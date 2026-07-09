// framer-motion needs a JS number for a transition duration, but the design
// system forbids raw ms / cubic-bezier in components (DESIGN_RULES R6 — motion
// tokens are load-bearing). This is the sanctioned bridge: read the live values
// straight off the motion tokens so `tokens.css` stays the single source of truth,
// including the reduced-motion media query (which zeroes the movement durations —
// `getComputedStyle` reflects the active media state, so a reduced-motion user
// gets `duration: 0` here for free, no separate branch).

import { useEffect, useState } from "react";

/** A cubic-bezier as [x1,y1,x2,y2] (framer's tuple form), or "linear". */
export type GridEase = [number, number, number, number] | "linear";

export interface GridMotion {
  /** Seconds — framer-motion's unit. */
  duration: number;
  ease: GridEase;
}

/** No animation — the SSR / test / unmeasured fallback (no magic numbers, rule-clean). */
const INSTANT: GridMotion = { duration: 0, ease: "linear" };

function parseSeconds(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return null;
  if (v.endsWith("ms")) return n / 1000;
  if (v.endsWith("s")) return n;
  return n / 1000; // bare number → tokens are authored in ms
}

function parseEase(value: string): GridEase {
  const match = /cubic-bezier\(([^)]+)\)/.exec(value);
  if (!match) return "linear";
  const nums = match[1].split(",").map((s) => Number.parseFloat(s.trim()));
  return nums.length === 4 && nums.every(Number.isFinite)
    ? [nums[0], nums[1], nums[2], nums[3]]
    : "linear";
}

/**
 * The movement-glide spec for the grid, read from the `--motion-base` /
 * `--ease-out` tokens. Under `prefers-reduced-motion` the token is `0ms`, so this
 * returns an instant transition — movement zeroes out, exactly as R6 prescribes.
 */
export function readGridMotion(): GridMotion {
  if (typeof window === "undefined" || typeof document === "undefined") return INSTANT;
  const styles = getComputedStyle(document.documentElement);
  const duration = parseSeconds(styles.getPropertyValue("--motion-base"));
  if (duration === null) return INSTANT;
  return { duration, ease: parseEase(styles.getPropertyValue("--ease-out")) };
}

/** Reactive `readGridMotion` — re-reads when the reduced-motion preference flips. */
export function useGridMotion(): GridMotion {
  const [motion, setMotion] = useState<GridMotion>(readGridMotion);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion(readGridMotion());
    update(); // sync once mounted (SSR fallback was INSTANT)
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return motion;
}
