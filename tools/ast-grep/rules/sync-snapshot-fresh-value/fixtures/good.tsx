// Fixed: a snapshot keeps its identity until the store changes.
import { useSyncExternalStore } from "react";

const EMPTY: string[] = [];
const getEmpty = () => EMPTY;

export function useTyping(store: Store | null) {
  return useSyncExternalStore(store?.subscribe ?? noop, store?.get ?? getEmpty);
}

export function useView(store: Store, channel: string) {
  return useSyncExternalStore(store.subscribe, () => store.view(channel));
}
