// The app's window at the foot of the hero (components/home/HeroWindow.astro). With the page's
// intro Moduo's Home stands up out of the dark, from lying back to its lean, and a light runs out
// along its top edge from the middle; then it holds still (the app's focus clock in its bar is the
// only thing that moves, motion/widgets.ts; the warm light the shafts lay on its edge is
// motion/first-light.ts's). With reduced motion it is simply there. The line above it arrives
// through the reveals (engine/reveal.ts): its two short lines, then the one big word.
import { gsap } from "gsap";

import { ease, onPage, prefersReducedMotion } from "../engine";

export function startHero() {
  onPage(({ intro }) => {
    const hwin = document.querySelector<HTMLElement>("[data-hwin]");
    if (!hwin) return;
    if (prefersReducedMotion()) {
      hwin.classList.add("is-ready");
      return;
    }
    const rise = hwin.querySelector<HTMLElement>("[data-hwin-rise]")!;
    const rim = hwin.querySelector<HTMLElement>("[data-hwin-rim]")!;

    gsap.set(rise, { autoAlpha: 0, y: 110, rotationX: 34 });
    gsap.set(rim, { scaleX: 0, autoAlpha: 0 });
    hwin.classList.add("is-ready");

    const tl = gsap.timeline({ paused: true });
    tl.to(rise, { autoAlpha: 1, duration: 0.9, ease: ease.out }, 0)
      .to(rise, { y: 0, rotationX: 0, duration: 1.8, ease: ease.out }, 0)
      .to(rim, { scaleX: 1, autoAlpha: 1, duration: 1.4, ease: ease.inOut }, 0.7);
    intro.add(() => void tl.play(), 0.15);

    return () => {
      tl.kill();
      hwin.classList.remove("is-ready");
    };
  });
}
