/**
 * The page half of task lines (Wave-3 NO-5, AC3/AC4) — implements the
 * editor bridge's `tasks` surface on top of the Tasks module hook + spine.
 * Owns every server write (mint, link, detach, revert) and the ONE-toast
 * contract; the editor plugin only ever hands over snapshots and callbacks.
 */

import { useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";

import { undoToast } from "../../../lib/undo-toast";
import type { ModuoRuntime } from "@/lib/runtime.types";
import type { EntityRef } from "@/lib/entity-links";
import { endPosition, makeTask } from "../../tasks/helpers";
import type { Task } from "../../tasks/model";
import type { TasksModuleApi } from "../../tasks/hooks/use-tasks-module";
import type { NotesTaskBridge } from "../editor/notes-editor-bridge";
import {
  applyTaskRename,
  buildMintTaskFields,
  buildTaskLineLink,
  type TaskLinkInput,
} from "../tasks/task-line";
import { buildDetachPlan, buildMintRevertPlan, type DetachPlan } from "../tasks/detach";

/** "⌘Z right after minting" is bounded — past this window a historic
 * removal detaches with the normal undoable toast instead of deleting. */
const MINT_REVERT_WINDOW_MS = 60_000;

type Params = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** The open note (task lines only exist inside one). */
  noteId: string | null;
  noteLabel: string;
  tasksApi: TasksModuleApi;
  onOpenTaskDetail: (taskId: string) => void;
};

