// Shared by the hours grid and what it lays over its columns.

import { useEffect, useState } from "react";

/** Re-render tick for the now-line; catches up on tab wake. */
export function useNowTick(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    const onWake = () => setNow(new Date());
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [intervalMs]);
  return now;
}

/** CSS length for a minute offset: hour height × real hours. */
export function gridY(minutes: number): string {
  return `calc(var(--cal-hour-h) * ${minutes / 60})`;
}
