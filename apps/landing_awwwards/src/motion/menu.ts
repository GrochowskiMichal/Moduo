// The full-screen menu for phones and narrow windows: focus stays inside, Escape closes and
// focus returns to the button; it closes when a navigation starts.
import { gsap } from "gsap";

import { ease, onPage, prefersReducedMotion, startScroll, stopScroll } from "../engine";

let closeMenu: (() => void) | null = null;

/** Closes the menu without taking focus back to its button (the waitlist bar takes it). */
export function closeMenuNow() {
  closeMenu?.();
}

export function startMenu() {
  document.addEventListener("astro:before-preparation", () => closeMenu?.());

  onPage(() => {
    const btn = document.querySelector<HTMLButtonElement>("[data-menu-open]");
    const menu = document.querySelector<HTMLElement>("[data-menu]");
    if (!btn || !menu) return;
    const root = document.documentElement;
    const focusables = () => [...menu.querySelectorAll<HTMLElement>("a[href], button")];

    const open = () => {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      root.classList.add("menu-open");
      root.classList.remove("hdr-away");
      stopScroll();
      if (!prefersReducedMotion()) {
        gsap.fromTo(
          menu.querySelectorAll(".menu__item"),
          { autoAlpha: 0, x: -18 },
          { autoAlpha: 1, x: 0, duration: 0.6, stagger: 0.04, ease: ease.out },
        );
      }
      focusables()[0]?.focus();
      document.addEventListener("keydown", onKey);
    };
    const close = (restore = true) => {
      if (menu.hidden) return;
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      root.classList.remove("menu-open");
      startScroll();
      document.removeEventListener("keydown", onKey);
      if (restore) btn.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      if (e.key !== "Tab") return;
      const list = [btn, ...focusables()];
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? i <= 0
          ? list.length - 1
          : i - 1
        : i >= list.length - 1
          ? 0
          : i + 1;
      e.preventDefault();
      list[next].focus();
    };
    const toggle = () => (menu.hidden ? open() : close());
    btn.addEventListener("click", toggle);
    closeMenu = () => close(false);
    return () => {
      btn.removeEventListener("click", toggle);
      document.removeEventListener("keydown", onKey);
      root.classList.remove("menu-open");
      closeMenu = null;
    };
  });
}
