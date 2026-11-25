// The compare page's morning (components/compare/WhereThingsLive.astro): the stack or Moduo. One
// number, --t on the figure, carries every part from the stack (0) to Moduo (1); the geometry and
// each part's stretch of it are CSS. As the figure comes into view the reader's own scroll moves
// it, forward and back, so the copies cancel and the chain forms while you watch; once a button
// is pressed, the buttons own it and tween it. The half-way point says which state is showing.
// Under reduced motion nothing moves by itself and a button sets the state at once.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { onPage, prefersReducedMotion } from "../../engine";

export function startCompare() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>('[data-pg="compare"]');
    const fig = root?.querySelector<HTMLElement>("[data-wt]");
    if (!fig) return;
    const picks = [...fig.querySelectorAll<HTMLButtonElement>("[data-wt-pick]")];
    const reduce = prefersReducedMotion();
    const st = { t: 0 };
    let moduo = false;

    const apply = () => {
      fig.style.setProperty("--t", st.t.toFixed(4));
      const on = st.t > 0.5;
      if (on === moduo) return;
      moduo = on;
      fig.classList.toggle("is-moduo", on);
      for (const b of picks)
        b.setAttribute("aria-pressed", String((b.dataset.wtPick === "moduo") === on));
    };

    let scrub: ScrollTrigger | null = reduce
      ? null
      : ScrollTrigger.create({
          trigger: fig.querySelector(".wt__box") ?? fig,
          // From the plate's top at mid screen until its middle is: the stack is read first,
          // and the chain stands whole on screen.
          start: "top 50%",
          end: "center 50%",
          scrub: 0.6,
          animation: gsap.to(st, { t: 1, ease: "none", onUpdate: apply }),
        });

    const onPick = (e: Event) => {
      const to = (e.currentTarget as HTMLElement).dataset.wtPick === "moduo" ? 1 : 0;
      if (scrub) {
        scrub.animation?.kill();
        scrub.kill();
        scrub = null;
      }
      if (reduce) {
        st.t = to;
        apply();
        return;
      }
      gsap.to(st, { t: to, duration: 1.8, ease: "power2.inOut", onUpdate: apply, overwrite: true });
    };
    for (const b of picks) b.addEventListener("click", onPick);

    return () => {
      scrub?.kill();
      gsap.killTweensOf(st);
      for (const b of picks) b.removeEventListener("click", onPick);
    };
  });
}
