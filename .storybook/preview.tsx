import type { Decorator, Preview } from "@storybook/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { useLayoutEffect, useMemo } from "react";

import "../src/global.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";

import { TooltipProvider } from "../src/components/ui/tooltip";
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from "../src/features/workspaces/workspace-context";
import {
  APPEARANCE_OPTIONS,
  type Appearance,
  DEFAULT_APPEARANCE,
  parseAppearance,
} from "../src/lib/appearance";
import { AuthContext, type AuthContextValue } from "../src/providers/auth-provider";

const mockAuth: AuthContextValue = {
  userId: "storybook-user",
  userEmail: "storybook@local",
  accessToken: null,
  isSignedIn: true,
  loading: false,
  configError: null,
  runtime: null,
  planTier: "pro",
  refreshPlanTier: async () => {},
  signOut: async () => {},
};

const mockWorkspace: WorkspaceContextValue = {
  loading: false,
  workspaces: [
    {
      id: "w1",
      name: "Storybook Workspace",
      icon: null,
      logoUrl: null,
      role: "owner",
      permissions: {
        notes: "edit",
        tasks: "edit",
        calendar: "edit",
        contacts: "edit",
        chat: "edit",
      },
      isDeleted: false,
      perms: [],
      roleId: null,
      createdAt: "",
      updatedAt: "",
    },
  ],
  selectedWorkspaceId: "w1",
  selectedWorkspace: {
    id: "w1",
    name: "Storybook Workspace",
    icon: null,
    logoUrl: null,
    role: "owner",
    permissions: { notes: "edit", tasks: "edit", calendar: "edit", contacts: "edit", chat: "edit" },
    isDeleted: false,
    perms: [],
    roleId: null,
    createdAt: "",
    updatedAt: "",
  },
  modulePermissions: {
    notes: "edit",
    tasks: "edit",
    calendar: "edit",
    contacts: "edit",
    chat: "edit",
  },
  canManageWorkspace: true,
  myPerms: [],
  can: () => true,
  roles: [],
  upsertRole: async () => null,
  deleteRole: async () => {},
  setMemberAccess: async () => {},
  members: [],
  invites: [],
  notificationsLoading: false,
  notifications: [],
  // The bell groups these on render: a missing feed crashed every story that
  // mounts the app chrome ("items is not iterable", visual audit B15; DS-6).
  // The mock is typed, and .storybook is in tsconfig, so the next field the
  // context gains fails `bun run typecheck` instead of a story.
  notificationHistory: [],
  workspaceInvitations: [],
  unreadCountWorkspace: 0,
  selectWorkspace: () => {},
  refreshWorkspaces: async () => [],
  refreshAccessData: async () => {},
  createWorkspace: async () => null,
  renameWorkspace: async () => {},
  updateWorkspaceBranding: async () => {},
  leaveWorkspace: async () => {},
  softDeleteWorkspace: async () => {},
  sendInvite: async () => null,
  joinWorkspace: async () => null,
  updateMemberPermissions: async () => {},
  removeMember: async () => {},
  transferOwnership: async () => {},
  updateInvite: async () => {},
  revokeInvite: async () => {},
  refreshNotifications: async () => {},
  markNotificationRead: async () => {},
  markAllNotificationsRead: async () => {},
  dismissNotifications: async () => {},
  undismissNotifications: async () => {},
};

const withAppProviders: Decorator = (Story, context) => {
  function StoryRoute() {
    return <Story />;
  }

  function RouterShell() {
    const router = useMemo(() => {
      const Root = () => <Outlet />;
      const rootRoute = createRootRoute({ component: Root });
      const indexRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/",
        component: StoryRoute,
      });
      const routeTree = rootRoute.addChildren([indexRoute]);
      return createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: ["/"] }),
        context: { storyId: context.id },
      });
    }, [context.id]);

    return <RouterProvider router={router} />;
  }

  return (
    <AuthContext.Provider value={mockAuth}>
      <WorkspaceContext.Provider value={mockWorkspace}>
        <TooltipProvider>
          <RouterShell />
        </TooltipProvider>
      </WorkspaceContext.Provider>
    </AuthContext.Provider>
  );
};

// Mirrors Settings → Appearance (src/lib/appearance.ts). Every axis a person
// can change in the app is a toolbar menu, built from the app's own option
// lists, so a story can be checked under any theme × shade × accent × density
// × radius × font. (Text size was retired in 2026-06; density is the size axis.)
const APPEARANCE_AXES = [
  { key: "theme", title: "Theme", icon: "contrast" },
  { key: "shade", title: "Shade", icon: "paintbrush" },
  { key: "accent", title: "Accent", icon: "circle" },
  { key: "density", title: "Density", icon: "ruler" },
  { key: "radius", title: "Radius", icon: "circlehollow" },
  { key: "font", title: "Font", icon: "paragraph" },
] as const satisfies ReadonlyArray<{ key: keyof Appearance; title: string; icon: string }>;

// One axis → its <html> attribute. A layout effect runs before paint and before
// a story's own effects, so a story may still pin an axis itself (the widgets
// gallery pins density); only a change to THAT global takes it over again.
function useAppearanceAttribute(key: (typeof APPEARANCE_AXES)[number]["key"], value: string) {
  useLayoutEffect(() => {
    document.documentElement.setAttribute(`data-${key}`, value);
  }, [key, value]);
}

// The decorator is keyed by story, so every story mounts it afresh and all six
// attributes are re-applied: a previous story's leftovers never leak into the
// next. Other attributes (data-tabs, data-motion) are left to the stories.
function AppearanceSync({
  appearance,
  children,
}: {
  appearance: Appearance;
  children: React.ReactNode;
}) {
  useAppearanceAttribute("theme", appearance.theme);
  useAppearanceAttribute("shade", appearance.shade);
  useAppearanceAttribute("accent", appearance.accent);
  useAppearanceAttribute("density", appearance.density);
  useAppearanceAttribute("radius", appearance.radius);
  useAppearanceAttribute("font", appearance.font);
  return <>{children}</>;
}

const withAppearance: Decorator = (Story, context) => (
  <AppearanceSync key={context.id} appearance={parseAppearance(context.globals)}>
    <Story />
  </AppearanceSync>
);

const preview: Preview = {
  decorators: [withAppearance, withAppProviders],
  globalTypes: Object.fromEntries(
    APPEARANCE_AXES.map(({ key, title, icon }) => [
      key,
      {
        description: `Appearance → ${title.toLowerCase()}`,
        toolbar: { title, icon, items: [...APPEARANCE_OPTIONS[key]], dynamicTitle: true },
      },
    ]),
  ),
  initialGlobals: Object.fromEntries(
    APPEARANCE_AXES.map(({ key }) => [key, DEFAULT_APPEARANCE[key]]),
  ),
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
