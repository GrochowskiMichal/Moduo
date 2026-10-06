// Locks the DF-24 validator finding: `joinWorkspace` must return the *joined
// workspace's* summary (resolved from the refreshed list via the invite's
// `workspace_id`), NOT `mapWorkspace(inviteRow)` — the invite shape would yield a
// garbage id/name and select a non-existent workspace.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  workspace: {
    // `list` always returns both workspaces so the just-joined one resolves.
    list: vi.fn(async () => [
      { id: "ws-1", name: "Alpha", role: "owner" },
      { id: "ws-2", name: "Beta", role: "editor" },
    ]),
    // `joinInvite` returns the accepted *invite* row (per runtime.web.ts) — its
    // `workspace_id` points at the joined workspace; its `id` is the invite id.
    joinInvite: vi.fn(async () => ({
      id: "invite-1",
      workspace_id: "ws-2",
      role: "editor",
      email: "invitee@example.com",
      status: "accepted",
      token: "TOK",
    })),
    listMembers: vi.fn(async () => []),
    listInvites: vi.fn(async () => []),
    listRoles: vi.fn(async () => []),
    listNotifications: vi.fn(async () => []),
  },
  spine: {
    listNotifications: vi.fn(async () => []),
  },
}));

vi.mock("./auth-provider", () => ({
  useAuth: () => ({ runtime, userId: "user-1" }),
}));

import { useWorkspace, WorkspaceProvider } from "./workspace-provider";

describe("WorkspaceProvider.joinWorkspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
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
