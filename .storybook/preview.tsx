import type { Decorator, Preview } from "@storybook/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import "../src/global.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";

import { TooltipProvider } from "../src/components/ui/tooltip";
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from "../src/features/workspaces/workspace-context";
import { AuthContext, type AuthContextValue } from "../src/providers/auth-provider";

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
  workspaces: [
    {
      id: "w1",
      name: "Storybook Workspace",
      icon: null,
      logoUrl: null,
      role: "owner",
      permissions: { notes: "edit", tasks: "edit" },
      isDeleted: false,
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
    permissions: { notes: "edit", tasks: "edit" },
    isDeleted: false,
    createdAt: "",
    updatedAt: "",
  },
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
  updateWorkspaceBranding: async () => {},
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
        <TooltipProvider>
          <RouterShell />
        </TooltipProvider>
      </WorkspaceContext.Provider>
    </AuthContext.Provider>
  );
};

// Mirrors the app's Appearance settings (src/lib/appearance.ts) so density and
// text-size can be spot-checked per story from the toolbar.
function AppearanceSync({
  density,
  textSize,
  shade,
  children,
}: {
  density: string;
  textSize: string;
  shade: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-density", density);
    root.setAttribute("data-text-size", textSize);
    root.setAttribute("data-shade", shade);
  }, [density, textSize, shade]);
  return <>{children}</>;
}

const withAppearance: Decorator = (Story, context) => (
  <AppearanceSync
    density={(context.globals.density as string) ?? "comfortable"}
    textSize={(context.globals.textSize as string) ?? "normal"}
    shade={(context.globals.shade as string) ?? "black"}
  >
    <Story />
  </AppearanceSync>
);

const preview: Preview = {
  decorators: [withAppearance, withAppProviders],
  globalTypes: {
    density: {
      description: "Appearance → density",
      toolbar: {
        title: "Density",
        icon: "ruler",
        items: ["comfortable", "compact", "dense"],
        dynamicTitle: true,
      },
    },
    textSize: {
      description: "Appearance → body text size",
      toolbar: {
        title: "Text size",
        icon: "paragraph",
        items: ["small", "normal", "large"],
        dynamicTitle: true,
      },
    },
    shade: {
      description: "Appearance → dark-surface shade",
      toolbar: {
        title: "Shade",
        icon: "paintbrush",
        items: ["black", "warm", "cool", "slate", "plum", "forest"],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    density: "comfortable",
    textSize: "normal",
    shade: "black",
  },
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
