// Arrivals, in the brand's grammar: things arrive (a fade and a short slide along the stroke
// axis), they don't perform. No blur, as in the app (decision 81). Authored in markup:
//   data-split            heading lines arrive one after another (SplitText, stays accessible)
//   data-reveal           a block arrives; "frame" travels a little further (large surfaces)
//   data-intro            plays with the page intro instead of on scroll
//   data-delay="0.2"      extra delay in seconds
// Nothing here runs under reduced motion; CSS keeps everything visible without JS.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

import { ease, prefersReducedMotion } from "./env";

gsap.registerPlugin(ScrollTrigger, SplitText);

// Keyboard users never wait for a scroll: the first Tab on a page finishes every arrival still
// pending, so no link or button is skipped for being hidden until it scrolls into view.
let pending: (() => void)[] = [];
let listening = false;
function finishOnTab(e: KeyboardEvent) {
  if (e.key !== "Tab" || !pending.length) return;
  const list = pending;
  pending = [];
  list.forEach((finish) => finish());
}

function splitTween(el: HTMLElement, isIntro: boolean) {
  const delay = parseFloat(el.dataset.delay || "0");
  const s = { tween: undefined as gsap.core.Tween | undefined, done: false, requested: false };
  SplitText.create(el, {
    type: "lines",
    linesClass: "split-line",
    // Spans, not divs: lines live inside headings, which allow only phrasing content.
    tag: "span",
    autoSplit: true,
    aria: "auto",
    onSplit(self) {
      gsap.set(el, { visibility: "visible" });
      if (s.done) return;
      s.tween = gsap.fromTo(
        self.lines,
        { autoAlpha: 0, x: -18 },
        {
          autoAlpha: 1,
          x: 0,
          duration: 0.9,
          stagger: 0.07,
          ease: ease.out,
          delay,
          paused: isIntro && !s.requested,
          onComplete: () => {
            s.done = true;
          },
          scrollTrigger: isIntro ? undefined : { trigger: el, start: "top 88%", once: true },
        },
      );
      return s.tween;
    },
  });
  pending.push(() => {
    s.done = true;
    gsap.set(el, { visibility: "visible" });
    s.tween?.scrollTrigger?.kill();
    s.tween?.progress(1);
  });
  return () => {
    s.requested = true;
    s.tween?.play();
  };
}

function blockTween(el: HTMLElement, paused: boolean) {
  const delay = parseFloat(el.dataset.delay || "0");
  const frame = el.dataset.reveal === "frame";
  gsap.set(el, { visibility: "visible" });
  const t = gsap.fromTo(
    el,
    { autoAlpha: 0, x: frame ? -24 : -14 },
    {
      autoAlpha: 1,
      x: 0,
      duration: frame ? 1.1 : 0.8,
      ease: ease.out,
      delay,
      paused,
      clearProps: "transform",
      scrollTrigger: paused ? undefined : { trigger: el, start: "top 90%", once: true },
    },
  );
  pending.push(() => {
    t.scrollTrigger?.kill();
    t.progress(1);
  });
  return t;
}

/** Wire every arrival inside `root`. Returns the page intro timeline (paused). */
export function initReveals(root: ParentNode = document) {
  const intro = gsap.timeline({ paused: true });
  pending = [];
  if (prefersReducedMotion()) return intro;
  if (!listening) {
    listening = true;
    document.addEventListener("keydown", finishOnTab);
  }

  root.querySelectorAll<HTMLElement>("[data-split]").forEach((el) => {
    const isIntro = el.hasAttribute("data-intro");
    const play = splitTween(el, isIntro);
    if (isIntro) intro.add(play, 0);
  });
  root.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
    const isIntro = el.hasAttribute("data-intro");
    const t = blockTween(el, isIntro);
    if (isIntro) intro.add(() => void t.play(), 0);
  });
  return intro;
}
