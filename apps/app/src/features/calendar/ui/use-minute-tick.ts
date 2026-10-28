// A clock for lines that name what's on now (the toolbar's now-and-next, the
// Home Today widget): re-renders every 30 s and catches up when the tab wakes.

import { useEffect, useState } from "react";

/** Now (ms), refreshed every 30 s and on visibilitychange. */
export function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return now;
}
