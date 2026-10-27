import type { Rpc } from "./moduo-sync";
import {
  assertPublishable,
  compute,
  type Facts,
  firstPass,
  followUps,
  isFixPr,
  median,
  noteTitle,
  PARENT_TITLE,
  type Pr,
  ratchetDrift,
  renderNote,
  reverts,
  type Run,
  type Session,
  sharedBranchRuns,
  skillCalls,
  usageByBlock,
  weekWindow,
  writeNote,
} from "./numbers";
import { parseBatch } from "./numbers-sources";

// specs/harness-v3.md AC34 · "numbers from fixture PRs and CI runs": each weekly metric is
// computed from fixture PRs, CI runs, git facts and Entire metadata, and the note is written
// (or rewritten) through the connector.

const W = weekWindow(new Date("2026-10-26T09:00:00Z"));

let n = 100;
function pr(p: Partial<Pr> & { mergedAt?: string | null }): Pr {
  n++;
  return {
    number: n,
    title: `Change ${n}`,
    url: `https://github.com/o/r/pull/${n}`,
    state: p.mergedAt === null ? "OPEN" : "MERGED",
    baseRefName: "mike",
    headRefName: `t/mike/change-${n}`,
    createdAt: "2026-10-20T08:00:00Z",
    mergedAt: "2026-10-20T12:00:00Z",
    labels: ["tier-1"],
    files: [],
    ...p,
  };
}

function run(p: Partial<Run>): Run {
  return {
    name: "secret-scan",
    event: "pull_request",
    headBranch: "t/mike/x",
    status: "completed",
    conclusion: "success",
    runAttempt: 1,
    createdAt: "2026-10-20T09:00:00Z",
    ...p,
  };
}

function session(p: Partial<Session>): Session {
  return {
    checkpointId: "c1",
    sessionId: "s1",
    createdAt: "2026-10-21T10:00:00Z",
    branch: "t/mike/x",
    inputTokens: 10,
    cacheCreationTokens: 90,
    cacheReadTokens: 1000,
    outputTokens: 50,
    apiCalls: 2,
    skills: [],
    ...p,
  };
}

