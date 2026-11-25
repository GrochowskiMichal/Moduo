// The "Moduo for" pages' day (pages/for/[slug].astro). On a wide screen the moments' pictures move
// into one sticky stage beside the words, and the moment nearest the middle of the screen is the
// one shown: the old picture parts to the left as the new one arrives from the right (the site's
// verb), its parts come in, its keys go down, the caption and the chain's lit stroke follow. On a
// phone each picture stays with its words and plays its parts as it scrolls into view. Under
// reduced motion nothing here runs: every picture is in place, complete.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { ease, onPage, prefersReducedMotion } from "../../engine";

gsap.registerPlugin(ScrollTrigger);

const $$ = (el: ParentNode, s: string) => [...el.querySelectorAll<HTMLElement>(s)];

/** A picture's moment: its parts arrive, then its keys go down and come back up. */
function playMoment(pic: HTMLElement, delay = 0) {
  const tl = gsap.timeline({ delay });
  const parts = $$(pic, "[data-a]");
  if (parts.length)
    tl.fromTo(
      parts,
      { autoAlpha: 0, y: 10 },
      { autoAlpha: 1, y: 0, duration: 0.7, ease: ease.out, stagger: 0.12, overwrite: true },
      0.1,
    );
  const keys = $$(pic, "[data-key]");
  if (keys.length)
    tl.to(
      keys,
      { y: 2, duration: 0.09, ease: "power1.in", yoyo: true, repeat: 1, stagger: 0.05 },
      0.05,
    );
  return tl;
}

export function startUsecase() {
  onPage(() => {
    const body = document.querySelector<HTMLElement>("[data-ud]");
    if (!body || prefersReducedMotion()) return;
    const moments = $$(body, "[data-ud-m]");
    const holders = $$(body, "[data-ud-pic]");
    const pics = holders.map((h) => h.querySelector<HTMLElement>(".uc-pic")!);
    const slot = body.querySelector<HTMLElement>("[data-ud-slot]")!;
    const capTime = body.querySelector<HTMLElement>("[data-ud-cap-time]")!;
    const capWhere = body.querySelector<HTMLElement>("[data-ud-cap-where]")!;
    const strokes = $$(body, ".ud__chain .clit__s");

    // Each picture's parts wait for their moment.
    pics.forEach((p) => gsap.set($$(p, "[data-a]"), { autoAlpha: 0 }));
    const mm = gsap.matchMedia();

    // Wide: one sticky stage.
    mm.add("(min-width: 1000px)", () => {
      body.classList.add("is-live");
      pics.forEach((p, i) => {
        slot.append(p);
        gsap.set(p, { autoAlpha: i === 0 ? 1 : 0, x: 0 });
      });
      let current = 0;
      const show = (i: number) => {
        if (i === current) return;
        const from = current;
        current = i;
        moments.forEach((m, k) => m.classList.toggle("is-on", k === i));
        strokes.forEach((s, k) => s.classList.toggle("is-lit", k === i));
        capTime.textContent = holders[i].dataset.udTime ?? "";
        capWhere.textContent = holders[i].dataset.udWhere ?? "";
        const dir = i > from ? 1 : -1;
        gsap.to(pics[from], {
          autoAlpha: 0,
          x: -28 * dir,
          duration: 0.5,
          ease: ease.out,
          overwrite: true,
        });
        gsap.fromTo(
          pics[i],
          { autoAlpha: 0, x: 36 * dir },
          { autoAlpha: 1, x: 0, duration: 0.85, ease: ease.out, overwrite: true },
        );
        playMoment(pics[i], 0.1);
      };
      const triggers = moments.map((m, i) =>
        ScrollTrigger.create({
          trigger: m,
          start: "top 55%",
          end: "bottom 55%",
          onToggle: (self) => {
            if (self.isActive) show(i);
          },
        }),
      );
      // The first picture plays its moment once the stage comes into view.
      triggers.push(
        ScrollTrigger.create({
          trigger: body,
          start: "top 70%",
          once: true,
          onEnter: () => void playMoment(pics[0]),
        }),
      );
      return () => {
        triggers.forEach((t) => t.kill());
        pics.forEach((p, i) => {
          gsap.set(p, { clearProps: "opacity,visibility,transform" });
          holders[i].append(p);
        });
        moments.forEach((m, k) => m.classList.toggle("is-on", k === 0));
        strokes.forEach((s, k) => s.classList.toggle("is-lit", k === 0));
        body.classList.remove("is-live");
      };
    });

    // Narrow: each picture with its words, playing its moment as it comes into view.
    mm.add("(max-width: 999px)", () => {
      const triggers = pics.map((p) =>
        ScrollTrigger.create({
          trigger: p,
          start: "top 80%",
          once: true,
          onEnter: () => void playMoment(p),
        }),
      );
      return () => triggers.forEach((t) => t.kill());
    });

    return () => {
      mm.revert();
      pics.forEach((p) =>
        gsap.set($$(p, "[data-a]"), { clearProps: "opacity,visibility,transform" }),
      );
    };
  });
}
