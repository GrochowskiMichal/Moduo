import { createRootRoute, createRoute, Outlet, redirect } from "@tanstack/react-router";
import { AuthProvider } from "../../providers/auth-provider";
import { AppGate } from "../../routes/layouts/app-gate";
import { AuthPage } from "../../routes/pages/auth-page";
import { OnboardingPage } from "../../routes/pages/onboarding-page";
import { HomePage } from "../../routes/pages/home-page";
import { NotesPage } from "../../routes/pages/notes-page";
import { TasksPage } from "../../routes/pages/tasks-page";
import { CalendarPage } from "../../routes/pages/calendar-page";
import { MindmapPage } from "../../routes/pages/mindmap-page";
import { EmailPage } from "../../routes/pages/email-page";
import { ContactsPage } from "../../routes/pages/contacts-page";
import { validateContactsSearch } from "../../features/contacts/search";
import { validateNotesSearch } from "../../features/notes/search";
import { validateTasksSearch } from "../../features/tasks/search";
import { validateCalendarSearch } from "../../features/calendar/search";
import { validateEmailSearch } from "../../features/email/url-search";
import { SettingsPage } from "../../routes/pages/settings-page";
import { PaywallPage } from "../../routes/pages/paywall-page";
import { PublishedNotePage } from "../../routes/pages/published-note-page";
import { JoinPage } from "../../routes/pages/join-page";
import { consumeLandingRedirect } from "../../lib/preferences";

function RootLayout() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

/**
 * Wrap a route that renders OUTSIDE the app gate (auth, onboarding, paywall,
 * join, the public note reader) so it stays monochrome.
 *
 * The accent is a personal, in-workspace choice: a returning user whose accent
 * is a hue must not see that hue on sign-in / setup / a public page. Scoping the
 * attribute here rather than on each page root means a page's individual return
 * branches (loading vs loaded vs error) can't drift apart — which is exactly how
 * these surfaces got inconsistent before. `display: contents` adds no box, so
 * layout is untouched while custom properties still inherit through it.
 */
function preWorkspace(Component: () => React.ReactNode) {
  return function PreWorkspaceRoute() {
    return (
      <div data-accent="mono" className="contents">
        <Component />
      </div>
    );
  };
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
  component: preWorkspace(AuthPage),
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: preWorkspace(OnboardingPage),
});

const paywallRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/paywall",
  component: preWorkspace(PaywallPage),
});

// Public, unauthenticated reader for a published note (NO-9b). Direct child of
// the root route — a sibling of /auth, OUTSIDE the app gate, so an anonymous
// visitor can read it. `?note=<id>` selects a child page within the subtree.
const publishedNoteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$token",
  component: preWorkspace(PublishedNotePage),
  validateSearch: (search: Record<string, unknown>): { note?: string } => {
    const note = typeof search.note === "string" && search.note ? search.note : undefined;
    return note ? { note } : {};
  },
});

// Workspace invite accept surface (DF-24). Sibling of /auth, OUTSIDE the app
// gate, so a brand-new invitee (0–1 workspaces) can redeem before the
// WorkspaceGate would bounce them to /onboarding and before AppChrome's nav
// redirect guard runs. Token rides in `?invite=` (base64 tokens break a path
// param). Not in the nav, so it needs none of the five in-chrome route wirings.
const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/join",
  component: preWorkspace(JoinPage),
  validateSearch: (search: Record<string, unknown>): { invite?: string } => {
    const invite = typeof search.invite === "string" && search.invite ? search.invite : undefined;
    return invite ? { invite } : {};
  },
});

const appGateRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app-gate",
  component: AppGate,
});

const homeRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/",
  // Default landing view (DF-19f): on the first authenticated launch at "/", the
  // landing preference may redirect to another module. One-shot — later in-app
  // navigations to Home never redirect. Explicit deep-links (a query string, or
  // any non-"/" path) still win; the guard lives in consumeLandingRedirect.
  beforeLoad: ({ location }) => {
    const target = consumeLandingRedirect(location.pathname, location.searchStr);
    if (target) throw redirect({ to: target, replace: true });
  },
  component: HomePage,
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
  validateSearch: validateNotesSearch,
});

const tasksRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/tasks",
  component: TasksPage,
  // URL-held task selection (?id=) — deep links + refresh keep it (DF-1).
  validateSearch: validateTasksSearch,
});

// The Wave 2 calendar (specs/calendar.md AC1) — the rebuild of the legacy
// exploratory calendar, sanctioned as a top-level route in the plan round.
const calendarRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/calendar",
  component: CalendarPage,
  // `?event=` deep link → navigate to the event's day + select + open detail (DF-2).
  validateSearch: validateCalendarSearch,
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
  // `?thread=` deep link → select + scroll the thread (desktop) / tissue card (web) (DF-2).
  validateSearch: validateEmailSearch,
});

const contactsRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/contacts",
  component: ContactsPage,
  // URL-held selection + palette action (fix pack FX-1 AC1/AC2).
  validateSearch: validateContactsSearch,
});

// /crm is the throwaway exploratory route; /contacts is its planned destination
// (specs/contacts.md AC10). Redirect stale deep-links so they don't 404.
const legacyCrmRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/crm",
  beforeLoad: () => { throw redirect({ to: "/contacts", replace: true }); },
  component: () => null,
});

const settingsRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/settings",
  component: SettingsPage,
});

export const routeTree = rootRoute.addChildren([
  authRoute,
  onboardingRoute,
  paywallRoute,
  publishedNoteRoute,
  joinRoute,
  appGateRoute.addChildren([
    homeRoute,
    legacyGridRoute,
    notesRoute,
    tasksRoute,
    calendarRoute,
    mindmapRoute,
    emailRoute,
    contactsRoute,
    legacyCrmRoute,
    settingsRoute,
  ]),
]);
