import { describe, expect, it } from "@rstest/core";
import { act, render } from "@testing-library/react";

import { mailViewKey } from "@/lib/runtime.types";

import { createMailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, type FixtureMessage, generateFixture } from "../testing/fixture";
import { DEFAULT_MAIL_BEHAVIOR } from "./behavior";
import { createMailController } from "./controller";
import { MailEngineProvider } from "./mail-engine-provider";

const inbox = { kind: "unified", role: "inbox" } as const;
const HOUR = 3_600_000;

function setup() {
  let t = FIXTURE_NOW_MS;
  const engine = createFakeMailEngine({
    fixture: generateFixture({ messages: 600 }),
    now: () => t,
  });
  const store = createMailStore();
  const notes: string[] = [];
  const dock: number[] = [];
  const deps = {
    now: () => t,
    launchMs: FIXTURE_NOW_MS,
    notify: (title: string, body: string) => notes.push(`${title}: ${body}`),
    setDockBadge: (n: number) => dock.push(n),
    sweepMs: 60_000,
  };
  const inboxIds = async () =>
    (await engine.listThreads({ view: inbox, limit: 500 })).rows.map((r) => r.threadId);
  return { engine, store, notes, dock, deps, inboxIds, advance: (ms: number) => (t += ms) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("MailEngineProvider (AC34)", () => {
  it("app-wide restore: a due snooze returns without /email mounted", async () => {
    const s = setup();
    const [id] = await s.inboxIds();
    await s.engine.applyOp({
      kind: "snooze",
      threadIds: [id!],
      args: { untilMs: FIXTURE_NOW_MS + HOUR },
    });
    const view = render(
      <MailEngineProvider
        engine={s.engine}
        store={s.store}
        deps={{ ...s.deps, behavior: DEFAULT_MAIL_BEHAVIOR }}
      />,
    );
    await act(flush);
    expect(await s.inboxIds()).not.toContain(id);
    s.advance(2 * HOUR);
    const controller = createMailController({
      engine: s.engine,
      store: s.store,
      behavior: DEFAULT_MAIL_BEHAVIOR,
      ...s.deps,
    });
    await controller.sweep();
    expect(await s.inboxIds()).toContain(id);
    expect(s.notes.some((n) => n.startsWith("Snoozed email back"))).toBe(true);
    expect(s.store.getState().awayReturned).toEqual([]);
    view.unmount();
  });

  it("reply unsnoozes: new mail on a snoozed thread brings it back", async () => {
    const s = setup();
    const [id] = await s.inboxIds();
    await s.engine.applyOp({
      kind: "snooze",
      threadIds: [id!],
      args: { untilMs: FIXTURE_NOW_MS + 48 * HOUR },
    });
    render(
      <MailEngineProvider
        engine={s.engine}
        store={s.store}
        deps={{ ...s.deps, behavior: DEFAULT_MAIL_BEHAVIOR }}
      />,
    );
    await act(flush);
    const thread = await s.engine.getThread(id!);
    const reply: FixtureMessage = {
      id: "reply-1",
      accountId: thread!.row.accountId,
      mailboxRole: "inbox",
      threadId: id!,
      messageId: "<reply-1@x>",
      inReplyTo: null,
      fromName: "Anna",
      fromEmail: "anna@example.com",
      to: [],
      subject: `Re: ${thread!.row.subject}`,
      snippet: "Thanks",
      bodyText: "Thanks",
      dateMs: FIXTURE_NOW_MS + HOUR,
      flags: 0,
      listUnsubscribe: null,
      precedence: null,
      autoSubmitted: null,
      attachmentNames: [],
      hasInvite: false,
    };
    s.engine.deliver(reply);
    await act(async () => {
      for (let i = 0; i < 5; i++) await flush();
    });
    expect(await s.inboxIds()).toContain(id);
  });

  it("away announcement: snoozes due while the app was closed are announced once", async () => {
    const s = setup();
    const ids = (await s.inboxIds()).slice(0, 2);
    await s.engine.applyOp({
      kind: "snooze",
      threadIds: ids,
      args: { untilMs: FIXTURE_NOW_MS - HOUR },
    });
    const controller = createMailController({
      engine: s.engine,
      store: s.store,
      behavior: DEFAULT_MAIL_BEHAVIOR,
      ...s.deps,
    });
    await controller.start();
    expect(s.store.getState().awayReturned.sort()).toEqual([...ids].sort());
    expect(s.notes.filter((n) => n.includes("while you were away"))).toHaveLength(1);
    await controller.sweep();
    expect(s.notes.filter((n) => n.includes("while you were away"))).toHaveLength(1);
    controller.stop();
  });
});

describe("MailEngineProvider badge (AC35)", () => {
  it("publishes the badge and Dock count at launch and follows the setting", async () => {
    const s = setup();
    const controller = createMailController({
      engine: s.engine,
      store: s.store,
      behavior: DEFAULT_MAIL_BEHAVIOR,
      ...s.deps,
    });
    await controller.start();
    const counts = await s.engine.counts();
    const personal = counts.byViewKey[mailViewKey(inbox, { kind: "personal" })] ?? 0;
    expect(s.store.getState().badge).toBe(personal);
    expect(s.dock.at(-1)).toBe(personal);
    controller.setBehavior({ ...DEFAULT_MAIL_BEHAVIOR, badge: "off" });
    expect(s.store.getState().badge).toBe(0);
    expect(s.dock.at(-1)).toBe(0);
    controller.stop();
  });

  it("renders nothing and does nothing without an engine (web)", () => {
    const store = createMailStore();
    const view = render(<MailEngineProvider engine={null} store={store} />);
    expect(view.container.innerHTML).toBe("");
    expect(store.getState().engine).toBeNull();
  });
});
