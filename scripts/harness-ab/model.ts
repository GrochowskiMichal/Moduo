// Tasks, arms, the run plan and the row each run writes (scripts/harness-ab/README.md).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  type ArmLike,
  type Refusal,
  refuseArm,
  RefusedError,
  refuseSource,
  refuseTask,
} from "./safety";

export const RIG_DIR = path.dirname(new URL(import.meta.url).pathname);
export const TASKS_DIR = path.join(RIG_DIR, "tasks");
export const ARMS_DIR = path.join(RIG_DIR, "arms");

/** One command run outside the agent, in the workspace, after it finishes. */
export type Check = {
  name: string;
  run: string;
  /** "fail" when the task is passed by the check still failing (the impossible spec). */
  expect?: "pass" | "fail";
};

export type Task = {
  id: string;
  title: string;
  /** Where it comes from: an escape folder, a PR, or "fixture". */
  source: { pr?: number; escape?: string; note?: string };
  /** The commit the workspace is cloned at (a fix's parent). */
  base: string;
  /** The commit the oracle files come from (the fix); check-tasks expects the checks to pass there. */
  fix?: string;
  /** What the agent is told: the bug as a person would report it, never the fix. */
  prompt: string;
  /** "fix": the oracle checks pass. "defect-report": the agent stops with a defect report, no test edits. */
  expect: "fix" | "defect-report";
  /** Run the agent in the frozen-tests phase (lane.sh --implement, HV-18). */
  implement?: boolean;
  /** false skips `bun install` (a fixture that needs no dependencies). */
  install?: boolean;
  /** A folder next to the task file copied into the workspace before the agent starts. */
  fixtures?: string;
  /** Paths deleted from the workspace before the agent starts: an answer key a later base contains. */
  hide?: string[];
  oracle: {
    /** Files copied from `fix` into the workspace after the agent finishes (the hidden tests). */
    files?: string[];
    checks: Check[];
    env?: Record<string, string>;
  };
  /** The verify command run after the oracle; null skips it. Defaults to the set's verify. */
  verify?: string | null;
};

export type TaskSet = {
  name: string;
  dir: string;
  description: string;
  /** Default verify command for the set's tasks. */
  verify: string | null;
  tasks: Task[];
};

export type Arm = ArmLike & {
  description: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Claude setting sources loaded in the workspace (default "project": the harness at that commit). */
  settingSources?: string;
};

export type PlannedRun = {
  runId: string;
  set: string;
  task: Task;
  arm: Arm;
  repeat: number;
};

export type Outcome = "planned" | "pass" | "fail" | "error";

/** One JSON row per run (one line in the results file). Bump `schema` when a field changes meaning. */
export type Row = {
  schema: 1;
  runId: string;
  batch: string;
  set: string;
  task: string;
  arm: string;
  repeat: number;
  base: string;
  rigSha: string;
  model: string;
  effort: string | null;
  expect: Task["expect"];
  startedAt: string;
  outcome: Outcome;
  error?: string;
  ms?: { setup: number; agent: number; oracle: number; verify: number };
  agent?: AgentSummary & { exit: number | null };
  diff?: { files: number; insertions: number; deletions: number; testEdits: string[] };
  oracle?: {
    ok: boolean;
    checks: { name: string; expect: "pass" | "fail"; exit: number | null }[];
  };
  verify?: { cmd: string; exit: number | null; ok: boolean } | null;
  safety?: { mcpServers: string[]; remotes: string[]; hosts: string[] };
  artifacts?: string;
};

export type AgentSummary = {
  model: string | null;
  mcpServers: string[];
  subtype: string | null;
  isError: boolean;
  turns: number | null;
  costUsd: number | null;
  durationMs: number | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
  tools: Record<string, number>;
  /** Bash calls that ran tests: how many tries the agent took. */
  testRuns: number;
  defectReport: boolean;
  result: string;
};

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

export function loadSet(name: string, root = TASKS_DIR): TaskSet {
  const dir = path.join(root, name);
  const meta = path.join(dir, "set.json");
  if (!existsSync(meta)) throw new Error(`no task set "${name}" (${meta} is missing)`);
  const set = readJson<{ description: string; verify?: string | null }>(meta);
  const tasks = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "set.json")
    .sort()
    .map((f) => {
      const task = readJson<Task>(path.join(dir, f));
      if (`${task.id}.json` !== f)
        throw new Error(`${f}: id "${task.id}" must match the file name`);
      return task;
    });
  return { name, dir, description: set.description, verify: set.verify ?? null, tasks };
}

