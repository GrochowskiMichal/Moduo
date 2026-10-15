import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { InviteEmailMismatchError, takePendingJoin } from "../../features/workspaces/invite-join";
import { JoinPage } from "./join-page";

const h = rs.hoisted(() => ({
  search: { invite: "ab+cd/ef==" } as { invite?: string },
  navigate: rs.fn((_to: unknown) => Promise.resolve()),
  signOut: rs.fn(() => Promise.resolve()),
  joinInvite: rs.fn((_token: string): Promise<unknown> => Promise.resolve({ workspace_id: "w1" })),
  auth: { isSignedIn: true, loading: false, userId: "u1" },
}));

rs.mock("@tanstack/react-router", () => ({
  useNavigate: () => h.navigate,
  useSearch: () => h.search,
}));
rs.mock("../../providers/auth-provider", () => ({
  useAuth: () => ({
    ...h.auth,
    signOut: h.signOut,
    runtime: { workspace: { joinInvite: h.joinInvite } },
  }),
}));
rs.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

beforeEach(() => {
  h.search = { invite: "ab+cd/ef==" };
  h.auth = { isSignedIn: true, loading: false, userId: "u1" };
  h.navigate.mockClear();
  h.signOut.mockClear();
  h.joinInvite.mockReset();
  window.localStorage.clear();
});

afterEach(() => cleanup());

async function accept() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Accept invite/ }));
  });
}

describe("JoinPage — invite for another address (TX-7 AC35)", () => {
  it("says which address the invite is for, masked, and offers Sign out", async () => {
    h.joinInvite.mockImplementation(() =>
      Promise.reject(new InviteEmailMismatchError("t•••@becker.studio")),
    );
    render(<JoinPage />);
    await accept();

    expect(screen.getByRole("alert").textContent).toBe(
      "This invite is for t•••@becker.studio. Sign in with that address to join.",
    );
    expect(screen.queryByRole("button", { name: /Accept invite/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeTruthy();
  });

  it("Sign out keeps the invite for after signing in with the right address", async () => {
    h.joinInvite.mockImplementation(() =>
      Promise.reject(new InviteEmailMismatchError("t•••@becker.studio")),
    );
    render(<JoinPage />);
    await accept();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    });

    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(takePendingJoin()).toBe("ab+cd/ef==");
    expect(h.navigate).toHaveBeenCalledWith({ to: "/auth", replace: true });
  });

  it("stays put when signing out fails, instead of bouncing back from /auth", async () => {
    h.joinInvite.mockImplementation(() =>
      Promise.reject(new InviteEmailMismatchError("t•••@becker.studio")),
    );
    h.signOut.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    render(<JoinPage />);
    await accept();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    });

    expect(h.navigate).not.toHaveBeenCalled();
    expect(takePendingJoin()).toBeNull();
    expect((screen.getByRole("button", { name: /Sign out/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("other refusals keep the existing message", async () => {
    h.joinInvite.mockImplementation(() => Promise.reject(new Error("Invalid or expired invite")));
    render(<JoinPage />);
    await accept();

    expect(screen.getByRole("alert").textContent).toBe("Invalid or expired invite");
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();
  });
});

describe("JoinPage — signed out (TX-7 AC36)", () => {
  it("keeps the invite across sign-in", () => {
    h.auth = { isSignedIn: false, loading: false, userId: "" };
    render(<JoinPage />);
    fireEvent.click(screen.getByRole("button", { name: /Sign in to accept/ }));

    expect(takePendingJoin()).toBe("ab+cd/ef==");
    expect(h.navigate).toHaveBeenCalledWith({ to: "/auth", replace: true });
  });
});
