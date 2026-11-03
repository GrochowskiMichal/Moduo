import { describe, expect, it } from "@rstest/core";

import { mailViewKey } from "@/lib/runtime.types.mail-engine";

import { createFakeMailEngine } from "./fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "./fixture";

const inbox = { kind: "unified", role: "inbox" } as const;

function setup() {
  let t = FIXTURE_NOW_MS;
  const engine = createFakeMailEngine({
    fixture: generateFixture({ messages: 3000 }),
    now: () => t,
  });
  return { engine, advance: (ms: number) => (t += ms) };
}

describe("fixture engine", () => {
  it("pages with a keyset cursor, newest first, no gaps or repeats", async () => {
    const { engine } = setup();
    const seen: string[] = [];
    let after = null;
    let prev = Infinity;
    do {
      const page = await engine.listThreads({ view: inbox, after, limit: 50 });
      for (const r of page.rows) {
        expect(r.lastDateMs).toBeLessThanOrEqual(prev);
        prev = r.lastDateMs;
        seen.push(r.threadId);
      }
      after = page.next;
    } while (after);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(100);
  });

  it("done hides the thread; undo inside the window restores exactly one copy", async () => {
    const { engine } = setup();
    const [first] = (await engine.listThreads({ view: inbox, limit: 1 })).rows;
    const { opIds } = await engine.applyOp({ kind: "done", threadIds: [first!.threadId] });
    const after = await engine.listThreads({ view: inbox, limit: 5 });
    expect(after.rows.some((r) => r.threadId === first!.threadId)).toBe(false);
    await engine.undoOp(opIds[0]!);
    const back = await engine.listThreads({ view: inbox, limit: 5 });
    expect(back.rows.filter((r) => r.threadId === first!.threadId)).toHaveLength(1);
  });

  it("undo after the window issues a compensating op", async () => {
    const { engine, advance } = setup();
    const [first] = (await engine.listThreads({ view: inbox, limit: 1 })).rows;
    const { opIds } = await engine.applyOp({ kind: "done", threadIds: [first!.threadId] });
    advance(9000);
    engine.flush();
    await engine.undoOp(opIds[0]!);
    const back = await engine.listThreads({ view: inbox, limit: 5 });
    expect(back.rows.some((r) => r.threadId === first!.threadId)).toBe(true);
  });

  it("a failed op is kept and discard restores the server state", async () => {
    const { engine, advance } = setup();
    const events: string[] = [];
    engine.subscribe((e) => events.push(e.kind));
    const [first] = (await engine.listThreads({ view: inbox, limit: 1 })).rows;
    engine.failNextOps(1);
    await engine.applyOp({ kind: "done", threadIds: [first!.threadId] });
    advance(9000);
    engine.flush();
    const failed = await engine.listFailedOps();
    expect(failed).toHaveLength(1);
    expect(events).toContain("op_failed");
    await engine.discardOp(failed[0]!.opId);
    expect(await engine.listFailedOps()).toHaveLength(0);
    const back = await engine.listThreads({ view: inbox, limit: 5 });
    expect(back.rows.some((r) => r.threadId === first!.threadId)).toBe(true);
  });

  it("counts by view key and badge = unread Personal inbox", async () => {
    const { engine } = setup();
    const c = await engine.counts();
    expect(c.badge).toBe(c.byViewKey[mailViewKey(inbox, { kind: "personal" })] ?? 0);
    expect(c.badge).toBeGreaterThan(0);
  });

  it("a list page over the full 100k fixture is fast", async () => {
    const engine = createFakeMailEngine();
    await engine.listThreads({ view: inbox, limit: 50 });
    const t0 = performance.now();
    await engine.listThreads({ view: inbox, limit: 50 });
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
