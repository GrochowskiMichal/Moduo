import { useMemo } from "react";
import type { Decorator, Preview } from "@storybook/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import "../src/global.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";

import { AuthContext, type AuthContextValue } from "../src/providers/auth-provider";
import { WorkspaceContext, type WorkspaceContextValue } from "../src/providers/workspace-provider";

const mockAuth: AuthContextValue = {
  userId: "storybook-user",
  userEmail: "storybook@local",
  accessToken: null,
  isSignedIn: true,
  loading: false,
  configError: null,
  runtime: null,
  signOut: async () => {},
};

const mockWorkspace: WorkspaceContextValue = {
  loading: false,
  workspaces: [{ id: "w1", name: "Storybook Workspace", role: "owner", permissions: { notes: "edit", tasks: "edit" }, isDeleted: false, createdAt: "", updatedAt: "" }],
  selectedWorkspaceId: "w1",
  selectedWorkspace: { id: "w1", name: "Storybook Workspace", role: "owner", permissions: { notes: "edit", tasks: "edit" }, isDeleted: false, createdAt: "", updatedAt: "" },
  modulePermissions: { notes: "edit", tasks: "edit" },
  canManageWorkspace: true,
  members: [],
  invites: [],
  notificationsScope: "workspace",
  notificationsLoading: false,
  notifications: [],
  unreadCountWorkspace: 0,
  unreadCountGlobal: 0,
  setNotificationsScope: () => {},
  selectWorkspace: () => {},
  refreshWorkspaces: async () => {},
  refreshAccessData: async () => {},
  createWorkspace: async () => null,
  renameWorkspace: async () => {},
  leaveWorkspace: async () => {},
  softDeleteWorkspace: async () => {},
  sendInvite: async () => {},
  updateMemberPermissions: async () => {},
  updateInvite: async () => {},
  revokeInvite: async () => {},
  refreshNotifications: async () => {},
  markNotificationRead: async () => {},
  markAllNotificationsRead: async () => {},
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
        <RouterShell />
      </WorkspaceContext.Provider>
    </AuthContext.Provider>
  );
};

const preview: Preview = {
  decorators: [withAppProviders],
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
