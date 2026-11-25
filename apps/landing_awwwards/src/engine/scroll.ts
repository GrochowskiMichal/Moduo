// Smooth scroll on one clock: Lenis runs on gsap.ticker and ScrollTrigger reads Lenis.
// Reduced motion keeps native scroll and still publishes the position.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

import { ease, prefersReducedMotion } from "./env";

gsap.registerPlugin(ScrollTrigger);

export type ScrollState = { y: number; velocity: number; progress: number };

let lenis: Lenis | null = null;
/** A part of a page that takes wheel and touch gestures for itself while it wants them (the home
 *  hero's chapters, motion/dusk-steps.ts). It answers true to take one (the page doesn't scroll
 *  for it), false to let the page scroll. One at a time; never asked while the page's scroll is
 *  stopped (the menu), for a pinch, or inside an element that keeps its own scroll. */
export type ScrollGate = (g: { deltaY: number; event: WheelEvent | TouchEvent }) => boolean;
let gate: ScrollGate | null = null;
const keepsOwn = (e: Event) =>
  e
    .composedPath()
    .some(
      (n) =>
        n instanceof HTMLElement &&
        (n.hasAttribute("data-lenis-prevent") || n.hasAttribute("data-lenis-prevent-wheel")),
    );
const listeners = new Set<(s: ScrollState) => void>();
const state: ScrollState = { y: 0, velocity: 0, progress: 0 };

export function initScroll() {
  if (lenis) return;
  if (prefersReducedMotion()) {
    addEventListener("scroll", nativeTick, { passive: true });
    return;
  }
  lenis = new Lenis({
    lerp: 0.12,
    wheelMultiplier: 1,
    touchMultiplier: 1.1,
    anchors: true,
    virtualScroll: (d) => {
      // Under a modal dialog the page stays where it is; a dialog taller than the screen keeps
      // its own scroll.
      const modal = document.querySelector<HTMLDialogElement>("dialog[open]");
      if (modal) {
        if (modal.scrollHeight <= modal.clientHeight + 1 && d.event.cancelable)
          d.event.preventDefault();
        return false;
      }
      if (!gate || lenis?.isStopped || d.event.ctrlKey || keepsOwn(d.event)) return true;
      if (!gate(d)) return true;
      if (d.event.cancelable) d.event.preventDefault();
      return false;
    },
  });
  lenis.on("scroll", (l: Lenis) => {
    state.y = l.scroll;
    state.velocity = l.velocity;
    state.progress = l.limit > 0 ? l.scroll / l.limit : 0;
    ScrollTrigger.update();
    listeners.forEach((fn) => fn(state));
  });
  gsap.ticker.add((time) => lenis?.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

function nativeTick() {
  const max = document.documentElement.scrollHeight - innerHeight;
  state.velocity = scrollY - state.y;
  state.y = scrollY;
  state.progress = max > 0 ? scrollY / max : 0;
  listeners.forEach((fn) => fn(state));
}

export const onScroll = (fn: (s: ScrollState) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const scrollState = () => state;
export const setScrollGate = (fn: ScrollGate | null) => {
  gate = fn;
};
/** Glide to `y` on the stage curve (ease.glide), the page's own scroll held off until it lands; a new glide
 *  takes over from one under way. */
export function glideTo(y: number, duration: number) {
  if (lenis)
    lenis.scrollTo(y, { duration, easing: gsap.parseEase(ease.glide), lock: true, force: true });
  else scrollTo({ top: y });
}
/** One endless page (the colophon): the scroll wraps from its end to its start and back, touch
 *  included (Lenis takes touch over while it's on). Off again when the page goes. */
export function setEndless(on: boolean) {
  if (!lenis) return;
  lenis.options.infinite = on;
  lenis.options.syncTouch = on;
  lenis.resize();
}
export const stopScroll = () => lenis?.stop();
export const startScroll = () => lenis?.start();

export function resetScroll() {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  else scrollTo(0, 0);
  state.y = 0;
  state.velocity = 0;
}

/** Move to `y` at once (no smooth scroll): under the curtain, or to reveal a focused element. */
export function jumpTo(y: number) {
  if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
  else scrollTo(0, y);
}

/** A link to a part of a page (/email#overlaps) lands there, minus its scroll-margin. */
export function jumpToHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const el = id ? document.getElementById(id) : null;
  if (!el) return;
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  jumpTo(el.getBoundingClientRect().top + scrollY - margin);
}

export function scrollToTarget(target: string | HTMLElement | number) {
  if (lenis) lenis.scrollTo(target, { duration: 1.2, easing: (t) => 1 - Math.pow(1 - t, 4) });
  else if (typeof target === "number") scrollTo({ top: target });
  else (typeof target === "string" ? document.querySelector(target) : target)?.scrollIntoView();
}
