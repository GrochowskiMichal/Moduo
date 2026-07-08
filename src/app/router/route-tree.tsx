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
import { SettingsPage } from "../../routes/pages/settings-page";
import { PaywallPage } from "../../routes/pages/paywall-page";
import { PublishedNotePage } from "../../routes/pages/published-note-page";

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

// Public, unauthenticated reader for a published note (NO-9b). Direct child of
// the root route — a sibling of /auth, OUTSIDE the app gate, so an anonymous
// visitor can read it. `?note=<id>` selects a child page within the subtree.
const publishedNoteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$token",
  component: PublishedNotePage,
  validateSearch: (search: Record<string, unknown>): { note?: string } => {
    const note = typeof search.note === "string" && search.note ? search.note : undefined;
    return note ? { note } : {};
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
});

// The Wave 2 calendar (specs/calendar.md AC1) — the rebuild of the legacy
// exploratory calendar, sanctioned as a top-level route in the plan round.
const calendarRoute = createRoute({
  getParentRoute: () => appGateRoute,
  path: "/calendar",
  component: CalendarPage,
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
