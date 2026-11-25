// Astro adapter (ClientRouter). Call start(setup) once from the layout's <script>.
// The curtain closes while the next page is fetched, so a transition adds no waiting.
// Back and forward skip the curtain and keep the restored scroll position.
import { boot, cleanup, enter, leave, syncFlags } from "./index";

let navigating = false;
let traverse = false;

export function start(setup?: () => void) {
  document.addEventListener("astro:before-preparation", (e) => {
    navigating = true;
    traverse = e.navigationType === "traverse";
    if (traverse) return;
    const load = e.loader;
    e.loader = async () => {
      await Promise.all([leave(), load()]);
    };
  });
  document.addEventListener("astro:before-swap", () => cleanup());
  // Astro replaces the <html> attributes on a swap; restore the engine flags before paint.
  document.addEventListener("astro:after-swap", () => syncFlags());
  document.addEventListener("astro:page-load", () => {
    if (!navigating) return void boot(setup);
    navigating = false;
    void enter(traverse ? { transition: false, scrollTop: false } : undefined);
  });
  // Module scripts run after parsing: boot now instead of waiting for the first page-load.
  boot(setup);
}
