import { describe, expect, it } from "@rstest/core";

import { OUTBOX_TEMPLATES } from "../outbox.ts";
import { renderEmail } from "../render.ts";
import { accountDeletedEmail } from "./account-deleted.ts";

const DATA = {
  email: "tom@becker.studio",
  deletedAt: "2026-10-08T10:30:00Z",
  zone: "Europe/Warsaw",
  hadBilling: true,
};

describe("account deleted (A2)", () => {
  it("has the ratified subject, preheader and copy", () => {
    const doc = accountDeletedEmail(DATA);
    expect(doc.subject).toBe("Your Moduo account is deleted");
    expect(doc.preheader).toBe("This is the last email we'll send to this address.");
    const { text } = renderEmail(doc);
    expect(text).toContain("Your account is deleted");
    expect(text).toContain("We deleted your Moduo account and your data on 8 October 2026, as you asked.");
    expect(text).toContain(
      "Things you shared in other people's workspaces stay with those workspaces. Your plan is canceled, and you won't be charged again.",
    );
    expect(text).toContain(
      "This is the last email we'll send to tom@becker.studio, and we're removing the address from our records now. To come back later, you'd need a new invite.",
    );
    expect(text).toContain("You got this email because the Moduo account for this address was deleted.");
  });

  it("dates the deletion in the person's own zone", () => {
    // 23:30 UTC on the 8th is already the 9th in Tokyo.
    const late = { ...DATA, deletedAt: "2026-10-08T23:30:00Z" };
    expect(renderEmail(accountDeletedEmail({ ...late, zone: "Asia/Tokyo" })).text).toContain("on 9 October 2026,");
    expect(renderEmail(accountDeletedEmail({ ...late, zone: null })).text).toContain("on 8 October 2026,");
    expect(renderEmail(accountDeletedEmail({ ...late, zone: "+09:00" })).text).toContain("on 8 October 2026,");
  });

  it("leaves the plan line out when there was no billing record", () => {
    const { text } = renderEmail(accountDeletedEmail({ ...DATA, hadBilling: false }));
    expect(text).toContain("Things you shared in other people's workspaces stay with those workspaces.");
    expect(text).not.toContain("Your plan is canceled");
    expect(text).not.toContain("charged");
  });

  it("escapes the address", () => {
    const { html } = renderEmail(accountDeletedEmail({ ...DATA, email: "<b>x</b>@example.com" }));
    expect(html).not.toContain("<b>x</b>");
  });

  it("is never queued: the worker has no template for it", () => {
    expect(OUTBOX_TEMPLATES.account_deleted).toBeUndefined();
  });
});
