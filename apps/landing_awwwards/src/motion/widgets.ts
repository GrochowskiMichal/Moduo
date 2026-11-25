// Small live pieces across the pages.
//  - The AI key: switching a module to None removes what the assistant could have said about it.
//  - Focus timers ([data-clock="seconds"]) count up, as a running focus session does in the app.
//  - Stroke pairs marked [data-join] close into one window when they scroll into view.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { onPage, prefersReducedMotion } from "../engine";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function startWidgets() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>("[data-ai]");
    if (!root) return;
    const form = root.querySelector("form")!;
    const update = () => {
      const levels = new Map<string, string>();
      root.querySelectorAll<HTMLFieldSetElement>("fieldset[data-module]").forEach((fs) => {
        const checked = fs.querySelector<HTMLInputElement>("input:checked");
        levels.set(fs.dataset.module!, checked?.value ?? "None");
      });
      root.querySelectorAll<HTMLElement>("[data-needs]").forEach((li) => {
        li.classList.toggle("is-off", levels.get(li.dataset.needs!) === "None");
      });
    };
    form.addEventListener("change", update);
    update();
    return () => form.removeEventListener("change", update);
  });

  onPage(() => {
    document.querySelectorAll<HTMLElement>("[data-join]").forEach((el) => {
      ScrollTrigger.create({
        trigger: el,
        start: "top 80%",
        once: true,
        onEnter: () => el.classList.add("is-joined"),
      });
    });
  });

  onPage(() => {
    const clocks = [...document.querySelectorAll<HTMLElement>("[data-clock]")];
    if (!clocks.length || prefersReducedMotion()) return;
    const start = clocks.map((c) => Number(c.dataset.clock) || 0);
    const t0 = gsap.ticker.time;
    let last = -1;
    const tick = (time: number) => {
      const s = Math.floor(time - t0);
      if (s === last) return;
      last = s;
      clocks.forEach((c, i) => (c.textContent = mmss(start[i] + s)));
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  });
}
