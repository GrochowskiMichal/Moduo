// The bulk writes on a selection beyond fields (TV-U12): delete, Focus (my
// queue), Waiting on, tags. Each is one write with one Undo, every task
// through its own server op (`bulk-write.ts` has the shared pool).

import { toast } from "sonner";
import { isNetworkError } from "../../../lib/sync/network";
import type { OverlayChange } from "../../../lib/sync/store";
import { undoToast } from "../../../lib/undo-toast";
import { attachOrDetachMany, tagNamed } from "../../tags/store";
import { type BulkRefusal, bulkResultText, tasksWord } from "../bulk";
import { betweenPositions } from "../helpers";
import type { Task, TaskQueueEntry, TaskWaitingEntry } from "../model";
import { endOfQueue } from "../queue";
import { isArchivedIn, messageOf, runPool } from "./bulk-write";
import type { TaskCommandsContext } from "./context";
import { isTempId, patchOf, type Shared } from "./shared";

export type BulkQueueOptions = {
  /** "toggle" (the bar's Focus, Q): out when every one is in already, else in.
   *  "add" (a drop on the Focus row): only ever adds. Default "toggle". */
  mode?: "add" | "toggle";
};

export function createBulkOps(ctx: TaskCommandsContext, shared: Shared) {
  const { store, runtime, workspaceId, userId, data, env, bumpActivity } = ctx;
  const {
    backlogToTodo,
    editBlocked,
    failed,
    isBlocked,
    optimisticEntry,
    queueFollowStatus,
    runQueueOp,
    tagContext,
  } = shared;
  const isArchived = (taskId: string) => isArchivedIn(store, taskId);

  /**
   * Delete several tasks as one write with one Undo (soft deletes; their
   * subtasks become top-level, as one delete does, and Undo re-attaches them).
   */
  const bulkDelete = async (ids: readonly string[]) => {
    if (editBlocked() || !store || !runtime || !workspaceId) return;
    const rt = runtime;
    const ws = workspaceId;
    const refused = new Map<string, BulkRefusal>();
    const targets: Task[] = [];
    for (const id of ids) {
      const t = data().allTasks.find((x) => x.id === id);
      if (!t || t.deletedAt) continue;
      if (isTempId(id) || isArchived(id)) {
        refused.set(id, { title: t.title, message: "It can’t be deleted right now." });
        continue;
      }
      targets.push(t);
    }
    if (targets.length === 0) return;
    const deleting = new Set(targets.map((t) => t.id));
    const children = data().allTasks.filter(
      (t) => t.parentId && deleting.has(t.parentId) && !t.deletedAt && !deleting.has(t.id),
    );
    const follows = targets.map((t) => queueFollowStatus(t.id, "deleted"));
    const write = store.begin([
      ...targets.map((t) => ({ table: "tasks", remove: t.id }) as OverlayChange),
      ...children.map((c) => patchOf(c.id, { parentId: null })),
      ...follows.flatMap((f) => f.changes),
    ]);
    const deleted: Task[] = [];
    let offlineError: unknown = null;
    const send = async (t: Task) => {
      try {
        deleted.push(await rt.tasks.deleteTask({ workspaceId: ws, taskId: t.id }));
      } catch (e) {
        if (isNetworkError(e)) offlineError = e;
        else refused.set(t.id, { title: t.title, message: messageOf(e) });
      }
    };
    // A selected subtask goes before its selected parent: the parent's delete
    // promotes only live subtasks, so this one keeps its parent and Undo
    // brings it back under it.
    const withParent = targets.filter((t) => t.parentId && deleting.has(t.parentId));
    const rest = targets.filter((t) => !withParent.includes(t));
    const offline = () => offlineError !== null;
    await runPool(withParent, send, offline);
    await runPool(rest, send, offline);
    write.settle({ tasks: deleted });
    const done = new Set(deleted.map((t) => t.id));
    const promoted = children.filter((c) => c.parentId && done.has(c.parentId));
    for (const c of promoted) store.patchCopy("tasks", c.id, { parentId: null });
    store.forget(
      "queue",
      follows.flatMap((f, i) => (done.has(targets[i].id) ? f.rowIds : [])),
    );
    if (offlineError) failed(offlineError, "");
    if (done.size > 0) {
      bumpActivity();
      void env().reloadTrash();
    }
    const text = bulkResultText(`Deleted ${tasksWord(done.size)}`, {
      changed: done.size,
      total: targets.length + refused.size,
      refused: [...refused.values()],
    });
    if (done.size === 0) {
      if (refused.size > 0) toast.error(text.title, { description: text.description });
      return;
    }
    undoToast(text.title, {
      description: text.description,
      onUndo: () => {
        void (async () => {
          // Each restore stands alone: one refused (its 30 days ran out,
          // access changed) never stops the rest or hides what came back.
          const rows: Task[] = [];
          const notRestored: BulkRefusal[] = [];
          const restored = new Set<string>();
          await runPool(
            [...done],
            async (id) => {
              try {
                rows.push(
                  await rt.tasks.updateTask({
                    workspaceId: ws,
                    taskId: id,
                    patch: { deletedAt: null },
                  }),
                );
                restored.add(id);
              } catch (e) {
                const title = targets.find((t) => t.id === id)?.title ?? "";
                notRestored.push({ title, message: messageOf(e) });
              }
            },
            () => false,
          );
          // Re-attach the subtasks still at the top level, under the parents
          // that came back.
          let detached = 0;
          await runPool(
            promoted.filter((c) => {
              if (!c.parentId || !restored.has(c.parentId)) return false;
              const now = data().allTasks.find((t) => t.id === c.id);
              return !now || now.parentId === null;
            }),
            async (c) => {
              try {
                rows.push(
                  await rt.tasks.updateTask({
                    workspaceId: ws,
                    taskId: c.id,
                    patch: { parentId: c.parentId },
                  }),
                );
              } catch {
                detached += 1;
              }
            },
            () => false,
          );
          if (rows.length > 0) {
            store.answer({ tasks: rows });
            bumpActivity();
          }
          await env().reloadTrash();
          if (notRestored.length === 1) {
            toast.error(`Couldn’t restore “${notRestored[0].title || "Untitled"}”`, {
              description: notRestored[0].message,
            });
          } else if (notRestored.length > 1) {
            toast.error(`Couldn’t restore ${tasksWord(notRestored.length)}`, {
              description: notRestored[0].message,
            });
          } else if (detached > 0) {
            toast.error(
              `${detached === 1 ? "A subtask" : `${detached} subtasks`} stayed at the top level.`,
            );
          }
        })().catch(() => toast.error("Couldn’t restore every task."));
      },
    });
  };

  /**
   * Focus (Q) on a selection: add the ones not in my line-up yet, at its end,
   * in order; or, when every one is in it already, take them all out. One
   * queue op, one Undo. A drop on the Focus row passes `mode: "add"`: it never
   * takes anything out. A selection never opens the one-task frontier offer;
   * blocked ones are added as "Queue anyway" would, and the toast names them.
   */
  const bulkQueue = (ids: readonly string[], options: BulkQueueOptions = {}) => {
    if (!store) return;
    const mine = new Set(data().myQueueEntries.map((e) => e.taskId));
    // What the last add saved and refused (for its toast and Undo).
    let lastRefusals: BulkRefusal[] = [];
    let lastAdded: string[] = [];
    const tasks = ids
      .map((id) => data().allTasks.find((t) => t.id === id))
      .filter((t): t is Task => !!t && !t.deletedAt && !isTempId(t.id));
    const open = tasks.filter((t) => t.status !== "done" && t.status !== "archived");
    const removing = options.mode !== "add" && open.length > 0 && open.every((t) => mine.has(t.id));
    const queueAdd = (list: readonly string[], onSaved: (added: number) => void) => {
      // Queuing a backlog task moves it to To do (the server does it).
      const toTodo = list
        .map((id) => data().allTasks.find((t) => t.id === id))
        .flatMap((t) => {
          const fields = t ? backlogToTodo(t) : null;
          return t && fields ? [patchOf(t.id, fields)] : [];
        });
      const shownTodo = toTodo.length > 0 ? store.begin(toTodo) : null;
      const added: string[] = [];
      const refusedAdds: BulkRefusal[] = [];
      lastRefusals = refusedAdds;
      lastAdded = added;
      const started = runQueueOp(
        (lineup) => {
          const rest = lineup.filter((e) => !list.includes(e.taskId));
          let prev = endOfQueue(rest);
          const added: TaskQueueEntry[] = [];
          for (const id of list) {
            added.push(optimisticEntry(id, prev));
            prev = betweenPositions(prev, null);
          }
          return [...rest, ...added];
        },
        async (rt, ws) => {
          let last: TaskQueueEntry[] | null = null;
          let firstError: unknown = null;
          for (const id of list) {
            try {
              last = await rt.tasks.opQueueAdd({ workspaceId: ws, taskId: id, at: "end" });
              added.push(id);
            } catch (e) {
              if (isNetworkError(e)) throw e;
              firstError ??= e;
              const t = data().allTasks.find((x) => x.id === id);
              refusedAdds.push({ title: t?.title ?? "", message: messageOf(e) });
            }
          }
          if (!last) {
            shownTodo?.fail();
            throw firstError ?? new Error("Couldn’t add them to Focus.");
          }
          return last;
        },
        () => {
          onSaved(added.length);
          if (shownTodo) void store.syncNow().finally(() => shownTodo.settle());
        },
      );
      if (!started) shownTodo?.fail();
    };
    const queueRemove = (
      list: readonly string[],
      onSaved: (removed: string[], refused: BulkRefusal[]) => void,
    ) => {
      // Each removal stands alone (as each add does): one refused never
      // stops the rest; the line-up the server answered last is the truth.
      const removed: string[] = [];
      const refusedRemoves: BulkRefusal[] = [];
      runQueueOp(
        (lineup) => lineup.filter((e) => !list.includes(e.taskId)),
        async (rt, ws) => {
          let last: TaskQueueEntry[] | null = null;
          let firstError: unknown = null;
          for (const id of list) {
            try {
              last = await rt.tasks.opQueueRemove({ workspaceId: ws, taskId: id });
              removed.push(id);
            } catch (e) {
              if (isNetworkError(e)) throw e;
              firstError ??= e;
              const t = data().allTasks.find((x) => x.id === id);
              refusedRemoves.push({ title: t?.title ?? "", message: messageOf(e) });
            }
          }
          if (!last) throw firstError ?? new Error("Couldn’t take them out of Focus.");
          return last;
        },
        () => onSaved(removed, refusedRemoves),
      );
    };
    if (removing) {
      const list = open.map((t) => t.id);
      queueRemove(list, (removed, refusedRemoves) => {
        const text = bulkResultText(`Removed ${tasksWord(removed.length)} from Focus`, {
          changed: removed.length,
          total: list.length,
          refused: refusedRemoves,
        });
        undoToast(text.title, {
          description: text.description,
          onUndo: () => queueAdd(removed, () => {}),
        });
      });
      return;
    }
    const list = open.filter((t) => !mine.has(t.id)).map((t) => t.id);
    if (list.length === 0) {
      toast(
        open.length > 0
          ? `${open.length === 1 ? "It’s" : "They’re"} in Focus already.`
          : "Done and Won’t do tasks can’t be added to Focus.",
      );
      return;
    }
    queueAdd(list, (count) => {
      const text = bulkResultText(`Added ${tasksWord(count)} to Focus`, {
        changed: count,
        total: list.length,
        refused: lastRefusals,
      });
      const added = [...lastAdded];
      // Blocked ones went in as asked (never a wall), named so it's no surprise.
      const blocked = added.filter((id) => isBlocked(id));
      if (blocked.length > 0 && !text.description) {
        const title = data().allTasks.find((t) => t.id === blocked[0])?.title || "Untitled";
        text.description =
          blocked.length === 1
            ? `“${title}” is blocked by an open task.`
            : `${blocked.length} of them are blocked by open tasks.`;
      }
      undoToast(text.title, {
        description: text.description,
        onUndo: () =>
          queueRemove(added, (_removed, refusedRemoves) => {
            if (refusedRemoves.length > 0) {
              toast.error(`Couldn’t take ${tasksWord(refusedRemoves.length)} out of Focus.`);
            }
          }),
      });
    });
  };

  /** Waiting on someone or something, for each task: one write, one Undo. */
  const bulkWaiting = async (
    ids: readonly string[],
    entry: { kind: TaskWaitingEntry["kind"]; ref?: string | null; label?: string | null },
    label: string,
    existing: readonly TaskWaitingEntry[],
  ) => {
    if (editBlocked() || !store || !runtime || !workspaceId) return;
    const rt = runtime;
    const ws = workspaceId;
    const now = new Date().toISOString();
    // Already waiting on that person: left as it is.
    const waitingAlready = new Set(
      entry.kind === "person"
        ? existing.filter((e) => e.kind === "person" && e.ref === entry.ref).map((e) => e.taskId)
        : [],
    );
    const tasks = ids
      .map((id) => data().allTasks.find((t) => t.id === id))
      .filter(
        (t): t is Task =>
          !!t && !t.deletedAt && !isTempId(t.id) && !isArchived(t.id) && !waitingAlready.has(t.id),
      );
    if (tasks.length === 0) return;
    const shownRows = tasks.map(
      (t): TaskWaitingEntry => ({
        id: crypto.randomUUID(),
        workspaceId: ws,
        taskId: t.id,
        kind: entry.kind,
        ref: entry.ref ?? null,
        label: entry.label ?? null,
        since: now,
        createdBy: userId,
        updatedAt: now,
      }),
    );
    const write = store.begin(shownRows.map((r) => ({ table: "waiting", insert: r })));
    const rows: TaskWaitingEntry[] = [];
    const added: TaskWaitingEntry[] = [];
    const refused: BulkRefusal[] = [];
    let offlineError: unknown = null;
    await runPool(
      shownRows,
      async (r) => {
        try {
          rows.push(
            ...(await rt.tasks.addWaiting({
              workspaceId: ws,
              taskId: r.taskId,
              id: r.id,
              kind: r.kind,
              ref: r.ref,
              label: r.label,
            })),
          );
          added.push(r);
        } catch (e) {
          if (isNetworkError(e)) offlineError = e;
          else {
            const t = tasks.find((x) => x.id === r.taskId);
            refused.push({ title: t?.title ?? "", message: messageOf(e) });
          }
        }
      },
      () => offlineError !== null,
    );
    write.settle({ waiting: rows });
    if (offlineError) failed(offlineError, "");
    if (added.length > 0) bumpActivity();
    const text = bulkResultText(`${tasksWord(added.length)} waiting on ${label}`, {
      changed: added.length,
      total: tasks.length,
      refused,
    });
    if (added.length === 0) {
      if (refused.length > 0) toast.error(text.title, { description: text.description });
      return;
    }
    undoToast(text.title, {
      description: text.description,
      onUndo: () => {
        const back = store.begin(added.map((r) => ({ table: "waiting", remove: r.id })));
        void (async () => {
          // Each removal stands alone: one refused keeps its entry on show,
          // the rest still go.
          const left: TaskWaitingEntry[] = [];
          const removed: string[] = [];
          let firstError: unknown = null;
          await runPool(
            added,
            async (r) => {
              try {
                left.push(...(await rt.tasks.removeWaiting({ workspaceId: ws, entryId: r.id })));
                removed.push(r.id);
              } catch (e) {
                firstError ??= e;
              }
            },
            () => false,
          );
          if (removed.length > 0) store.forget("waiting", removed);
          const gone = new Set(removed);
          // What the server still has (a refused entry) shows again.
          back.settle({ waiting: left.filter((w) => !gone.has(w.id)) });
          if (removed.length > 0) bumpActivity();
          if (firstError) failed(firstError, "Couldn’t undo it for every task.");
        })().catch((e) => {
          back.fail();
          failed(e, "Couldn’t undo it.");
        });
      },
    });
  };

  /**
   * A tag on every task of a selection, or off every one when they all have
   * it: one toast, one Undo (tags live in the workspace tag store, TV-T1).
   */
  const bulkTag = async (
    ids: readonly string[],
    wanted: { id: string; name: string } | { name: string },
    has: (id: string) => boolean,
  ) => {
    const ctx = tagContext();
    if (!ctx) return;
    // A typed name that matches no tag makes one (shown at once; the links
    // wait for its row).
    const tag = "id" in wanted ? wanted : tagNamed(ctx, wanted.name);
    if (!tag) return;
    const tasks = ids
      .map((id) => data().allTasks.find((t) => t.id === id))
      .filter((t): t is Task => !!t && !t.deletedAt && !isTempId(t.id) && !isArchived(t.id));
    if (tasks.length === 0) return;
    const removing = tasks.every((t) => has(t.id));
    const touched = tasks.filter((t) => has(t.id) === removing);
    const entities = touched.map((t) => ({ entityType: "task", entityId: t.id }));
    const result = await attachOrDetachMany(ctx, tag.id, entities, !removing);
    const okIds = new Set(result.changed.map((e) => e.entityId));
    const refused = result.failed.map((f) => ({
      title: touched.find((t) => t.id === f.entity.entityId)?.title ?? "",
      message: f.message,
    }));
    const label = removing
      ? `Removed “${tag.name}” from ${tasksWord(okIds.size)}`
      : `Tagged ${tasksWord(okIds.size)} “${tag.name}”`;
    const text = bulkResultText(label, {
      changed: okIds.size,
      total: touched.length,
      refused,
    });
    if (okIds.size === 0) {
      if (refused.length > 0) toast.error(text.title, { description: text.description });
      return;
    }
    undoToast(text.title, {
      description: text.description,
      onUndo: () => {
        void attachOrDetachMany(ctx, tag.id, result.changed, removing).then((r) => {
          if (r.failed.length > 0) toast.error("Couldn’t undo every tag.");
        });
      },
    });
  };

  return { bulkDelete, bulkQueue, bulkWaiting, bulkTag };
}
