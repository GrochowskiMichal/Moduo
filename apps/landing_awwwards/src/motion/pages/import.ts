// /import: the move (components/import/Move.astro). Once the picture is in view the wires draw
// across one after another, top to bottom, and each note in Moduo's tree arrives as its wire
// lands; the files that are skipped get their tag last. It plays once. Reduced motion, and
// before this runs, show the finished move.
import { gsap } from "gsap";

import { ease, onPage, prefersReducedMotion } from "../../engine";

export function startImport() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>('[data-pg="import"]');
    const mv = root?.querySelector<HTMLElement>("[data-mv]");
    if (!mv || prefersReducedMotion()) return;
    const wires = [...mv.querySelectorAll<SVGGElement>("[data-mv-wire]")];
    const notes = [...mv.querySelectorAll<HTMLElement>("[data-mv-note]")];
    const skips = [...mv.querySelectorAll<HTMLElement>("[data-mv-skip]")];
    const foot = mv.querySelector<HTMLElement>(".mv__foot");

    gsap.set(
      wires.map((w) => w.querySelector("path")),
      { strokeDashoffset: 1 },
    );
    gsap.set(
      wires.flatMap((w) => [...w.querySelectorAll("circle")]),
      { autoAlpha: 0 },
    );
    gsap.set(notes, { autoAlpha: 0, x: -10 });
    gsap.set([...skips, foot], { autoAlpha: 0 });

    const tl = gsap.timeline({
      paused: true,
      // Stacked on a phone, the notes are the panel to wait for.
      scrollTrigger: {
        trigger: wires[0]?.closest("svg")?.getBoundingClientRect().width
          ? mv
          : (mv.querySelector(".mv__to") ?? mv),
        start: "top 78%",
        once: true,
        onEnter: () => void tl.play(),
      },
    });
    wires.forEach((w, k) => {
      const at = 0.35 + k * 0.16;
      const [start, end] = w.querySelectorAll("circle");
      const note = notes[Number(w.dataset.mvWire)];
      tl.to(start, { autoAlpha: 1, duration: 0.2, ease: ease.out }, at)
        .to(w.querySelector("path"), { strokeDashoffset: 0, duration: 0.7, ease: ease.inOut }, at)
        .to(end, { autoAlpha: 1, duration: 0.2, ease: ease.out }, at + 0.6)
        .to(note, { autoAlpha: 1, x: 0, duration: 0.7, ease: ease.out }, at + 0.55);
    });
    const after = 0.35 + wires.length * 0.16 + 0.6;
    tl.to(skips, { autoAlpha: 1, duration: 0.5, stagger: 0.08, ease: ease.out }, after).to(
      foot,
      { autoAlpha: 1, duration: 0.6, ease: ease.out },
      after + 0.2,
    );

    return () => tl.kill();
  });
}
