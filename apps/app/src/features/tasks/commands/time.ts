// Time on a task (TV-D3, TV-D14): Focus stretches, adjustments and their
// Undo, a typed total, logged entries. Every write goes through one chain per
// task (`writeTime`), shown at once and settled by the server's total.
// Focus time itself is saved by the one time engine's app-shell sink, from any
// page (TV-P0, TV-F6): it puts each saved total straight into the store copy.

import { toast } from "sonner";

import type { TaskTimeEntry, TaskTimeResult, TrackTimeInput } from "../model";
import type { TaskCommandsContext, TimeAdjustment } from "./context";
import { isTempId, NO_EDIT, patchOf, type Shared, STILL_SAVING } from "./shared";

export function createTimeOps(ctx: TaskCommandsContext, shared: Shared) {
  const { store, runtime, workspaceId, data, env } = ctx;
  const { failed } = shared;

  /** Each task's time writes in flight, chained (see `writeTime`). */
  const timeChains = new Map<string, Promise<void>>();

  /**
   * Every time write (TV-D3): show it at once, send it through
   * `tasks_op_track_time`, then take the server's total, which already counts
   * everyone else's time. Only the task's time changes, never the rest of the
   * row. `delta` is what the write adds as far as this list can tell; if the
   * write fails or the task is gone, the shown total goes back.
   */
  const writeTime = (id: string, delta: number, input: TrackTimeInput): Promise<TaskTimeResult> => {
    if (!runtime || !store) return Promise.reject(new Error("Not signed in."));
    // One task's time writes go one at a time, in order, so each answer's
    // total includes every earlier write and the last one shown is the latest.
    const previous = timeChains.get(id) ?? Promise.resolve();
    const sent = previous.then(() => runtime.tasks.trackTime(input));
    const settled = sent.then(
      () => undefined,
      () => undefined,
    );
    timeChains.set(id, settled);
    void settled.then(() => {
      if (timeChains.get(id) === settled) timeChains.delete(id);
    });
    const before = data().allTasks.find((t) => t.id === id)?.timeSpentSeconds;
    const shown = before === undefined ? undefined : Math.max(0, before + Math.round(delta));
    const write = store.begin(
      before !== undefined && shown !== before ? [patchOf(id, { timeSpentSeconds: shown })] : [],
    );
    return sent.then(
      (result) => {
        if (result.totalSeconds === null) write.fail();
        else {
          store.patchCopy("tasks", id, { timeSpentSeconds: result.totalSeconds });
          write.settle();
        }
        return result;
      },
      (e) => {
        write.fail();
        throw e;
      },
    );
  };

  /** Why a time write can't be sent right now, or null. */
  const timeWriteBlocked = (id: string): string | null => {
    if (!runtime || !workspaceId || !env().canEdit) return NO_EDIT;
    if (isTempId(id)) return STILL_SAVING;
    if (store?.isOffline()) return "You're offline — time saves once you're back.";
    return null;
  };

  /**
   * Calendar's focus on a block (CAL-5) saving what it tracked, as a finished
   * focus stretch (a negative delta takes time away). Fire and forget; false
   * when it can't be sent now. Manual "+5m" and "Took longer" are adjustments:
   * `logTimeAdjustment`.
   */
  const addTimeSpent = (id: string, deltaSeconds: number): boolean => {
    if (!Number.isFinite(deltaSeconds) || Math.abs(deltaSeconds) < 1) return true; // nothing to persist
    if (timeWriteBlocked(id) || !workspaceId) return false;
    const seconds = Math.round(deltaSeconds);
    void writeTime(
      id,
      seconds,
      seconds > 0
        ? { workspaceId, taskId: id, action: "focus", seconds }
        : { workspaceId, taskId: id, action: "adjust", seconds },
    ).catch((e) => failed(e, "Couldn't save the time."));
    return true;
  };

  /**
   * Add (or take away) time as one adjustment, like Calendar's "Took longer".
   * Resolves to what `undoTimeAdjustment` needs to remove exactly that one, or
   * null when nothing was recorded.
   */
  const logTimeAdjustment = (id: string, deltaSeconds: number): Promise<TimeAdjustment | null> => {
    const seconds = Math.round(deltaSeconds);
    if (!Number.isFinite(seconds) || seconds === 0) return Promise.resolve(null);
    const blocked = timeWriteBlocked(id);
    if (blocked || !workspaceId) {
      toast.error(blocked ?? "Couldn't save the time.");
      return Promise.resolve(null);
    }
    return writeTime(id, seconds, { workspaceId, taskId: id, action: "adjust", seconds }).then(
      (result) => (result.status === "saved" ? { entryId: result.entryId, seconds } : null),
      (e) => {
        failed(e, "Couldn't save the time.");
        return null;
      },
    );
  };

  /** Undo an adjustment `logTimeAdjustment` made: removes exactly that one. */
  const undoTimeAdjustment = (id: string, adjustment: TimeAdjustment) => {
    if (timeWriteBlocked(id) || !workspaceId) return;
    void writeTime(id, -adjustment.seconds, {
      workspaceId,
      taskId: id,
      action: "undo",
      entryId: adjustment.entryId,
      seconds: adjustment.seconds,
    }).catch((e) => failed(e, "Couldn't undo that."));
  };

  /** Set the tracked total to a typed value: one adjustment makes it exactly that. */
  const setTimeSpent = (id: string, seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const blocked = timeWriteBlocked(id);
    if (blocked || !workspaceId) {
      toast.error(blocked ?? "Couldn't save the time.");
      return;
    }
    const total = Math.max(0, Math.round(seconds));
    const before = data().allTasks.find((t) => t.id === id)?.timeSpentSeconds ?? total;
    void writeTime(id, total - before, {
      workspaceId,
      taskId: id,
      action: "set_total",
      seconds: total,
    }).catch((e) => failed(e, "Couldn't save the time."));
  };

  /**
   * "Add time…" (TV-D14): log `seconds` on a day (YYYY-MM-DD) with an optional
   * note, as your own entry. Resolves true once saved; a resend after a lost
   * answer counts once (the key).
   */
  const logTime = (
    id: string,
    entry: { seconds: number; on: string; note?: string | null },
  ): Promise<boolean> => {
    const blocked = timeWriteBlocked(id);
    if (blocked || !workspaceId) {
      toast.error(blocked ?? "Couldn't log the time.");
      return Promise.resolve(false);
    }
    const seconds = Math.round(entry.seconds);
    return writeTime(id, seconds, {
      workspaceId,
      taskId: id,
      action: "add",
      seconds,
      on: entry.on,
      note: entry.note?.trim() ? entry.note.trim() : null,
      key: `add-${crypto.randomUUID()}`.slice(0, 64),
    }).then(
      (result) => result.status === "saved" || result.status === "duplicate",
      (e) => {
        failed(e, "Couldn't log the time.");
        return false;
      },
    );
  };

  /**
   * Change one of your own logged or Focus entries (TV-D14): its length, a
   * logged entry's day, its note ("" clears it). `delta` is the length's
   * change, for the total shown until the server answers.
   */
  const editTimeEntry = (
    id: string,
    entryId: string,
    change: { seconds?: number; on?: string; note?: string },
    delta = 0,
  ): Promise<boolean> => {
    const blocked = timeWriteBlocked(id);
    if (blocked || !workspaceId) {
      toast.error(blocked ?? "Couldn't change the entry.");
      return Promise.resolve(false);
    }
    return writeTime(id, delta, {
      workspaceId,
      taskId: id,
      action: "edit",
      entryId,
      seconds: change.seconds,
      on: change.on ?? null,
      note: change.note ?? null,
    }).then(
      (result) => result.status === "saved",
      (e) => {
        failed(e, "Couldn't change the entry.");
        return false;
      },
    );
  };

  /** Remove one of your own logged or Focus entries (TV-D14). */
  const removeTimeEntry = (id: string, entryId: string, seconds: number): Promise<boolean> => {
    const blocked = timeWriteBlocked(id);
    if (blocked || !workspaceId) {
      toast.error(blocked ?? "Couldn't remove the entry.");
      return Promise.resolve(false);
    }
    return writeTime(id, -seconds, {
      workspaceId,
      taskId: id,
      action: "remove",
      entryId,
    }).then(
      (result) => result.status === "saved",
      (e) => {
        failed(e, "Couldn't remove the entry.");
        return false;
      },
    );
  };

  /** Your own time entries on a task, newest first (TV-D14). */
  const listMyTimeEntries = (id: string): Promise<TaskTimeEntry[]> => {
    if (!runtime || !workspaceId || isTempId(id)) return Promise.resolve([]);
    return runtime.tasks.listMyTimeEntries(workspaceId, id);
  };

  return {
    addTimeSpent,
    logTimeAdjustment,
    undoTimeAdjustment,
    setTimeSpent,
    logTime,
    editTimeEntry,
    removeTimeEntry,
    listMyTimeEntries,
  };
}