export function useNotesTaskBridge({
  runtime,
  workspaceId,
  noteId,
  noteLabel,
  tasksApi,
  onOpenTaskDetail,
}: Params): NotesTaskBridge {
  // Tasks minted recently (⌘Z-after-mint reverts these, AC4) and a live
  // overlay so lines render the row before the bundle catches up. The mint
  // registry is TIME-BOUNDED: "⌘Z right after minting" is the immediate-
  // regret gesture — an hour-later undo sweep through history must NOT
  // quietly delete a task the user has since worked on (validator M2); past
  // the window a historic removal detaches with the normal undoable toast.
  const mintedRef = useRef(new Map<string, number>());
  const mintedOverlayRef = useRef(new Map<string, Task>());
  // Detaches whose toast is still live — a Lexical ⌘Z (instead of the toast's
  // Undo) re-creates the lines, and we re-link + retire the toast.
  const pendingDetachRef = useRef(
    new Map<string, { plan: DetachPlan; toastId: string | number }>(),
  );

  const tasksById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasksApi.tasks) {
      if (t.deletedAt === null) map.set(t.id, t);
    }
    return map;
  }, [tasksApi.tasks]);

  const stable = useRef({ runtime, workspaceId, noteId, noteLabel, tasksApi, tasksById });
  stable.current = { runtime, workspaceId, noteId, noteLabel, tasksApi, tasksById };

  const noteRef = useCallback((): EntityRef | null => {
    const { noteId: id } = stable.current;
    return id ? { type: "note", id } : null;
  }, []);

  const getTask = useCallback((taskId: string): Task | null => {
    const { tasksById: byId } = stable.current;
    const fromBundle = byId.get(taskId);
    if (fromBundle) return fromBundle;
    const minted = mintedOverlayRef.current.get(taskId);
    // The overlay only fills the gap until the bundle knows the task.
    return minted && !byId.has(taskId) ? minted : null;
  }, []);

  const restoreLinks = useCallback(async (links: TaskLinkInput[]) => {
    const { runtime: rt } = stable.current;
    if (!rt) return;
    // `links_op_create` is idempotent — re-creating an existing pair no-ops.
    await Promise.all(links.map((input) => rt.spine.createLink(input)));
  }, []);

  const listNoteLinks = useCallback(async (noteId?: string) => {
    const { runtime: rt, workspaceId: ws, noteId: current } = stable.current;
    const id = noteId ?? current;
    if (!rt || !ws || !id) return [];
    return rt.spine.listLinks({ workspaceId: ws, entityType: "note", entityId: id });
  }, []);

  const mintTask = useCallback(async (title: string): Promise<Task | null> => {
    const { runtime: rt, workspaceId: ws, tasksApi: api, noteLabel: label } = stable.current;
    const note = noteRef();
    if (!rt || !ws || !note || !api.canEdit) return null;
    const inbox = api.inbox;
    if (!inbox) {
      toast.error("Tasks are still loading — try again in a moment.");
      return null;
    }
    try {
      // Position past BOTH the bundle and the not-yet-reloaded overlay so
      // back-to-back mints don't collide on the same Inbox tail slot.
      const inboxTasks = api.tasks
        .filter((t) => t.bucketId === inbox.id)
        .concat(
          [...mintedOverlayRef.current.values()].filter((t) => t.bucketId === inbox.id),
        );
      const fields = buildMintTaskFields({
        workspaceId: ws,
        inboxBucketId: inbox.id,
        title,
        position: endPosition(inboxTasks),
      });
      const saved = await rt.tasks.upsertTask({ ...makeTask(fields), id: "" });
      mintedRef.current.set(saved.id, Date.now());
      mintedOverlayRef.current.set(saved.id, saved);
      await rt.spine.createLink(
        buildTaskLineLink({
          workspaceId: ws,
          note,
          noteLabel: label,
          taskId: saved.id,
          taskTitle: saved.title,
          minted: true,
        }),
      );
      void api.reload();
      return saved;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the task.");
      return null;
    }
  }, [noteRef]);

  const linkExistingTask = useCallback(
    (task: Task) => {
      const { runtime: rt, workspaceId: ws, noteLabel: label } = stable.current;
      const note = noteRef();
      if (!rt || !ws || !note) return;
      const input = buildTaskLineLink({
        workspaceId: ws,
        note,
        noteLabel: label,
        taskId: task.id,
        taskTitle: task.title,
        minted: false,
      });
      void rt.spine.createLink(input).catch(() => {
        toast.error("Couldn't link that task.", {
          action: { label: "Retry", onClick: () => void rt.spine.createLink(input) },
        });
      });
    },
    [noteRef],
  );

  const detachTaskLines = useCallback<NotesTaskBridge["detachTaskLines"]>(
    ({ noteId, lines, restoreLines: restoreLineNodes, mode }) => {
      const { runtime: rt, workspaceId: ws, noteLabel: label, tasksApi: api } = stable.current;
      const id = noteId;
      if (!rt || !ws || !id || lines.length === 0) return;
      void (async () => {
        try {
          const links = await listNoteLinks(id);
          const plan = buildDetachPlan({
            workspaceId: ws,
            noteId: id,
            noteLabel: label,
            lines,
            links,
          });
          if (!plan) return;
          await Promise.all(
            plan.linkIds.map((linkId) => rt.spine.deleteLink({ workspaceId: ws, linkId })),
          );
          if (mode === "keep") return;
          // One grammar (DF-5): Undo in the action slot; the destructive
          // "delete the tasks too" escalation rides the body via undoToast's
          // `danger`, never sonner's `cancel` slot (a destructive verb in the
          // dismiss position).
          const toastId = undoToast(plan.toastLabel, {
            description: "Still in Tasks.",
            onUndo: () => {
              for (const taskId of plan.taskIds) pendingDetachRef.current.delete(taskId);
              restoreLineNodes();
              void restoreLinks(plan.restoreLinks);
            },
            danger: {
              label: plan.taskIds.length === 1 ? "Delete the task too" : "Delete the tasks too",
              // The escalation is a deliberate destructive choice made from
              // inside this toast — delete via the runtime (silent) + reload,
              // NOT api.deleteTask (which would stack one "Task deleted" undo
              // toast per task on top of this one).
              onClick: () => {
                void (async () => {
                  for (const taskId of plan.taskIds) pendingDetachRef.current.delete(taskId);
                  await Promise.all(
                    plan.taskIds.map((taskId) => rt.tasks.deleteTask({ workspaceId: ws, taskId })),
                  );
                  void api.reload();
                })().catch(() => toast.error("Couldn't delete the tasks."));
              },
            },
          });
          for (const taskId of plan.taskIds) {
            pendingDetachRef.current.set(taskId, { plan, toastId });
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Couldn't detach the task.");
        }
      })();
    },
    [listNoteLinks, restoreLinks],
  );

  const detachAndDeleteTask = useCallback<NotesTaskBridge["detachAndDeleteTask"]>(
    ({ noteId, line, restoreLine }) => {
      const { runtime: rt, workspaceId: ws, noteLabel: label, tasksApi: api } = stable.current;
      const id = noteId;
      if (!rt || !ws || !id) return;
      const snapshot = getTask(line.taskId);
      void (async () => {
        try {
          const links = await listNoteLinks(id);
          const plan = buildDetachPlan({
            workspaceId: ws,
            noteId: id,
            noteLabel: label,
            lines: [line],
            links,
          });
          if (plan) {
            await Promise.all(
              plan.linkIds.map((linkId) => rt.spine.deleteLink({ workspaceId: ws, linkId })),
            );
          }
          // Runtime delete (not the hook's) — a just-minted task may not be
          // in the bundle yet and the hook's deleteTask no-ops on unknowns.
          await rt.tasks.deleteTask({ workspaceId: ws, taskId: line.taskId });
          void api.reload();
          undoToast("Task deleted", {
            onUndo: () => {
              void (async () => {
                // Un-delete (soft delete = a stamp; the upsert clears it),
                // re-link, and give the line its task back.
                if (snapshot) await rt.tasks.upsertTask({ ...snapshot, deletedAt: null });
                if (plan) await restoreLinks(plan.restoreLinks);
                restoreLine();
                void api.reload();
              })().catch(() => toast.error("Couldn't restore the task."));
            },
          });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Couldn't delete the task.");
        }
      })();
    },
    [getTask, listNoteLinks, restoreLinks],
  );

  const revertMintIfJustMinted = useCallback(
    (taskId: string): boolean => {
      const mintedAt = mintedRef.current.get(taskId);
      if (mintedAt === undefined) return false;
      if (Date.now() - mintedAt > MINT_REVERT_WINDOW_MS) {
        mintedRef.current.delete(taskId); // aged out — normal detach applies
        return false;
      }
      mintedRef.current.delete(taskId);
      mintedOverlayRef.current.delete(taskId);
      const { runtime: rt, workspaceId: ws, noteId: id, tasksApi: api } = stable.current;
      if (!rt || !ws || !id) return true;
      void (async () => {
        const links = await listNoteLinks();
        const plan = buildMintRevertPlan({ noteId: id, taskId, links });
        await Promise.all(
          plan.linkIds.map((linkId) => rt.spine.deleteLink({ workspaceId: ws, linkId })),
        );
        // Straight to the runtime: the just-minted task may not be in the
        // hook's bundle yet (reload in flight) and the hook's deleteTask
        // silently no-ops on unknown ids (validator M1).
        await rt.tasks.deleteTask({ workspaceId: ws, taskId });
        void api.reload();
      })().catch(() => {
        // Quiet — the worst case is an orphaned Inbox task the user can delete.
      });
      return true;
    },
    [listNoteLinks],
  );

  const restoreDetachedTasks = useCallback(
    (taskIds: string[]) => {
      const seenToasts = new Set<string | number>();
      for (const taskId of taskIds) {
        const pending = pendingDetachRef.current.get(taskId);
        if (!pending) continue;
        pendingDetachRef.current.delete(taskId);
        void restoreLinks(
          pending.plan.restoreLinks.filter(
            (l) => l.target.id === taskId || l.source.id === taskId,
          ),
        );
        if (!seenToasts.has(pending.toastId)) {
          seenToasts.add(pending.toastId);
          // Retire the toast only once every task it covered is back.
          const stillPending = pending.plan.taskIds.some((tid) =>
            pendingDetachRef.current.has(tid),
          );
          if (!stillPending) toast.dismiss(pending.toastId);
        }
      }
    },
    [restoreLinks],
  );

  // NOTE: `tasksById` is a real dependency — the bridge's IDENTITY must change
  // whenever the tasks bundle does, or the editor plugin (which reads tasks
  // through this object) never re-renders lines/effects on a bundle refresh
  // (caught in NO-5 live-verify: a checked task stayed visually unchecked).
  return useMemo<NotesTaskBridge>(
    () => ({
      canEditTasks: tasksApi.canEdit && Boolean(noteId),
      getTask,
      listLinkableTasks: () => stable.current.tasksApi.tasks,
      toggleTask: (taskId) => {
        const task = getTask(taskId);
        if (task) stable.current.tasksApi.toggleDone(task);
      },
      renameTask: (taskId, lineText) => {
        const task = getTask(taskId);
        if (!task) return;
        const patch = applyTaskRename(task, lineText);
        if (patch) stable.current.tasksApi.patchTask(taskId, patch);
      },
      scheduleTaskAt: (taskId, iso) => {
        if (iso) stable.current.tasksApi.scheduleTaskAt(taskId, iso);
        else stable.current.tasksApi.unscheduleTask(taskId);
      },
      mintTask,
      linkExistingTask,
      detachTaskLines,
      detachAndDeleteTask,
      revertMintIfJustMinted,
      restoreDetachedTasks,
      openTaskDetail: onOpenTaskDetail,
    }),
    [
      tasksApi.canEdit,
      noteId,
      tasksById,
      getTask,
      mintTask,
      linkExistingTask,
      detachTaskLines,
      detachAndDeleteTask,
      revertMintIfJustMinted,
      restoreDetachedTasks,
      onOpenTaskDetail,
    ],
  );
}
