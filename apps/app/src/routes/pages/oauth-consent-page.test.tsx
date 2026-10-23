// The consent screen's offer to replace duplicate connections (MCPO-5
// follow-up; docs/decisions/mcp.md): Claude registers anew on every Connect,
// so the person's other "Claude" connections are listed with when each was
// made and last used, ticked unless one was used in the last two minutes, and
// what stays ticked is sent with Approve.
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { OAuthConsentRequest } from "../../lib/runtime";

const mocks = rs.hoisted(() => {
  const workspace = {
    readOAuthRequest: rs.fn(),
    list: rs.fn(),
    connectOAuthApp: rs.fn(),
    approveOAuthRequest: rs.fn(),
    denyOAuthRequest: rs.fn(),
  };
  const chat = { isEnabled: rs.fn(() => Promise.resolve(true)) };
  return {
    workspace,
    auth: {
      runtime: { workspace, chat },
      userId: "u-me",
      userEmail: "me@example.com",
      isSignedIn: true,
      loading: false,
    },
    navigate: rs.fn(),
  };
});

rs.mock("../../providers/auth-provider", () => ({ useAuth: () => mocks.auth }));
rs.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useSearch: () => ({ authorization_id: "auth-1" }),
}));
rs.mock("sonner", () => ({ toast: { success: rs.fn(), error: rs.fn() } }));

import { OAuthConsentPage } from "./oauth-consent-page";

const request = (others: OAuthConsentRequest["others"]): OAuthConsentRequest => ({
  authorizationId: "auth-1",
  clientId: "client-new",
  appName: "Claude",
  clientDomain: "claude.ai",
  clientScheme: "https",
  connection: null,
  fullWorkspaceIds: [],
  others,
  heldRedirect: "https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz",
});

const stale = {
  id: "conn-stale",
  workspaceId: "w1",
  name: "Claude",
  createdAt: "2026-10-21T09:00:00.000Z",
  lastUsedAt: "2026-10-22T10:00:00.000Z",
  recentlyUsed: false,
};
const live = {
  id: "conn-live",
  workspaceId: "w1",
  name: "Claude",
  createdAt: "2026-10-23T09:00:00.000Z",
  lastUsedAt: "2026-10-23T09:59:00.000Z",
  recentlyUsed: true,
};

beforeEach(() => {
  mocks.workspace.list.mockResolvedValue([
    { id: "w1", name: "Studio", owner_id: "u-me", workspace_members: [] },
  ]);
  mocks.workspace.connectOAuthApp.mockResolvedValue({
    id: "conn-new",
    created: true,
    movedFrom: null,
    replaced: [],
  });
});

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
  rs.restoreAllMocks();
});

describe("replacing duplicate connections on the consent screen", () => {
  it("lists the other Claude connections, ticked unless used in the last two minutes", async () => {
    mocks.workspace.readOAuthRequest.mockResolvedValue(request([live, stale]));
    render(<OAuthConsentPage />);
    const boxes = await screen.findAllByRole("checkbox", {
      name: "Replace your other Claude connection",
    });
    expect(boxes).toHaveLength(2);
    expect(boxes[0].getAttribute("aria-checked")).toBe("false");
    expect(boxes[1].getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Last used just now/)).toBeTruthy();
    expect(screen.getAllByText(/^Connected /)).toHaveLength(2);
  });

  it("sends what stays ticked with Approve", async () => {
    mocks.workspace.readOAuthRequest.mockResolvedValue(request([live, stale]));
    const user = userEvent.setup();
    render(<OAuthConsentPage />);
    const boxes = await screen.findAllByRole("checkbox", {
      name: "Replace your other Claude connection",
    });
    await user.click(boxes[0]);
    await user.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(mocks.workspace.connectOAuthApp).toHaveBeenCalledTimes(1));
    expect(mocks.workspace.connectOAuthApp.mock.calls[0][0].replaceIds).toEqual([
      "conn-live",
      "conn-stale",
    ]);
  });

  it("replaces nothing when everything is unticked, and shows nothing when there are no others", async () => {
    mocks.workspace.readOAuthRequest.mockResolvedValue(request([stale]));
    const user = userEvent.setup();
    render(<OAuthConsentPage />);
    await user.click(
      await screen.findByRole("checkbox", { name: "Replace your other Claude connection" }),
    );
    await user.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(mocks.workspace.connectOAuthApp).toHaveBeenCalledTimes(1));
    expect(mocks.workspace.connectOAuthApp.mock.calls[0][0].replaceIds).toEqual([]);

    cleanup();
    mocks.workspace.readOAuthRequest.mockResolvedValue(request([]));
    render(<OAuthConsentPage />);
    await screen.findByRole("button", { name: /Approve/ });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
