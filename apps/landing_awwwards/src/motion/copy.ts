// Copy buttons (components/page/Code.astro, and any [data-copy] with a [data-copy-source] or a
// data-copy-text of its own): one click puts the text on the clipboard and the button says so for
// a moment, out loud for screen readers too. Delegated, so it covers every page without setup.
import { onPage } from "../engine";

export function startCopy() {
  onPage(() => {
    const timers = new Map<HTMLElement, number>();
    const onClick = async (e: MouseEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-copy]");
      if (!btn) return;
      const text =
        btn.dataset.copyText ??
        btn.closest("figure, [data-copy-scope]")?.querySelector<HTMLElement>("[data-copy-source]")
          ?.innerText ??
        "";
      if (!text) return;
      const label = btn.querySelector<HTMLElement>("[data-copy-label]");
      const status = btn.querySelector<HTMLElement>("[data-copy-status]");
      const rest = btn.dataset.copyRest ?? label?.textContent ?? "Copy";
      btn.dataset.copyRest = rest;
      let ok = true;
      try {
        await navigator.clipboard.writeText(text.trim());
      } catch {
        ok = false;
      }
      if (label) label.textContent = ok ? "Copied" : "Select and copy";
      if (status) status.textContent = ok ? "Copied to the clipboard" : "";
      btn.classList.toggle("is-copied", ok);
      window.clearTimeout(timers.get(btn));
      timers.set(
        btn,
        window.setTimeout(() => {
          if (label) label.textContent = rest;
          if (status) status.textContent = "";
          btn.classList.remove("is-copied");
        }, 1800),
      );
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      timers.forEach((t) => window.clearTimeout(t));
    };
  });
}
