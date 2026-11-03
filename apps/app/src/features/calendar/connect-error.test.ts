import { describe, expect, it } from "@rstest/core";

import { connectErrorText } from "./connect-error";

describe("a failed Connect in words", () => {
  it("says a build without a sign-in client isn't set up, never the setting's name", () => {
    const google = connectErrorText(
      "google",
      "missing_google_client_id:set MODUO_CALENDAR_GOOGLE_CLIENT_ID",
    );
    expect(google).toContain("isn't set up in this version of the app");
    expect(google).toContain("app.moduo.app");
    expect(google).not.toContain("MODUO_");
    const outlook = connectErrorText(
      "microsoft",
      "missing_microsoft_client_id:set MODUO_CALENDAR_MICROSOFT_CLIENT_ID",
    );
    expect(outlook).toBe(
      "Connecting Outlook isn't set up in this version of the app. Connect it at app.moduo.app instead; it shows here too.",
    );
  });

  it("turns any other code into a plain retry line", () => {
    expect(connectErrorText("google", "oauth_callback_bind_failed:Address in use")).toBe(
      "Couldn't connect Google Calendar. Try again.",
    );
    expect(connectErrorText("microsoft", "microsoft_me_failed")).toBe(
      "Couldn't connect Outlook. Try again.",
    );
  });

  it("keeps a message that is already a sentence", () => {
    expect(connectErrorText("google", "Could not connect Google.")).toBe(
      "Could not connect Google.",
    );
  });
});
