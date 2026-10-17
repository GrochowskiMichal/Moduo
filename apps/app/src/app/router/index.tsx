import { createRouter } from "@tanstack/react-router";
import { reloadOnceForChunkError } from "../../lib/chunk-reload";
import { writeLastRoute } from "../../lib/preferences";
import { routeTree } from "./route-tree";

export const router = createRouter({
  routeTree,
  // A lazy route whose chunk is gone after a deploy reloads once (lib/chunk-reload.ts).
  defaultOnCatch: (error) => {
    reloadOnceForChunkError(error);
  },
});

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
