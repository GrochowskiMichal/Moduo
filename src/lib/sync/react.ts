// React's way into the shared store (TV-D11a). A component that needs a
// workspace's Tasks data holds the store while mounted (`useWorkspaceStore`)
// and reads its snapshot (`useStoreSnapshot`). The app shell holds the
// selected workspace's store for the whole session, so every page opens warm.
//
// With the React Compiler on, the hook must return the `useSyncExternalStore`
// snapshot itself (docs/gotchas/ui.md, RF-1): never read the store beside it.

import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { ModuoRuntime } from "../runtime.types";
import { EMPTY_SNAPSHOT, type StoreSnapshot, type WorkspaceStore, workspaceStore } from "./store";

const noSubscribe = () => () => {};
const emptySnapshot = () => EMPTY_SNAPSHOT;

/**
 * The workspace's store, running while this component is mounted. Null when
 * there's no runtime, person or workspace yet, or reading Tasks isn't allowed.
 */
export function useWorkspaceStore(
  runtime: ModuoRuntime | null,
  userId: string | null,
  workspaceId: string | null,
  enabled = true,
): WorkspaceStore | null {
  const store = useMemo(
    () =>
      enabled && runtime && userId && workspaceId
        ? workspaceStore(runtime, userId, workspaceId)
        : null,
    [enabled, runtime, userId, workspaceId],
  );
  useEffect(() => store?.acquire(), [store]);
  return store;
}

/** The store's current snapshot (an empty one without a store). */
export function useStoreSnapshot(store: WorkspaceStore | null): StoreSnapshot {
  return useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.getSnapshot : emptySnapshot,
    store ? store.getSnapshot : emptySnapshot,
  );
}
