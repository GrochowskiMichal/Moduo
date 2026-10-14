// The contexts a reference reads: the workspace's reference store (lazy,
// cached facts) and the page that hosts it (how opening works there). Light on
// purpose: the app's wiring (runtime, Realtime) is in ./provider.tsx, so a test
// or a story can hand in a store of its own.

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import { referenceKey } from "./kinds";
import type { ReferenceStore } from "./store";
import type { ReferenceLevel, ReferenceRef, ReferenceState } from "./types";

const ReferenceStoreContext = createContext<ReferenceStore | null>(null);

/** What the page around a reference offers it. Every member is optional. */
export type ReferenceHost = {
  /**
   * Open the item in this page's right panel as "← item" (SH-1's stack).
   * Without it a click opens the item full, in its own module.
   */
  openInPanel?: (ref: ReferenceRef) => void;
  /** Complete or reopen a task from its card (the card's one action). */
  setTaskDone?: (taskId: string, done: boolean) => void;
  /** `/` in prose creates too: "New task “Buy milk”" (a type and a title). */
  createEntity?: (type: string, title: string) => Promise<ReferenceRef | null>;
  /** The reader can edit tasks here (shows the card's Complete action). */
  canEditTasks?: boolean;
};

const ReferenceHostContext = createContext<ReferenceHost | null>(null);

/** Whether the reader may complete tasks from a card (the Tasks permission). */
const ReferenceCanEditContext = createContext(false);

/** Hand a store to everything below (the app's provider, a test, a story). */
export function ReferenceStoreProvider({
  store,
  canEditTasks = false,
  children,
}: {
  store: ReferenceStore | null;
  /** The reader can edit tasks: a card offers Complete. */
  canEditTasks?: boolean;
  children?: ReactNode;
}) {
  return (
    <ReferenceStoreContext.Provider value={store}>
      <ReferenceCanEditContext.Provider value={canEditTasks}>
        {children}
      </ReferenceCanEditContext.Provider>
    </ReferenceStoreContext.Provider>
  );
}

/** Whether a card may offer Complete (reactive: follows the permission as it loads). */
export function useCanEditTasks(): boolean {
  return useContext(ReferenceCanEditContext);
}

/** Say how references open and act on this page. */
export function ReferenceHostProvider({
  host,
  children,
}: {
  host: ReferenceHost;
  children?: ReactNode;
}) {
  return <ReferenceHostContext.Provider value={host}>{children}</ReferenceHostContext.Provider>;
}

export function useReferenceStore(): ReferenceStore | null {
  return useContext(ReferenceStoreContext);
}

export function useReferenceHost(): ReferenceHost | null {
  return useContext(ReferenceHostContext);
}

const NOOP_SUBSCRIBE = () => () => {};
const ZERO = () => 0;

/**
 * A reference's state, kept live: asks the store for it while mounted (at the
 * chip level, or the card's when `level` is "card") and re-renders when its
 * answer changes. Null outside the app shell (no store), where a caller falls
 * back to whatever it had.
 */
export function useReference(
  ref: ReferenceRef | null,
  level: ReferenceLevel = "chip",
  enabled = true,
): ReferenceState | null {
  const store = useReferenceStore();
  const type = ref?.type ?? null;
  const id = ref?.id ?? null;
  // The state IS the snapshot (the store hands back one object per answer), so
  // the React Compiler's memoisation can never keep an old one (gotchas §UI).
  const state = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    () => (store && type && id ? store.read({ type, id }) : null),
    () => null,
  );
  useEffect(() => {
    if (!store || !enabled || !type || !id) return;
    return store.want({ type, id }, level);
  }, [store, type, id, level, enabled]);
  return state;
}

/**
 * Many references at once (a notification list's mentions): asks for each and
 * returns a reader for their current states.
 */
export function useReferences(
  refs: readonly ReferenceRef[],
): (ref: ReferenceRef) => ReferenceState | null {
  const store = useReferenceStore();
  const version = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    store?.getSnapshot ?? ZERO,
    ZERO,
  );
  const keys = refs.map(referenceKey).sort().join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `keys` is the identity of `refs`
  useEffect(() => {
    if (!store || refs.length === 0) return;
    const releases = refs.map((ref) => store.want(ref, "chip"));
    return () => {
      for (const release of releases) release();
    };
  }, [store, keys]);
  // The reader uses `version`, so it changes with every answer (the React
  // Compiler memoises on what a function reads, not on a deps list).
  return useMemo(
    () => (ref: ReferenceRef) => (store && version >= 0 ? store.read(ref) : null),
    [store, version],
  );
}
