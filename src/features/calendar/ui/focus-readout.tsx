// The live focus readout (CAL-5). Self-ticking so ONLY this span re-renders
// each second — the grid/chip stay off the per-second render path. Elapsed =
// the banked (paused) seconds + the live running stretch since `runningSinceMs`.

import { useEffect, useState } from "react";

import { formatFocusClock } from "../focus";

type Props = {
  /** Epoch (ms) the running stretch began; null while paused. */
  runningSinceMs: number | null;
  /** Seconds banked before the current stretch. */
  baseSeconds: number;
  className?: string;
};

export function FocusReadout({ runningSinceMs, baseSeconds, className }: Props) {
  const [, force] = useState(0);
  useEffect(() => {
    if (runningSinceMs == null) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [runningSinceMs]);

  const seconds =
    baseSeconds + (runningSinceMs != null ? Math.floor((Date.now() - runningSinceMs) / 1000) : 0);
  return (
    <span className={className} aria-label={`Focused ${formatFocusClock(seconds)}`}>
      {formatFocusClock(seconds)}
    </span>
  );
}
