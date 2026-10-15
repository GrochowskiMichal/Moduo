import { describe, expect, it } from "@rstest/core";

import { OUTBOX_TEMPLATES } from "../outbox.ts";
import { renderEmail } from "../render.ts";
import { formatFrom } from "../send.ts";
import {
  parseWorkspaceInvitePayload,
  parseWorkspaceOwnerPayload,
  parseWorkspaceRemovedPayload,
  workspaceInviteEmail,
  workspaceOwnerEmail,
  workspaceRemovedEmail,
} from "./workspace.ts";

// The payloads 20261015090000_tx7_workspace_emails.sql writes (snake_case, from SQL).
const INVITE = {
  invite_id: "5f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b",
  email: "tom@becker.studio",
  workspace_name: "Northwind Studio",
  inviter_name: "Anna Carter",
  inviter_email: "anna@northwind.studio",
  role_name: "Member",
  role_key: "member",
  expires_at: "2026-10-15T09:12:00Z",
  token: "ab+cd/ef==",
};
const OWNER = {
  workspace_name: "Northwind Studio",
  by_name: "Anna Carter",
  by_email: "anna@northwind.studio",
  at: "2026-10-08T09:12:00Z",
};
const REMOVED = { ...OWNER };

const textOf = (doc: Parameters<typeof renderEmail>[0]) => renderEmail(doc).text;

describe("workspace invite (B3)", () => {
  it("has the ratified subject, preheader and copy", () => {
    const doc = workspaceInviteEmail(parseWorkspaceInvitePayload(INVITE));
    expect(doc.subject).toBe("Anna Carter invited you to Northwind Studio");
    expect(doc.preheader).toBe("Join as a member. The invite works until 15 October.");
    const text = textOf(doc);
    expect(text).toContain("Join Northwind Studio on Moduo");
    expect(text).toContain("Anna Carter (anna@northwind.studio) invited you to their workspace in Moduo.");
    expect(text).toContain("Member");
    expect(text).toContain("Thursday 15 October");
    expect(text).toContain(
      "New to Moduo? Accepting sets up your account. Sign in with tom@becker.studio, the address this invite was sent to.",
    );
    expect(text).toContain("Not expecting this? Ignore it and nothing happens.");
    expect(text).toContain("You got this email because Anna Carter invited this address to a Moduo workspace.");
  });

  it("links to app.moduo.app/join with the token encoded", () => {
    const { html, text } = renderEmail(workspaceInviteEmail(parseWorkspaceInvitePayload(INVITE)));
    const url = "https://app.moduo.app/join?invite=ab%2Bcd%2Fef%3D%3D";
    expect(text).toContain(url);
    expect(html).toContain(url);
  });

  it("is sent as '<Inviter> via Moduo' with replies to the inviter", () => {
    const queued = OUTBOX_TEMPLATES.workspace_invite?.(INVITE);
    expect(queued?.fromName).toBe("Anna Carter via Moduo");
    expect(queued?.replyTo).toBe("anna@northwind.studio");
    expect(formatFrom(queued?.fromName ?? "", "hello@moduo.app")).toBe('"Anna Carter via Moduo" <hello@moduo.app>');
  });

  it("falls back to the inviter's address, and sends as Moduo, when they have no name", () => {
    const payload = { ...INVITE, inviter_name: "" };
    const doc = workspaceInviteEmail(parseWorkspaceInvitePayload(payload));
    expect(doc.subject).toBe("anna@northwind.studio invited you to Northwind Studio");
    expect(textOf(doc)).toContain("anna@northwind.studio invited you to their workspace in Moduo.");
    expect(OUTBOX_TEMPLATES.workspace_invite?.(payload).fromName).toBe("Moduo");
  });

  it("names the role: system roles in words, custom roles as named", () => {
    const admin = workspaceInviteEmail(parseWorkspaceInvitePayload({ ...INVITE, role_name: "Admin", role_key: "admin" }));
    expect(admin.preheader).toBe("Join as an admin. The invite works until 15 October.");
    const custom = workspaceInviteEmail(
      parseWorkspaceInvitePayload({ ...INVITE, role_name: "Studio lead", role_key: null }),
    );
    expect(custom.preheader).toBe("Join as Studio lead. The invite works until 15 October.");
    expect(textOf(custom)).toContain("Studio lead");
  });

  it("keeps names inert: markup and line breaks stay text on one line", () => {
    const doc = workspaceInviteEmail(
      parseWorkspaceInvitePayload({
        ...INVITE,
        inviter_name: "<b>Anna</b>\r\nBcc: x@evil.test",
        workspace_name: 'North"wind <i>',
      }),
    );
    expect(doc.subject).not.toMatch(/[\r\n]/);
    const { html } = renderEmail(doc);
    expect(html).not.toContain("<b>Anna</b>");
    expect(html).not.toContain("<i>");
    const from = OUTBOX_TEMPLATES.workspace_invite?.({ ...INVITE, inviter_name: 'Ann"a <x@y>\nBcc' }).fromName ?? "";
    expect(formatFrom(from, "hello@moduo.app")).toMatch(/^"[^"\r\n<>]+" <hello@moduo\.app>$/);
  });

  it("refuses a payload it can't render", () => {
    expect(() => parseWorkspaceInvitePayload({})).toThrow("email missing");
    expect(() => parseWorkspaceInvitePayload({ ...INVITE, token: "" })).toThrow("token missing");
    expect(() => parseWorkspaceInvitePayload({ ...INVITE, inviter_email: "" })).toThrow("inviter_email missing");
    expect(() => parseWorkspaceInvitePayload({ ...INVITE, expires_at: "soon" })).toThrow("expires_at missing");
  });

  it("renders the same email twice from the same payload (the idempotency key needs that)", () => {
    expect(renderEmail(workspaceInviteEmail(parseWorkspaceInvitePayload(INVITE)))).toEqual(
      renderEmail(workspaceInviteEmail(parseWorkspaceInvitePayload(INVITE))),
    );
  });
});

