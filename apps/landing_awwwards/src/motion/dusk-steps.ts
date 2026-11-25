// Dusk's chapters as stages (motion/dusk.ts): inside the hero one gesture is one chapter. A wheel
// push, a swipe or a key glides to the next chapter's rest (lib/dusk.ts chapterRest) on a soft
// in-out (the words change at once, the camera follows), and the rest of that gesture (a trackpad's inertia, a flick's tail) is spent on
// it, so a big scroll can't skip chapters. A fresh gesture early in a glide is kept and taken as
// soon as the glide is well under way: deliberate scrolling still runs at a steady pace.
// Past the last chapter the page scrolls on as ever, and scrolling back up into the hero catches
// on the last chapter and steps from there; the first chapter lets go upward. A scrollbar drag or
// a link moves freely, and the next gesture steps from wherever it left the page.
// Not under reduced motion (the hero is tabs there, and the page scrolls natively).
import { gsap } from "gsap";

import { glideTo, scrollState, setScrollGate } from "../engine";

/** One stage's glide, s: unhurried, since the words lead it. */
const GLIDE = 1.3;
/** How far into a glide a fresh gesture may take the next stage, s. */
const NEXT = 0.6;
/** A pause in the wheel this long ends a gesture, ms (inertia runs on without one). */
const QUIET = 180;
/** Finger travel that makes a swipe, px. */
const SWIPE = 28;
/** Keys that step, and which way. */
const KEYS: Record<string, number> = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 };

/** `rests`: each chapter's rest, page px; `end`: where the hero's scroll ends; `chapterOf`: the
 *  chapter showing at a scroll position; `onGo`: told the chapter a step is headed for, as it
 *  starts. */
export function startSteps(
  rests: () => readonly number[],
  end: () => number,
  chapterOf: (y: number) => number,
  onGo: (k: number) => void,
) {
  let target = -1;
  let since = -1e9;
  // The wheel's gesture: when it last moved, how hard, and whether it has had its stage.
  let last = -1e9;
  let lastMag = 0;
  let spent = false;
  // The finger's: whether the hero takes it, how far it has gone, whether it has had its stage.
  let touch: null | "take" | "free" = null;
  let travel = 0;
  let swiped = false;

  const now = () => performance.now();
  const gliding = () => now() - since < GLIDE * 1000;
  const early = () => now() - since < NEXT * 1000;

  /** The stage a gesture going `dir` steps to, or -1 when the page should scroll instead. */
  const nextFrom = (dir: number) => {
    const s = rests();
    if (gliding() && target >= 0) {
      const k = target + dir;
      return k >= 0 && k < s.length ? k : -1;
    }
    const y = scrollState().y;
    if (y > end() + 2) return -1;
    if (dir > 0) return s.findIndex((v) => v > y + 4);
    // Going back from past a chapter's rest (its frame holds there, the last one's to the hero's
    // end) is going back from that chapter: to the one before, not to its own rest again.
    let k = s.length - 1;
    while (k >= 0 && s[k] >= y - 4) k--;
    if (k >= 0 && chapterOf(y) === k) k--;
    return k;
  };
  let queued: gsap.core.Tween | null = null;
  const go = (k: number) => {
    queued?.kill();
    queued = null;
    target = k;
    since = now();
    glideTo(rests()[k], GLIDE);
    onGo(k);
  };
  /** Step `dir` now, or keep it for when the glide under way is far enough along (one kept at
   *  most). False when the page should scroll instead. */
  const step = (dir: number) => {
    const k = nextFrom(dir);
    if (k < 0) return false;
    if (gliding() && early()) {
      queued?.kill();
      queued = gsap.delayedCall(Math.max(0, NEXT - (now() - since) / 1000), () => {
        queued = null;
        const n = nextFrom(dir);
        if (n >= 0) go(n);
      });
    } else go(k);
    return true;
  };

  const onWheel = (dy: number) => {
    const t = now();
    const mag = Math.abs(dy);
    // A new gesture: after a pause, or a fresh push rising out of the last one's dying inertia.
    if (t - last > QUIET || (mag > lastMag * 1.8 && mag > 20)) spent = false;
    last = t;
    lastMag = mag;
    if (!dy) return false;
    if (spent) return true;
    if (!step(Math.sign(dy))) return false;
    spent = true;
    return true;
  };

  const onTouch = (e: TouchEvent, dy: number) => {
    if (e.type === "touchstart") {
      touch = null;
      travel = 0;
      swiped = false;
      return false;
    }
    if (e.type === "touchend") {
      const took = touch === "take";
      touch = null;
      return took;
    }
    if (e.touches.length > 1) touch = "free";
    if (!touch) {
      if (!dy) return false;
      // Decided on the first move, for the whole swipe: a browser won't scroll a touch whose
      // first move was held, so a swipe that leaves the hero is never held.
      touch = nextFrom(Math.sign(dy)) < 0 ? "free" : "take";
    }
    if (touch === "free") return false;
    travel += dy;
    if (!swiped && Math.abs(travel) > SWIPE) swiped = step(Math.sign(travel));
    return true;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest("input, textarea, select, [contenteditable], dialog, [role=dialog]")) return;
    const space = e.key === " " && !el?.closest("button, a, [role=button], summary");
    const dir = space ? (e.shiftKey ? -1 : 1) : (KEYS[e.key] ?? 0);
    if (!dir) return;
    if (step(dir)) e.preventDefault();
  };

  setScrollGate(({ deltaY, event }) =>
    event.type.startsWith("touch") ? onTouch(event as TouchEvent, deltaY) : onWheel(deltaY),
  );
  addEventListener("keydown", onKey);
  return {
    /** Glide straight to chapter k (the chapter row's buttons). */
    go,
    /** The chapter a glide under way is headed for, or -1. */
    heading: () => (gliding() ? target : -1),
    stop: () => {
      queued?.kill();
      setScrollGate(null);
      removeEventListener("keydown", onKey);
    },
  };
}
