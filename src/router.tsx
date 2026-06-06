import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { AuthProvider } from "./providers/auth-provider";
import { AppGate } from "./routes/layouts/app-gate";
import { AuthPage } from "./routes/pages/auth-page";
import { OnboardingPage } from "./routes/pages/onboarding-page";
import { GridPage } from "./routes/pages/grid-page";
import { NotesPage } from "./routes/pages/notes-page";
import { MindmapPage } from "./routes/pages/mindmap-page";
import { EmailPage } from "./routes/pages/email-page";
import { CrmPage } from "./routes/pages/crm-page";
import { SettingsPage } from "./routes/pages/settings-page";
import { PaywallPage } from "./routes/pages/paywall-page";

function RootLayout() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
  component: AuthPage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: OnboardingPage,
});

const paywallRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/paywall",
  component: PaywallPage,
});

const appGateRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app-gate",
  component: AppGate,
});

const homeRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/",
  component: GridPage,
});

const legacyGridRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/product-demo",
  beforeLoad: () => { throw redirect({ to: "/", replace: true }); },
  component: () => null,
});

const notesRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/notes",
  component: NotesPage,
});

const mindmapRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/mindmap",
  component: MindmapPage,
});

const emailRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/email",
  component: EmailPage,
});

const crmRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/crm",
  component: CrmPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  authRoute,
  onboardingRoute,
  paywallRoute,
  appGateRoute.addChildren([
    homeRoute,
    legacyGridRoute,
    notesRoute,
    mindmapRoute,
    emailRoute,
    crmRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
