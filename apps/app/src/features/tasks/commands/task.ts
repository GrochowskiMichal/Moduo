// A task's own commands: create, edit (field by field, or through an intent
// op), take, delete and restore, subtasks, a drop's write and its Undo, and
// blocked-by edges.

import { isClosedTask, isOpenTask, taskCategoryOf } from "@contracts/vocabularies";
import { toast } from "sonner";

import { undoToast } from "../../../lib/undo-toast";
import { type TaskDropWrite, undoWrite } from "../dnd/drop-write";
import { bucketEndPosition } from "../dnd/rail-drop";
import { endPosition, formatScheduled, makeTask, wouldCreateCycle } from "../helpers";
import type { ActivityEntry, RecurrenceRule, Task, TaskRelation } from "../model";
import { handedOutOfSight, patchOfWrite, planTaskWrite, type WritePlan } from "../write-plan";
import type { NewTaskInput, TaskCommandsContext, TaskPeers } from "./context";
import { isTempId, NO_EDIT, patchOf, type Shared, STILL_SAVING } from "./shared";

export function createTaskOps(ctx: TaskCommandsContext, shared: Shared, peers: TaskPeers) {
  const { store, runtime, workspaceId, userId, data, env, bumpActivity } = ctx;
  const {
    applyOp,
    applyQueueFollow,
    archivedBlocked,
    editBlocked,
    failed,
    planContext,
    queueFollowStatus,
    refused,
    sendNewTask,
  } = shared;

  /** Read again now (a Retry): the store asks the server for what changed. */
  const load = async () => {
    await store?.reload();
  };

  /**
   * Search every task on the server while the copy can't answer alone
   * (TV-D11b): the ids that match; the store reads the rows it lacks, so they
   * show like any other. Null when the copy is enough (or offline).
   */
  const searchTasks = (query: string): Promise<string[] | null> =>
    store ? store.searchTasks(query) : Promise.resolve(null);

  /**
   * Take a team's unclaimed task (TV-D13, "Take it" on My tasks' team block):
   * shown as yours at once; the server checks you're in its team and can edit
   * it, and refuses one somebody took first (the copy goes back and says so).
   */
  const claimTask = (id: string, onClaimed?: () => void) => {
    if (!userId) return;
    applyOp(
      id,
      { assigneeId: userId },
      () => runtime!.tasks.opClaim({ workspaceId: workspaceId!, taskId: id }),
      // Only a claim the server took says so (TV-U15's "Taken" toast).
      { onSaved: onClaimed ? () => onClaimed() : undefined },
    );
  };

  /** Fetch a task's quiet activity trail (newest first). */
  const loadActivity = async (taskId: string): Promise<ActivityEntry[]> => {
    if (!runtime || !workspaceId || !env().canRead || isTempId(taskId)) return [];
    return runtime.tasks.listActivity({
      workspaceId,
      entityType: "task",
      entityId: taskId,
      limit: 50,
      module: "tasks",
    });
  };

  // ── task mutations ───────────────────────────────────────────────────────────
  /**
   * Create a task (shown at once). Resolves to the saved task, or null if it
   * wasn't created (or waits offline) — what `createTagForTask` takes to tag it
   * before it exists.
   */
  const createTask = (fields: NewTaskInput): Promise<Task | null> => {
    if (!runtime || !workspaceId || !env().canEdit || !store) {
      toast.error(NO_EDIT);
      return Promise.resolve(null);
    }
    const bucketTasks = data().liveTasks.filter((t) => t.bucketId === fields.bucketId);
    const position = endPosition(bucketTasks);
    const optimistic = makeTask({ ...fields, workspaceId, position });
    // Shown right away; the server records the same creator. An assignee
    // left unchosen is the creator (as before TV-D1).
    optimistic.creatorId = userId ?? "";
    if (optimistic.assigneeId === "") optimistic.assigneeId = userId;
    optimistic.id = `tmp-${crypto.randomUUID()}`;
    return sendNewTask(optimistic);
  };

  /** "Still in Backlog · Move to To do": the offer after assigning a backlog
   *  task or giving it a due date. */
  const offerMoveToTodo = (task: Task) => {
    const title = task.title.trim() || "This task";
    toast(`${title} is still in Backlog`, {
      description: "Backlog tasks stay out of My tasks, Upcoming and Focus.",
      action: {
        label: "Move to To do",
        onClick: () => peers.setTaskStatus(task.id, { category: "todo" }),
      },
    });
  };

  /** Say why a planned write can't start (a deleted task's is quiet). */
  const sayRefused = (plan: Extract<WritePlan, { kind: "refused" }>) => {
    if (plan.reason === "no-edit") toast.error(NO_EDIT);
    else if (plan.reason === "still-saving") toast.error(STILL_SAVING);
    else if (plan.reason === "archived") {
      // A task of an archived project is read-only until it's unarchived (TV-U6).
      toast.error(`Unarchive “${plan.projectName ?? "its project"}” to change its tasks.`);
    }
  };

  /**
   * Edit one task: the decision and what shows at once are `planTaskWrite`'s
   * (the same rules a drop and a bulk write follow); the ops it goes by are
   * picked here. Answers the plan (null for a task the copy doesn't have), so
   * a status command can follow up only on a write that started.
   */
  const writeTask = (id: string, patch: Partial<Task>): WritePlan | null => {
    const existing = data().allTasks.find((t) => t.id === id);
    if (!existing) return null;
    const planCtx = planContext();
    const plan = planTaskWrite(existing, patch, planCtx);
    if (plan.kind === "refused") {
      sayRefused(plan);
      return plan;
    }
    if (plan.kind === "noop") return plan;
    const { followUps } = plan;
    if (plan.status && followUps.restoreReminders) {
      peers.offerReminderRestore(existing, plan.status.category);
    }
    // Assigning a backlog task or giving it a due date offers to plan it
    // (REPLAN 53): it stays in Backlog unless you say so.
    if (followUps.moveToTodo) offerMoveToTodo(existing);
    if (followUps.nextOccurrence) {
      // Quiet, factual mirror — when this comes back (never a wall).
      // "Done — next: Tomorrow, 9:00 AM" (the one grammar reads "Tomorrow").
      toast(`Done — next: ${formatScheduled(followUps.nextOccurrence)}`);
    }
    const { assigneeId: _assignee, ...shown } = plan.shown;
    // Assignment is an intent op (tasks.assign): the RPC checks the person can
    // take tasks, and the server notifies them. The rest of the patch, if
    // any, saves as usual below.
    if (plan.assigneeId !== undefined) {
      const assigneeId = plan.assigneeId;
      // Someone else's unfiled task handed on into another Inbox (TV-D13,
      // call 20) is out of my sight now: drop it and the steps that went
      // with it, rather than keep them until the next access check.
      const leaves = (saved: Task) => handedOutOfSight(saved, existing, planContext());
      // An Inbox task assigned and edited in one gesture ("Assign to Mike ·
      // in Bugs", 20a): the edit lands first, then the assignment, so a
      // hand-over can't take the task away before the edit does.
      const inInbox = planCtx.bucketsById.get(existing.bucketId)?.isSystem === true;
      if (inInbox && Object.keys(plan.columns).length > 0) {
        if (plan.status) applyQueueFollow(id, plan.queue);
        // The edit answers every row it changed (a move's subtasks too):
        // settled with the assignment's row in one go.
        let edited: Task[] = [];
        applyOp(
          id,
          plan.shown,
          async () => {
            edited = await runtime!.tasks.opUpdateTask({
              workspaceId: workspaceId!,
              taskId: id,
              patch: plan.columns,
            });
            return runtime!.tasks.opAssign({ workspaceId: workspaceId!, taskId: id, assigneeId });
          },
          {
            leaves,
            extra: plan.alongside,
            forget: plan.queue.rowIds,
            rows: () => edited,
            // A refused check-off isn't kept on show in my queue.
            ...(plan.status ? { onRefused: () => store?.unkeep(id) } : {}),
          },
        );
        return plan;
      }
      applyOp(
        id,
        { assigneeId },
        () => runtime!.tasks.opAssign({ workspaceId: workspaceId!, taskId: id, assigneeId }),
        { leaves },
      );
      // Offline, applyOp has already said so; don't say it twice.
      if (Object.keys(plan.columns).length === 0 || store?.isOffline()) return plan;
    }
    // Status changes are an intent op (tasks.set_status): the RPC enforces
    // the invariants server-side and logs attributed activity. Only the
    // status cluster (status / recurrence ride-along / board position) goes
    // that way — plain field edits below are field-level writes (contract §1).
    // A check-off is the one edit that waits on the device when offline.
    if (plan.status && Object.keys(plan.fields).length === 0 && plan.scheduledAt === undefined) {
      const { status, recurrence, position } = plan.status;
      // Done, archived or backlog leaves every queue on the server (TV-D2);
      // the same write takes it out of the queues shown.
      applyQueueFollow(id, plan.queue);
      applyOp(
        id,
        shown,
        () =>
          runtime!.tasks.opSetStatus({
            workspaceId: workspaceId!,
            taskId: id,
            status,
            recurrence,
            position,
          }),
        {
          extra: plan.alongside,
          forget: plan.queue.rowIds,
          offline: { status, recurrence },
          // A refused check-off isn't kept on show in my queue.
          onRefused: () => store?.unkeep(id),
        },
      );
      return plan;
    }
    // A scheduled time on its own is an intent op (tasks.reschedule /
    // tasks.unschedule), so setting it from a row, the panel or a menu lands
    // in the task's trail (TV-P0). The server op checks access and logs.
    if (!plan.status && plan.scheduledAt !== undefined && Object.keys(plan.fields).length === 0) {
      const scheduledAt = plan.scheduledAt ?? null;
      if ((existing.scheduledAt ?? null) === scheduledAt) return plan;
      applyOp(id, shown, () =>
        scheduledAt
          ? runtime!.tasks.opReschedule({ workspaceId: workspaceId!, taskId: id, scheduledAt })
          : runtime!.tasks.opUnschedule({ workspaceId: workspaceId!, taskId: id }),
      );
      return plan;
    }
    // Field-level save (TV-D1): only the changed columns go to the server,
    // so this edit can't put back a field a teammate changed meanwhile.
    // A status shown by category goes to the server as the category (the
    // id picked here is only what shows meanwhile).
    const fields = plan.columns;
    if (Object.keys(fields).length === 0) return plan;
    if (editBlocked() || !store) return plan;
    if (plan.status) applyQueueFollow(id, plan.queue);
    // Moving a parent takes its subtasks along (TV-P0): shown at once for
    // every subtask (`plan.alongside`), then settled by the server, which
    // carries the ones you can edit (TV-D8).
    const write = store.begin([
      patchOf(id, { ...shown, updatedAt: planCtx.now.toISOString() }),
      ...plan.alongside,
    ]);
    void (async () => {
      // A move is one op (TV-D8): the server moves the subtasks with their
      // parent in the same transaction and answers with every row it
      // changed, so each ends on the server's own row. A subtask it didn't
      // carry (one you can't edit) shows where the server has it once this
      // write's own fields go. Any other edit answers with the task alone.
      const saved = plan.moving
        ? await runtime!.tasks.opUpdateTask({
            workspaceId: workspaceId!,
            taskId: id,
            patch: fields,
          })
        : [
            await runtime!.tasks.updateTask({
              workspaceId: workspaceId!,
              taskId: id,
              patch: fields,
            }),
          ];
      write.settle({ tasks: saved });
      if (plan.queue.rowIds.length > 0) store.forget("queue", plan.queue.rowIds);
      // Every edit is in the trail now (TV-D8): refresh it.
      bumpActivity();
    })().catch((e) => {
      refused(write, e);
      if (plan.status) store.unkeep(id);
    });
    return plan;
  };

  /** Edit one task (`writeTask`, without its plan). */
  const patchTask = (id: string, patch: Partial<Task>): void => {
    writeTask(id, patch);
  };

  const deleteTask = (id: string) => {
    const d = data();
    const existing = d.bundle.tasks.find((t) => t.id === id);
    if (!existing) {
      archivedBlocked(id);
      return;
    }
    if (editBlocked() || !store) return;
    // Snapshot the children BEFORE the optimistic promotion — Undo re-attaches
    // them (their snapshot rows still carry parentId = id).
    const children = d.bundle.tasks.filter((t) => t.parentId === id && !t.deletedAt);
    // A deleted task leaves every queue; Undo doesn't put it back (TV-D2).
    const follow = queueFollowStatus(id, "deleted");
    // Deleting a parent promotes its subtasks to top-level (the server does
    // it in the same op) so they stay visible — work is never silently lost.
    const write = store.begin([
      { table: "tasks", remove: id },
      ...children.map((c) => patchOf(c.id, { parentId: null })),
      ...follow.changes,
    ]);
    void runtime!.tasks
      .deleteTask({ workspaceId: workspaceId!, taskId: id })
      .then((deleted) => {
        write.settle({ tasks: [deleted] });
        for (const c of children) store.patchCopy("tasks", c.id, { parentId: null });
        store.forget("queue", follow.rowIds);
        void env().reloadTrash();
        // Same guarantee as deleting the task from a note (DF-5): soft delete =
        // a stamp; Undo clears it and re-attaches the subtasks. Only those two
        // fields are written back, so edits made meanwhile survive (TV-D1).
        undoToast("Task deleted", {
          onUndo: () => {
            void (async () => {
              const restored = await runtime!.tasks.updateTask({
                workspaceId: workspaceId!,
                taskId: id,
                patch: { deletedAt: null },
              });
              const reattached = await Promise.all(
                children.map((c) =>
                  runtime!.tasks.updateTask({
                    workspaceId: workspaceId!,
                    taskId: c.id,
                    patch: { parentId: id },
                  }),
                ),
              );
              store.answer({ tasks: [restored, ...reattached] });
              await env().reloadTrash();
            })().catch(() => toast.error("Couldn't restore the task."));
          },
        });
      })
      .catch((e) => refused(write, e));
  };

  /**
   * Bring back a deleted task (the panel's "Deleted task" Restore, TV-U13):
   * the same op the delete's Undo uses. Resolves whether it came back.
   */
  const restoreTask = async (id: string): Promise<boolean> => {
    if (editBlocked() || !runtime || !workspaceId || !store) return false;
    try {
      const restored = await runtime.tasks.updateTask({
        workspaceId,
        taskId: id,
        patch: { deletedAt: null },
      });
      store.answer({ tasks: [restored] });
      bumpActivity();
      toast("Task restored");
      return true;
    } catch (e) {
      failed(e, "Couldn’t restore the task.");
      return false;
    }
  };

  // ── subtask mutations (one level — spec §11) ─────────────────────────────────

  /** Create a new subtask under `parentId`, in the parent's bucket. */
  const addSubtask = (parentId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (isTempId(parentId)) {
      toast.error(STILL_SAVING);
      return;
    }
    const d = data();
    const parent = d.liveTasks.find((t) => t.id === parentId);
    if (!parent) {
      archivedBlocked(parentId);
      return;
    }
    // One level: a task that is itself a subtask can't get children.
    if (parent.parentId && d.liveTasks.some((t) => t.id === parent.parentId)) {
      toast.error("Subtasks are one level — this task is already a subtask.");
      return;
    }
    // The parent's project, as the copy has it.
    const bucketId = d.bundle.tasks.find((t) => t.id === parentId)?.bucketId ?? parent.bucketId;
    void createTask({ bucketId, title: trimmed, parentId });
  };

  /**
   * Attach a task under a parent, or detach it (`parentId = null`, "promote to
   * task"). Enforces the one-level rule in both directions; the DB trigger is
   * the backstop.
   */
  const setTaskParent = (id: string, parentId: string | null) => {
    const d = data();
    const existing = d.liveTasks.find((t) => t.id === id);
    if (!existing) {
      archivedBlocked(id);
      return;
    }
    const next = parentId ?? null;
    if ((existing.parentId ?? null) === next) return;
    if (next) {
      if (isTempId(id) || isTempId(next)) {
        toast.error(STILL_SAVING);
        return;
      }
      if (next === id) return;
      const parent = d.liveTasks.find((t) => t.id === next);
      if (!parent) return;
      if (parent.parentId && d.liveTasks.some((t) => t.id === parent.parentId)) {
        toast.error("Subtasks are one level — that task is already a subtask.");
        return;
      }
      if ((d.subtasksByParent.get(id)?.length ?? 0) > 0) {
        toast.error("Subtasks are one level — this task has subtasks of its own.");
        return;
      }
    }
    patchTask(id, { parentId: next });
  };

  /**
   * Save one task's drop writes (`TaskDropWrite`): shown at once, then sent
   * in order, each after the one before has landed — the field-level write
   * (parent, project with every subtask following, Won't do and done ones
   * too; place; priority), then the status op (with the place, when it
   * rides), then the assign op. Resolves to the saved row, or null when
   * anything failed: then it has said so, and the drop's fields show the
   * server's again. `recurrence` replaces the advance a status change would
   * make (Undo puts the rule back).
   */
  const saveTaskWrite = async (
    write: TaskDropWrite,
    opts: { recurrence?: RecurrenceRule | null } = {},
  ): Promise<Task | null> => {
    if (editBlocked() || !runtime || !workspaceId || !store) return null;
    const { taskId } = write;
    const existing = data().allTasks.find((t) => t.id === taskId);
    if (!existing) return null;
    const rt = runtime;
    const ws = workspaceId;
    // `recurrence` replaces the advance a status change would make.
    const plan = planTaskWrite(
      existing,
      {
        ...patchOfWrite(write),
        ...(write.status !== undefined && opts.recurrence !== undefined
          ? { recurrence: opts.recurrence }
          : {}),
      },
      planContext(),
    );
    if (plan.kind === "refused") {
      sayRefused(plan);
      return null;
    }
    if (plan.kind === "noop") return null;
    const { fields, status, assigneeId } = plan;
    if (status && plan.followUps.restoreReminders) {
      peers.offerReminderRestore(existing, status.category);
    }
    if (status) applyQueueFollow(taskId, plan.queue);
    // The task, every subtask following it into another project (done and
    // Won't do ones too), and the queue rows a status change takes out.
    const shown = store.begin(plan.overlay);

    const saved: Task[] = [];
    try {
      if (Object.keys(fields).length > 0) {
        if (plan.moving) {
          // A move is one op (TV-D8, as `patchTask`): the server carries the
          // subtasks it lets you edit in the same transaction and answers
          // with every row it changed; one you can only view stays where the
          // server has it, and the drop still lands (TV-U10).
          saved.push(...(await rt.tasks.opUpdateTask({ workspaceId: ws, taskId, patch: fields })));
        } else {
          saved.push(await rt.tasks.updateTask({ workspaceId: ws, taskId, patch: fields }));
        }
      }
      if (status) {
        // After any older check-off for it still on its way (MOD-561): sent
        // first, the older one would land last and win. The drop's Undo
        // needs the server's row, so it waits its turn rather than queueing.
        saved.push(
          await store.sendStatusInTurn(taskId, () =>
            rt.tasks.opSetStatus({
              workspaceId: ws,
              taskId,
              // By id when Undo puts a named status back, else the word.
              status: status.status,
              recurrence: status.recurrence,
              position: status.position,
            }),
          ),
        );
      }
      if (assigneeId !== undefined) {
        saved.push(await rt.tasks.opAssign({ workspaceId: ws, taskId, assigneeId }));
      }
      // The last answer for a row is the newest.
      const byId = new Map(saved.map((t) => [t.id, t]));
      shown.settle({ tasks: [...byId.values()] });
      store.forget("queue", plan.queue.rowIds);
      bumpActivity();
      if (plan.followUps.nextOccurrence) {
        toast(`Done — next: ${formatScheduled(plan.followUps.nextOccurrence)}`);
      }
      return byId.get(taskId) ?? null;
    } catch (e) {
      // What already saved stays (its rows become the copy); the rest shows
      // the server's again.
      if (saved.length > 0) store.answer({ tasks: saved });
      refused(shown, e);
      if (status) store.unkeep(taskId);
      return null;
    }
  };

  /**
   * A drop, or a move key (TV-U4): save `write` (`saveTaskWrite`), and once
   * the server has taken all of it, say `label` with an 8 s Undo (call a). A
   * move into another project that didn't place the task sends it to that
   * project's end. Undo puts back each field the drop changed, unless it
   * changed again since: it never overwrites a newer change, and says so. A
   * drop that closed a queued task (Done) puts it back in my queue where it
   * was. Resolves to whether the drop saved; a failed one shows no Undo.
   */
  const dropTask = async (write: TaskDropWrite, label: string): Promise<boolean> => {
    const d = data();
    const canEdit = env().canEdit;
    const before = d.allTasks.find((t) => t.id === write.taskId);
    if (!before) return false;
    // My line-up before the drop: a drop that closes the task takes it out.
    const lineupBefore = d.myQueueEntries.map((e) => e.taskId);
    const wasQueued = lineupBefore.includes(write.taskId);
    const moving =
      write.bucketId !== undefined &&
      write.bucketId !== before.bucketId &&
      write.position === undefined;
    const saving: TaskDropWrite = moving
      ? {
          ...write,
          position: bucketEndPosition({
            moving: new Set([
              write.taskId,
              ...d.allTasks.filter((t) => t.parentId === write.taskId).map((t) => t.id),
            ]),
            bucketId: write.bucketId as string,
            allByPosition: d.liveTasks,
          }),
        }
      : write;
    const after = await saveTaskWrite(saving);
    if (!after) return false;
    // Call 87: a drop into Done finishes the open subtasks too, under the drop's Undo.
    const finished =
      canEdit && taskCategoryOf(after) === "done" && !isClosedTask(before)
        ? peers.finishOpenSubtasks(before)
        : null;
    const said = finished
      ? `${label} · also ${finished.count === 1 ? "1 subtask" : `${finished.count} subtasks`}`
      : label;
    undoToast(said, {
      onUndo: () => {
        finished?.undo();
        const current = data().allTasks.find((t) => t.id === write.taskId);
        const title = `“${before.title || "Untitled"}”`;
        if (!current || current.deletedAt) {
          toast(`${title} is gone, so there’s nothing to undo.`);
          return;
        }
        const undo = undoWrite({ write: saving, before, after, current });
        const keptNote = () => {
          if (undo.kept.length > 0) toast(`Undo kept a newer change to ${title}.`);
        };
        if (!undo.write) {
          keptNote();
          return;
        }
        // A status going back takes its repeat rule back too: the one before
        // the drop, unless the rule was edited since (then it stays as is).
        const ruleUntouched =
          JSON.stringify(current.recurrence) === JSON.stringify(after.recurrence);
        void saveTaskWrite(undo.write, {
          recurrence:
            undo.write.status === undefined
              ? undefined
              : ruleUntouched
                ? before.recurrence
                : current.recurrence,
        }).then((saved) => {
          if (!saved) return;
          keptNote();
          // Back to open from a drop that closed it: its queue place too.
          if (wasQueued && isOpenTask(saved)) peers.restoreQueuePlace(saved.id, lineupBefore);
        });
      },
    });
    return true;
  };

  // ── blocked-by mutations (edges, not statuses — spec §5c) ────────────────────

  /** Add a blocker → task edge. Cycle-checked here; the DB trigger backstops. */
  const addBlocker = (taskId: string, blockerId: string) => {
    if (editBlocked() || !runtime || !workspaceId || !store) return;
    if (isTempId(taskId) || isTempId(blockerId)) {
      toast.error(STILL_SAVING);
      return;
    }
    if (taskId === blockerId) return;
    const relations = data().bundle.taskRelations;
    const exists = relations.some(
      (r) => r.blockerTaskId === blockerId && r.blockedTaskId === taskId,
    );
    if (exists) return;
    if (wouldCreateCycle(blockerId, taskId, relations)) {
      toast.error("That would create a cycle — these tasks already depend on each other.");
      return;
    }
    const optimistic: TaskRelation = {
      id: `tmp-${crypto.randomUUID()}`,
      workspaceId,
      blockerTaskId: blockerId,
      blockedTaskId: taskId,
      createdAt: new Date().toISOString(),
    };
    const write = store.begin([{ table: "relations", insert: optimistic }]);
    void runtime.tasks
      .createTaskRelation({ workspaceId, blockerTaskId: blockerId, blockedTaskId: taskId })
      .then((saved) => write.settle({ relations: [saved] }))
      .catch((e) => refused(write, e, "Couldn't add the dependency."));
  };

  /** Remove the blocker → task edge (removes the dependency, not the task). */
  const removeBlocker = (taskId: string, blockerId: string) => {
    const existing = data().bundle.taskRelations.find(
      (r) => r.blockerTaskId === blockerId && r.blockedTaskId === taskId,
    );
    if (!existing) return;
    if (isTempId(existing.id)) {
      toast.error("Still saving that dependency — try again in a moment.");
      return;
    }
    if (editBlocked() || !store) return;
    const write = store.begin([{ table: "relations", remove: existing.id }]);
    void runtime!.tasks
      .deleteTaskRelation({ workspaceId: workspaceId!, relationId: existing.id })
      .then(() => {
        store.forget("relations", [existing.id]);
        write.settle();
      })
      .catch((e) => refused(write, e));
  };

  return {
    load,
    searchTasks,
    claimTask,
    loadActivity,
    createTask,
    writeTask,
    patchTask,
    deleteTask,
    restoreTask,
    addSubtask,
    setTaskParent,
    saveTaskWrite,
    dropTask,
    addBlocker,
    removeBlocker,
  };
}
