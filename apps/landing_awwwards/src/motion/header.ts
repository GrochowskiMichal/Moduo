// The header: one highlight (the app's hover fill) slides to the nav item under the pointer and
// rests on the current page; the bar steps aside while you scroll down and returns on the way up.
import { gsap } from "gsap";

import { ease, onPage, onScroll } from "../engine";

export function startHeader() {
  // Step aside: registered once, it reads the scroll feed for every page. Over a hero picture
  // (home's Dusk) the bar stays clear until the picture has gone by.
  let last = 0;
  let clearUntil = 40;
  const solidFrom = () => {
    const hero = document.querySelector<HTMLElement>("[data-light], [data-dusk]");
    const bar = document.querySelector<HTMLElement>(".hdr__in");
    return hero ? Math.max(40, hero.offsetHeight - (bar?.offsetHeight ?? 64)) : 40;
  };
  onScroll(({ y }) => {
    const root = document.documentElement;
    root.classList.toggle("hdr-solid", y > clearUntil);
    if (Math.abs(y - last) < 6) return;
    const away = y > 160 && y > last && !root.classList.contains("menu-open");
    root.classList.toggle("hdr-away", away);
    last = y;
  });

  onPage(() => {
    clearUntil = solidFrom();
    document.documentElement.classList.remove("hdr-away");
    document.documentElement.classList.toggle("hdr-solid", scrollY > clearUntil);
    const nav = document.querySelector<HTMLElement>(".hdr__nav");
    const hl = nav?.querySelector<HTMLElement>(".hdr__hl");
    if (!nav || !hl) return;
    const links = [...nav.querySelectorAll<HTMLElement>(".hdr__link")];
    const current = nav.querySelector<HTMLElement>("[aria-current]");

    const moveTo = (el: HTMLElement | null, instant = false) => {
      links.forEach((l) => l.classList.toggle("is-hot", l === el));
      if (!el) return void gsap.to(hl, { opacity: 0, duration: 0.25, ease: ease.out });
      const r = el.getBoundingClientRect();
      const n = nav.getBoundingClientRect();
      gsap.to(hl, {
        x: r.left - n.left,
        width: r.width,
        opacity: 1,
        duration: instant ? 0 : 0.42,
        ease: ease.out,
        overwrite: true,
      });
    };
    moveTo(current, true);

    // A pointer left resting where the last page's link was (after Back) is not a hover yet:
    // the highlight follows the pointer only once it moves on this page.
    let armed = false;
    const arm = () => {
      armed = true;
    };
    addEventListener("pointermove", arm, { once: true, passive: true });
    const enter = (e: Event) => {
      if (e.type === "pointerenter" && !armed) return;
      moveTo(e.currentTarget as HTMLElement);
    };
    const rest = () => moveTo(current);
    links.forEach((l) => {
      l.addEventListener("pointerenter", enter);
      l.addEventListener("focus", enter);
      l.addEventListener("blur", rest);
    });
    nav.addEventListener("pointerleave", rest);
    return () => {
      links.forEach((l) => {
        l.removeEventListener("pointerenter", enter);
        l.removeEventListener("focus", enter);
        l.removeEventListener("blur", rest);
      });
      nav.removeEventListener("pointerleave", rest);
      removeEventListener("pointermove", arm);
    };
  });
}
