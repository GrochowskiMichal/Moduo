// Where you are on a long page: the rail lights the part you are reading. Links in a
// [data-spy] rail point at sections by id; a ChainNav rail also lights its stroke and label.
// The current part is the last one whose top has passed 45% of the screen, read from cached
// offsets on the one clock (ScrollTrigger), so jumps and anchor links land on the right part.
// State, not motion: it runs under reduced motion too.
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { onPage } from "../engine";

export function startRail() {
  onPage(() => {
    const rail = document.querySelector<HTMLElement>("[data-spy]");
    if (!rail) return;
    // A ChainNav's names repeat its strokes' links for the pointer: the strokes are the rail.
    const links = [...rail.querySelectorAll<Element>('a[href^="#"]:not(.cnav__labels a)')];
    const targets = links
      .map((a) => ({ a, el: document.getElementById((a.getAttribute("href") ?? "").slice(1)) }))
      .filter((t): t is { a: Element; el: HTMLElement } => !!t.el);
    if (!targets.length) return;

    let tops: number[] = [];
    let lit = -1;
    const measure = () => {
      tops = targets.map(({ el }) => el.getBoundingClientRect().top + scrollY);
    };
    const light = (index: number) => {
      if (index === lit) return;
      lit = index;
      targets.forEach(({ a }, i) => {
        const on = i === index;
        if (on) a.setAttribute("aria-current", "location");
        else a.removeAttribute("aria-current");
        const n = a.getAttribute("data-i");
        if (n === null) return;
        a.querySelector(".cnav__s")?.classList.toggle("is-current", on);
        rail.querySelector(`.cnav__labels li[data-i="${n}"]`)?.classList.toggle("is-current", on);
      });
    };
    const update = (y: number) => {
      const line = y + innerHeight * 0.45;
      let index = 0;
      for (let i = 0; i < tops.length; i++) if (tops[i] <= line) index = i;
      light(index);
    };
    const st = ScrollTrigger.create({
      start: 0,
      end: "max",
      onRefresh: (self) => {
        measure();
        update(self.scroll());
      },
      onUpdate: (self) => update(self.scroll()),
    });
    measure();
    update(scrollY);
    return () => st.kill();
  });
}
