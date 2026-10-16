import { describe, expect, it } from "@rstest/core";

import { OUTBOX_TEMPLATES } from "../outbox.ts";
import { renderEmail } from "../render.ts";
import { chatWaitingEmail, parseChatWaitingPayload } from "./chat-waiting.ts";

// The payload chat__queue_waiting_emails() writes (snake_case, from SQL).
const DM = {
  workspace_name: "Moduo Studio",
  conversation_kind: "dm",
  conversation_name: null,
  sender_name: "Sofia Ortiz",
  count: 1,
  text: "Can you look at the logo?",
  path: "/chat?c=5e2b9c1d-7a4f-4e8b-b3c6-0d9f1a2e4b7c&m=8f0c2a4e-1b6d-4c3a-9e7f-2d5b8a1c6e90",
  channel_id: "5e2b9c1d-7a4f-4e8b-b3c6-0d9f1a2e4b7c",
};
const CHANNEL = { ...DM, conversation_kind: "channel", conversation_name: "plans", count: 3, text: null };

describe("chat waiting (CV-6a)", () => {
  it("one message: who messaged you, where, the text and one button", () => {
    const doc = chatWaitingEmail(parseChatWaitingPayload(DM));
    expect(doc.subject).toBe("Sofia Ortiz messaged you in Moduo Studio");
    const { text } = renderEmail(doc);
    expect(text).toContain("Sofia Ortiz sent you a direct message.");
    expect(text).toContain("Can you look at the logo?");
    expect(text).toContain(`Open in Moduo`);
    expect(text).toContain(`https://app.moduo.app${DM.path}`);
    expect(text).toContain('Turn off "Email when away"');
  });

  it("several: the count in the subject; no text when Show message text is off (AC7.9)", () => {
    const doc = chatWaitingEmail(parseChatWaitingPayload(CHANNEL));
    expect(doc.subject).toBe("3 messages are waiting in Moduo Studio");
    expect(doc.preheader).toBe("Open Moduo to read it.");
    const { text } = renderEmail(doc);
    expect(text).toContain("3 messages for you in #plans, the newest from Sofia Ortiz.");
    expect(text).not.toContain("logo");
  });

  it("refuses a payload it can't render, and a link that leaves Chat", () => {
    expect(() => parseChatWaitingPayload({})).toThrow("workspace_name missing");
    expect(() => parseChatWaitingPayload({ ...DM, count: 0 })).toThrow("count missing");
    expect(() => parseChatWaitingPayload({ ...DM, conversation_kind: "group" })).toThrow("conversation_kind missing");
    expect(() => parseChatWaitingPayload({ ...DM, path: "https://evil.example" })).toThrow("path missing");
    expect(() => parseChatWaitingPayload({ ...DM, path: "/chat?c=1&next=//evil.example" })).toThrow("path missing");
  });

  it("is queued by the worker and renders the same twice (the idempotency key needs that)", () => {
    expect(OUTBOX_TEMPLATES.chat_waiting).toBeDefined();
    const a = renderEmail(chatWaitingEmail(parseChatWaitingPayload(DM)));
    const b = renderEmail(chatWaitingEmail(parseChatWaitingPayload(DM)));
    expect(a).toEqual(b);
  });
});
