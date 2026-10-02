import { describe, expect, it } from "vitest";

import {
  addressEmail,
  buildComposeDraft,
  forwardSubject,
  htmlToPlainText,
  replySubject,
  splitAddresses,
  stripReFwd,
} from "./compose";
import type { EmailEnvelope, EmailThread } from "./model/email-types";

function env(partial: Partial<EmailEnvelope>): EmailEnvelope {
  return {
    id: "e",
    messageKey: "mk",
    accountId: "acc",
    folder: "inbox",
    uid: 1,
    sender: "Bob Boss",
    senderEmail: "boss@corp.com",
    to: "me@fastmail.com",
    subject: "Project update",
    preview: "Here is the update.",
    date: "2026-07-04T10:00:00.000Z",
    read: true,
    starred: false,
    threadId: "t1",
    hasCachedBody: true,
    ...partial,
  };
}

const thread: EmailThread = {
  threadId: "t1",
  accountId: "acc",
  accountEmail: "me@fastmail.com",
  subject: "Project update",
  participants: ["Bob Boss"],
  fromName: "Bob Boss",
  fromEmail: "boss@corp.com",
  snippet: "Here is the update.",
  date: "2026-07-04T10:00:00.000Z",
  timestampMs: Date.parse("2026-07-04T10:00:00.000Z"),
  messageCount: 1,
  unread: false,
  unreadCount: 0,
  starred: false,
  folder: "inbox",
  latestUid: 1,
};

const self = { accountId: "acc", address: "me@fastmail.com", signatureHtml: "" };
const selfAddresses = ["me@fastmail.com", "me@gmail.com"];

describe("subject helpers", () => {
  it("strips a run of Re:/Fwd: prefixes", () => {
    expect(stripReFwd("Re: Re: Hello")).toBe("Hello");
    expect(stripReFwd("Fwd: FW: x")).toBe("x");
    expect(stripReFwd("Plain")).toBe("Plain");
  });
  it("does not double-prefix a reply", () => {
    expect(replySubject("Re: Hi")).toBe("Re: Hi");
    expect(replySubject("Hi")).toBe("Re: Hi");
  });
  it("forward prefixes Fwd:", () => {
    expect(forwardSubject("Re: Hi")).toBe("Fwd: Hi");
  });
});

describe("address parsing", () => {
  it("extracts the bare address from a display form", () => {
    expect(addressEmail("Bob <bob@x.com>")).toBe("bob@x.com");
    expect(addressEmail("bob@x.com")).toBe("bob@x.com");
    expect(addressEmail("not an address")).toBe("");
  });
  it("splits a recipient list", () => {
    expect(splitAddresses("a@x.com, Bob <b@y.com>")).toEqual(["a@x.com", "b@y.com"]);
    expect(splitAddresses(null)).toEqual([]);
  });
});

describe("htmlToPlainText", () => {
  it("converts blocks + entities to plain text", () => {
    expect(htmlToPlainText("<p>Hi</p>there &amp; you")).toBe("Hi\nthere & you");
    expect(htmlToPlainText("a<br>b")).toBe("a\nb");
  });
});

describe("buildComposeDraft", () => {
  it("reply targets the counterpart with a Re: subject + threading headers", () => {
    const draft = buildComposeDraft({
      mode: "reply",
      thread,
      messages: [env({ messageId: "<m1@corp.com>", references: ["<root@corp.com>"] })],
      self,
      selfAddresses,
    });
    expect(draft.to).toBe("boss@corp.com");
    expect(draft.subject).toBe("Re: Project update");
    expect(draft.inReplyTo).toBe("<m1@corp.com>");
    expect(draft.references).toEqual(["<root@corp.com>", "<m1@corp.com>"]);
  });

  it("reply-all keeps the original To AND Cc recipients, minus every address I own", () => {
    const draft = buildComposeDraft({
      mode: "reply-all",
      thread,
      messages: [
        env({
          messageId: "<m1@corp.com>",
          to: "me@fastmail.com, teammate@corp.com, me@gmail.com",
          cc: "cc-person@corp.com, me@fastmail.com",
        }),
      ],
      self,
      selfAddresses,
    });
    expect(draft.to).toBe("boss@corp.com");
    // Both my addresses are pruned across To + Cc; the To-teammate AND the
    // Cc-person both survive (the Cc-drop bug is fixed).
    expect(draft.cc).toBe("teammate@corp.com, cc-person@corp.com");
  });

  it("reply picks the newest NON-self message as the target", () => {
    const draft = buildComposeDraft({
      mode: "reply",
      thread,
      messages: [
        env({ senderEmail: "boss@corp.com", messageId: "<m1@corp.com>" }),
        env({
          senderEmail: "me@fastmail.com",
          messageId: "<m2@fastmail.com>",
          date: "2026-07-04T11:00:00.000Z",
        }),
      ],
      self,
      selfAddresses,
    });
    // Anchor (threading) is my newest message, but the reply goes to the counterpart.
    expect(draft.inReplyTo).toBe("<m2@fastmail.com>");
    expect(draft.to).toBe("boss@corp.com");
  });

  it("forward has no recipients and a Fwd: subject", () => {
    const draft = buildComposeDraft({
      mode: "forward",
      thread,
      messages: [env({ messageId: "<m1@corp.com>" })],
      self,
      selfAddresses,
    });
    expect(draft.to).toBe("");
    expect(draft.subject).toBe("Fwd: Project update");
  });

  it("appends the account signature to the initial body", () => {
    const draft = buildComposeDraft({
      mode: "reply",
      thread,
      messages: [env({ messageId: "<m1@corp.com>" })],
      self: { ...self, signatureHtml: "<p>— Me</p>" },
      selfAddresses,
    });
    expect(draft.bodyHtml).toContain("— Me");
  });
});
