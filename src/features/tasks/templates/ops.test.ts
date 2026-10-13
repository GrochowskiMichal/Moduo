// TV-D15 · a copy goes through the shared store in one step: one `begin`
// (the new project shows at once), one `settle` with every row the server
// made; a refusal or a lost connection takes the optimistic project back.

import { describe, expect, it } from "@rstest/core";

import type { TemplateApplyResult } from "../../../lib/runtime.web.templates";
import { applyTaskTemplate, duplicateProject } from "./ops";

const result = (over: Partial<TemplateApplyResult> = {}): TemplateApplyResult => ({
  buckets: [{ id: "np" } as never],
  statuses: [],
  sections: [],
  tasks: [{ id: "t1" } as never, { id: "t2" } as never],
  tagLinks: [],
  relations: [],
  ...over,
});

function fakeStore(opts: { offline?: boolean } = {}) {
  const log: string[] = [];
  const begun: unknown[][] = [];
  const settled: unknown[] = [];
  const store = {
    isOffline: () => Boolean(opts.offline),
    wentOffline: () => log.push("offline"),
    getSnapshot: () => ({
      bundle: {
        buckets: [{ position: "a0", deletedAt: null }],
        archivedBuckets: [],
        tags: [{ id: "g-known" }],
      },
    }),
    syncNow: async () => {
      log.push("sync");
    },
    begin: (changes: unknown[]) => {
      begun.push(changes);
      log.push("begin");
      return {
        settle: (answers: unknown) => {
          settled.push(answers);
          log.push("settle");
        },
        fail: () => log.push("fail"),
        add: () => undefined,
        op: 1,
      };
    },
  };
  return { store: store as never, log, begun, settled };
}

const runtimeWith = (tasks: Record<string, unknown>) => ({ tasks }) as never;

describe("copies through the shared store (TV-D15)", () => {
  it("a duplicate shows the project at once, then settles every row in one step", async () => {
    const { store, log, begun, settled } = fakeStore();
    const calls: unknown[] = [];
    const runtime = runtimeWith({
      duplicateProject: async (input: unknown) => {
        calls.push(input);
        return result();
      },
    });
    const outcome = await duplicateProject(
      { runtime, store, workspaceId: "ws", userId: "u1" },
      "p1",
      { id: "np", name: "Season 2", startsOn: "2027-01-04", areaId: null, keepPeople: true },
    );
    expect(log).toEqual(["begin", "settle"]);
    expect(begun[0]).toEqual([
      {
        table: "buckets",
        insert: expect.objectContaining({ id: "np", name: "Season 2", isSystem: false }),
      },
    ]);
    expect(settled).toEqual([result()]);
    expect(calls).toEqual([
      {
        workspaceId: "ws",
        projectId: "p1",
        id: "np",
        name: "Season 2",
        startsOn: "2027-01-04",
        areaId: null,
        keepPeople: true,
      },
    ]);
    expect(outcome).toMatchObject({ ok: true, projectId: "np", taskIds: ["t1", "t2"] });
  });

  it("a refusal takes the project back and says why", async () => {
    const { store, log } = fakeStore();
    const runtime = runtimeWith({
      duplicateProject: async () => {
        throw new Error("That project isn't in this workspace.");
      },
    });
    const outcome = await duplicateProject(
      { runtime, store, workspaceId: "ws", userId: "u1" },
      "p1",
      { id: "np", name: "X", startsOn: null, areaId: null, keepPeople: true },
    );
    expect(log).toEqual(["begin", "fail"]);
    expect(outcome).toEqual({
      ok: false,
      offline: false,
      message: "That project isn't in this workspace.",
    });
  });

  it("offline, nothing is sent", async () => {
    const { store, log } = fakeStore({ offline: true });
    let sent = false;
    const runtime = runtimeWith({
      applyTaskTemplate: async () => {
        sent = true;
        return result();
      },
    });
    const outcome = await applyTaskTemplate(
      { runtime, store, workspaceId: "ws", userId: "u1" },
      "tt",
      { id: "t1", date: null },
    );
    expect(sent).toBe(false);
    expect(log).toEqual([]);
    expect(outcome).toMatchObject({ ok: false, offline: true });
  });

  it("a lost connection marks the store offline", async () => {
    const { store, log } = fakeStore();
    const runtime = runtimeWith({
      applyTaskTemplate: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const outcome = await applyTaskTemplate(
      { runtime, store, workspaceId: "ws", userId: "u1" },
      "tt",
      { id: "t1", date: "2027-01-01" },
    );
    expect(log).toEqual(["begin", "fail", "offline"]);
    expect(outcome).toMatchObject({ ok: false, offline: true });
  });

  it("a tag the apply made (not in the store yet) is read right after", async () => {
    const { store, log } = fakeStore();
    const runtime = runtimeWith({
      applyTaskTemplate: async () =>
        result({
          buckets: [],
          tagLinks: [{ tagId: "g-known" } as never, { tagId: "g-new" } as never],
        }),
    });
    await applyTaskTemplate({ runtime, store, workspaceId: "ws", userId: "u1" }, "tt", {
      id: "t1",
      date: null,
    });
    expect(log).toEqual(["begin", "settle", "sync"]);
  });

  it("a runtime without templates offers none", async () => {
    const { store } = fakeStore();
    const outcome = await duplicateProject(
      { runtime: runtimeWith({}), store, workspaceId: "ws", userId: "u1" },
      "p1",
      { id: "np", name: "X", startsOn: null, areaId: null, keepPeople: true },
    );
    expect(outcome.ok).toBe(false);
  });
});
