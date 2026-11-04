import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { ConnectError, connectErrorCopy } from "./connect-error";

afterEach(cleanup);

describe("connect dialog errors (AC37)", () => {
  it("admin blocked copy", () => {
    for (const code of ["AADSTS65001", "AADSTS90094", "admin_policy_enforced", "org_internal"]) {
      const copy = connectErrorCopy(`admin_consent_required:${code}`);
      expect(copy.message).toContain("Your organization's admin needs to allow Moduo");
      expect(copy.detail).toBe(`Provider code: ${code}`);
    }
    render(<ConnectError error="Error: admin_consent_required:AADSTS65001" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("admin needs to allow Moduo");
    expect(alert.textContent).toContain("AADSTS65001");
  });

  it("testing-mode re-approval and missing secret get their own copy", () => {
    expect(connectErrorCopy("account_reauth_required").message).toContain("every 7 days");
    expect(connectErrorCopy("account_secret_missing").message).toContain("Keychain");
  });

  it("passes other errors through", () => {
    expect(connectErrorCopy("IMAP login failed")).toEqual({
      message: "IMAP login failed",
      detail: null,
    });
  });
});
