import {
  blockIdOfTask,
  type BlockTask,
  buildQueue,
  parseExecutionBlocks,
  queueFromModuo,
  queueFromSpecs,
  render,
  type SpecBlock,
} from "./queue";

// specs/harness-v3.md AC12 · "frontier from deps + state": given task states,
// spec dependency tables and open PRs, the queue lists exactly the ready
// blocks; Moduo unreachable falls back with a notice.

const SPEC = `# Spec

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| XQ-1 | **Base** ✅ 2026-10-01 | the base | AC1 | — |
| XQ-2 | Second | more | AC2 | XQ-1 |
| 3 | **XQ-3 — Third** *(start now)* | more | AC3 | 2 |
| **XQ-4** | **Fourth** | more | AC4 | XQ-2, XQ-3 + ≥2 desktop releases |

## Out of scope
| XQ-9 | not a block | | | XQ-1 |
`;

const specs = new Map<string, SpecBlock>(
  parseExecutionBlocks(SPEC, "specs/xq.md").map((b) => [b.id, b]),
);

function task(id: string, status: string, extra: Partial<BlockTask> = {}): BlockTask {
  return {
    handle: `MOD-${id.split("-")[1]}`,
    id: `uuid-${id}`,
    title: `${id} — Block ${id}`,
    status,
    tags: ["block"],
    blockId: id,
    project: "Closed alpha",
    ...extra,
  };
}

describe("parseExecutionBlocks", () => {
  it("reads IDs, names, ✅ and dependencies, including row refs, and stops at the next section", () => {
    expect([...specs.values()]).toEqual([
      { id: "XQ-1", name: "Base", spec: "specs/xq.md", deps: [], done: true },
      { id: "XQ-2", name: "Second", spec: "specs/xq.md", deps: ["XQ-1"], done: false },
      { id: "XQ-3", name: "Third", spec: "specs/xq.md", deps: ["XQ-2"], done: false },
      { id: "XQ-4", name: "Fourth", spec: "specs/xq.md", deps: ["XQ-2", "XQ-3"], done: false },
    ]);
  });

  it("ignores a table whose last column isn't dependencies", () => {
    const md =
      "## Execution blocks\n\n| Block | What | Why this order |\n| --- | --- | --- |\n| **PZ-1** | x | after PZ-0 |\n";
    expect(parseExecutionBlocks(md, "s.md")[0]?.deps).toEqual([]);
  });
});

describe("blockIdOfTask", () => {
  it("takes '<ID> — ' at the start or '(<ID>)' at the end", () => {
    expect(blockIdOfTask("HV-8 — Moduo is the queue")).toBe("HV-8");
    expect(blockIdOfTask("Moduo is the queue (HV-8)")).toBe("HV-8");
    expect(blockIdOfTask("Mentions HV-8 somewhere")).toBeNull();
  });
});

describe("queueFromModuo", () => {
  it("lists exactly the ready blocks: open, unclaimed, every dependency closed", () => {
    const q = queueFromModuo(
      [task("XQ-2", "todo"), task("XQ-3", "todo"), task("XQ-4", "todo")],
      specs,
      [],
    );
    expect(q.ready.map((e) => e.id)).toEqual(["XQ-2"]);
    expect(q.waiting.map((e) => [e.id, e.waitingOn])).toEqual([
      ["XQ-3", ["XQ-2"]],
      ["XQ-4", ["XQ-2", "XQ-3"]],
    ]);
  });

  it("an open [ID] PR or an in-progress task is a claim, never ready", () => {
    const q = queueFromModuo(
      [task("XQ-2", "todo"), task("XQ-5", "todo"), task("XQ-6", "in_progress")],
      specs,
      [{ number: 7, title: "[XQ-2] Second", isDraft: true }],
    );
    expect(q.claimed.map((e) => [e.id, e.pr?.number])).toEqual([
      ["XQ-2", 7],
      ["XQ-6", undefined],
    ]);
    expect(q.ready.map((e) => e.id)).toEqual(["XQ-5"]);
  });

  it("a Moduo blocker edge or Backlog makes a block wait; closed dependencies don't", () => {
    const q = queueFromModuo(
      [task("XQ-3", "todo", { blocked: true }), task("XQ-4", "backlog"), task("XQ-8", "todo")],
      specs,
      [],
      new Map([["MOD-3", ["XQ-8"]]]),
    );
    expect(q.ready.map((e) => e.id)).toEqual(["XQ-8"]);
    expect(q.waiting.map((e) => [e.id, e.waitingOn])).toEqual([
      ["XQ-3", ["XQ-8"]],
      ["XQ-4", ["XQ-3", "backlog"]],
    ]);
  });

  it("a dependency merged and awaiting release no longer holds its dependents back", () => {
    const q = queueFromModuo(
      [
        task("XQ-2", "in_progress", { status_name: "Awaiting release" }),
        task("XQ-3", "todo", { blocked: true }),
      ],
      specs,
      [],
      new Map([["MOD-3", ["XQ-2"]]]),
    );
    expect(q.ready.map((e) => e.id)).toEqual(["XQ-3"]);
  });

  it("keeps Moduo's order and counts a duplicate ID once", () => {
    const q = queueFromModuo(
      [task("XQ-7", "todo"), task("XQ-5", "todo"), task("XQ-7", "todo", { handle: "MOD-dup" })],
      specs,
      [],
    );
    expect(q.ready.map((e) => [e.id, e.task])).toEqual([
      ["XQ-7", "MOD-7"],
      ["XQ-5", "MOD-5"],
    ]);
  });
});

