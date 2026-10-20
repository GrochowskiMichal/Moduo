import "./lib/auth-url-boot";
import { RouterProvider } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { RootErrorBoundary } from "./components/app/root-error-boundary";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { APP_BUILD, IS_DESKTOP } from "./features/settings/about";
import { applyAppearance, readLocalAppearance } from "./lib/appearance";
import { installChunkReload } from "./lib/chunk-reload";
import { useConfirmBeforeQuit } from "./lib/confirm-before-quit";
import { useKeepInMenuBar } from "./lib/keep-in-menu-bar";
import { startNewVersionCheck } from "./lib/new-version-check";
import { applyMotion, readLocalPreferences, usePreferences } from "./lib/preferences";
import { router } from "./router";
import "./global.css";

// Pre-paint: synchronously apply the cached appearance + motion override to <html>
// before React mounts. Prevents a flash of default theme / full motion on launch.
// The cloud-synced values are reconciled later inside useAppearance/usePreferences.
applyAppearance(readLocalAppearance());
applyMotion(readLocalPreferences().motion);

// A chunk the host no longer serves (a tab older than the last 3 deploys) reloads once.
installChunkReload();

// Web only (REL-4): a tab left open across a release offers "Moduo was updated ·
// Reload", and never reloads by itself.
if (!IS_DESKTOP && APP_BUILD !== "dev") startNewVersionCheck({ bundledBuild: APP_BUILD });

window.addEventListener("error", (event) => {
  console.error("Global error event:", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
});

// Mount the preferences domain app-wide so it reconciles with the cloud on every
// launch / sign-in (mirrors how appearance rides the always-mounted Toaster). The
// hook no-ops until signed in, and the boot landing/motion still first-paint from
// the localStorage mirror — this keeps the mirror in sync for the next launch.
function PreferencesSync() {
  usePreferences({ syncOwner: true });
  return null;
}

// Desktop-only: mirror the confirm-before-quit pref into Rust so the native quit
// handlers (⌘Q menu item + window CloseRequested) can read it. No-op on web. DF-19f-quit.
function ConfirmBeforeQuit() {
  useConfirmBeforeQuit();
  // TV-D12: and whether closing the window keeps Moduo in the menu bar.
  useKeepInMenuBar();
  return null;
}

// The TanStack Devtools panel, in development builds only: production never
// reaches the import, so the bundler drops it (scripts/check-bundle-size.ts guards the size).
// Not under automation (Playwright sets navigator.webdriver; its trigger used to
// sit over toast buttons), and off with MODUO_DEVTOOLS=0.
const TanStackDevtoolsPanel =
  process.env.NODE_ENV === "development" &&
  import.meta.env.MODUO_DEVTOOLS !== "0" &&
  !(typeof navigator !== "undefined" && navigator.webdriver)
    ? lazy(() => import("./lib/devtools/tanstack-devtools"))
    : null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
    <Toaster />
    <PreferencesSync />
    <ConfirmBeforeQuit />
    {TanStackDevtoolsPanel ? (
      <Suspense fallback={null}>
        <TanStackDevtoolsPanel />
      </Suspense>
    ) : null}
  </RootErrorBoundary>,
);
