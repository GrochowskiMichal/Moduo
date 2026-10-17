// Saved views' writes (TV-U8), on the shared store: each shows at once
// (`store.begin`), then the op; the server's row becomes the copy, a refusal
// puts back only what this write changed. Views are read whole on every sync
// (they aren't published to Realtime), so another device's change shows on
// the next read: opening Tasks, coming back to the window, a reconnect.
//
// Keeping your own views needs only Tasks view access; sharing one needs
// edit access (the server says so when it's missing).

import type { TaskViewScope } from "@contracts/vocabularies";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { ViewPatch } from "../../../lib/runtime.web.views";
import type { OverlayChange, PendingWrite, WorkspaceStore } from "../../../lib/sync/store";
import { undoToast } from "../../../lib/undo-toast";
import type { TasksViewPrefs } from "../display";
import { type SeedView, sidebarViews, type TaskView, viewPayload } from "../views";

export type SaveViewInput = {
  name: string;
  scope: TaskViewScope;
  projectId: string | null;
  prefs: TasksViewPrefs;
};

export type ViewOps = {
  /** Your views (in your order) then the ones shared with you (by name). */
  views: TaskView[];
  /** Save the place's Filter and Display as a new view of yours; answers with it. */
  saveView: (input: SaveViewInput) => Promise<TaskView | null>;
  /** Save an open view's Filter and Display into it. */
  saveViewChanges: (viewId: string, prefs: TasksViewPrefs) => Promise<boolean>;
  renameView: (viewId: string, name: string) => void;
  /** Share with the workspace (true) or keep it yours (false). */
  shareView: (viewId: string, shared: boolean) => void;
  /** Delete, with Undo. */
  deleteView: (viewId: string) => void;
  moveView: (viewId: string, direction: "up" | "down") => void;
  /**
   * Make onboarding's views (each once per person; the server answers with
   * one already made). True once the server answered for every seed; false
   * when it couldn't be asked (offline, an older server, an error), so the
   * caller tries again another time.
   */
  seedViews: (seeds: readonly SeedView[]) => Promise<boolean>;
};

function sayOffline(): void {
  toast("Offline", { description: "Saved views change when you're back online." });
}

