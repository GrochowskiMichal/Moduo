// Engine core: the page lifecycle, framework-agnostic and SSR-safe (no DOM work at import).
//   boot(setup)          once, on first load: setup → page init → intro
//   leave() → cleanup()  before the route swaps (leave runs in parallel with the fetch)
//   enter()              after the new page is in the DOM: init → enter → intro
// Project code hooks in with onPage(fn); everything fn creates inside its gsap.context is
// reverted on navigation. Return a function for the rest (window listeners and the like).
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { prefersReducedMotion } from "./env";
import { initReveals } from "./reveal";
import { initScroll, jumpToHash, resetScroll, startScroll, stopScroll } from "./scroll";
import { playEnter, playLeave } from "./transition";

export { ease, isMobile, isTouch, isWebKit, prefersReducedMotion } from "./env";
export {
  glideTo,
  jumpTo,
  onScroll,
  type ScrollGate,
  scrollState,
  scrollToTarget,
  setEndless,
  setScrollGate,
  startScroll,
  stopScroll,
} from "./scroll";

export type PageInfo = { intro: gsap.core.Timeline; path: string; firstLoad: boolean };
export type PageFn = (page: PageInfo) => void | (() => void);

const pageFns = new Set<PageFn>();
const cleanups: (() => void)[] = [];
let ctx: gsap.Context | null = null;
let intro: gsap.core.Timeline | null = null;
let ready = false;
let booted = false;
let firstLoad = true;

/** Run fn on every page load (and now, if a page is ready). Returns an unsubscribe. */
export function onPage(fn: PageFn) {
  pageFns.add(fn);
  if (ready) runPageFn(fn);
  return () => {
    pageFns.delete(fn);
  };
}

function runPageFn(fn: PageFn) {
  ctx?.add(() => {
    const c = fn({ intro: intro!, path: location.pathname, firstLoad });
    if (typeof c === "function") cleanups.push(c);
  });
}

// Flags on <html>, re-applied on every page because the router swaps root attributes.
export function syncFlags() {
  const h = document.documentElement.classList;
  h.add("js", "is-booted");
  h.toggle("motion", !prefersReducedMotion());
}

function initPage() {
  syncFlags();
  ctx = gsap.context(() => {
    intro = initReveals(document);
  });
  ready = true;
  pageFns.forEach(runPageFn);
  requestAnimationFrame(() => ScrollTrigger.refresh());
}

/** First load. `setup` registers global behavior once, before the first page initializes. */
export function boot(setup?: () => void) {
  if (booted) return;
  booted = true;
  syncFlags();
  initScroll();
  setup?.();
  initPage();
  firstLoad = false;
  document.documentElement.classList.add("is-loaded");
  intro?.play();
}

/** Close the curtain; resolves when the screen is covered. */
export async function leave() {
  stopScroll();
  await playLeave();
}

/** Tear down the current page: reverts every tween, ScrollTrigger and split. */
export function cleanup() {
  if (!ready) return;
  ready = false;
  cleanups.splice(0).forEach((c) => c());
  ctx?.revert();
  ctx = null;
}

/** Init the new page. `transition: false` for back and forward, where no leave ran. */
export async function enter({ transition = true, scrollTop = true } = {}) {
  if (!booted) return;
  cleanup();
  if (scrollTop) resetScroll();
  initPage();
  // A link into a page (/email#overlaps) opens on that part, still under the curtain.
  if (scrollTop) jumpToHash();
  startScroll();
  // The new page arrives while the panels part, not after: one continuous move.
  const parting = transition ? playEnter() : null;
  intro?.play();
  if (parting) await parting;
}
