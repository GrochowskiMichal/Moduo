import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import { router } from "./router";
import { RootErrorBoundary } from "./components/app/root-error-boundary";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { applyAppearance, readLocalAppearance } from "./lib/appearance";
import "./global.css";

// Pre-paint: synchronously apply the cached appearance to <html> before React
// mounts. Prevents a flash of default theme on launch. This localStorage mirror
// is the source of truth (appearance is localStorage-only; redb is paused).
applyAppearance(readLocalAppearance());

window.addEventListener("error", (event) => {
  console.error("Global error event:", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
    <Toaster />
  </RootErrorBoundary>
);
