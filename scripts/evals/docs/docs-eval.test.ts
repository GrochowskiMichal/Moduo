import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "@rstest/core";

import { loadSet, plan, type Row, taskProblems } from "../../harness-ab/model";
import { refuseTask } from "../../harness-ab/safety";
import { EVAL_DIR, grade, loadQuestions } from "./grade";
import { compare, drift, regrade, score, SET } from "./run";

// The docs eval (specs/harness-v3.md, AC32): 46 questions with keys that accept their own gold answer
// and reject an empty or outdated one, a rig task set generated from them, and a score that can't
// drop below the recorded baseline unnoticed.
const questions = loadQuestions();
const tmp = mkdtempSync(path.join(tmpdir(), "docs-eval-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("questions", () => {
  it("are the 46, numbered E01–E46, with every kind of need", () => {
    expect(questions.map((q) => q.id)).toEqual(
      Array.from({ length: 46 }, (_, i) => `E${String(i + 1).padStart(2, "0")}`),
    );
    expect(new Set(questions.map((q) => q.kind))).toEqual(new Set(["how", "why", "id", "status"]));
  });

  it("include supersession traps and questions the docs don't answer", () => {
    const traps = questions.filter((q) => q.stale?.length);
    expect(traps.length).toBeGreaterThanOrEqual(10);
    for (const q of traps) expect(q.staleAnswer, q.id).toBeTruthy();
    expect(questions.filter((q) => q.abstain).length).toBeGreaterThanOrEqual(1);
  });

  it("have keys whose patterns compile", () => {
    for (const q of questions) {
      expect(q.must.length, q.id).toBeGreaterThan(0);
      for (const p of [...q.must.flat(), ...(q.stale ?? [])])
        expect(() => new RegExp(p, "i")).not.toThrow();
    }
  });

  it.each(questions.map((q) => [q.id, q] as const))(
    "%s: the gold answer passes its key",
    (_, q) => {
      expect(grade(q, q.gold)).toMatchObject({ pass: true, missing: [], stale: [] });
    },
  );

  it.each(questions.map((q) => [q.id, q] as const))(
    "%s: an empty or wrong answer fails",
    (_, q) => {
      expect(grade(q, "").pass).toBe(false);
      expect(grade(q, "I couldn't find anything about this in the repository.").pass).toBe(
        q.abstain === true,
      );
      if (q.staleAnswer) expect(grade(q, q.staleAnswer).pass, "the outdated answer").toBe(false);
    },
  );

  it("ignore markdown and case", () => {
    const q = questions.find((x) => x.id === "E34");
    expect(q && grade(q, q.gold.replace(/cargo/g, "**`CARGO`**")).pass).toBe(true);
  });
});

describe("the rig task set", () => {
  it("is generated from questions.jsonl (bun run eval:docs sync)", () => {
    const d = drift(questions);
    expect(d.write.map(([f]) => f)).toEqual([]);
    expect(d.remove).toEqual([]);
    expect(loadSet(SET).tasks).toHaveLength(46);
  });

  it("passes the rig's checks and plans one run per question", () => {
    const set = loadSet(SET);
    expect(set.tasks.flatMap(taskProblems)).toEqual([]);
    expect(set.tasks.flatMap(refuseTask)).toEqual([]);
    for (const t of set.tasks) {
      expect(t.prompt).not.toMatch(/scripts\/evals|answer key/i);
      expect(t.hide).toContain("scripts/evals/docs");
    }
    const runs = plan({
      set,
      arms: [{ id: "docs", model: "opus", description: "" }],
      repeats: 1,
      source: path.resolve(EVAL_DIR, "../../.."),
      batch: "t",
    });
    expect(runs).toHaveLength(46);
  });
});

describe("grade.ts", () => {
  const cli = (args: string[], env: Record<string, string> = {}) =>
    spawnSync("bun", [path.join(EVAL_DIR, "grade.ts"), ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    }).status;
  const q = questions[0];

  it("exits 0 for a passing answer and 1 for a failing or missing one", () => {
    if (!q) throw new Error("no questions");
    const good = path.join(tmp, "good.md");
    const bad = path.join(tmp, "bad.md");
    writeFileSync(good, q.gold);
    writeFileSync(bad, "no idea");
    expect(cli([q.id, good])).toBe(0);
    expect(cli([q.id], { HARNESS_AB_ANSWER: good })).toBe(0);
    expect(cli([q.id, bad])).toBe(1);
    expect(cli([q.id, path.join(tmp, "missing.md")])).toBe(1);
    expect(cli(["E99", good])).toBe(2);
  });
});

describe("score", () => {
  const row = (task: string, outcome: Row["outcome"], repeat = 1) =>
    ({ task, outcome, repeat }) as Row;

  it("is the pass share of the scored runs, and names errored runs", () => {
    const s = score([
      row("E01", "pass"),
      row("E01", "fail", 2),
      row("E02", "pass"),
      row("E03", "error"),
    ]);
    expect(s).toMatchObject({ pass: 2, runs: 3, errors: ["E03"] });
    expect(s.score).toBeCloseTo(2 / 3);
    expect(s.questions).toEqual({ E01: 0.5, E02: 1 });
  });

  it("holds at the baseline, drops below it, and names lost and gained questions", () => {
    const baseline = score([row("E01", "pass"), row("E02", "fail")]);
    const same = score([row("E01", "fail"), row("E02", "pass")]);
    expect(compare(same, baseline)).toEqual({ ok: true, lost: ["E01"], gained: ["E02"] });
    const worse = score([row("E01", "fail"), row("E02", "fail")]);
    expect(compare(worse, baseline).ok).toBe(false);
    const errored = score([row("E01", "pass"), row("E02", "error")]);
    expect(compare(errored, baseline).ok).toBe(false);
  });

  it("regrades stored answers with the current keys and leaves errored runs alone", () => {
    const q = questions.find((x) => x.staleAnswer);
    if (!q) throw new Error("no trap");
    const rows = [row(q.id, "fail"), row(q.id, "pass", 2), row(q.id, "error", 3)];
    const answers = [q.gold, q.staleAnswer ?? "", q.gold];
    const out = regrade(rows, (r) => answers[r.repeat - 1] ?? null);
    expect(out.map((r) => r.outcome)).toEqual(["pass", "fail", "error"]);
  });

  it("has a recorded baseline over all 46 questions", () => {
    const b = JSON.parse(readFileSync(path.join(EVAL_DIR, "baseline.json"), "utf8"));
    expect(Object.keys(b.questions)).toHaveLength(46);
    expect(b.errors).toEqual([]);
    expect(b.score).toBeGreaterThan(0);
  });
});
