// The app's reference store, one per signed-in person and workspace (RF-1).
// Mounted once in the app shell, so every page, the bell and the panel share
// one cache. It reads through `runtime.spine.previews` (RLS = can_access),
// names assignees from the workspace's member list, and keeps tasks, projects
// and tags live through the Tasks Realtime link (TV-D5), which it holds only
// while such a reference is on screen. Notes, events, contacts and emails have
// no Realtime feed yet: they refresh when the window comes back and when a
// cached answer is a few minutes old.

import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import { useAuth } from "../../../providers/auth-provider";
import { listenTasksLive } from "../../tasks/realtime";
import { useWorkspace } from "../../workspaces/workspace-context";
import { ReferenceStoreProvider } from "./context";
import type { ResolveContext } from "./resolvers";
import { isLiveKind, ReferenceStore } from "./store";
import type { ReferencePerson } from "./types";

/** Focus and visibility arrive together on a return: one re-read for both. */
const RESYNC_COALESCE_MS = 1_000;

export function ReferencesProvider({ children }: { children: ReactNode }) {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId, selectedWorkspace, members, modulePermissions } = useWorkspace();
  const taskKey = selectedWorkspace?.taskKey ?? null;
  const canEditTasks = modulePermissions.tasks === "edit" || modulePermissions.tasks === "admin";

  // The latest of everything a read needs, without rebuilding the store.
  const latest = useRef({
    runtime,
    workspaceId: selectedWorkspaceId,
    taskKey,
    members,
    canEditTasks,
  });
  useLayoutEffect(() => {
    latest.current = { runtime, workspaceId: selectedWorkspaceId, taskKey, members, canEditTasks };
  });

  // A new person or workspace starts a new cache: nothing carries across.
  const store = useMemo(
    () =>
      runtime && selectedWorkspaceId && userId
        ? new ReferenceStore({
            context: (): ResolveContext | null => {
              const {
                runtime: rt,
                workspaceId,
                taskKey: key,
                members: list,
                canEditTasks: canEdit,
              } = latest.current;
              if (!rt || !workspaceId || !rt.spine.previews) return null;
              return {
                workspaceId,
                previews: rt.spine.previews,
                taskKey: key,
                personOf: (id): ReferencePerson | null => {
                  const m = list.find((x) => x.userId === id);
                  return m
                    ? {
                        name: m.displayName?.trim() || "Member",
                        id: m.userId,
                        avatarUrl: m.avatarUrl,
                      }
                    : null;
                },
                getEntities: (refs) => rt.spine.getEntities({ workspaceId, refs }),
                setTaskStatus: canEdit
                  ? async (taskId, done) => {
                      await rt.tasks.opSetStatus({
                        workspaceId,
                        taskId,
                        status: done ? "done" : "todo",
                      });
                    }
                  : undefined,
                now: () => new Date(),
              };
            },
          })
        : null,
    [runtime, selectedWorkspaceId, userId],
  );

  // A rename of the task key re-reads every handle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: taskKey is the cue
  useEffect(() => {
    store?.forgetHandles();
    store?.invalidate((kind) => kind === "task");
  }, [taskKey]);

  // Live while a task, project or tag reference is on screen.
  const needsLive = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    () => store?.hasLiveKinds() ?? false,
    () => false,
  );
  useEffect(() => {
    if (!store || !needsLive || !selectedWorkspaceId || !userId) return;
    // A return fires focus and visibility together: one re-read per return.
    let lastResync = 0;
    const stop = listenTasksLive(selectedWorkspaceId, userId, (event) => {
      if (event.type === "resync") {
        const now = Date.now();
        if (now - lastResync < RESYNC_COALESCE_MS) return;
        lastResync = now;
        store.invalidate((kind) => isLiveKind(kind));
        return;
      }
      const { change } = event;
      if (change.table === "tasks") {
        if (change.kind === "delete") store.applyLive({ table: "tasks", id: change.id });
        else
          store.applyLive({
            table: "tasks",
            id: change.row.id,
            parentId: change.row.parentId,
            bucketId: change.row.bucketId,
          });
      } else if (change.table === "buckets") {
        store.applyLive({
          table: "buckets",
          id: change.kind === "delete" ? change.id : change.row.id,
        });
      } else if (change.table === "tags") {
        store.applyLive({
          table: "tags",
          id: change.kind === "delete" ? change.id : change.row.id,
        });
      }
    });
    return () => {
      stop();
      // Nothing watches tasks, projects or tags until one is on screen again:
      // the cached ones are re-read when they next show (no catch-up on join).
      store.invalidate((kind) => isLiveKind(kind));
    };
  }, [store, needsLive, selectedWorkspaceId, userId]);

  // Coming back to the window re-reads what's on screen of the kinds Realtime
  // doesn't carry (the live link re-reads its own), once per return.
  useEffect(() => {
    if (!store || typeof window === "undefined") return;
    let last = 0;
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < RESYNC_COALESCE_MS) return;
      last = now;
      store.invalidate((kind) => !isLiveKind(kind));
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [store]);

  return (
    <ReferenceStoreProvider store={store} canEditTasks={canEditTasks}>
      {children}
    </ReferenceStoreProvider>
  );
}
