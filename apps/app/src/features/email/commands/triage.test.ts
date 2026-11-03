import { describe, expect, it } from "@rstest/core";

import { createMailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { createMailCommands } from "./triage";

const inbox = { kind: "unified", role: "inbox" } as const;

function setup() {
  let t = FIXTURE_NOW_MS;
  const engine = createFakeMailEngine({
    fixture: generateFixture({ messages: 600 }),
    now: () => t,
  });
  const store = createMailStore({ engine });
  const commands = createMailCommands(store, () => t);
  const ids = async () =>
    (await engine.listThreads({ view: inbox, limit: 500 })).rows.map((r) => r.threadId);
  return { engine, store, commands, ids, advance: (ms: number) => (t += ms) };
}

describe("triage commands (AC11)", () => {
  it("applies in the same call and undo inside the window cancels cleanly", async () => {
    const { commands, ids, store } = setup();
    const [first] = await ids();
    await commands.apply({ kind: "done", threadIds: [first!] });
    expect(await ids()).not.toContain(first);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(await commands.undo()).toBe(true);
    const after = await ids();
    expect(after.filter((id) => id === first)).toHaveLength(1);
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it("a reload inside the window keeps the thread hidden", async () => {
    const { commands, ids, engine, advance } = setup();
    const [first] = await ids();
    await commands.apply({ kind: "done", threadIds: [first!] });
    advance(3000);
    engine.flush();
    expect(await ids()).not.toContain(first);
  });

  it("undo after the window issues the compensating op", async () => {
    const { commands, ids, engine, advance } = setup();
    const [first] = await ids();
    await commands.apply({ kind: "done", threadIds: [first!] });
    advance(9000);
    engine.flush();
    expect(await ids()).not.toContain(first);
    await commands.undo();
    expect(await ids()).toContain(first);
  });

  it("failed ops can be retried or discarded, restoring the server's state", async () => {
    const { commands, ids, engine, store, advance } = setup();
    const [first] = await ids();
    engine.failNextOps(1);
    await commands.apply({ kind: "done", threadIds: [first!] });
    advance(9000);
    engine.flush();
    const failed = await engine.listFailedOps();
    expect(failed).toHaveLength(1);
    await commands.discard(failed[0]!.opId);
    expect(store.getState().failedOps).toHaveLength(0);
    expect(await ids()).toContain(first);
  });

  it("dismissing a follow-up removes it and remembers the dismissal", () => {
    const { commands, store } = setup();
    commands.dismissFollowup("t1");
    commands.dismissFollowup("t1");
    expect(store.getState().dismissedFollowups).toEqual(["t1"]);
  });
});
