// MV-0 contract (specs/mail-v3.md §Execution blocks, "MV-0: the port additions"):
// the fixture engine implements every port addition and the lab states, so the
// screens and the lab run without IMAP. Frozen after MV-0's commit.

import { describe, expect, it } from "@rstest/core";

import { mailViewKey } from "@/lib/runtime.types";
import type { MailEvent } from "@/lib/runtime.types.mail-engine";

import { createFakeMailEngine, type FakeEngineOptions } from "./fake-engine";
import { FIXTURE_NOW_MS, type FixtureMessage, generateFixture } from "./fixture";

const inbox = { kind: "unified", role: "inbox" } as const;

function setup(extra: Partial<FakeEngineOptions> = {}) {
  let t = FIXTURE_NOW_MS;
  const engine = createFakeMailEngine({
    fixture: generateFixture({ messages: 600 }),
    now: () => t,
    ...extra,
  });
  const events: MailEvent[] = [];
  engine.subscribe((e) => events.push(e));
  return { engine, events, advance: (ms: number) => (t += ms) };
}

let seq = 0;
function msg(from: string, extra: Partial<FixtureMessage> = {}): FixtureMessage {
  const n = ++seq;
  return {
    id: `v3m${n}`,
    accountId: "acc-gmail",
    mailboxRole: "inbox",
    threadId: `acc-gmail:v3t${n}`,
    messageId: `<v3m${n}@fixture.moduo.test>`,
    inReplyTo: null,
    fromName: from.split("@")[0]!,
    fromEmail: from,
    to: ["mike@gmail.test"],
    subject: `Subject ${n}`,
    snippet: "snippet",
    bodyText: "body",
    dateMs: FIXTURE_NOW_MS + n,
    flags: 0,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    attachmentNames: [],
    hasInvite: false,
    ...extra,
  };
}

const CLASSIFY: FakeEngineOptions["classify"] = {
  blocked: ["spam@bad.test"],
  rules: [
    { id: "r-receipts", from: "billing@shop.test", action: "mark_read" },
    { id: "r-ops", domain: "ops.test", tab: { kind: "notifications" } },
  ],
  senderOverrides: { "pal@friends.test": { kind: "newsletters" } },
  customTabs: [{ id: "ct-investors", senders: [], domains: ["northzone.vc"] }],
  knownContacts: ["ana@acme.test"],
};

