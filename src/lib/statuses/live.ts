// The browser's sources for the people-now store (CV-17): `user_statuses`
// changes over Realtime (read under the table's rule, so only statuses you
// may see arrive) and the tab's visibility. Imported once by the app.

import { supabaseClient } from "../runtime.web";
import { readPeopleNow } from "./api";
import { setDefaultPeopleNowDeps } from "./store";

let seq = 0;

setDefaultPeopleNowDeps(() => ({
  read: readPeopleNow,
  live: (onChange) => {
    seq += 1;
    const channel = supabaseClient
      .channel(`user-statuses:${seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_statuses" }, () =>
        onChange(),
      )
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
