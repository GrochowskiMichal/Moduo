// The 404: two strokes that don't touch, so nothing opens between them. Point at (or focus) the
// way home and they close until a window opens: the one link on the page.
import { gsap } from "gsap";

import { ease, onPage, prefersReducedMotion } from "../engine";
import { chainLayers, chainX } from "../lib/stroke";

const APART = 1.9;

export function startNotFound() {
  onPage(() => {
    const svg = document.querySelector<SVGSVGElement>("[data-lost] svg[data-chain]");
    const link = document.querySelector<HTMLElement>("[data-lost-link]");
    if (!svg || !link) return;
    const id = svg.dataset.chain!;
    const a = svg.querySelector<SVGPathElement>(`#${id}-a`)!;
    const b = svg.querySelector<SVGPathElement>(`#${id}-b`)!;
    const s = { g: APART };
    const draw = () => {
      // Keep the pair centered on the apart pair's middle while it closes.
      const xs = chainX([s.g]);
      const shift = (APART - s.g) * 97.12;
      const l = chainLayers(xs.map((x) => x + shift));
      a.setAttribute("d", l.a);
      b.setAttribute("d", l.b);
    };
    const to = (g: number) =>
      prefersReducedMotion()
        ? ((s.g = g), draw())
        : gsap.to(s, { g, duration: 0.7, ease: ease.out, onUpdate: draw, overwrite: true });
    const open = () => void to(1);
    const shut = () => void to(APART);
    link.addEventListener("pointerenter", open);
    link.addEventListener("focus", open);
    link.addEventListener("pointerleave", shut);
    link.addEventListener("blur", shut);
    return () => {
      link.removeEventListener("pointerenter", open);
      link.removeEventListener("focus", open);
      link.removeEventListener("pointerleave", shut);
      link.removeEventListener("blur", shut);
    };
  });
}
