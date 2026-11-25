// /download: one window, three frames (components/download/OsWindow.astro). The picker starts on
// the visitor's own system. Switching sends the site's band across the window: a Paper
// parallelogram with the stroke's 45° edges, blended with `difference` so it inverts what it
// passes, and the new frame is drawn in behind its trailing edge. The Inbox widget changes as the
// band crosses it. Only transforms and clip-paths move. Reduced motion switches in place.
import { gsap } from "gsap";

import { ease, onPage, prefersReducedMotion } from "../../engine";

type Os = "mac" | "windows" | "web";

/** The visitor's own system: a Mac or Windows, or the browser for everything else. */
function detect(): Os {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = (nav.userAgentData?.platform || navigator.platform || "").toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|android/.test(ua) || navigator.maxTouchPoints > 1) return "web";
  if (platform.includes("mac")) return "mac";
  if (platform.includes("win")) return "windows";
  return "web";
}

export function startDownload() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>('[data-pg="download"]');
    const dw = root?.querySelector<HTMLElement>("[data-dw]");
    if (!dw) return;
    const win = dw.querySelector<HTMLElement>("[data-dw-win]")!;
    const band = dw.querySelector<HTMLElement>("[data-dw-band]")!;
    const cap = dw.querySelector<HTMLElement>("[data-dw-cap]")!;
    const captions = JSON.parse(
      dw.querySelector("[data-dw-captions]")?.textContent || "{}",
    ) as Record<Os, string>;
    const buttons = [...dw.querySelectorAll<HTMLButtonElement>("[data-dw-os]")];
    const bar = (os: Os) => dw.querySelector<HTMLElement>(`[data-bar="${os}"]`)!;
    let current = (dw.dataset.os as Os) || "mac";
    let tl: gsap.core.Timeline | null = null;

    const settle = (os: Os) => {
      tl?.kill();
      tl = null;
      dw.querySelectorAll<HTMLElement>(".dw__bar").forEach((b) => {
        b.classList.remove("is-to");
        b.style.clipPath = "";
      });
      gsap.set(band, { visibility: "hidden", clipPath: "polygon(0 0, 0 0, 0 0, 0 0)" });
      dw.dataset.os = os;
      dw.dataset.inbox = os === "web" ? "web" : "mac";
    };

    const show = (os: Os, animate: boolean) => {
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.dwOs === os)));
      if (os === current) return;
      const from = current;
      current = os;
      cap.textContent = captions[os] ?? "";
      if (!animate || prefersReducedMotion()) {
        settle(os);
        return;
      }
      settle(from);
      const W = win.clientWidth;
      const H = win.clientHeight;
      const T = Math.max(W * 0.07, 28);
      const next = bar(os);
      const h = next.offsetHeight;
      // Where the band crosses the Inbox widget, the widget changes under it.
      const inbox = win.querySelector<HTMLElement>(".hf-inbox");
      const box = win.getBoundingClientRect();
      const ib = inbox && inbox.offsetParent ? inbox.getBoundingClientRect() : null;
      const inboxAt = ib
        ? { x: ib.left - box.left + ib.width / 2, y: ib.top - box.top + ib.height / 2 }
        : null;
      const wantInbox = os === "web" ? "web" : "mac";
      next.classList.add("is-to");
      gsap.set(band, { visibility: "visible" });
      const p = { x: -(H + T) };
      const draw = () => {
        const x = p.x;
        band.style.clipPath = `polygon(${x}px ${H}px, ${x + H}px 0px, ${x + H + T}px 0px, ${x + T}px ${H}px)`;
        // The trailing edge runs from (x, H) up to (x + H, 0): at height y it is at x + H - y.
        next.style.clipPath = `polygon(0 0, ${x + H}px 0, ${x + H - h}px ${h}px, 0 ${h}px)`;
        if (inboxAt && dw.dataset.inbox !== wantInbox && x + H - inboxAt.y >= inboxAt.x)
          dw.dataset.inbox = wantInbox;
      };
      draw();
      tl = gsap.timeline({ onComplete: () => settle(os) });
      tl.to(p, { x: W, duration: 1.15, ease: ease.inOut, onUpdate: draw });
    };

    const onClick = (e: Event) => {
      const os = (e.currentTarget as HTMLElement).dataset.dwOs as Os;
      show(os, true);
    };
    buttons.forEach((b) => b.addEventListener("click", onClick));
    const mine = detect();
    root!.dataset.mine = mine;
    show(mine, false);

    return () => {
      tl?.kill();
      buttons.forEach((b) => b.removeEventListener("click", onClick));
    };
  });
}
