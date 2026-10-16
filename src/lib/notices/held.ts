// "3 held until Focus ends" (CV-18, #33): your notices a running Focus is
// holding. The server writes them `held_for_focus` and never pushes them; when
// the run stops running it closes them into one summary ("3 messages while you
// focused"). Read from your own rows (RLS), every 30 s while shown.

import { useEffect, useState } from "react";

import { supabaseClient } from "@/lib/runtime.web";

export const HELD_REFRESH_MS = 30_000;

/** The line, or null when nothing is held. */
export function heldLine(count: number): string | null {
  return count > 0 ? `${count} held until Focus ends` : null;
}

async function readHeldCount(): Promise<number> {
  const { count, error } = await supabaseClient
    .from("notice_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("held_for_focus", true)
    .is("acked_at", null);
  return error ? 0 : (count ?? 0);
}

/** How many of your notices Focus holds now (0 when none or unknown). */
export function useHeldForFocus(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const read = () =>
      void readHeldCount().then((n) => {
        if (!cancelled) setCount(n);
      });
    read();
    const timer = setInterval(read, HELD_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return count;
}
