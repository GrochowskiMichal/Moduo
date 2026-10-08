import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { hiddenReachableRoutes } from "./app-chrome-constants";

/**
 * Bounce genuinely-unknown or removed routes to the first nav tab, but exempt
 * /settings and any hidden-but-reachable route (e.g. /mindmap, hidden from the nav
 * in DF-4 yet kept reachable for its rethink). Without that exemption a direct
 * visit to a hidden route gets silently redirected to Home.
 *
 * Waits while a navigation is loading: the router already reports the destination
 * then, though the chrome is still mounted, so a route outside the chrome (/auth,
 * /book, /p/…) would look unknown and be bounced. That hijacked the Danger zone's
 * move to /auth?deleted=1 (PRIV-2b).
 */
export function useUnknownRouteRedirect(navHrefs: readonly string[]) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const pending = useRouterState({ select: (state) => state.status === "pending" });

  useEffect(() => {
    if (pending) return;
    if (pathname.startsWith("/settings")) return;
    if (hiddenReachableRoutes.includes(pathname)) return;
    if (navHrefs.includes(pathname)) return;
    void navigate({ to: navHrefs[0] ?? "/", replace: true });
  }, [navigate, navHrefs, pathname, pending]);
}