describe("fixture engine: MV-0 port additions", () => {
  it("explains every classifier stage, with the rule and custom tab ids", async () => {
    const { engine } = setup({ classify: CLASSIFY });
    const cases = [
      { from: "spam@bad.test", stage: "block" },
      { from: "alerts@ops.test", stage: "rules", ruleId: "r-ops" },
      { from: "pal@friends.test", stage: "sender_override" },
      { from: "dana@northzone.vc", stage: "custom_tabs", customTabId: "ct-investors" },
      { from: "ana@acme.test", stage: "known_contact" },
    ] as const;
    for (const c of cases) {
      const m = msg(c.from);
      engine.deliver(m);
      const why = await engine.explainThread!(m.threadId);
      expect(why.stage).toBe(c.stage);
      expect(why.address).toBe(c.from);
      expect(why.ruleId).toBe("ruleId" in c ? c.ruleId : null);
      expect(why.customTabId).toBe("customTabId" in c ? c.customTabId : null);
    }
    const news = msg("hello@lumen.test", { listUnsubscribe: "<https://lumen.test/u>" });
    engine.deliver(news);
    const why = await engine.explainThread!(news.threadId);
    expect(why).toMatchObject({ stage: "header_heuristics", tab: "newsletters" });
  });

  it("explains an old thread by re-running, or answers without a stage when headers are gone", async () => {
    const { engine } = setup({ classify: CLASSIFY });
    const a = msg("ana@acme.test");
    const b = msg("ana@acme.test");
    engine.deliver(a);
    engine.deliver(b);
    engine.forgetReason(a.threadId, { keepHeaders: true });
    engine.forgetReason(b.threadId, { keepHeaders: false });
    expect((await engine.explainThread!(a.threadId)).stage).toBe("known_contact");
    const lost = await engine.explainThread!(b.threadId);
    expect(lost.stage).toBeNull();
    expect(lost.tab).toBe("personal");
  });

  it("applies a rule to existing mail: the dry run counts, the apply is one undoable op", async () => {
    const { engine } = setup({ classify: CLASSIFY });
    const ms = [msg("billing@shop.test"), msg("billing@shop.test"), msg("billing@shop.test")];
    for (const m of ms) engine.deliver(m);
    const unread = async () =>
      (await Promise.all(ms.map((m) => engine.getThread(m.threadId)))).filter((t) => t!.row.unread)
        .length;
    // New mail from the rule's sender is already read on arrival (rules act on new mail, AC6).
    expect(await unread()).toBe(0);
    for (const m of ms) await engine.applyOp({ kind: "mark_unread", threadIds: [m.threadId] });
    expect(await unread()).toBe(3);
    const dry = await engine.applyRuleExisting!({ ruleId: "r-receipts", dryRun: true });
    expect(dry).toEqual({ count: 3, opIds: [] });
    expect(await unread()).toBe(3);
    const applied = await engine.applyRuleExisting!({ ruleId: "r-receipts", dryRun: false });
    expect(applied.count).toBe(3);
    expect(applied.opIds).toHaveLength(1);
    expect(await unread()).toBe(0);
    await engine.undoOp(applied.opIds[0]!);
    expect(await unread()).toBe(3);
  });

  it("remembers Always load images per sender", async () => {
    const { engine } = setup();
    const m = msg("lumen@news.test");
    const other = msg("lumen@news.test");
    engine.deliver(m);
    engine.deliver(other);
    expect((await engine.getThread(m.threadId))!.imagesAllowed).toBe(false);
    await engine.setImageAllow!("lumen@news.test", true);
    expect((await engine.getThread(other.threadId))!.imagesAllowed).toBe(true);
    await engine.setImageAllow!("lumen@news.test", false);
    expect((await engine.getThread(m.threadId))!.imagesAllowed).toBe(false);
  });

  it("reports when each account last synced and whether it is pushed", async () => {
    const { engine, events } = setup();
    const accounts = await engine.listAccounts();
    for (const a of accounts) {
      expect(typeof a.lastSyncedMs).toBe("number");
      expect(typeof a.push).toBe("boolean");
    }
    expect(accounts.some((a) => a.push) && accounts.some((a) => !a.push)).toBe(true);
    engine.setAccountState("acc-work", { syncState: "reconnect", lastError: "invalid_grant" });
    const work = (await engine.listAccounts()).find((a) => a.id === "acc-work")!;
    expect(work).toMatchObject({ syncState: "reconnect", lastError: "invalid_grant" });
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "sync_status", accountId: "acc-work", state: "reconnect" }),
    );
  });

  it("counts the Outbox and lists queued sends with their state", async () => {
    const { engine } = setup();
    expect((await engine.counts()).outbox).toBe(0);
    const id = engine.queueOutbox({
      accountId: "acc-gmail",
      subject: "Pilot",
      to: ["ana@acme.test"],
    });
    expect((await engine.counts()).outbox).toBe(1);
    const page = await engine.listThreads({ view: { kind: "outbox" }, limit: 10 });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ threadId: id, outboxState: "pending", subject: "Pilot" });
    engine.drainOutbox();
    expect((await engine.counts()).outbox).toBe(0);
    expect((await engine.listThreads({ view: { kind: "outbox" }, limit: 10 })).rows).toHaveLength(
      0,
    );
  });

  it("carries the follow-up time and lists due follow-ups", async () => {
    const { engine, advance } = setup();
    const [first] = (await engine.listThreads({ view: inbox, limit: 1 })).rows;
    const due = FIXTURE_NOW_MS + 3_600_000;
    await engine.setFollowUp!(first!.threadId, due);
    expect((await engine.getThread(first!.threadId))!.row.followUpAtMs).toBe(due);
    expect(
      (await engine.listThreads({ view: { kind: "followups" }, limit: 10 })).rows,
    ).toHaveLength(0);
    advance(3_600_001);
    const rows = (await engine.listThreads({ view: { kind: "followups" }, limit: 10 })).rows;
    expect(rows.map((r) => r.threadId)).toEqual([first!.threadId]);
    await engine.setFollowUp!(first!.threadId, null);
    expect((await engine.getThread(first!.threadId))!.row.followUpAtMs).toBeNull();
  });

  it("says why a thread came back: the snooze ran out, or a reply woke it", async () => {
    const { engine } = setup();
    const [a, b] = (await engine.listThreads({ view: inbox, limit: 2 })).rows;
    await engine.applyOp({
      kind: "snooze",
      threadIds: [a!.threadId, b!.threadId],
      args: { untilMs: FIXTURE_NOW_MS + 1 },
    });
    await engine.applyOp({ kind: "unsnooze", threadIds: [a!.threadId] });
    expect((await engine.getThread(a!.threadId))!.row.returnReason).toBe("snooze");
    engine.deliver(msg("x@acme.test", { threadId: b!.threadId, accountId: b!.accountId }));
    await engine.applyOp({ kind: "unsnooze", threadIds: [b!.threadId] });
    expect((await engine.getThread(b!.threadId))!.row.returnReason).toBe("reply");
  });

  it("returns undoUntilMs from the engine clock and names the thread on failed ops", async () => {
    const { engine, events, advance } = setup();
    const [first] = (await engine.listThreads({ view: inbox, limit: 1 })).rows;
    engine.failNextOps(1);
    const res = await engine.applyOp({ kind: "done", threadIds: [first!.threadId] });
    expect(res.undoUntilMs).toBe(FIXTURE_NOW_MS + 8000);
    advance(9000);
    engine.flush();
    const [failed] = await engine.listFailedOps();
    expect(failed!.subject).toBe(first!.subject);
    const ev = events.find((e) => e.kind === "op_failed");
    expect(ev && ev.kind === "op_failed" && ev.op.threadIds).toEqual([first!.threadId]);
  });
});

