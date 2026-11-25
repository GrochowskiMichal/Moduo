// Live keycaps: pressing a shortcut anywhere on the page lights its cap in the keyboard section.
// Visual only: the browser keeps every key (nothing is prevented).
import { onPage } from "../engine";

const norm = (e: KeyboardEvent) => {
  const parts: string[] = [];
  if (e.shiftKey && e.key !== "?") parts.push("⇧");
  if (e.metaKey || e.ctrlKey) parts.push("⌘");
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(k);
  return parts.join(" ");
};

export function startKeys() {
  onPage(() => {
    const caps = [...document.querySelectorAll<HTMLElement>("[data-key]")];
    if (!caps.length) return;
    const timers = new Map<HTMLElement, number>();
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const combo = norm(e);
      for (const cap of caps) {
        if (cap.dataset.key !== combo) continue;
        cap.classList.add("is-down");
        clearTimeout(timers.get(cap));
        timers.set(
          cap,
          window.setTimeout(() => cap.classList.remove("is-down"), 520),
        );
      }
    };
    addEventListener("keydown", down);
    return () => {
      removeEventListener("keydown", down);
      timers.forEach((t) => clearTimeout(t));
    };
  });
}
