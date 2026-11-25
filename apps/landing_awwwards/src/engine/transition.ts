// Page transitions in the brand's grammar: two Canvas panels with the stroke's 45° edge close
// over the page from both sides until they meet (the old page cancels out), then part on the
// new one (separation reveals). The adapter runs leave() while the next page loads.
import { gsap } from "gsap";

import { ease, prefersReducedMotion } from "./env";

export type Transition = {
  leave: (curtain: HTMLElement) => gsap.core.Animation;
  enter: (curtain: HTMLElement) => gsap.core.Animation;
};

// Far enough that a panel's diagonal clears the viewport on any aspect ratio.
const reach = () => innerWidth / 2 + innerHeight / 2 + 4;
const panels = (c: HTMLElement) => [c.querySelector(".curtain__l"), c.querySelector(".curtain__r")];

const parted: Transition = {
  leave: (c) => {
    const [l, r] = panels(c);
    return gsap
      .timeline()
      .set(c, { autoAlpha: 1 })
      .fromTo(l, { x: -reach() }, { x: 0, duration: 0.55, ease: ease.inOut }, 0)
      .fromTo(r, { x: reach() }, { x: 0, duration: 0.55, ease: ease.inOut }, 0);
  },
  enter: (c) => {
    const [l, r] = panels(c);
    return gsap
      .timeline()
      .to(l, { x: -reach(), duration: 0.7, ease: ease.out }, 0.05)
      .to(r, { x: reach(), duration: 0.7, ease: ease.out }, 0.05)
      .set(c, { autoAlpha: 0 });
  },
};

const reduced: Transition = {
  leave: (c) => {
    const [l, r] = panels(c);
    return gsap
      .timeline()
      .set([l, r], { x: 0 })
      .fromTo(c, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.18 });
  },
  enter: (c) => gsap.to(c, { autoAlpha: 0, duration: 0.18 }),
};

const pick = () => (prefersReducedMotion() ? reduced : parted);
const curtain = () => document.getElementById("curtain") as HTMLElement;

export const playLeave = () => pick().leave(curtain());
export const playEnter = () => pick().enter(curtain());
