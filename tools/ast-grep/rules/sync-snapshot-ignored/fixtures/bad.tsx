// Pre-fix shape: subscribe for re-renders, then read the store beside it.
export function useReference(store: Store, ref: Ref) {
  // @flag
  useSyncExternalStore(store.subscribe, store.version);
  return store.read(ref);
}
