// The browser's sources for the people-now store (CV-17): `user_statuses`
// changes over Realtime (read under the table's rule, so only statuses you
// may see arrive) and the tab's visibility. Imported once by the app.

import { supabaseClient } from "../runtime.web.client";
import { readPeopleNow } from "./api";
import { setDefaultPeopleNowDeps } from "./store";

let seq = 0;

setDefaultPeopleNowDeps(() => ({
  read: readPeopleNow,
  live: (onChange) => {
    seq += 1;
    // Inserts and updates only: clearing and expiry update the row, and a
    // delete (account erasure) passes no read rule, so it isn't asked for.
    const changes = { schema: "public", table: "user_statuses" } as const;
    const channel = supabaseClient
      .channel(`user-statuses:${seq}`)
      .on("postgres_changes", { event: "INSERT", ...changes }, () => onChange())
      .on("postgres_changes", { event: "UPDATE", ...changes }, () => onChange())
      .subscribe();
    return () => {
      void supabaseClient.removeChannel(channel);
    };
  },
  visible: () => typeof document === "undefined" || document.visibilityState === "visible",
  onVisible: (fn) => {
    if (typeof document === "undefined") return () => {};
    const handler = () => {
      if (document.visibilityState === "visible") fn();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
}));
