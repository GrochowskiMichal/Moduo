// Fixed: the snapshot is the state.
export function useReference(store: Store, ref: Ref) {
  return useSyncExternalStore(store.subscribe, () => store.read(ref));
}
