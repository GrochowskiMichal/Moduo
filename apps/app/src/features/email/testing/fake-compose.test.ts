// MV-0 contract for the fixture compose port (specs/mail-v3.md AC10, AC11): the draft
// upload reports `draft_changed` with its server uid, a failed send returns to Drafts
// with its reason, and a save clears that reason. Frozen after MV-0's commit.

import { describe, expect, it } from "@rstest/core";

import type { MailDraftDoc } from "@/lib/runtime.types.mail-compose";

import { createFakeCompose } from "./fake-compose";

const doc = (over: Partial<MailDraftDoc> = {}): MailDraftDoc => ({
  messageId: "",
  fromName: "Mike",
  fromAddr: "mike@gmail.test",
  to: ["ana@acme.test"],
  cc: [],
  bcc: [],
  subject: "Pilot",
  text: "Hi Ana",
  html: null,
  inReplyTo: null,
  references: [],
  attachments: [],
  lastError: null,
  ...over,
});

describe("fixture compose: MV-0", () => {
  it("uploads saved drafts and reports draft_changed with the server uid", async () => {
    const changed: { draftId: string; serverUid: number | null }[] = [];
    const compose = createFakeCompose({
      onDraftChanged: (draftId, serverUid) => changed.push({ draftId, serverUid }),
    });
    const { draftId } = await compose.saveDraft({ accountId: "acc-gmail", threadId: null, doc: doc() });
    expect((await compose.getDraft(draftId))!.serverUid).toBeNull();
    compose.uploadDrafts();
    const uid = (await compose.getDraft(draftId))!.serverUid;
    expect(typeof uid).toBe("number");
    expect(changed).toEqual([{ draftId, serverUid: uid }]);
    // Offline: nothing reaches the server.
    compose.online = false;
    const second = await compose.saveDraft({ accountId: "acc-gmail", threadId: null, doc: doc() });
    compose.uploadDrafts();
    expect((await compose.getDraft(second.draftId))!.serverUid).toBeNull();
  });

  it("sendFailed scenario: a draft with its reason; a save clears it", async () => {
    const compose = createFakeCompose({ scenario: ["sendFailed"] });
    const [failed] = (await compose.listDrafts()).filter((d) => d.doc.lastError);
    expect(failed).toBeTruthy();
    await compose.saveDraft({
      draftId: failed!.id,
      accountId: failed!.accountId,
      threadId: failed!.threadId,
      doc: failed!.doc,
    });
    expect((await compose.getDraft(failed!.id))!.doc.lastError).toBeNull();
  });

  it("outbox scenario: one queued send", async () => {
    const compose = createFakeCompose({ scenario: ["outbox"] });
    expect(await compose.listOutbox()).toHaveLength(1);
  });
});
