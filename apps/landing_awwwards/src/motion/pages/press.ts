// /press's plate (components/press/Plate.astro): when it comes into view the clear space opens
// outward from the artwork's own box, the guides draw across, and the o's that measure the room
// arrive in its margins. Once, then still. Without motion the plate is simply drawn.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { ease, onPage, prefersReducedMotion } from "../../engine";

export function startPress() {
  onPage(() => {
    const plate = document.querySelector<HTMLElement>('[data-pg="press"] [data-plate]');
    if (!plate || prefersReducedMotion()) return;
    const rooms = [...plate.querySelectorAll<SVGRectElement>(".plate__room")];
    const guides = plate.querySelectorAll<SVGPathElement>(".plate__gl");
    const os = plate.querySelectorAll<SVGPathElement>(".plate__o");
    const labels = plate.querySelectorAll<SVGElement>(".plate__gt, .plate__dim");

    const from = rooms.map((r) => {
      const [x, y, width, height] = (r.dataset.room ?? "").split(" ").map(Number);
      return { x, y, width, height };
    });
    const to = rooms.map((r) => ({
      x: r.x.baseVal.value,
      y: r.y.baseVal.value,
      width: r.width.baseVal.value,
      height: r.height.baseVal.value,
    }));

    rooms.forEach((r, i) => gsap.set(r, { attr: from[i], autoAlpha: 0 }));
    gsap.set(guides, { strokeDasharray: 1, strokeDashoffset: 1 });
    gsap.set([...os, ...labels], { autoAlpha: 0 });

    const tl = gsap.timeline({ paused: true });
    tl.to(guides, { strokeDashoffset: 0, duration: 1.2, ease: ease.inOut, stagger: 0.08 }, 0).to(
      rooms,
      { autoAlpha: 1, duration: 0.3 },
      0.35,
    );
    rooms.forEach((r, i) => tl.to(r, { attr: to[i], duration: 1.1, ease: ease.out }, 0.35));
    tl.to(os, { autoAlpha: 1, duration: 0.6, ease: ease.out, stagger: 0.06 }, 0.95).to(
      labels,
      { autoAlpha: 1, duration: 0.6, ease: ease.out, stagger: 0.04 },
      1.05,
    );

    const st = ScrollTrigger.create({
      trigger: plate,
      start: "top 75%",
      once: true,
      onEnter: () => void tl.play(),
    });
    return () => {
      st.kill();
      tl.kill();
    };
  });
}
