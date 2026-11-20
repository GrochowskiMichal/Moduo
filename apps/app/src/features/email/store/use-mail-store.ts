import { useSyncExternalStore } from "react";

import { type MailStore, mailStore, type MailStoreState } from "./mail-store";

/** Read one slice of the mail store; the selector must return a stable value. */
export function useMailStore<T>(
  selector: (s: MailStoreState) => T,
  store: MailStore = mailStore,
): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

const selectBadge = (s: MailStoreState) => s.badge;
const selectHasEngine = (s: MailStoreState) => s.engine !== null;

/** The nav and Dock mail badge, correct from launch (AC35). */
export function useMailBadge(): { count: number; live: boolean } {
  const count = useMailStore(selectBadge);
  const live = useMailStore(selectHasEngine);
  return { count, live };
}
