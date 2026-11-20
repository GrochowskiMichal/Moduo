// AC20: ⌘A picks every thread in the tab, not just the loaded window.
import { describe, expect, it } from "@rstest/core";

import type { MailView } from "@/lib/runtime.types.mail-engine";

import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { allThreadIds } from "./selection";
import { MAIL_PAGE } from "./use-thread-window";

const INBOX: MailView = { kind: "unified", role: "inbox" };

async function everyRow(
  engine: ReturnType<typeof createFakeMailEngine>,
  view: MailView,
  tab: { kind: "personal" } | null,
) {
  const page = await engine.listThreads({ view, tab, limit: 100_000 });
  return page.rows;
}

describe("select all (AC20)", () => {
  it("select all takes the full id list", async () => {
    const engine = createFakeMailEngine({
      fixture: generateFixture({ messages: 3000 }),
      now: () => FIXTURE_NOW_MS,
    });
    const tab = { kind: "personal" } as const;
    const rows = await everyRow(engine, INBOX, tab);
    // More threads than the list's first window loads.
    expect(rows.length).toBeGreaterThan(MAIL_PAGE);

    const ids = await allThreadIds(engine, { view: INBOX, tab, accountId: null }, 50);
    expect(ids).toEqual(rows.map((r) => r.threadId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps to the rail's account scope", async () => {
    const engine = createFakeMailEngine({
      fixture: generateFixture({ messages: 600 }),
      now: () => FIXTURE_NOW_MS,
    });
    const [account] = await engine.listAccounts();
    const rows = await everyRow(engine, INBOX, { kind: "personal" });
    const ids = await allThreadIds(
      engine,
      { view: INBOX, tab: { kind: "personal" }, accountId: account!.id },
      40,
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(rows.filter((r) => r.accountId === account!.id).map((r) => r.threadId));
  });
});
