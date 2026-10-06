import type { Meta, StoryObj } from "@storybook/react";
import type * as React from "react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { AuthContext, type AuthContextValue } from "../../../providers/auth-provider";
import {
  ALL_PERMISSION_KEYS,
  type PermissionKey,
  resolvePermissions,
  type WorkspaceRoleDef,
} from "../../workspaces/access";
import type { WorkspaceInvite, WorkspaceMember } from "../../workspaces/types";
import { WorkspaceContext, type WorkspaceContextValue } from "../../workspaces/workspace-context";
import { AccessSection } from "./access-section";

const WS = "ws-story";
const ALL = [...ALL_PERMISSION_KEYS];
const MEMBER_PERMS = ALL.filter((k) => !k.startsWith("ws.")).concat("ws.publish");
const VIEWER_PERMS = ALL.filter((k) => k.endsWith(".view"));

const roles: WorkspaceRoleDef[] = [
  {
    id: "r-admin",
    workspaceId: WS,
    systemKey: "admin",
    name: "Admin",
    description: "Runs the workspace with the owner.",
    permissions: ALL,
    readOnly: false,
    position: 0,
    updatedAt: "1",
  },
  {
    id: "r-member",
    workspaceId: WS,
    systemKey: "member",
    name: "Member",
    description: "Does the work. The default for invites.",
    permissions: MEMBER_PERMS,
    readOnly: false,
    position: 1,
    updatedAt: "1",
  },
  {
    id: "r-viewer",
    workspaceId: WS,
    systemKey: "viewer",
    name: "Viewer",
    description: "Sees what's shared. Never edits.",
    permissions: VIEWER_PERMS,
    readOnly: true,
    position: 2,
    updatedAt: "1",
  },
  {
    id: "r-contractor",
    workspaceId: WS,
    systemKey: null,
    name: "Contractor",
    description: "Tasks only.",
    permissions: ["tasks.view", "tasks.create", "tasks.edit", "chat.view", "chat.create"],
    readOnly: false,
    position: 3,
    updatedAt: "1",
  },
];

function member(
  id: string,
  name: string,
  roleId: string,
  overrides: Partial<Record<PermissionKey, boolean>> = {},
  owner = false,
): WorkspaceMember {
  const role = roles.find((r) => r.id === roleId)!;
  return {
    id: `m-${id}`,
    workspaceId: WS,
    userId: `u-${id}`,
    role: owner
      ? "owner"
      : role.systemKey === "admin"
        ? "admin"
        : role.readOnly
          ? "viewer"
          : "editor",
    roleId,
    overrides,
    perms: owner ? ALL : resolvePermissions(role.permissions, role.readOnly, overrides),
    joinedAt: "2026-09-12T10:00:00Z",
    isActive: true,
    removedAt: null,
    displayName: name,
    avatarUrl: null,
  };
}

const members: WorkspaceMember[] = [
  member("mike", "Mike Grochowski", "r-admin", {}, true),
  member("piotr", "Piotr Wiśniewski", "r-admin"),
  member("anna", "Anna Nowak", "r-member", { "tasks.delete": false, "notes.delete": false }),
  member("jan", "Jan Kowalski", "r-contractor", { "calendar.view": true }),
  member("ola", "Ola Zielińska", "r-viewer"),
];

const invites: WorkspaceInvite[] = [
  {
    id: "i1",
    workspaceId: WS,
    email: "kasia@studio.pl",
    role: "editor",
    roleId: "r-member",
    status: "pending",
    expiresAt: "2026-10-12T10:00:00Z",
    token: "tok",
    createdAt: "",
    updatedAt: "",
  },
];

const runtime = {
  workspace: { inviteUrl: (t: string) => `https://moduo.app/join?invite=${t}` },
} as unknown as ModuoRuntime;

function providers(asUser: string, children: React.ReactNode) {
  const me = members.find((m) => m.userId === asUser)!;
  const isOwner = me.role === "owner";
  const auth: AuthContextValue = {
    userId: asUser,
    userEmail: "you@example.com",
    accessToken: null,
    isSignedIn: true,
    loading: false,
    configError: null,
    runtime,
    planTier: "team",
    signOut: async () => {},
    refreshPlanTier: async () => {},
  };
  const workspace = {
    selectedWorkspaceId: WS,
    selectedWorkspace: {
      id: WS,
      name: "Studio",
      role: isOwner ? "owner" : me.role,
      perms: me.perms,
      roleId: me.roleId,
    },
    members,
    roles,
    invites,
    myPerms: me.perms,
    can: (k: PermissionKey) => isOwner || me.perms.includes(k),
    refreshAccessData: async () => {},
    upsertRole: async () => null,
    deleteRole: async () => {},
    setMemberAccess: async () => {},
    removeMember: async () => {},
    transferOwnership: async () => {},
    sendInvite: async () => null,
    updateInvite: async () => {},
    revokeInvite: async () => {},
  } as unknown as WorkspaceContextValue;
  return (
    <AuthContext.Provider value={auth}>
      <WorkspaceContext.Provider value={workspace}>
        <TooltipProvider>
          <div className="bg-background p-6">{children}</div>
        </TooltipProvider>
      </WorkspaceContext.Provider>
    </AuthContext.Provider>
  );
}

const meta: Meta<typeof AccessSection> = {
  title: "features/settings/sections/access-section",
  component: AccessSection,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** The owner: can change everything except their own access. */
export const AsOwner: Story = {
  decorators: [(Story) => providers("u-mike", <Story />)],
};

/** An admin: manages people below admin; peers and the owner are read-only. */
export const AsAdmin: Story = {
  decorators: [(Story) => providers("u-piotr", <Story />)],
};

/** A member: sees their own access and the roster, changes nothing. */
export const AsMember: Story = {
  decorators: [(Story) => providers("u-anna", <Story />)],
};
