// Projects ("buckets" in the schema until TV-D7): create, edit, file under an
// area, archive, close (TV-U16), delete (REPLAN 78), and Recently deleted
// (TV-U6). Writes to one project go out in order (`chainProjectOp`).

import { type ProjectState, taskCategoryOf } from "@contracts/vocabularies";
import { toast } from "sonner";
import type { LabelColor } from "../../../components/tag-colors";
import type { ProjectFields } from "../../../lib/runtime.web.structure";
import type { OverlayChange } from "../../../lib/sync/store";
import { undoToast } from "../../../lib/undo-toast";
import { endPosition } from "../helpers";
import type { Bucket } from "../model";
import { clientCopyClears } from "../project-overview";
import {
  projectDeletePlan,
  projectDeleteSummary,
  projectEndPosition,
  projectOpenWork,
  storedBucketColor,
} from "../sidebar";
import type { ArchiveOpenTasks, TaskCommandsContext, TaskPeers, TrashTarget } from "./context";
import { isTempId, NOT_MOVED, patchOf, type Shared } from "./shared";

export function createProjectOps(ctx: TaskCommandsContext, shared: Shared, peers: TaskPeers) {
  const { store, runtime, workspaceId, userId, data, env, setTrash, openTrashRef } = ctx;
  const { chainProjectOp, editBlocked, failed, refused } = shared;

  /** A new project at the end of the sidebar, or of an area (TV-U6). */
  const createBucket = (name: string, opts?: { areaId?: string | null }) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (editBlocked() || !runtime || !workspaceId || !store) return;
    // Past every project the server still has (an archived one too), so an
    // Undo can't tie their places.
    const position = endPosition(data().allBuckets.filter((b) => !b.deletedAt));
    const areaId = opts?.areaId ?? null;
    const optimistic: Bucket = {
      id: `tmp-${crypto.randomUUID()}`,
      workspaceId,
      ownerId: userId ?? "",
      name: trimmed,
      isSystem: false,
      group: null,
      position,
      areaId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    const write = store.begin([{ table: "buckets", insert: optimistic }]);
    // TV-D10: through the project op (the old save on a database before it).
    void runtime.tasks
      .createProject({
        workspaceId,
        fields: { name: trimmed, position, ...(areaId ? { areaId } : {}) },
      })
      .then((saved) => write.settle({ buckets: [saved] }))
      .catch((e) => refused(write, e, "Couldn't create the project."));
  };

  /**
   * Edit a project's fields (TV-U6): shown at once, then only the changed
   * fields go through `projects_op_update` (never its owner, workspace or
   * Inbox flag), so nothing a teammate changed meanwhile is put back. A
   * refusal puts back only these fields. Resolves false when it didn't save.
   */
  const editProject = (
    id: string,
    patch: ProjectFields,
    local: Partial<Bucket>,
  ): Promise<boolean> => {
    if (editBlocked() || !runtime || !workspaceId || !store) return Promise.resolve(false);
    if (isTempId(id)) {
      toast.error("Still saving that project — try again in a moment.");
      return Promise.resolve(false);
    }
    const existing = data().allBuckets.find((b) => b.id === id);
    if (!existing || existing.isSystem) return Promise.resolve(false);
    const write = store.begin([
      { table: "buckets", patch: { id, fields: local as Record<string, unknown> } },
    ]);
    return chainProjectOp(id, () =>
      runtime.tasks.updateProject({
        workspaceId,
        projectId: id,
        patch,
        fallback: { ...existing, ...local },
      }),
    ).then(
      (saved) => {
        write.settle({ buckets: [saved] });
        return true;
      },
      (e) => {
        refused(write, e, "Couldn't save the project.");
        return false;
      },
    );
  };

  const renameBucket = (id: string, name: string) => {
    const trimmed = name.trim();
    const existing = data().allBuckets.find((b) => b.id === id);
    if (!existing || !trimmed || trimmed === existing.name) return;
    // Only the name goes (TV-D10), so a rename can't put back a teammate's
    // newer area or place.
    void editProject(id, { name: trimmed }, { name: trimmed });
  };

  /**
   * File a project under an area by name (or none with `group = null`). The
   * area of that name is found or made on the server (TV-D10). Kept for the
   * old rail's Section menu; the sidebar files by area (`moveBucketToArea`).
   */
  const setBucketGroup = (id: string, group: string | null) => {
    const bundle = data().bundle;
    const existing = bundle.buckets.find((b) => b.id === id);
    if (!existing) return;
    const next = group?.trim() ? group.trim() : null;
    if (next === (existing.group ?? null)) return;
    if (editBlocked() || !store) return;
    const updated = { ...existing, group: next, updatedAt: new Date().toISOString() };
    const write = store.begin([{ table: "buckets", patch: { id, fields: { group: next } } }]);
    void runtime!.tasks
      .setProjectArea({
        workspaceId: existing.workspaceId,
        project: updated,
        areaName: next,
        areas: bundle.areas ?? [],
      })
      .then(({ project, areas: nextAreas }) =>
        write.settle({ buckets: [project], ...(nextAreas ? { areas: nextAreas } : {}) }),
      )
      .catch((e) => refused(write, e));
  };

  /** The sidebar dot's colour (TV-U6); neutral stores none. */
  const setBucketColor = (id: string, color: LabelColor) => {
    const existing = data().allBuckets.find((b) => b.id === id);
    const next = storedBucketColor(color);
    if (!existing || (existing.color ?? null) === next) return;
    void editProject(id, { color: next }, { color: next });
  };

  /** Move a project into an area (null: none), last in it (TV-U6). Answers
   *  whether it's there (a refused move puts it back; MOD-38's drop asks). */
  const moveBucketToArea = (id: string, areaId: string | null): Promise<boolean> => {
    const allBuckets = data().allBuckets;
    const existing = allBuckets.find((b) => b.id === id);
    if (!existing) return Promise.resolve(false);
    if ((existing.areaId ?? null) === areaId) return Promise.resolve(true);
    const position = projectEndPosition(allBuckets);
    return editProject(id, { areaId, position }, { areaId, position });
  };

  /** Bring an archived project back (TV-U6). Its tasks aren't re-queued. */
  const unarchiveBucket = (id: string) =>
    editProject(id, { archived: false }, { archivedAt: null });

  /**
   * What closing a project does to its open work (REPLAN 78: "n open tasks —
   * Won't do · Move · Keep"), shared by Archive and Done (TV-U16): Won't do
   * marks each open task, Move sends the open tops (their subtasks follow) to
   * another project, Keep leaves them. Starts the task edits at once and
   * answers with when the moves landed, how to put everything back (an Undo,
   * or a refused close) and what the toast says.
   */
  const closeOpenWork = (id: string, openTasks: ArchiveOpenTasks) => {
    const d = data();
    const work = projectOpenWork(d.liveTasks, id);
    const before = work.open.map((t) => ({
      id: t.id,
      statusId: t.statusId ?? null,
      category: taskCategoryOf(t),
    }));
    const revert = () => {
      if (openTasks.kind === "wont_do") {
        for (const t of before) {
          peers.setTaskStatus(
            t.id,
            t.statusId ? { statusId: t.statusId } : { category: t.category },
          );
        }
      } else if (openTasks.kind === "move") {
        for (const t of work.tops) peers.patchTask(t.id, { bucketId: id });
      }
    };
    let movesDone: Promise<boolean> = Promise.resolve(true);
    if (openTasks.kind === "wont_do") {
      for (const t of work.open) peers.setTaskStatus(t.id, { category: "wont_do" });
    } else if (openTasks.kind === "move" && runtime && workspaceId && store) {
      const target = openTasks.projectId;
      const topIds = new Set(work.tops.map((t) => t.id));
      const steps = d.liveTasks.filter(
        (t) => t.bucketId === id && !!t.parentId && topIds.has(t.parentId),
      );
      const moveWrite = store.begin(
        [...work.tops, ...steps].map((t) => patchOf(t.id, { bucketId: target, sectionId: null })),
      );
      movesDone = Promise.all(
        work.tops.map((t) =>
          runtime.tasks.opUpdateTask({ workspaceId, taskId: t.id, patch: { bucketId: target } }),
        ),
      ).then(
        (rows) => {
          moveWrite.settle({ tasks: rows.flat() });
          return true;
        },
        (e) => {
          refused(moveWrite, e, "Couldn't move the open tasks.");
          // Some may have moved before one was refused: read where they are.
          void store.syncNow();
          return false;
        },
      );
    }
    const moved = openTasks.kind === "move" ? work.tops.length : 0;
    const marked = openTasks.kind === "wont_do" ? work.open.length : 0;
    const target =
      openTasks.kind === "move" ? d.allBuckets.find((b) => b.id === openTasks.projectId) : null;
    const note =
      marked > 0
        ? `${marked === 1 ? "Its open task is" : `Its ${marked} open tasks are`} marked Won’t do.`
        : moved > 0
          ? `${moved === 1 ? "Its open task" : `Its ${moved} open tasks`} moved to ${target?.name ?? "another project"}.`
          : null;
    return { work, movesDone, revert, note };
  };

  /**
   * Archive a project (TV-U6, REPLAN 16 + 78): it leaves the sidebar, every
   * list, count and queue on every surface at once (the server takes its
   * tasks out of everyone's queue), and opens from Archived projects; search
   * still finds its tasks. With open tasks the sidebar asks first: Won't do
   * (each open task), Move (the open tasks, with their subtasks, to another
   * project) or Keep. Needs Full access (the server says so). Undo
   * unarchives and puts the open tasks back as they were.
   */
  const archiveBucket = (id: string, openTasks: ArchiveOpenTasks = { kind: "keep" }) => {
    if (editBlocked() || !runtime || !workspaceId || !store) return;
    if (isTempId(id)) {
      toast.error("Still saving that project — try again in a moment.");
      return;
    }
    // As things are before the open work's edits below start.
    const d = data();
    const existing = d.liveBuckets.find((b) => b.id === id);
    if (!existing || existing.isSystem) return;
    // Move goes first and the archive waits for it: archiving takes what's
    // still in the project out of every queue, so a task the archive beat
    // would lose its place in queues.
    const { work, movesDone, revert, note } = closeOpenWork(id, openTasks);
    // What stays in the project leaves every queue (the server does it).
    const movedTops = new Set(openTasks.kind === "move" ? work.tops.map((t) => t.id) : []);
    const staying = new Set(
      d.liveTasks
        .filter(
          (t) =>
            t.bucketId === id && !movedTops.has(t.id) && !(t.parentId && movedTops.has(t.parentId)),
        )
        .map((t) => t.id),
    );
    const queueRowIds = d.allQueueRows.filter((e) => staying.has(e.taskId)).map((e) => e.id);
    const archivedAt = new Date().toISOString();
    const write = store.begin([
      { table: "buckets", patch: { id, fields: { archivedAt } } },
      ...queueRowIds.map((rowId) => ({ table: "queue", remove: rowId }) as OverlayChange),
    ]);
    void chainProjectOp(id, async () => {
      if (!(await movesDone)) throw NOT_MOVED;
      return runtime.tasks.updateProject({
        workspaceId,
        projectId: id,
        patch: { archived: true },
        fallback: { ...existing, archivedAt },
      });
    })
      .then((saved) => {
        write.settle({ buckets: [saved] });
        store.forget("queue", queueRowIds);
      })
      .catch((e) => {
        if (e === NOT_MOVED) {
          // The move said why; the project stays where it was.
          write.fail();
          return;
        }
        refused(write, e, "Couldn't archive the project.");
        revert();
      });
    // The toast waits for the moves it names (a refused move says so instead).
    void movesDone.then((moved) => {
      if (!moved) return;
      undoToast(`“${existing.name}” archived`, {
        description: note ?? "It’s in the sidebar’s ⋯ → Archived projects.",
        onUndo: () => {
          void unarchiveBucket(id);
          revert();
        },
      });
    });
  };

  /**
   * Set a project's state (TV-U16, REPLAN 16): Active, On hold or Done. Done
   * with open work asks first, like Archive (REPLAN 78: Won't do · Move ·
   * Keep), and runs the task edits before the state; Undo puts the state and
   * the tasks back. On hold and Done never hide tasks. Needs Edit.
   */
  const setProjectState = (
    id: string,
    status: ProjectState,
    openTasks: ArchiveOpenTasks = { kind: "keep" },
  ) => {
    if (editBlocked() || !runtime || !workspaceId || !store) return;
    const existing = data().liveBuckets.find((b) => b.id === id);
    if (!existing || existing.isSystem) return;
    const previous = existing.status ?? "active";
    if (previous === status) return;
    if (status !== "done") {
      void editProject(id, { status }, { status });
      return;
    }
    if (isTempId(id)) {
      toast.error("Still saving that project — try again in a moment.");
      return;
    }
    // Shown at once, and queued on the project's chain right now (the moves
    // go first, like Archive's), so an Undo queues after it, never before.
    const { movesDone, revert, note } = closeOpenWork(id, openTasks);
    const write = store.begin([{ table: "buckets", patch: { id, fields: { status } } }]);
    void chainProjectOp(id, async () => {
      if (!(await movesDone)) throw NOT_MOVED;
      return runtime.tasks.updateProject({
        workspaceId,
        projectId: id,
        patch: { status },
        fallback: { ...existing, status },
      });
    })
      .then((saved) => write.settle({ buckets: [saved] }))
      .catch((e) => {
        if (e === NOT_MOVED) {
          // The move said why; the project keeps its state.
          write.fail();
          return;
        }
        refused(write, e, "Couldn't save the project.");
        revert();
      });
    // The toast waits for the moves it names (a refused move says so instead).
    void movesDone.then((moved) => {
      if (!moved) return;
      undoToast(`“${existing.name}” is done`, {
        ...(note ? { description: note } : {}),
        onUndo: () => {
          void editProject(id, { status: previous }, { status: previous });
          revert();
        },
      });
    });
  };

  /** Edit a project's own fields from its overview (TV-U16): dates, lead,
   *  client, description. Resolves false when it didn't save. */
  const updateProjectFields = (
    id: string,
    patch: Omit<ProjectFields, "archived" | "status">,
  ): Promise<boolean> => {
    const local: Partial<Bucket> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      (local as Record<string, unknown>)[key] = key === "description" ? (value ?? "") : value;
    }
    // MOD-155: a client is a person or a company; the op clears the other.
    Object.assign(
      local,
      clientCopyClears(
        data().allBuckets.find((b) => b.id === id),
        patch,
      ),
    );
    return editProject(id, patch, local);
  };

  /**
   * A project's start and target (the Timeline's bar, TV-TL2): one write,
   * shown at once; with `label`, a toast whose Undo puts the old dates back
   * unless they changed again since.
   */
  const setProjectDates = (
    id: string,
    dates: { startsOn: string | null; targetOn: string | null },
    label?: string,
  ): Promise<boolean> => {
    const existing = data().allBuckets.find((b) => b.id === id);
    if (!existing) return Promise.resolve(false);
    const before = {
      startsOn: existing.startsOn ?? null,
      targetOn: existing.targetOn ?? null,
    };
    if (before.startsOn === dates.startsOn && before.targetOn === dates.targetOn) {
      return Promise.resolve(false);
    }
    return editProject(id, dates, dates).then((ok) => {
      if (ok && label) {
        undoToast(label, {
          onUndo: () => {
            const now = store?.getSnapshot().bundle.buckets.find((b) => b.id === id);
            if (!now) return;
            if (
              (now.startsOn ?? null) !== dates.startsOn ||
              (now.targetOn ?? null) !== dates.targetOn
            ) {
              toast("Undo kept a newer change.");
              return;
            }
            void editProject(id, before, before);
          },
        });
      }
      return ok;
    });
  };

  // ── Recently deleted (TV-U6) ────────────────────────────────────────────────

  /**
   * Bring something back from Recently deleted (TV-U6): a project with the
   * finished tasks (and files) deleted with it and the open ones its delete
   * handed out that nobody touched since, or one task (into your Inbox when
   * its project is gone). `quiet` for an Undo.
   */
  const restoreFromTrash = (
    target: TrashTarget,
    opts?: { quiet?: boolean; label?: string },
  ): Promise<boolean> => {
    if (editBlocked() || !runtime || !workspaceId || !store) return Promise.resolve(false);
    return chainProjectOp(target.id, () =>
      runtime.tasks.restoreTrash({
        workspaceId,
        entityType: target.kind,
        entityId: target.id,
      }),
    ).then(
      async () => {
        // What came back (and what moved back) is read like any change.
        await store.syncNow().catch(() => undefined);
        void env().reloadTrash();
        if (!opts?.quiet) toast(opts?.label ? `“${opts.label}” restored` : "Restored");
        return true;
      },
      (e) => {
        failed(e, "Couldn't restore it.");
        void env().reloadTrash();
        return false;
      },
    );
  };

  /** Delete forever, from Recently deleted only (TV-U6): files included, no Undo. */
  const deleteForever = (target: TrashTarget) => {
    if (editBlocked() || !runtime || !workspaceId) return;
    setTrash((prev) =>
      prev
        ? target.kind === "bucket"
          ? { ...prev, buckets: prev.buckets.filter((b) => b.bucket.id !== target.id) }
          : { ...prev, tasks: prev.tasks.filter((t) => t.task.id !== target.id) }
        : prev,
    );
    void chainProjectOp(target.id, () =>
      runtime.tasks.purgeTrash({ workspaceId, entityType: target.kind, entityId: target.id }),
    )
      .then(() => env().reloadTrash())
      .catch((e) => {
        failed(e, "Couldn't delete it forever.");
        void env().reloadTrash();
      });
  };

  /**
   * Delete a project (REPLAN 78). Its open work goes to each top task's
   * assignee's Inbox (unassigned: yours), with one quiet notice per person;
   * the finished work goes with it to Recently deleted. The sidebar confirms
   * first. It leaves every surface at once (what lands in your Inbox shows
   * there), the server delete goes out at once, and the Undo toast restores
   * it, as Recently deleted does for 30 days.
   */
  const deleteBucket = (id: string) => {
    if (editBlocked() || !runtime || !workspaceId || !store) return;
    if (isTempId(id)) {
      toast.error("Still saving that project — try again in a moment.");
      return;
    }
    const d = data();
    const existing =
      d.liveBuckets.find((b) => b.id === id) ?? d.archivedBuckets.find((b) => b.id === id);
    if (!existing || existing.isSystem) return;
    const inboxId = d.inbox?.id ?? null;
    const plan = projectDeletePlan(d.allTasks, id, { inboxId, userId });
    const summary = projectDeleteSummary(d.allTasks, id, userId);
    const write = store.begin([
      { table: "buckets", remove: id },
      ...(inboxId
        ? plan.toInbox.map((taskId) => patchOf(taskId, { bucketId: inboxId, sectionId: null }))
        : []),
      ...plan.gone.map((taskId) => ({ table: "tasks", remove: taskId }) as OverlayChange),
    ]);
    const done = chainProjectOp(id, () =>
      runtime.tasks.deleteProject({ workspaceId, projectId: id }),
    ).then(
      async (result) => {
        // Its tasks moved and left on the server: read what changed; the
        // copy then shows it, and this write's overlay goes.
        await store.syncNow().catch(() => undefined);
        write.settle();
        // What went to a teammate's Inbox is out of your sight now, so no
        // read reports it: it would show again under the deleted project
        // until the next access check. A moved task you can still see
        // already carries its new place.
        const left = new Set(plan.gone);
        const ghosts = store
          .getSnapshot()
          .bundle.tasks.filter((t) => left.has(t.id) && t.bucketId === id)
          .map((t) => t.id);
        if (ghosts.length > 0) store.forget("tasks", ghosts);
        void env().reloadTrash();
        return result;
      },
      (e) => {
        refused(write, e, "Couldn't delete the project.");
        return null;
      },
    );
    const others = summary.moving - summary.toYou;
    undoToast(`“${existing.name}” deleted`, {
      description:
        others > 0
          ? "Its open tasks went to their assignees’ Inboxes."
          : summary.toYou > 0
            ? summary.toYou === 1
              ? "Its open task is in your Inbox."
              : `Its ${summary.toYou} open tasks are in your Inbox.`
            : summary.finished > 0
              ? "It’s in Recently deleted with its finished tasks."
              : undefined,
      ...(openTrashRef.current
        ? { link: { label: "Recently deleted", onClick: () => openTrashRef.current?.() } }
        : {}),
      onUndo: () => {
        void done.then((result) => {
          if (result?.restorable) void restoreFromTrash({ kind: "bucket", id }, { quiet: true });
          else if (result) toast.error("This delete can't be undone on this database.");
        });
      },
    });
  };

  return {
    createBucket,
    editProject,
    renameBucket,
    setBucketGroup,
    setBucketColor,
    moveBucketToArea,
    unarchiveBucket,
    archiveBucket,
    setProjectState,
    updateProjectFields,
    setProjectDates,
    restoreFromTrash,
    deleteForever,
    deleteBucket,
  };
}