export function useViewOps(input: {
  runtime: ModuoRuntime | null;
  store: WorkspaceStore | null;
  workspaceId: string | null;
  userId: string | null;
  rows: readonly TaskView[];
  /** Says why a write didn't go through (a lost connection is "Offline"). */
  failed: (e: unknown, fallback: string) => void;
}): ViewOps {
  const { runtime, store, workspaceId, userId, rows, failed } = input;
  const views = useMemo(() => sidebarViews(rows, userId), [rows, userId]);

  /** Why a write can't start now (said once), or false when it can. */
  const blocked = useCallback((): boolean => {
    if (!runtime?.tasks.createView || !store || !workspaceId || !userId) {
      toast.error("Saved views need a newer server.");
      return true;
    }
    if (store.isOffline()) {
      sayOffline();
      return true;
    }
    return false;
  }, [runtime, store, workspaceId, userId]);

  const run = useCallback(
    async <T>(
      changes: OverlayChange[],
      op: () => Promise<T>,
      settle: (answer: T, write: PendingWrite) => void,
      fallback: string,
    ): Promise<T | null> => {
      if (blocked() || !store) return null;
      const write = store.begin(changes);
      try {
        const answer = await op();
        settle(answer, write);
        return answer;
      } catch (e) {
        write.fail();
        failed(e, fallback);
        return null;
      }
    },
    [blocked, store, failed],
  );

  const update = useCallback(
    (viewId: string, patch: ViewPatch, shown: OverlayChange[], fallback: string) =>
      run(
        shown,
        () => runtime!.tasks.updateView!({ workspaceId: workspaceId!, viewId, patch }),
        (view, write) => write.settle({ views: [view] }),
        fallback,
      ),
    [run, runtime, workspaceId],
  );

  const saveView = useCallback(
    async ({ name, scope, projectId, prefs }: SaveViewInput): Promise<TaskView | null> => {
      const trimmed = name.trim();
      if (!trimmed || !userId || !workspaceId) return null;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { filters, display } = viewPayload(prefs);
      const mine = rows.filter((v) => v.ownerId === userId);
      const shown: TaskView = {
        id,
        workspaceId,
        ownerId: userId,
        name: trimmed,
        scope,
        projectId: scope === "project" ? projectId : null,
        filters,
        display,
        shared: false,
        position: Math.max(0, ...mine.map((v) => v.position)) + 1,
        seed: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      return run(
        [{ table: "views", insert: shown }],
        () =>
          runtime!.tasks.createView!({
            workspaceId,
            id,
            name: trimmed,
            scope,
            projectId,
            filters,
            display,
          }),
        (view, write) => write.settle({ views: [view] }),
        "Couldn't save the view.",
      );
    },
    [rows, run, runtime, userId, workspaceId],
  );

  const saveViewChanges = useCallback(
    async (viewId: string, prefs: TasksViewPrefs): Promise<boolean> => {
      const { filters, display } = viewPayload(prefs);
      const saved = await update(
        viewId,
        { filters, display },
        [{ table: "views", patch: { id: viewId, fields: { filters, display } } }],
        "Couldn't save the view.",
      );
      return !!saved;
    },
    [update],
  );

  const renameView = useCallback(
    (viewId: string, name: string) => {
      const trimmed = name.trim();
      const existing = rows.find((v) => v.id === viewId);
      if (!existing || !trimmed || trimmed === existing.name) return;
      void update(
        viewId,
        { name: trimmed },
        [{ table: "views", patch: { id: viewId, fields: { name: trimmed } } }],
        "Couldn't rename the view.",
      );
    },
    [rows, update],
  );

  const shareView = useCallback(
    (viewId: string, shared: boolean) => {
      const existing = rows.find((v) => v.id === viewId);
      if (!existing) return;
      // The workspace's owner or an admin taking down someone else's shared
      // view: it leaves their sidebar too (it's no longer shared with them).
      if (!shared && existing.ownerId !== userId) {
        void run(
          [{ table: "views", remove: viewId }],
          () =>
            runtime!.tasks.updateView!({ workspaceId: workspaceId!, viewId, patch: { shared } }),
          (view, write) =>
            write.settle({ views: [{ ...view, deletedAt: view.deletedAt ?? view.updatedAt }] }),
          "Couldn't change who sees the view.",
        ).then((view) => {
          if (view) toast(`“${view.name}” is no longer shared`);
        });
        return;
      }
      void update(
        viewId,
        { shared },
        [{ table: "views", patch: { id: viewId, fields: { shared } } }],
        "Couldn't change who sees the view.",
      ).then((view) => {
        if (!view) return;
        toast(
          shared ? `“${view.name}” is shared with the workspace` : `“${view.name}” is yours again`,
          {
            description: shared
              ? "People see the tasks they can see through it, nothing more."
              : undefined,
          },
        );
      });
    },
    [rows, userId, run, runtime, workspaceId, update],
  );

  const deleteView = useCallback(
    (viewId: string) => {
      const existing = rows.find((v) => v.id === viewId);
      if (!existing) return;
      void update(
        viewId,
        { deleted: true },
        [{ table: "views", remove: viewId }],
        "Couldn't delete the view.",
      ).then((view) => {
        if (!view) return;
        undoToast(`“${existing.name}” deleted`, {
          onUndo: () => {
            void update(viewId, { deleted: false }, [], "Couldn't bring the view back.");
          },
        });
      });
    },
    [rows, update],
  );

  const moveView = useCallback(
    (viewId: string, direction: "up" | "down") => {
      void run(
        [],
        () => runtime!.tasks.moveView!({ workspaceId: workspaceId!, viewId, direction }),
        (next, write) => write.settle({ views: next }),
        "Couldn't move the view.",
      );
    },
    [run, runtime, workspaceId],
  );

  const seedViews = useCallback(
    async (seeds: readonly SeedView[]): Promise<boolean> => {
      if (!runtime?.tasks.createView || !store || !workspaceId || store.isOffline()) return false;
      const made: TaskView[] = [];
      let answered = true;
      for (const seed of seeds) {
        try {
          made.push(
            await runtime.tasks.createView({
              workspaceId,
              id: crypto.randomUUID(),
              name: seed.name,
              scope: seed.scope,
              filters: seed.filters,
              display: seed.display,
              seed: seed.seed,
            }),
          );
        } catch {
          // A default, not something they asked for: no error toast; the
          // caller tries again another time (the server makes each once).
          answered = false;
        }
      }
      if (made.length > 0) store.begin([]).settle({ views: made });
      return answered;
    },
    [runtime, store, workspaceId],
  );

  return {
    views,
    saveView,
    saveViewChanges,
    renameView,
    shareView,
    deleteView,
    moveView,
    seedViews,
  };
}