describe("weekWindow", () => {
  it("is the last full Monday–Sunday UTC week, also when run on a Monday", () => {
    expect(W.start.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(W.end.toISOString()).toBe("2026-10-26T00:00:00.000Z");
    const sunday = weekWindow(new Date("2026-10-25T23:59:00Z"));
    expect(sunday.start.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  it("takes a Monday by name and refuses any other day", () => {
    expect(weekWindow(new Date(), "2026-10-12").end.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(() => weekWindow(new Date(), "2026-10-13")).toThrow(/Monday/);
    expect(() => weekWindow(new Date(), "last week")).toThrow(/YYYY-MM-DD/);
  });
});

describe("first-pass CI rate", () => {
  const green = pr({ headRefName: "t/mike/green" });
  const failed = pr({ headRefName: "t/mike/red" });
  const rerun = pr({ headRefName: "t/mike/rerun" });
  const bare = pr({ headRefName: "t/mike/bare" });
  const sync = pr({ headRefName: "mike", baseRefName: "develop" });
  const lastWeek = pr({ headRefName: "t/mike/old", mergedAt: "2026-10-18T12:00:00Z" });
  const runs = [
    run({ headBranch: "t/mike/green" }),
    run({ headBranch: "t/mike/green", name: "pr-tier", conclusion: "failure" }), // not a gate
    run({ headBranch: "t/mike/green", conclusion: "cancelled" }),
    run({ headBranch: "t/mike/green", conclusion: "failure", createdAt: "2026-10-21T09:00:00Z" }), // after merge
    run({ headBranch: "t/mike/red", conclusion: "failure" }),
    run({ headBranch: "t/mike/red" }),
    run({ headBranch: "t/mike/rerun", runAttempt: 2 }),
    run({ headBranch: "mike", conclusion: "failure" }),
  ];

  it("counts merged task PRs whose gate runs never went red, and the ones with no gate run", () => {
    const fp = firstPass([green, failed, rerun, bare, sync, lastWeek], runs, W);
    expect(fp).toEqual({
      measured: 3,
      passed: 1,
      unmeasured: 1,
      red: [
        { number: failed.number, title: failed.title },
        { number: rerun.number, title: rerun.title },
      ],
    });
  });

  it("counts red checks runs on the shared branches' pushes", () => {
    const pushes = [
      run({ name: "checks", event: "push", headBranch: "develop" }),
      run({ name: "checks", event: "push", headBranch: "mike", conclusion: "failure" }),
      run({ name: "checks", event: "push", headBranch: "maciej", runAttempt: 3 }),
      run({ name: "checks", event: "push", headBranch: "mike", conclusion: "cancelled" }),
      run({ name: "checks", event: "push", headBranch: "t/mike/x", conclusion: "failure" }),
      run({ name: "checks", event: "push", headBranch: "mike", createdAt: "2026-10-26T01:00:00Z" }),
    ];
    expect(sharedBranchRuns(pushes, W)).toEqual({ runs: 3, red: 2 });
  });
});

describe("follow-up fixes within 7 days", () => {
  it("pairs a fix with the latest task PR in the 7 days before it that changed the same code", () => {
    const older = pr({ files: ["apps/app/src/a.ts"], mergedAt: "2026-10-14T10:00:00Z" });
    const original = pr({
      files: ["apps/app/src/a.ts", "docs/x.md"],
      mergedAt: "2026-10-18T10:00:00Z",
    });
    const fix = pr({
      title: "Fix the a.ts race",
      files: ["apps/app/src/a.ts"],
      mergedAt: "2026-10-20T10:00:00Z",
    });
    const docsOnly = pr({
      title: "Fix a typo",
      files: ["docs/x.md", "bun.lock"],
      mergedAt: "2026-10-21T10:00:00Z",
    });
    const unrelated = pr({
      title: "[HV-9] Fix nothing shared",
      files: ["b.ts"],
      mergedAt: "2026-10-21T10:00:00Z",
    });
    const tooLate = pr({
      title: "Fix a.ts again",
      files: ["apps/app/src/a.ts"],
      mergedAt: "2026-10-26T10:00:00Z",
    });
    const out = followUps([older, original, fix, docsOnly, unrelated, tooLate], W);
    expect(out).toEqual([
      {
        fix: { number: fix.number, title: fix.title },
        original: { number: original.number, title: original.title },
        shared: 1,
      },
    ]);
  });

  it("knows a fix by its leading word or its branch, not by the word anywhere", () => {
    expect(isFixPr(pr({ title: "Fix offline Log out" }))).toBe(true);
    expect(isFixPr(pr({ title: "[CV-2] fix the share sheet" }))).toBe(true);
    expect(isFixPr(pr({ title: "Notes: fix the outline" }))).toBe(true);
    expect(isFixPr(pr({ title: "Speed up reads", headRefName: "t/mike/fix-reads" }))).toBe(true);
    expect(isFixPr(pr({ title: "TS-3b: narrow reads; hotspots fixed" }))).toBe(false);
    expect(isFixPr(pr({ title: 'Revert "Fix a"' }))).toBe(false);
  });
});

describe("reverts", () => {
  it("counts a revert once across branches and PRs", () => {
    const revertPr = pr({ title: 'Revert "Add the thing"' });
    const out = reverts(
      ['Revert "Add the thing"', "Add the thing", 'Revert "Other"'],
      [revertPr],
      W,
    );
    expect(out).toEqual(["Add the thing", "Other"]);
  });
});

describe("erosion", () => {
  it("counts ratchet entries added, raised and eased", () => {
    const before = { size: { a: 40000, b: 50000, gone: 33000 }, complexity: { f: 20 } };
    const after = { size: { a: 41000, b: 45000, c: 34000 }, complexity: { f: 20, g: 18 } };
    expect(ratchetDrift(before, after)).toEqual({ added: 2, raised: 1, eased: 2 });
    expect(ratchetDrift(null, after)).toBeNull();
  });
});

describe("usage per block", () => {
  const block = pr({ title: "[HV-21] Weekly numbers", headRefName: "t/mike/hv-21" });
  const plain = pr({ title: "Tidy", headRefName: "t/mike/tidy" });
  const sessions = [
    session({ branch: "t/mike/hv-21", sessionId: "a", skills: ["tdd", "mattpocock-skills:tdd"] }),
    session({
      branch: "t/mike/hv-21",
      sessionId: "a",
      checkpointId: "c2",
      outputTokens: 150,
      skills: ["s2"],
    }),
    session({ branch: "t/mike/hv-21", sessionId: "b" }),
    session({ branch: "t/mike/tidy", sessionId: "c" }),
    session({ branch: "t/mike/secret-plan", sessionId: "d" }),
    session({ branch: "mike", sessionId: "e" }),
    session({ branch: "t/mike/hv-21", sessionId: "z", createdAt: "2026-10-27T10:00:00Z" }),
  ];

  it("groups token usage by block ID, PR or bucket, never naming a branch without a PR", () => {
    const out = usageByBlock(sessions, [block, plain], W);
    expect(out[0]).toEqual({
      key: "HV-21",
      pr: block.number,
      sessions: 2,
      apiCalls: 6,
      outputTokens: 250,
      freshInputTokens: 300,
      cacheReadTokens: 3000,
    });
    expect(out.map((u) => u.key).sort()).toEqual(
      ["#" + plain.number, "(no PR)", "(on a shared branch)", "HV-21"].sort(),
    );
    expect(JSON.stringify(out)).not.toContain("secret-plan");
  });

  it("counts skill calls by bare name inside the window", () => {
    expect(skillCalls(sessions, W)).toEqual({ tdd: 2, s2: 1 });
  });

  it("takes the median", () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(3);
  });
});

function facts(over: Partial<Facts> = {}): Facts {
  return {
    window: W,
    prs: [
      pr({ title: "[HV-21] Weekly numbers", labels: ["tier-1"] }),
      pr({ title: "Tidy | pipes\nand lines", labels: ["tier-2"] }),
    ],
    runs: [],
    sharedSubjects: [],
    escapesAdded: [{ id: "645-1-queue-bypass", foundBy: "HV-15 variant hunt" }],
    escapesTotal: 12,
    ratchetBefore: { size: {}, complexity: {} },
    ratchetAfter: { size: { a: 1 }, complexity: {} },
    knowledgeBefore: 2048,
    knowledgeAfter: 4096,
    reviewThreads: { 7: 2, 8: 0 },
    sessions: null,
    ...over,
  };
}

describe("the note", () => {
  it("renders every number, lists without breaking the tables, and says when Entire is absent", () => {
    const num = compute(facts());
    expect(noteTitle(num)).toBe("Weekly numbers · 2026-10-19 → 2026-10-25");
    const md = renderNote(num);
    for (const line of [
      "| Task PRs merged | 2 (1 through the block flow, 50%) |",
      "| First-pass CI rate | n/a (0 of 0; 2 had no gate run) |",
      "| Follow-up fixes within 7 days | 0 (0% of task PRs) |",
      "| Reverts | 0 |",
      "| Escapes | 1 new (12 in the benchmark) |",
      "| Ratchet drift | 1 new, 0 raised, 0 eased |",
      "| Knowledge files | 2 KB → 4 KB |",
      "| Unresolved AI-review threads, Tier 2 into develop | 2 on 1 PRs |",
      "| Usage | no Entire data on this machine |",
      "- 645-1-queue-bypass (found by HV-15 variant hunt)",
      "Tier mix of task PRs: tier-1 1 · tier-2 1.",
    ])
      expect(md).toContain(line);
  });

  it("refuses a body that looks like it carries a secret", () => {
    expect(() => assertPublishable("all clear, #123")).not.toThrow();
    expect(() => assertPublishable(`token ghp_${"a".repeat(36)}`)).toThrow(/secret/);
    expect(() => assertPublishable("-----BEGIN RSA PRIVATE KEY-----")).toThrow(/secret/);
  });
});

describe("writeNote", () => {
  function fakeRpc(notes: { id: string; title: string }[]) {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc: Rpc = async (tool, args) => {
      calls.push([tool, args]);
      if (tool === "notes_search") return notes.filter((x) => String(args.query).includes(x.title));
      if (tool === "notes_create") return { id: `new-${calls.length}` };
      return { ok: true };
    };
    return { rpc, calls };
  }

  it("creates the parent and the week's note on the first run", async () => {
    const { rpc, calls } = fakeRpc([]);
    const out = await writeNote(rpc, "Weekly numbers · w", "body");
    expect(out.action).toBe("created");
    const creates = calls.filter(([t]) => t === "notes_create").map(([, a]) => a);
    expect(creates[0]).toMatchObject({ title: PARENT_TITLE });
    expect(creates[1]).toEqual({
      title: "Weekly numbers · w",
      markdown: "body",
      parent_id: "new-2",
    });
  });

  it("replaces the week's note on a re-run", async () => {
    const { rpc, calls } = fakeRpc([
      { id: "p", title: PARENT_TITLE },
      { id: "w", title: "Weekly numbers · w" },
    ]);
    expect(await writeNote(rpc, "Weekly numbers · w", "body 2")).toEqual({
      id: "w",
      action: "updated",
    });
    expect(calls.filter(([t]) => t === "notes_create")).toEqual([]);
    expect(calls.find(([t]) => t === "notes_update")?.[1]).toEqual({
      note_id: "w",
      title: "Weekly numbers · w",
      markdown: "body 2",
    });
  });

  it("writes nothing when the body looks like a secret", async () => {
    const { rpc, calls } = fakeRpc([]);
    await expect(writeNote(rpc, "t", `sk-${"x".repeat(30)}`)).rejects.toThrow(/secret/);
    expect(calls).toEqual([]);
  });
});

describe("parseBatch (Entire metadata through git cat-file)", () => {
  it("splits bodies and marks missing objects", () => {
    const out = Buffer.from(
      'abc blob 7\n{"a":1}\nrefs/entire/x:1/metadata.json missing\ndef blob 2\n{}\n',
    );
    expect(parseBatch(out, 3)).toEqual(['{"a":1}', undefined, "{}"]);
  });
});
