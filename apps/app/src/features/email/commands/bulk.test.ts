import { describe, expect, it } from "@rstest/core";

import { createMailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { createBulkCommands, ZERO_AGES } from "./bulk";
import { createMailCommands } from "./triage";

const inbox = { kind: "unified", role: "inbox" } as const;

function setup() {
  const t = FIXTURE_NOW_MS;
  const engine = createFakeMailEngine({
    fixture: generateFixture({ messages: 600 }),
    now: () => t,
  });
  const store = createMailStore({ engine });
  const commands = createMailCommands(store, () => t);
  const bulk = createBulkCommands(store, () => t, commands);
  const rows = async () => (await engine.listThreads({ view: inbox, limit: 1000 })).rows;
  return { store, commands, bulk, rows };
}

describe("bulk triage (AC13)", () => {
  it("bulk done one undo", async () => {
    const { store, commands, bulk, rows } = setup();
    const before = (await rows()).map((r) => r.threadId);
    const picked = before.slice(0, 5);
    await bulk.apply("done", [...picked, picked[0]!]);
    expect(store.getState().undoStack).toHaveLength(1);
    const after = (await rows()).map((r) => r.threadId);
    for (const id of picked) expect(after).not.toContain(id);
    await commands.undo();
    expect((await rows()).map((r) => r.threadId).sort()).toEqual([...before].sort());
  });

  it("get me to zero by age", async () => {
    const { store, bulk, rows } = setup();
    const all = await rows();
    const cutoff = FIXTURE_NOW_MS - ZERO_AGES.week;
    const older = all.filter((r) => r.lastDateMs < cutoff).map((r) => r.threadId);
    const newer = all.filter((r) => r.lastDateMs >= cutoff).map((r) => r.threadId);
    expect(older.length).toBeGreaterThan(0);
    const entry = await bulk.getMeToZero(inbox, null, "week");
    expect(entry?.threadIds.sort()).toEqual([...older].sort());
    expect(store.getState().undoStack).toHaveLength(1);
    expect((await rows()).map((r) => r.threadId).sort()).toEqual([...newer].sort());
  });
});
