// Locks the DF-24 validator finding: `joinWorkspace` must return the *joined
// workspace's* summary (resolved from the refreshed list via the invite's
// `workspace_id`), NOT `mapWorkspace(inviteRow)` — the invite shape would yield a
// garbage id/name and select a non-existent workspace.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

const runtime = rs.hoisted(() => ({
  workspace: {
    // `list` always returns both workspaces so the just-joined one resolves.
    list: rs.fn(async () => [
      { id: "ws-1", name: "Alpha", role: "owner" },
      { id: "ws-2", name: "Beta", role: "editor" },
    ]),
    // `joinInvite` returns the accepted *invite* row (per runtime.web.ts) — its
    // `workspace_id` points at the joined workspace; its `id` is the invite id.
    joinInvite: rs.fn(async () => ({
      id: "invite-1",
      workspace_id: "ws-2",
      role: "editor",
      email: "invitee@example.com",
      status: "accepted",
      token: "TOK",
    })),
    listMembers: rs.fn(async (): Promise<unknown[]> => []),
    listInvites: rs.fn(async () => []),
    listRoles: rs.fn(async () => []),
    listNotifications: rs.fn(async () => []),
  },
  spine: {
    listNotifications: rs.fn(async () => []),
  },
}));

rs.mock("./auth-provider", () => ({
  useAuth: () => ({ runtime, userId: "user-1" }),
}));

import { PROFILE_UPDATED_EVENT } from "../features/profile/profile-storage";
import { useWorkspace, WorkspaceProvider } from "./workspace-provider";

describe("WorkspaceProvider.joinWorkspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    rs.clearAllMocks();
  });

  it("returns the joined workspace summary and selects it (not the invite shape)", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: WorkspaceProvider });

    // Wait for the initial boot resolution to settle.
    await waitFor(() => expect(result.current.loading).toBe(false));

    let joined: Awaited<ReturnType<typeof result.current.joinWorkspace>> = null;
    await act(async () => {
      joined = await result.current.joinWorkspace("TOK");
    });

    // The real workspace summary — id/name from the workspace row, not the invite.
    expect(joined).not.toBeNull();
    expect(joined!.id).toBe("ws-2");
    expect(joined!.name).toBe("Beta");
    expect(joined!.role).toBe("editor");

    // ...and the joined workspace becomes the active selection.
    await waitFor(() => expect(result.current.selectedWorkspaceId).toBe("ws-2"));
  });

  it("returns null when the invite's workspace is absent from the refreshed list", async () => {
    runtime.workspace.joinInvite.mockResolvedValueOnce({
      id: "invite-2",
      workspace_id: "ws-missing",
      role: "viewer",
      email: "invitee@example.com",
      status: "accepted",
      token: "TOK2",
    });

    const { result } = renderHook(() => useWorkspace(), { wrapper: WorkspaceProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let joined: Awaited<ReturnType<typeof result.current.joinWorkspace>> = null;
    await act(async () => {
      joined = await result.current.joinWorkspace("TOK2");
    });

    expect(joined).toBeNull();
  });
});

describe("WorkspaceProvider members after a profile change (MOD-96)", () => {
  const PHOTO =
    "https://example.supabase.co/storage/v1/object/public/avatars/profiles/user-1/a.png";
  const row = (avatarUrl: string | null) => ({
    id: "m1",
    workspace_id: "ws-1",
    user_id: "user-1",
    role: "owner",
    is_active: true,
    profiles: { id: "user-1", display_name: "Ada Lovelace", avatar_url: avatarUrl },
  });

  beforeEach(() => {
    window.localStorage.clear();
    rs.clearAllMocks();
  });
  afterEach(() => {
    runtime.workspace.listMembers.mockImplementation(async () => []);
  });

  it("re-reads the members when a profile changes, so a new photo shows at once", async () => {
    runtime.workspace.listMembers.mockImplementation(async () => [row(null)]);
    const { result } = renderHook(() => useWorkspace(), { wrapper: WorkspaceProvider });
    await waitFor(() => expect(result.current.members[0]?.displayName).toBe("Ada Lovelace"));
    expect(result.current.members[0]?.avatarUrl).toBeNull();

    runtime.workspace.listMembers.mockImplementation(async () => [row(PHOTO)]);
    act(() => {
      window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
    });
    await waitFor(() => expect(result.current.members[0]?.avatarUrl).toBe(PHOTO));
  });

  it("keeps the roster it has when that read fails", async () => {
    runtime.workspace.listMembers.mockImplementation(async () => [row(PHOTO)]);
    const { result } = renderHook(() => useWorkspace(), { wrapper: WorkspaceProvider });
    await waitFor(() => expect(result.current.members[0]?.avatarUrl).toBe(PHOTO));
    const calls = runtime.workspace.listMembers.mock.calls.length;

    runtime.workspace.listMembers.mockImplementation(async () => {
      throw new Error("offline");
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(runtime.workspace.listMembers.mock.calls.length).toBe(calls + 1);
    expect(result.current.members).toHaveLength(1);
    expect(result.current.members[0]?.avatarUrl).toBe(PHOTO);
  });
});
