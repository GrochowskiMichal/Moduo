// Decorator/provider chain for the design-sync reference build + the
// converter's preview-decorator bundle. Adapted from the repo's
// .storybook/preview.tsx with two deliberate changes:
//   1. WorkspaceContext is imported from @/features/workspaces/workspace-context
//      (the real preview imports it from @/providers/workspace-provider, which
//      does NOT re-export it — vite dev tolerates the missing named export, a
//      strict rollup/esbuild bundle errors).
//   2. The TanStack RouterProvider wrapper is removed. None of the 39 synced
//      core components use @tanstack/react-router, and re-bundling the memory
//      router outside Storybook's runtime made it render every story as an
//      undefined element ("Element type is invalid … SafeFragment" — SafeFragment
//      is the router's internal shell). The story now mounts directly inside the
//      Auth/Workspace/Tooltip providers the components actually read. Reference
//      and preview share this file, so both stay consistent.
import { useEffect } from "react";
import type { Decorator, Preview } from "@storybook/react";

// NOTE: no CSS/font imports here. This preview is also bundled by the
// design-sync converter into _vendor/preview-decorators.js with an esbuild
// loader set that has no .woff2 loader, so a global.css import (which url()s
// brand fonts) breaks that bundle. Styling reaches previews via the DS
// stylesheet (cfg.cssEntry -> _ds_bundle.css). The reference Storybook build
// pulls in global.css through the sibling sb-ref/preview.tsx instead.
// Import the providers from the DS package entry, NOT from @/ source paths, so
// they share React-context identity with the components: the converter's dsShim
// rewrites "moduo2.0" -> window.ModuoDS (the same instances the bundled
// components read), and the reference build aliases "moduo2.0" -> the barrel.
// Types still come from source (erased at build, no runtime/identity impact).
import { AuthContext, WorkspaceContext, TooltipProvider } from "moduo2.0";
import type { AuthContextValue } from "@/providers/auth-provider";
import type { WorkspaceContextValue } from "@/features/workspaces/workspace-context";

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
  // Two workspaces: WorkspaceSwitcher returns null with <=1 workspace, so a
  // single-workspace mock renders nothing (the repo's own story has this gap).
  workspaces: [
    { id: "w1", name: "Storybook Workspace", role: "owner", permissions: { notes: "edit", tasks: "edit" }, isDeleted: false, createdAt: "", updatedAt: "" },
    { id: "w2", name: "Acme Team", role: "editor", permissions: { notes: "edit", tasks: "view" }, isDeleted: false, createdAt: "", updatedAt: "" },
  ],
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

const withAppProviders: Decorator = (Story) => (
  <AuthContext.Provider value={mockAuth}>
    <WorkspaceContext.Provider value={mockWorkspace}>
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    </WorkspaceContext.Provider>
  </AuthContext.Provider>
);

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
  // Return children directly rather than `<>{children}</>`: the converter's
  // decorator-bundle React shim leaves `Fragment` undefined, so a JSX fragment
  // renders as an invalid element type. Avoiding the fragment keeps this
  // decorator working in both the reference build and the preview bundle.
  return children as React.ReactElement;
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
