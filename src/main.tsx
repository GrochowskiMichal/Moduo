import "./lib/auth-url-boot";
import { RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import { RootErrorBoundary } from "./components/app/root-error-boundary";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { applyAppearance, readLocalAppearance } from "./lib/appearance";
import { useConfirmBeforeQuit } from "./lib/confirm-before-quit";
import { applyMotion, readLocalPreferences, usePreferences } from "./lib/preferences";
import { router } from "./router";
import "./global.css";

// Pre-paint: synchronously apply the cached appearance + motion override to <html>
// before React mounts. Prevents a flash of default theme / full motion on launch.
// The cloud-synced values are reconciled later inside useAppearance/usePreferences.
applyAppearance(readLocalAppearance());
applyMotion(readLocalPreferences().motion);

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
  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
    <Toaster />
    <PreferencesSync />
    <ConfirmBeforeQuit />
  </RootErrorBoundary>,
);
