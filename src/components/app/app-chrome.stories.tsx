import { useContext, useEffect, useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react";

import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from "../../features/workspaces/workspace-context";
import type { WorkspaceSummary } from "../../features/workspaces/types";
import { AppChrome } from "./app-chrome";

const baseWorkspace: WorkspaceSummary = {
  id: "w1",
  name: "Storybook Workspace",
  role: "owner",
  permissions: { notes: "edit", tasks: "edit" },
  isDeleted: false,
  createdAt: "",
  updatedAt: "",
};

const singleWorkspaceList: WorkspaceSummary[] = [baseWorkspace];
const multiWorkspaceList: WorkspaceSummary[] = [
  baseWorkspace,
  { ...baseWorkspace, id: "w2", name: "Acme Corp" },
  { ...baseWorkspace, id: "w3", name: "Personal" },
];

function WorkspaceFixture({
  workspaces,
  children,
}: {
  workspaces: WorkspaceSummary[];
  children: React.ReactNode;
}) {
  const parent = useContext(WorkspaceContext);
  const value = useMemo<WorkspaceContextValue>(
    () =>
      ({
        ...parent,
        workspaces,
        selectedWorkspaceId: workspaces[0]?.id ?? null,
        selectedWorkspace: workspaces[0] ?? null,
      }) as WorkspaceContextValue,
    [parent, workspaces],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

function TabsMode({ mode }: { mode: "auto" | "icons" }) {
  useEffect(() => {
    const prev = document.documentElement.getAttribute("data-tabs");
    document.documentElement.setAttribute("data-tabs", mode);
    return () => {
      if (prev) document.documentElement.setAttribute("data-tabs", prev);
      else document.documentElement.removeAttribute("data-tabs");
    };
  }, [mode]);
  return null;
}

const meta: Meta<typeof AppChrome> = {
  title: "Components/app/app-chrome",
  component: AppChrome,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default chrome: data-tabs="auto", three workspaces (so the switcher
 * trigger is visible in the top-left), router seeded at "/". The user
 * sees the Moduo Mark + Workspace trigger on the left, the six module
 * tabs centred in the viewport, and NotificationCenter + Avatar on the
 * right.
 */
export const Default: Story = {
  render: () => (
    <WorkspaceFixture workspaces={multiWorkspaceList}>
      <TabsMode mode="auto" />
      <AppChrome profileInitial="M" />
    </WorkspaceFixture>
  ),
};

/**
 * Icons-only mode: every tab is a square h-8 w-8 hit area with no
 * label. Active state is signalled by background + colour only — the
 * row is uniform. Tooltips still carry the module name.
 */
export const IconsOnly: Story = {
  render: () => (
    <WorkspaceFixture workspaces={multiWorkspaceList}>
      <TabsMode mode="icons" />
      <AppChrome profileInitial="M" />
    </WorkspaceFixture>
  ),
};

/**
 * Single workspace: the workspace switcher trigger is hidden entirely,
 * leaving the Moduo Mark alone on the left. The chrome should not
 * shift when the trigger disappears — verify the module nav still
 * sits in the viewport centre.
 */
export const SingleWorkspace: Story = {
  render: () => (
    <WorkspaceFixture workspaces={singleWorkspaceList}>
      <TabsMode mode="auto" />
      <AppChrome profileInitial="M" />
    </WorkspaceFixture>
  ),
};

/**
 * Narrow viewport: the bar is clamped to 1024px (the Tauri-enforced
 * minimum). The six tabs fit without horizontal scroll. The grid
 * 1fr-auto-1fr keeps the nav centred even when the left zone carries
 * the workspace switcher.
 */
export const NarrowViewport: Story = {
  parameters: {
    viewport: {
      viewports: {
        narrowDesktop: {
          name: "Narrow desktop (1024px)",
          styles: { width: "1024px", height: "768px" },
          type: "desktop",
        },
      },
      defaultViewport: "narrowDesktop",
    },
  },
  render: () => (
    <WorkspaceFixture workspaces={multiWorkspaceList}>
      <TabsMode mode="auto" />
      <AppChrome profileInitial="M" />
    </WorkspaceFixture>
  ),
};

/**
 * Trial-banner-active: the real TrialBanner fetches user_entitlements
 * from Supabase on mount, which we don't mock in Storybook. This story
 * simulates the banner-above-chrome stack with a fixed-height
 * placeholder so a reviewer can sanity-check the z-index, height math,
 * and that the bar doesn't bleed under it. The real banner is
 * verified in dev with a trialing account.
 */
export const TrialBannerActive: Story = {
  render: () => (
    <WorkspaceFixture workspaces={multiWorkspaceList}>
      <TabsMode mode="auto" />
      <div className="flex h-10 items-center justify-center bg-warning text-sm text-warning-foreground">
        Storybook stub: TrialBanner would render here in production.
      </div>
      <AppChrome profileInitial="M" />
    </WorkspaceFixture>
  ),
};
