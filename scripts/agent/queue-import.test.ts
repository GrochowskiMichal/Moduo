import type { Rpc } from "./moduo-sync";
import {
  applyPlan,
  findBlockTask,
  type FoundTask,
  type ImportBlock,
  type Lookup,
  parseLedger,
  planImport,
  retryingReads,
  specLine,
  type Step,
} from "./queue-import";

// specs/harness-v3.md AC12: the import that puts the blocks into Moduo is
// idempotent (a re-run updates, never duplicates), never reopens a closed
// task, and mirrors each spec dependency as a "blocks" edge.

const LEDGER = `# Build order

**Focus:** something

## Harness v3 · [\`specs/harness-v3.md\`](./harness-v3.md)

- [x] **HV-1 — Rails** · deps: —
- [ ] **HV-8 — Moduo is the queue** · deps: HV-7
- [~] **HV-9 — Security pass** · deps: — · _built_
- [ ] ⏸ **TS-4 — Chat collections** · paused · deps: TS-3c, ~~SK-C3 ✓~~

## Wave D · _added from an audit_

- [ ] 🔴 **\`/s1 ALPHA\` — Alpha launch plan** · deps: —
- [ ] **DF-15 — Home first-run composition** · deps: —
`;

describe("parseLedger (the migration input)", () => {
  it("reads open and in-progress rows with deps, pause and their section's spec", () => {
    expect(parseLedger(LEDGER)).toEqual([
      {
        id: "HV-8",
        name: "Moduo is the queue",
        spec: "specs/harness-v3.md",
        deps: ["HV-7"],
        paused: false,
      },
      { id: "HV-9", name: "Security pass", spec: "specs/harness-v3.md", deps: [], paused: false },
      {
        id: "TS-4",
        name: "Chat collections",
        spec: "specs/harness-v3.md",
        deps: ["TS-3c"],
        paused: true,
      },
      { id: "DF-15", name: "Home first-run composition", spec: undefined, deps: [], paused: false },
    ]);
  });
});

const row = (handle: string, title: string, extra: Partial<FoundTask> = {}): FoundTask => ({
  handle,
  title,
  status_category: "todo",
  bucket_id: "p-closed",
  section_id: "s-infra",
  tags: ["block"],
  description: "",
  ...extra,
});

describe("findBlockTask", () => {
  it("matches the title rule only, and prefers the one open task beside a done duplicate", () => {
    const rows = [
      row("MOD-1", "HV-10 — Rules by path"),
      row("MOD-2", "HV-1 — Rails", { status_category: "done" }),
      row("MOD-3", "Mentions HV-1 in passing"),
    ];
    expect(findBlockTask(rows, "HV-1")).toMatchObject({ handle: "MOD-2" });
    expect(findBlockTask(rows, "HV-8")).toBe("none");
    expect(
      findBlockTask(
        [row("MOD-4", "HV-8 — A"), row("MOD-5", "HV-8 — B", { status_category: "done" })],
        "HV-8",
      ),
    ).toMatchObject({ handle: "MOD-4" });
    expect(findBlockTask([row("MOD-4", "HV-8 — A"), row("MOD-5", "HV-8 — B")], "HV-8")).toBe(
      "ambiguous",
    );
  });
});

const blocks: ImportBlock[] = [
  { id: "HV-7", name: "GitHub sync", spec: "specs/harness-v3.md", deps: [], fromSpec: true },
  {
    id: "HV-8",
    name: "Moduo is the queue",
    spec: "specs/harness-v3.md",
    deps: ["HV-7"],
    fromSpec: true,
  },
  {
    id: "HV-30",
    name: "Close-out",
    spec: "specs/harness-v3.md",
    deps: ["HV-3", "HV-8"],
    fromSpec: true,
  },
  { id: "HV-2", name: "Built long ago", spec: "specs/harness-v3.md", deps: [], fromSpec: true },
  { id: "HV-9", name: "Security", spec: "specs/harness-v3.md", deps: [], fromSpec: true },
];

function input(found: Map<string, Lookup>) {
  return {
    blocks,
    found,
    history: new Set(["HV-2", "HV-3", "HV-7"]),
    fallbackProject: "p-beta",
    openPrs: new Map([["HV-30", { draft: true }]]),
    descriptions: new Map<string, string>(),
  };
}

