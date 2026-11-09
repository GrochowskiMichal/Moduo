// specs/mail-improve.md MI-0: the fixture states the improve lab needs: a failed send by
// size with its attachment, failed ops with their causes, the Screener with senders
// waiting, first run, a 200-character subject at the head, and collapsed messages whose
// newest lines open with a salutation. Frozen after MI-0's commit.

import { describe, expect, it } from "@rstest/core";

import { createFakeCompose } from "./fake-compose";
import { createFakeMailEngine, MAIL_FIXTURE_SCENARIOS } from "./fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "./fixture";

const inbox = { kind: "unified", role: "inbox" } as const;

function engineWith(scenario: (typeof MAIL_FIXTURE_SCENARIOS)[number][]) {
  return createFakeMailEngine({
    fixture: generateFixture({ messages: 400 }),
    now: () => FIXTURE_NOW_MS,
    scenario,
  });
}

describe("improve fixture states (MI-0)", () => {
  it("names every new state", () => {
    for (const s of ["newSenders", "long", "salutation"])
      expect(MAIL_FIXTURE_SCENARIOS as readonly string[]).toContain(s);
  });

  it("sendFailedSize: a draft refused for size, its attachment over the limit", async () => {
    const port = createFakeCompose({ scenario: ["sendFailedSize"] });
    const failed = (await port.listDrafts()).filter((d) => d.doc.lastError);
    expect(failed).toHaveLength(1);
    const d = failed[0]!;
    expect(d.doc.lastError).toMatch(/size/i);
    expect(d.doc.attachments.some((a) => (a.size ?? 0) > 25 * 1024 * 1024)).toBe(true);
  });

  it("failed: ops carry different causes", async () => {
    const ops = await engineWith(["failed"]).listFailedOps();
    expect(ops.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ops.map((o) => o.lastError)).size).toBeGreaterThanOrEqual(2);
  });

  it("newSenders: threads wait in New senders until released", async () => {
    const engine = engineWith(["newSenders"]);
    const page = await engine.listThreads({ view: { kind: "new_senders" }, limit: 50 });
    expect(page.rows.length).toBeGreaterThanOrEqual(3);
    await engine.releaseNewSenders!(page.rows.map((r) => r.threadId));
    const after = await engine.listThreads({ view: { kind: "new_senders" }, limit: 50 });
    expect(after.rows).toHaveLength(0);
  });

  it("noAccount stays the first-run state", async () => {
    expect(await engineWith(["noAccount"]).listAccounts()).toEqual([]);
  });

  it("long: a 200-character subject heads Personal", async () => {
    const engine = engineWith(["long"]);
    const page = await engine.listThreads({ view: inbox, tab: { kind: "personal" }, limit: 5 });
    expect(page.rows[0]!.subject.length).toBeGreaterThanOrEqual(200);
  });

  it("salutation: the head thread's messages open with a greeting; snippets skip it", async () => {
    const engine = engineWith(["salutation"]);
    const page = await engine.listThreads({ view: inbox, tab: { kind: "personal" }, limit: 5 });
    const thread = (await engine.getThread(page.rows[0]!.threadId))!;
    expect(thread.messages.length).toBeGreaterThanOrEqual(2);
    const [first] = thread.messages;
    expect(first!.text).toMatch(/^Hi Robin,/);
    expect(first!.snippet).not.toMatch(/^Hi/);
    // One message is only a salutation: its snippet falls back to the subject.
    expect(
      thread.messages.some((m) => m.text?.trim() === "Hi Robin," && m.snippet === m.subject),
    ).toBe(true);
  });
});
