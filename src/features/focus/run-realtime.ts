// My own runs, live (TV-F2): another device of mine starting, pausing, moving
// or ending the run reaches this one within a couple of seconds. One Supabase
// channel per signed-in person, `postgres_changes` on focus_runs filtered to
// my rows; Realtime checks RLS (own rows only) on inserts and updates. Like
// TV-D5's tasks realtime this imports the Supabase client directly: Realtime
// is a socket concern, outside the runtime seam. Polling (run.ts) stays the
// backstop.

import { supabaseClient } from "../../lib/runtime.web";

export function subscribeOwnRuns(
  userId: string,
  onRow: (row: unknown) => void,
  onResync: () => void,
): () => void {
  let joinedOnce = false;
  const channel = supabaseClient
    .channel(`focus-runs:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "focus_runs", filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = (payload as { new?: unknown }).new;
        if (row && typeof row === "object" && Object.keys(row).length > 0) onRow(row);
      },
    )
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // Every join after the first is a reconnect that may have missed changes.
      if (joinedOnce) onResync();
      joinedOnce = true;
    });
  return () => {
    void supabaseClient.removeChannel(channel);
  };
}
