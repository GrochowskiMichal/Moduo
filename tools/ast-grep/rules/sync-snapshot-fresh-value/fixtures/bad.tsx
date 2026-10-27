// Pre-fix shapes: every `@flag` line must be reported.
import { useSyncExternalStore } from "react";

export function useTyping(store: Store | null) {
  return useSyncExternalStore(
    store?.subscribe ?? noop,
    // @flag
    () => [],
  );
}

export function useSeen(store: Store) {
  return React.useSyncExternalStore(
    store.subscribe,
    // @flag
    () => new Set(store.ids()),
  );
}

export function useMap(store: Store) {
  // @flag
  return useSyncExternalStore(store.subscribe, () => ({ ...store.state }));
}