describe("planImport", () => {
  const found = new Map<string, Lookup>([
    ["HV-7", row("MOD-590", "HV-7 — GitHub sync", { tags: [], description: "Old notes" })],
    ["HV-8", "none"],
    ["HV-30", "none"],
    ["HV-2", "none"],
    ["HV-3", row("MOD-540", "HV-3 — Skills", { status_category: "done" })],
    ["HV-9", row("MOD-541", "HV-9 — Security", { status_category: "done" })],
  ]);
  const steps = planImport(input(found));
  const kinds = (k: Step["kind"]) => steps.filter((s) => s.kind === k);

  it("updates a found open task: block tag, spec link on top, never its title or status", () => {
    expect(kinds("update")).toEqual([
      {
        kind: "update",
        block: blocks[0],
        task: "MOD-590",
        changes: {
          tags_add: ["block"],
          description: `${specLine("specs/harness-v3.md")}\n\nOld notes`,
        },
      },
    ]);
  });

  it("creates a missing block beside its siblings, in the PR's stage when one is open", () => {
    expect(
      kinds("create").map((s) => s.kind === "create" && [s.block.id, s.placement, s.status]),
    ).toEqual([
      ["HV-8", { project_id: "p-closed", section_id: "s-infra" }, "todo"],
      ["HV-30", { project_id: "p-closed", section_id: "s-infra" }, "Building"],
    ]);
  });

  it("never reopens a closed task and doesn't create a spec block history already names", () => {
    expect(kinds("skip").map((s) => s.kind === "skip" && [s.block.id, s.why])).toEqual([
      ["HV-2", "a commit already names it (built)"],
      ["HV-9", "closed in Moduo"],
    ]);
  });

  it("adds a blocks edge for each dependency that is or becomes open, none to closed ones", () => {
    expect(kinds("edge")).toEqual([
      { kind: "edge", from: "HV-7", to: "HV-8" },
      { kind: "edge", from: "HV-8", to: "HV-30" },
    ]);
  });

  it("a re-run after the first only keeps tasks and re-asserts edges (no duplicates)", () => {
    const after = new Map<string, Lookup>(found);
    after.set(
      "HV-7",
      row("MOD-590", "HV-7 — GitHub sync", {
        description: `${specLine("specs/harness-v3.md")}\n\nOld notes`,
      }),
    );
    after.set(
      "HV-8",
      row("MOD-600", "HV-8 — Moduo is the queue", { description: specLine("specs/harness-v3.md") }),
    );
    after.set(
      "HV-30",
      row("MOD-601", "HV-30 — Close-out", {
        status_category: "in_progress",
        description: specLine("specs/harness-v3.md"),
      }),
    );
    const again = planImport(input(after));
    expect(again.filter((s) => s.kind === "create" || s.kind === "update")).toEqual([]);
    expect(again.filter((s) => s.kind === "keep").map((s) => s.kind === "keep" && s.task)).toEqual([
      "MOD-590",
      "MOD-600",
      "MOD-601",
    ]);
    expect(again.filter((s) => s.kind === "edge")).toHaveLength(2);
  });

  it("falls back to Beta & later and Backlog for a paused block with no siblings", () => {
    const solo = planImport({
      ...input(new Map([["ZZ-1", "none"]])),
      blocks: [{ id: "ZZ-1", name: "Solo", deps: [], paused: true }],
    });
    expect(solo).toEqual([
      {
        kind: "create",
        block: { id: "ZZ-1", name: "Solo", deps: [], paused: true },
        placement: { project_id: "p-beta" },
        status: "backlog",
      },
    ]);
  });
});

describe("applyPlan", () => {
  it("creates through one import run with an imported_from key, then links by handle", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc: Rpc = async (tool, args) => {
      calls.push([tool, args]);
      if (tool === "imports_begin") return { id: "run-1" };
      if (tool === "tasks_create") return { handle: "MOD-600" };
      return {};
    };
    const found = new Map<string, Lookup>([["HV-7", row("MOD-590", "HV-7 — GitHub sync")]]);
    const tally = await applyPlan(
      rpc,
      [
        {
          kind: "create",
          block: blocks[1]!,
          placement: { project_id: "p-closed" },
          status: "todo",
        },
        { kind: "edge", from: "HV-7", to: "HV-8" },
      ],
      found,
      () => {},
    );
    expect(tally).toEqual({ created: 1, updated: 0, edges: 1, failed: 0 });
    expect(calls.map(([t]) => t)).toEqual([
      "imports_begin",
      "tasks_create",
      "links_create",
      "imports_finish",
    ]);
    expect(calls[1]![1]).toMatchObject({
      title: "HV-8 — Moduo is the queue",
      tags: ["block"],
      assignee_id: null,
      imported_from: { source: "moduo-spec", key: "HV-8" },
      import_id: "run-1",
    });
    expect(calls[2]![1]).toEqual({
      source_type: "task",
      source_id: "MOD-590",
      target_type: "task",
      target_id: "MOD-600",
      relation_kind: "blocks",
    });
  });

  it("keeps going past a failed step and counts it", async () => {
    const rpc: Rpc = async (tool) => {
      if (tool === "tasks_update") throw new Error("tasks_update: refused");
      return {};
    };
    const lines: string[] = [];
    const tally = await applyPlan(
      rpc,
      [{ kind: "update", block: blocks[0]!, task: "MOD-590", changes: { tags_add: ["block"] } }],
      new Map(),
      (l) => lines.push(l),
    );
    expect(tally.failed).toBe(1);
    expect(lines[0]).toMatch(/^failed update HV-7: tasks_update: refused/);
  });
});

describe("retryingReads", () => {
  it("retries a timed-out read or edge, never a create", async () => {
    let n = 0;
    const flaky: Rpc = async (tool) => {
      n++;
      if (n < 3) throw new Error("The operation timed out.");
      return tool;
    };
    expect(await retryingReads(flaky)("tasks_search", {})).toBe("tasks_search");
    n = 0;
    await expect(retryingReads(flaky)("tasks_create", {})).rejects.toThrow(/timed out/);
  });
});
