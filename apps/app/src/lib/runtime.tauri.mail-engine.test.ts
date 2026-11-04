import { describe, expect, it } from "@rstest/core";

import { createTauriMailEngine } from "./runtime.tauri.mail-engine";
import type { MailEvent } from "./runtime.types.mail-engine";

describe("tauri mail engine", () => {
  it("maps calls to mail_* commands and fans one channel out to every listener", async () => {
    const calls: [string, unknown][] = [];
    let push: ((e: MailEvent) => void) | null = null;
    const engine = createTauriMailEngine(
      async <T>(cmd: string, args?: Record<string, unknown>) => {
        calls.push([cmd, args]);
        return [] as T;
      },
      (onMessage) => {
        push = onMessage;
        return "channel";
      },
    );
    await engine.applyOp({ kind: "done", threadIds: ["t1"] });
    const a: MailEvent[] = [];
    const b: MailEvent[] = [];
    const offA = engine.subscribe((e) => a.push(e));
    engine.subscribe((e) => b.push(e));
    expect(calls.filter(([c]) => c === "mail_subscribe")).toHaveLength(1);
    push!({ kind: "draft_changed", draftId: "d" });
    offA();
    push!({ kind: "draft_changed", draftId: "e" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
    expect(calls[0]).toEqual(["mail_apply_op", { input: { kind: "done", threadIds: ["t1"] } }]);
  });

  it("maps the reader and on-demand calls to their commands", async () => {
    const calls: [string, unknown][] = [];
    const engine = createTauriMailEngine(
      async <T>(cmd: string, args?: Record<string, unknown>) => {
        calls.push([cmd, args]);
        return null as T;
      },
      () => "channel",
    );
    await engine.getRawMessage!("m1", "t1");
    await engine.attachmentFile!("t1", "7");
    await engine.getInvite!("t1", "m1");
    await engine.rsvp!("t1", "m1", "decline");
    await engine.unsubscribePlan!("t1", "m1");
    await engine.unsubscribe!("t1", "m1", { allowMailto: true });
    await engine.avatar!({ email: "a@b.io", name: null, contactPhoto: null });
    await engine.setReaderPrefs!({ senderLogos: false, undoSendSeconds: 10 });
    await engine.setVisible!(["t1"]);
    await engine.openFolder!("a-inbox");
    await engine.backfill!("a");
    await engine.cancelBackfill!("a");
    await engine.setFollowUp!("t1", 9);
    await engine.releaseNewSenders!(["t1"]);
    expect(calls).toEqual([
      ["mail_get_raw_message", { threadId: "t1", messageId: "m1" }],
      ["mail_attachment_file", { threadId: "t1", attachmentId: "7" }],
      ["mail_get_invite", { threadId: "t1", messageId: "m1" }],
      ["mail_rsvp", { threadId: "t1", messageId: "m1", answer: "decline" }],
      ["mail_unsubscribe_plan", { threadId: "t1", messageId: "m1" }],
      ["mail_unsubscribe", { threadId: "t1", messageId: "m1", allowMailto: true }],
      ["mail_avatar", { email: "a@b.io", name: null, contactPhoto: null }],
      ["mail_set_reader_prefs", { prefs: { senderLogos: false, undoSendSeconds: 10 } }],
      ["mail_set_visible", { threadIds: ["t1"] }],
      ["mail_open_folder", { mailboxId: "a-inbox" }],
      ["mail_backfill", { accountId: "a" }],
      ["mail_cancel_backfill", { accountId: "a" }],
      ["mail_set_follow_up", { input: { threadId: "t1", dueMs: 9 } }],
      ["mail_release_new_senders", { threadIds: ["t1"] }],
    ]);
  });

  it("refuses Show original without the thread", async () => {
    const engine = createTauriMailEngine(
      async <T>() => "" as T,
      () => "c",
    );
    await expect(engine.getRawMessage!("m1")).rejects.toThrow();
  });
});
