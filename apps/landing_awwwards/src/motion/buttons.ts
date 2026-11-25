// The XOR sweep: a Paper band with the stroke's 45° edge enters from the left, covers the
// button (difference blend, so the button inverts), and on leave travels on and exits right.
// Touch, no-JS and reduced motion get the inversion in place from base.css.
import { gsap } from "gsap";

import { ease, isTouch, onPage, prefersReducedMotion } from "../engine";

export function startButtons() {
  onPage(() => {
    if (isTouch() || prefersReducedMotion()) return;
    const off: (() => void)[] = [];
    document.querySelectorAll<HTMLElement>("[data-sweep]").forEach((btn) => {
      const band = btn.querySelector<HTMLElement>(".btn__sweep");
      if (!band) return;
      const get = () => parseFloat(band.style.getPropertyValue("--s") || "0");
      // Whether the band is on its way in or covering: a blur that lands before the cover's
      // first frame must still call it off (Tab moving straight past a button).
      let on = false;
      const cover = () => {
        on = true;
        if (get() >= 1.999) gsap.set(band, { "--s": 0 });
        gsap.to(band, { "--s": 1, duration: 0.42, ease: ease.out, overwrite: true });
      };
      const uncover = () => {
        if (!on) return;
        on = false;
        if (get() <= 0.05) {
          gsap.killTweensOf(band);
          gsap.set(band, { "--s": 0 });
          return;
        }
        gsap.to(band, {
          "--s": 2,
          duration: 0.42,
          ease: ease.out,
          overwrite: true,
          onComplete: () => void gsap.set(band, { "--s": 0 }),
        });
      };
      const focus = () => btn.matches(":focus-visible") && cover();
      btn.addEventListener("pointerenter", cover);
      btn.addEventListener("pointerleave", uncover);
      btn.addEventListener("focus", focus);
      btn.addEventListener("blur", uncover);
      off.push(() => {
        btn.removeEventListener("pointerenter", cover);
        btn.removeEventListener("pointerleave", uncover);
        btn.removeEventListener("focus", focus);
        btn.removeEventListener("blur", uncover);
      });
    });
    return () => off.forEach((f) => f());
  });
}