export function loadArm(id: string, root = ARMS_DIR): Arm {
  const file = path.join(root, `${id}.json`);
  if (!existsSync(file)) throw new Error(`no arm "${id}" (${file} is missing)`);
  const arm = readJson<Arm>(file);
  if (arm.id !== id) throw new Error(`${file}: id "${arm.id}" must match the file name`);
  return arm;
}

export const listDir = (dir: string, json: boolean) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => (json ? f.endsWith(".json") : !f.includes(".")))
        .map((f) => f.replace(/\.json$/, ""))
        .sort()
    : [];

/** Structural checks the JSON can't express: one message per problem. */
export function taskProblems(task: Task): string[] {
  const out: string[] = [];
  const sha = /^[0-9a-f]{7,40}$/;
  if (!sha.test(task.base)) out.push(`${task.id}: base must be a commit SHA`);
  if (task.fix && !sha.test(task.fix)) out.push(`${task.id}: fix must be a commit SHA`);
  if ((task.oracle.files?.length ?? 0) > 0 && !task.fix)
    out.push(`${task.id}: oracle files need a fix commit to come from`);
  if (task.oracle.checks.length === 0) out.push(`${task.id}: needs at least one oracle check`);
  if (task.expect === "defect-report" && !task.implement)
    out.push(`${task.id}: a defect-report task runs in the frozen-tests phase (implement: true)`);
  return out;
}

/**
 * Expand set × arms × repeats into runs, after every refusal check. Throws RefusedError when any
 * task, arm or the source points at the shared stack, production or a remote.
 */
export function plan(opts: {
  set: TaskSet;
  arms: Arm[];
  repeats: number;
  source: string;
  only?: string[];
  batch: string;
}): PlannedRun[] {
  const tasks = opts.only?.length
    ? opts.set.tasks.filter((t) => opts.only?.includes(t.id))
    : opts.set.tasks;
  const missing = (opts.only ?? []).filter((id) => !opts.set.tasks.some((t) => t.id === id));
  if (missing.length) throw new Error(`no task ${missing.join(", ")} in set ${opts.set.name}`);
  if (opts.arms.length === 0) throw new Error("no arms");
  if (!Number.isInteger(opts.repeats) || opts.repeats < 1) throw new Error("repeats must be ≥ 1");

  const problems = tasks.flatMap(taskProblems);
  if (problems.length) throw new Error(problems.join("\n"));
  const refusals: Refusal[] = [
    ...refuseSource(opts.source),
    ...opts.arms.flatMap(refuseArm),
    ...tasks.flatMap(refuseTask),
  ];
  if (refusals.length) throw new RefusedError(refusals);

  const runs: PlannedRun[] = [];
  for (const task of tasks)
    for (const arm of opts.arms)
      for (let repeat = 1; repeat <= opts.repeats; repeat++)
        runs.push({
          runId: `${opts.batch}-${task.id}-${arm.id}-r${repeat}`,
          set: opts.set.name,
          task,
          arm,
          repeat,
        });
  return runs;
}

export function plannedRow(run: PlannedRun, batch: string, rigSha: string): Row {
  return {
    schema: 1,
    runId: run.runId,
    batch,
    set: run.set,
    task: run.task.id,
    arm: run.arm.id,
    repeat: run.repeat,
    base: run.task.base,
    rigSha,
    model: run.arm.model,
    effort: run.arm.effort ?? null,
    expect: run.task.expect,
    startedAt: new Date().toISOString(),
    outcome: "planned",
  };
}

/** The prompt the agent gets: the arm's framing around the task's report. */
export function agentPrompt(task: Task, arm: Arm) {
  return [arm.promptPrefix, task.prompt, arm.promptSuffix].filter(Boolean).join("\n\n");
}

/** Pass/fail from the oracle, verify and the task's expectation. */
export function judge(r: {
  task: Task;
  agent: AgentSummary;
  oracle: NonNullable<Row["oracle"]>;
  verify: Row["verify"];
  testEdits: string[];
}): Outcome {
  if (!r.oracle.ok) return "fail";
  if (r.verify && !r.verify.ok) return "fail";
  if (r.task.expect === "defect-report")
    return r.agent.defectReport && r.testEdits.length === 0 ? "pass" : "fail";
  return "pass";
}

/** Test paths, as the frozen-tests profile sees them (HV-18). */
export const isTestPath = (file: string) =>
  /\.(test|spec)\.[^/]+$/.test(file) ||
  file.startsWith("supabase/tests/") ||
  file.startsWith("benchmarks/");