describe("queueFromSpecs (Moduo unreachable)", () => {
  it("treats ✅ rows and IDs named in history as done, unless a PR is open", () => {
    const q = queueFromSpecs(
      specs,
      [{ number: 9, title: "[XQ-3] Third" }],
      new Set(["XQ-2", "XQ-3"]),
    );
    expect(q.source).toBe("specs");
    expect(q.claimed.map((e) => e.id)).toEqual(["XQ-3"]);
    expect(q.waiting.map((e) => [e.id, e.waitingOn])).toEqual([["XQ-4", ["XQ-3"]]]);
  });
});

describe("buildQueue", () => {
  const base = { specs: () => new Map(specs), prs: () => [], history: () => new Set<string>() };

  it("falls back with a notice when the connector fails", async () => {
    const out = await buildQueue({
      ...base,
      rpc: async () => {
        throw new Error("projects_list: HTTP 503");
      },
    });
    expect(out.queue.source).toBe("specs");
    expect(out.notice).toMatch(/^Moduo unreachable \(.*HTTP 503\)\. Falling back/);
    expect(out.queue.ready.map((e) => e.id)).toEqual(["XQ-2"]);
  });

  it("falls back with a notice when no key is set", async () => {
    const out = await buildQueue({ ...base, rpc: null });
    expect(out.notice).toMatch(/MODUO_MCP_KEY is not set/);
  });

  it("reads block tasks from one cross-project list per category, and the Focus note", async () => {
    const calls: string[] = [];
    const out = await buildQueue({
      ...base,
      rpc: async (tool, args) => {
        calls.push(`${tool}:${String(args.category ?? "")}`);
        if (tool === "tasks_list" && args.category === "open")
          return [
            {
              handle: "MOD-1",
              id: "a",
              title: "XQ-2 — Second",
              status: "todo",
              tags: ["block"],
              project: "Beta & later",
            },
            {
              handle: "MOD-2",
              id: "b",
              title: "XQ-5 — Fifth",
              status: "todo",
              tags: ["block"],
              project: "Closed alpha",
            },
            { handle: "MOD-3", id: "c", title: "XQ-6 — Not tagged", status: "todo", tags: [] },
          ];
        if (tool === "tasks_list") return [];
        if (tool === "notes_list") return [{ id: "n1", title: "Focus" }];
        if (tool === "notes_get") return { markdown: "Focus\n\nTasks and Chat (DS-\\*)\n\nmore" };
        throw new Error(`unexpected ${tool}`);
      },
    });
    expect(out.notice).toBeUndefined();
    expect(out.focus).toBe("Tasks and Chat (DS-*)\n\nmore");
    // Closed alpha before Beta & later; the untagged task isn't a block.
    expect(out.queue.ready.map((e) => e.id)).toEqual(["XQ-5", "XQ-2"]);
    expect(calls.filter((c) => c.startsWith("tasks_list")).sort()).toEqual([
      "tasks_list:backlog",
      "tasks_list:open",
    ]);
    expect(render(out.queue, out.focus)).toMatch(
      /^Focus: Tasks and Chat \(DS-\*\)\n\nReady \(2\)\n {2}XQ-5 /,
    );
  });
});
