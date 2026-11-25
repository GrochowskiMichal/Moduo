// /integrations: the filter. One group at a time (or all of them); the rows that stay part in
// from the left, the site's arrival, a few hundredths of a second apart. A polite status says how
// many show. Reduced motion switches in place.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { ease, onPage, prefersReducedMotion } from "../../engine";

export function startIntegrations() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>('[data-pg="integrations"]');
    const ix = root?.querySelector<HTMLElement>("[data-ix]");
    if (!ix) return;
    const buttons = [...ix.querySelectorAll<HTMLButtonElement>("[data-ix-kind]")];
    const groups = [...ix.querySelectorAll<HTMLElement>("[data-ix-group]")];
    const status = ix.querySelector<HTMLElement>("[data-ix-status]");
    const plate = root!.querySelector<HTMLElement>("[data-ixp]");
    let tween: gsap.core.Tween | null = null;
    let settled = false;

    // The first time the filter is used, every arrival in the index finishes where it is, so a
    // group that comes back is never waiting for a scroll that already happened.
    const settle = () => {
      if (settled) return;
      settled = true;
      ix.querySelectorAll<HTMLElement>("[data-reveal], [data-split], .split-line").forEach((el) => {
        gsap.getTweensOf(el).forEach((t) => {
          t.scrollTrigger?.kill();
          t.progress(1);
        });
        el.style.visibility = "visible";
      });
    };

    const show = (kind: string) => {
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ixKind === kind)));
      if (plate) plate.dataset.kind = kind;
      const shown = groups.filter((g) => {
        const on = kind === "all" || g.dataset.ixGroup === kind;
        g.hidden = !on;
        return on;
      });
      const rows = shown.flatMap((g) => [
        ...g.querySelectorAll<HTMLElement>(".ix-row, .ix-group__head"),
      ]);
      const count = shown.reduce((n, g) => n + g.querySelectorAll(".ix-row").length, 0);
      if (status) status.textContent = `Showing ${count} integration${count === 1 ? "" : "s"}`;
      tween?.kill();
      settle();
      ScrollTrigger.refresh();
      if (prefersReducedMotion()) return;
      tween = gsap.fromTo(
        rows,
        { autoAlpha: 0, x: -14 },
        {
          autoAlpha: 1,
          x: 0,
          duration: 0.6,
          stagger: 0.03,
          ease: ease.out,
          clearProps: "transform",
        },
      );
    };

    const onClick = (e: Event) => show((e.currentTarget as HTMLElement).dataset.ixKind || "all");
    buttons.forEach((b) => b.addEventListener("click", onClick));
    return () => {
      tween?.kill();
      buttons.forEach((b) => b.removeEventListener("click", onClick));
    };
  });
}
