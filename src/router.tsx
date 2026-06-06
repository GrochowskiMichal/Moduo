import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { AuthProvider } from "./providers/auth-provider";
import { AppGate } from "./routes/layouts/app-gate";
import { AuthPage } from "./routes/pages/auth-page";
import { OnboardingPage } from "./routes/pages/onboarding-page";
import { GridPage } from "./routes/pages/grid-page";
import { NotesPage } from "./routes/pages/notes-page";
import { MindmapPage } from "./routes/pages/mindmap-page";
import { TemplatesPage } from "./routes/pages/templates-page";
import { EmailPage } from "./routes/pages/email-page";
import { CrmPage } from "./routes/pages/crm-page";
import { FormsPage } from "./routes/pages/forms-page";
import { ActivityPage } from "./routes/pages/activity-page";
import { FeedPage } from "./routes/pages/feed-page";
import { FilesPage } from "./routes/pages/files-page";
import { BrainstormPage } from "./routes/pages/brainstorm-page";
import { ExpansesPage } from "./routes/pages/expanses-page";
import { RevenuePage } from "./routes/pages/revenue-page";
import { KpiOkrPage } from "./routes/pages/kpi-okr-page";
import { StatsPage } from "./routes/pages/stats-page";
import { AnalyticsPage } from "./routes/pages/analytics-page";
import { RecordingsPage } from "./routes/pages/recordings-page";
import { TimetrackingPage } from "./routes/pages/timetracking-page";
import { RoadmapPage } from "./routes/pages/roadmap-page";
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

const templatesRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/templates",
  component: TemplatesPage,
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

const formsRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/forms",
  component: FormsPage,
});

const activityRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/activity",
  component: ActivityPage,
});

const feedRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/feed",
  component: FeedPage,
});

const filesRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/files",
  component: FilesPage,
});

const brainstormRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/brainstorm",
  component: BrainstormPage,
});

const expansesRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/expanses",
  component: ExpansesPage,
});

const revenueRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/revenue",
  component: RevenuePage,
});

const kpiOkrRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/kpi-okr",
  component: KpiOkrPage,
});

const statsRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/stats",
  component: StatsPage,
});

const analyticsRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/analytics",
  component: AnalyticsPage,
});

const recordingsRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/recordings",
  component: RecordingsPage,
});

const timetrackingRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/timetracking",
  component: TimetrackingPage,
});

const roadmapRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/roadmap",
  component: RoadmapPage,
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
    templatesRoute,
    emailRoute,
    crmRoute,
    formsRoute,
    activityRoute,
    feedRoute,
    filesRoute,
    brainstormRoute,
    expansesRoute,
    revenueRoute,
    kpiOkrRoute,
    statsRoute,
    analyticsRoute,
    recordingsRoute,
    timetrackingRoute,
    roadmapRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