describe("fixture engine: lab scenarios", () => {
  it("outbox: one queued send", async () => {
    const { engine } = setup({ scenario: ["outbox"] });
    expect((await engine.counts()).outbox).toBe(1);
  });

  it("offline, reconnect, error and first sync set account states", async () => {
    const off = setup({ scenario: ["offline"] }).engine;
    expect((await off.listAccounts()).every((a) => a.syncState === "offline")).toBe(true);
    const re = setup({ scenario: ["reconnect"] }).engine;
    expect((await re.listAccounts()).filter((a) => a.syncState === "reconnect")).toHaveLength(1);
    const err = setup({ scenario: ["error"] }).engine;
    const bad = (await err.listAccounts()).filter((a) => a.syncState === "error");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.lastError).toBeTruthy();
    const first = setup({ scenario: ["firstSync"] }).engine;
    expect((await first.listAccounts()).every((a) => a.syncState === "first_sync")).toBe(true);
    expect(await setup({ scenario: ["noAccount"] }).engine.listAccounts()).toEqual([]);
  });

  it("failed: two failed ops with subjects", async () => {
    const { engine } = setup({ scenario: ["failed"] });
    const failed = await engine.listFailedOps();
    expect(failed).toHaveLength(2);
    for (const op of failed) {
      expect(op.subject).toBeTruthy();
      expect(op.lastError).toBeTruthy();
    }
  });

  it("away: snoozes that came due before launch", async () => {
    const { engine } = setup({ scenario: ["away"] });
    const rows = (await engine.listThreads({ view: { kind: "snoozed" }, limit: 50 })).rows;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => (r.snoozedUntilMs ?? Infinity) <= FIXTURE_NOW_MS)).toBe(true);
  });

  it("followups: one due follow-up", async () => {
    const { engine } = setup({ scenario: ["followups"] });
    expect(
      (await engine.listThreads({ view: { kind: "followups" }, limit: 10 })).rows,
    ).toHaveLength(1);
  });

  it("bodyFetch and bodyOffline: the newest Personal thread waits for its body", async () => {
    for (const [scenario, state] of [
      ["bodyFetch", "text_only"],
      ["bodyOffline", "none"],
    ] as const) {
      const { engine } = setup({ scenario: [scenario] });
      const [first] = (
        await engine.listThreads({ view: inbox, tab: { kind: "personal" }, limit: 1 })
      ).rows;
      const thread = await engine.getThread(first!.threadId);
      expect(thread!.messages.at(-1)!.bodyState).toBe(state);
      if (scenario === "bodyOffline") {
        const acc = (await engine.listAccounts()).find((a) => a.id === first!.accountId);
        expect(acc!.syncState).toBe("offline");
      }
    }
  });

  it("counts include the custom tab view keys", async () => {
    const { engine } = setup({ classify: CLASSIFY });
    engine.deliver(msg("dana@northzone.vc"));
    const c = await engine.counts();
    expect(c.byViewKey[mailViewKey(inbox, { kind: "custom", customTabId: "ct-investors" })]).toBe(
      1,
    );
    const rows = (
      await engine.listThreads({
        view: inbox,
        tab: { kind: "custom", customTabId: "ct-investors" },
        limit: 10,
      })
    ).rows;
    expect(rows).toHaveLength(1);
  });
});
