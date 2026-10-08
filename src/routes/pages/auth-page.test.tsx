import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { ACCOUNT_DELETED_NOTICE } from "../../features/settings/delete-account";
import { AuthPage } from "./auth-page";

const h = rs.hoisted(() => ({
  search: {} as { deleted?: 1 },
  auth: { isSignedIn: false, loading: false },
  navigate: rs.fn((_to: unknown) => Promise.resolve()),
}));

rs.mock("@tanstack/react-router", () => ({
  useNavigate: () => h.navigate,
  useSearch: () => h.search,
}));
rs.mock("../../providers/auth-provider", () => ({
  useAuth: () => h.auth,
}));
rs.mock("../../components/auth/email-auth-panel", () => ({
  EmailAuthPanel: () => <div>sign-in form</div>,
}));
rs.mock("../../features/settings/about", () => ({ IS_STAGING_PORTAL: false }));

beforeEach(() => {
  h.search = {};
  h.auth = { isSignedIn: false, loading: false };
  h.navigate.mockClear();
});

afterEach(() => cleanup());

describe("AuthPage — deleted notice (PRIV-2 AC11)", () => {
  it("says the account and its data were deleted when the Danger zone sent you here", () => {
    h.search = { deleted: 1 };
    render(<AuthPage />);

    expect(screen.getByRole("status").textContent).toBe(ACCOUNT_DELETED_NOTICE);
    expect(screen.getByText("sign-in form")).toBeTruthy();
  });

  it("says nothing about a deletion on a plain visit", () => {
    render(<AuthPage />);

    expect(screen.queryByText(ACCOUNT_DELETED_NOTICE)).toBeNull();
    expect(screen.getByText("sign-in form")).toBeTruthy();
  });

  it("keeps the notice up while the sign-out that follows the deletion is still running", () => {
    h.search = { deleted: 1 };
    h.auth = { isSignedIn: true, loading: false };
    render(<AuthPage />);

    expect(h.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(ACCOUNT_DELETED_NOTICE);
  });

  it("still sends a signed-in visitor into the app on a plain visit", () => {
    h.auth = { isSignedIn: true, loading: false };
    render(<AuthPage />);

    expect(h.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });
});
