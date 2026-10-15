// The sum of your open Catch up items on the app itself (CV-6b, §11 "Count"):
// the dock or taskbar badge on the desktop (Tauri's badge count: macOS and
// Linux), the tab title ("(3) Moduo") and a dot on the favicon on the web.

import { isTauriRuntime } from "../runtime";

const TITLE_COUNT = /^\(\d+\+?\) /;

/** "(3) Moduo"; a count over 99 reads "99+"; zero takes the prefix off. */
export function titleWithCount(title: string, count: number): string {
  const base = title.replace(TITLE_COUNT, "");
  if (count <= 0) return base;
  return `(${count > 99 ? "99+" : count}) ${base}`;
}

let shownCount = -1;
let iconHref: { link: HTMLLinkElement; href: string } | null = null;

/** The badge colour of the app's tab dots (`bg-primary`), as the browser resolved it. */
function dotColour(): string | null {
  const probe = document.createElement("span");
  probe.className = "bg-primary";
  probe.hidden = true;
  document.body.appendChild(probe);
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return colour && colour !== "rgba(0, 0, 0, 0)" ? colour : null;
}

function pngIcon(): HTMLLinkElement | null {
  return (
    document.querySelector<HTMLLinkElement>('link[rel~="icon"][type="image/png"]') ??
    document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  );
}

function setFaviconDot(on: boolean): void {
  const link = pngIcon();
  if (!link) return;
  if (!iconHref) iconHref = { link, href: link.href };
  if (!on) {
    iconHref.link.href = iconHref.href;
    return;
  }
  const colour = dotColour();
  if (!colour) return;
  const image = new Image();
  image.onload = () => {
    if (shownCount <= 0) return;
    try {
      const size = 32;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, size, size);
      ctx.beginPath();
      ctx.arc(size - 8, 8, 7, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      if (iconHref) iconHref.link.href = canvas.toDataURL("image/png");
    } catch {
      // A tainted or missing icon: the title still carries the count.
    }
  };
  image.src = iconHref.href;
}

async function setDockBadge(count: number): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined);
  } catch {
    // Windows has no badge count (an overlay icon instead); never an error.
  }
}

/** Show the sum on the app (idempotent: the same count changes nothing). */
export function showAppBadge(count: number): void {
  if (typeof document === "undefined" || count === shownCount) return;
  const before = shownCount;
  shownCount = count;
  if (isTauriRuntime()) {
    void setDockBadge(count);
    return;
  }
  document.title = titleWithCount(document.title, count);
  if (before <= 0 || count <= 0) setFaviconDot(count > 0);
}
