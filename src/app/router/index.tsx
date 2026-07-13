import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./route-tree";
import { writeLastRoute } from "../../lib/preferences";

export const router = createRouter({ routeTree });

// Remember the last top-level module route so `landingView: "last"` (Settings →
// Preferences, DF-19f) can restore it on the next launch. writeLastRoute ignores
// non-landable routes (settings, onboarding, hidden modules).
router.subscribe("onResolved", () => {
  writeLastRoute(router.state.location.pathname);
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
