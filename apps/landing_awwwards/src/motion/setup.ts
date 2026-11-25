// Global motion and behavior, registered once on the client before the first page runs.
// Every module checks for its own markup on each page (onPage), so order doesn't matter.
import { onPage } from "../engine";
import { startConsent } from "../lib/consent";
import { startWaitlist } from "../lib/waitlist";
import { startButtons } from "./buttons";
import { startCopy } from "./copy";
import { startDusk } from "./dusk";
import { startFirstLight } from "./first-light";
import { startFooter } from "./footer";
import { startHeader } from "./header";
import { startHero } from "./hero";
import { startInterlock } from "./interlock";
import { startKeys } from "./keys";
import { startMenu } from "./menu";
import { startNotFound } from "./notfound";
import { startRail } from "./rail";
import { startWidgets } from "./widgets";

/**
 * A page's own driver, fetched the first time a page carries its markup. Its start() registers
 * onPage, which runs at once for the page that is already up, so nothing waits for a reload.
 */
function lazy(selector: string, load: () => Promise<() => void>) {
  let started = false;
  onPage(() => {
    if (started || !document.querySelector(selector)) return;
    started = true;
    void load().then((start) => start());
  });
}

export function setupMotion() {
  startHeader();
  startHero();
  startMenu();
  startButtons();
  startWaitlist();
  startConsent();
  // Home is where most visits land, so its hero and its scene ship with the first script. Dusk
  // registers before the interlock: it places the mark's box the interlock measures.
  startDusk();
  startFirstLight();
  startInterlock();
  startKeys();
  startWidgets();
  startNotFound();
  startRail();
  startFooter();
  startCopy();
  lazy("[data-board]", () => import("./board").then((m) => m.startBoard));
  lazy("[data-cz]", () => import("./colophon").then((m) => m.startColophon));
  lazy("[data-about]", () => import("./about").then((m) => m.startAbout));
  lazy("[data-typeface]", () => import("./typeface").then((m) => m.startTypeface));
  lazy("[data-bento]", () => import("./bento").then((m) => m.startBento));
  lazy("[data-mods]", () => import("./modules").then((m) => m.startModules));
  // The inner pages' own drivers (motion/pages/*), each on the page that carries its marker.
  lazy('[data-pg="ai"]', () => import("./pages/ai").then((m) => m.startAi));
  lazy('[data-pg="security"]', () => import("./pages/security").then((m) => m.startSecurity));
  lazy('[data-pg="press"]', () => import("./pages/press").then((m) => m.startPress));
  lazy('[data-pg="download"]', () => import("./pages/download").then((m) => m.startDownload));
  lazy('[data-pg="integrations"]', () =>
    import("./pages/integrations").then((m) => m.startIntegrations),
  );
  lazy('[data-pg="import"]', () => import("./pages/import").then((m) => m.startImport));
  lazy('[data-pg="help"]', () => import("./pages/help").then((m) => m.startHelp));
  lazy('[data-pg="shortcuts"]', () => import("./pages/shortcuts").then((m) => m.startShortcuts));
  lazy('[data-pg="compare"]', () => import("./pages/compare").then((m) => m.startCompare));
  lazy('[data-pg="usecase"]', () => import("./pages/usecase").then((m) => m.startUsecase));
  lazy('[data-pg="login"]', () => import("./pages/login").then((m) => m.startLogin));
}