describe("you're the owner now (B4)", () => {
  it("has the ratified subject, preheader and copy, from Moduo", () => {
    const doc = workspaceOwnerEmail(parseWorkspaceOwnerPayload(OWNER));
    expect(doc.subject).toBe("You're now the owner of Northwind Studio");
    expect(doc.preheader).toBe("Anna Carter handed the workspace over to you.");
    const text = textOf(doc);
    expect(text).toContain("You own Northwind Studio now");
    expect(text).toContain(
      "Anna Carter made you the owner of Northwind Studio on 8 October. You can now manage its members, roles and settings, and only you can delete it.",
    );
    expect(text).toContain("Its seats now come from your plan.");
    expect(text).toContain("https://app.moduo.app/settings?section=workspace");
    expect(text).toContain("You got this email because ownership of a Moduo workspace moved to you.");
    const queued = OUTBOX_TEMPLATES.workspace_owner?.(OWNER);
    expect(queued?.fromName).toBeUndefined();
    expect(queued?.replyTo).toBeUndefined();
  });

  it("refuses a payload it can't render", () => {
    expect(() => parseWorkspaceOwnerPayload({ ...OWNER, at: "" })).toThrow("at missing");
  });
});

describe("removed from a workspace (B5)", () => {
  it("has the ratified subject, preheader and copy, from Moduo", () => {
    const doc = workspaceRemovedEmail(parseWorkspaceRemovedPayload(REMOVED));
    expect(doc.subject).toBe("You no longer have access to Northwind Studio");
    expect(doc.preheader).toBe("Your own workspaces and account aren't affected.");
    const text = textOf(doc);
    expect(text).toContain("You've been removed from Northwind Studio");
    expect(text).toContain(
      "Anna Carter removed you from Northwind Studio on 8 October. Your own workspaces and your account aren't affected.",
    );
    expect(text).toContain("If you think this is a mistake, ask Anna.");
    expect(text).toContain("You got this email because you were a member of Northwind Studio on Moduo.");
    expect(OUTBOX_TEMPLATES.workspace_removed?.(REMOVED).fromName).toBeUndefined();
  });

  it("names the remover by address when they have no name", () => {
    const text = textOf(workspaceRemovedEmail(parseWorkspaceRemovedPayload({ ...REMOVED, by_name: "" })));
    expect(text).toContain("anna@northwind.studio removed you from Northwind Studio");
    expect(text).toContain("ask anna@northwind.studio.");
  });
});

describe("the worker's templates", () => {
  it("send the workspace kinds and keep every kind live before TX-7", () => {
    expect(Object.keys(OUTBOX_TEMPLATES).sort()).toEqual(
      [
        "booking_guest_added",
        "booking_guest_cancelled",
        "booking_guest_confirmed",
        "booking_host_guest_cancelled",
        "booking_host_new",
        "ops_alert",
        "waitlist_invite",
        "workspace_invite",
        "workspace_owner",
        "workspace_removed",
      ].sort(),
    );
  });
});
