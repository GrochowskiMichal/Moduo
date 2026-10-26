// The A/B rig (specs/harness-v3.md, HV-20, AC33): a task set × arms × repeats, one JSON row per run.
// Each run: a clone with no remote at the task's commit, `claude -p --output-format stream-json`
// inside srt (scripts/agent/lane.sh) with the network cut to the model API and npm, then the oracle
// and verify run outside the agent, also inside srt. How to add tasks and arms: README.md here.
//
//   bun run ab list
//   bun run ab run --set core --arms control,smoke [--tasks a,b] [--repeats 3] [--dry-run] [--keep] [--no-verify]
//   bun run ab check-tasks --set core [--tasks a,b]     (no model: the oracle fails at base, passes at fix)
//   bun run ab report <results.jsonl>

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  agentPrompt,
  type Arm,
  ARMS_DIR,
  isTestPath,
  judge,
  listDir,
  loadArm,
  loadSet,
  plan,
  plannedRow,
  type PlannedRun,
  RIG_DIR,
  type Row,
  type Task,
  TASKS_DIR,
} from "./model";
import { agentEnv, RefusedError, refuseWorkspace, rigProfile, type SrtProfile } from "./safety";
import { summarize } from "./stream";

const SOURCE = path.resolve(RIG_DIR, "../..");
const OUT = process.env.HARNESS_AB_OUT ?? path.join(SOURCE, ".harness-ab");
const LANE = path.join(SOURCE, "scripts/agent/lane.sh");
const AGENT_TIMEOUT_MS = 45 * 60_000;
const CHECK_TIMEOUT_MS = 20 * 60_000;

type Sh = { status: number | null; stdout: string; stderr: string };

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Sh {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeout,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: (r.stderr ?? "") + (r.error ? String(r.error) : ""),
  };
}

const git = (cwd: string, ...args: string[]) => {
  const r = sh("git", args, { cwd });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout.trim();
};

const timed = <T>(fn: () => T): [T, number] => {
  const t = Date.now();
  const v = fn();
  return [v, Date.now() - t];
};

/** A clone of the local repository at `sha`, with its remote removed: nothing to push to. */
function makeWorkspace(sha: string, dir: string, fixtures?: string) {
  git(SOURCE, "cat-file", "-e", `${sha}^{commit}`);
  git(tmpdir(), "clone", "--quiet", "--shared", "--no-checkout", SOURCE, dir);
  git(dir, "remote", "remove", "origin");
  git(dir, "checkout", "--quiet", "--detach", sha);
  git(dir, "config", "user.name", "harness-ab");
  git(dir, "config", "user.email", "harness-ab@localhost");
  if (fixtures) {
    cpSync(fixtures, dir, { recursive: true });
    git(dir, "add", "--all");
    git(dir, "commit", "--quiet", "--no-verify", "-m", "harness-ab fixtures");
  }
  const remotes = git(dir, "remote").split("\n").filter(Boolean);
  const refused = refuseWorkspace({ dir, source: SOURCE, remotes });
  if (refused.length) throw new RefusedError(refused);
  return { start: git(dir, "rev-parse", "HEAD"), remotes };
}

/** Run a shell command in the workspace inside srt with the rig profile (no stack, prod or remote). */
function sandboxed(
  ws: string,
  profileFile: string,
  cmd: string,
  env: Record<string, string>,
  log: string,
) {
  const r = sh("srt", ["--settings", profileFile, "-c", cmd], {
    cwd: ws,
    env: agentEnv(process.env, env),
    timeout: CHECK_TIMEOUT_MS,
  });
  writeFileSync(log, `$ ${cmd}\n${r.stdout}\n${r.stderr}`);
  return r.status;
}

/** The lane profile turned into the rig profile, with paths resolved for the workspace. */
function writeProfiles(run: PlannedRun, ws: string, dir: string) {
  const lane = JSON.parse(
    readFileSync(path.join(SOURCE, ".claude/sandbox/lane.srt.json"), "utf8"),
  ) as SrtProfile;
  const profile = rigProfile(lane, { source: SOURCE, extraHosts: run.arm.network });
  const laneProfile = path.join(dir, "rig.srt.json");
  writeFileSync(laneProfile, JSON.stringify(profile, null, 2));
  // The same profile resolved against the workspace, for the commands the rig runs itself.
  const abs = (p: string) =>
    p.startsWith("/") || p.startsWith("~") ? p : p === "." ? ws : path.join(ws, p);
  const gitdir = path.join(ws, ".git");
  const resolved = {
    ...profile,
    $comment: undefined,
    filesystem: {
      denyRead: profile.filesystem.denyRead.map(abs),
      allowWrite: [...profile.filesystem.allowWrite.map(abs), gitdir],
      denyWrite: [...profile.filesystem.denyWrite.map(abs), `${gitdir}/hooks`, `${gitdir}/config`],
    },
  };
  const checkProfile = path.join(dir, "check.srt.json");
  writeFileSync(checkProfile, JSON.stringify(resolved, null, 2));
  const laneSettings = JSON.parse(
    readFileSync(path.join(SOURCE, ".claude/settings.lane.json"), "utf8"),
  );
  const settings = path.join(dir, "claude.settings.json");
  writeFileSync(settings, JSON.stringify(merge(laneSettings, run.arm.settings ?? {}), null, 2));
  return { laneProfile, checkProfile, settings, hosts: profile.network.allowedDomains };
}

function merge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    if (Array.isArray(prev) && Array.isArray(v)) out[k] = [...prev, ...v];
    else if (prev && v && typeof prev === "object" && typeof v === "object")
      out[k] = merge(prev as Record<string, unknown>, v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

/** The claude arguments after the prompt (lane.sh adds -p, bypass and --settings). */
export function claudeArgs(arm: Arm) {
  return [
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--model",
    arm.model,
    ...(arm.effort ? ["--effort", arm.effort] : []),
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--setting-sources",
    arm.settingSources ?? "project",
    ...(arm.appendSystemPrompt ? ["--append-system-prompt", arm.appendSystemPrompt] : []),
    ...(arm.args ?? []),
  ];
}

function diffStats(ws: string, start: string) {
  git(ws, "add", "--all");
  const numstat = git(ws, "diff", "--cached", "--numstat", start);
  let insertions = 0;
  let deletions = 0;
  const files: string[] = [];
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [ins, del, file] = line.split("\t");
    insertions += Number(ins) || 0;
    deletions += Number(del) || 0;
    if (file) files.push(file);
  }
  return {
    files: files.length,
    insertions,
    deletions,
    testEdits: files.filter(isTestPath),
    patch: git(ws, "diff", "--cached", start),
  };
}

function oracle(task: Task, ws: string, profile: string, dir: string) {
  for (const file of task.oracle.files ?? []) {
    mkdirSync(path.dirname(path.join(ws, file)), { recursive: true });
    writeFileSync(path.join(ws, file), git(SOURCE, "show", `${task.fix}:${file}`) + "\n");
  }
  const checks = task.oracle.checks.map((c, i) => {
    const exit = sandboxed(
      ws,
      profile,
      c.run,
      task.oracle.env ?? {},
      path.join(dir, `oracle-${i + 1}.log`),
    );
    return { name: c.name, expect: c.expect ?? "pass", exit };
  });
  const ok = checks.every((c) =>
    c.expect === "pass" ? c.exit === 0 : c.exit !== 0 && c.exit !== null,
  );
  return { ok, checks };
}

function install(task: Task, ws: string, profile: string, dir: string) {
  if (task.install === false || !existsSync(path.join(ws, "package.json"))) return 0;
  return sandboxed(ws, profile, "bun install --frozen-lockfile", {}, path.join(dir, "install.log"));
}

function execute(
  run: PlannedRun,
  opts: {
    batch: string;
    rigSha: string;
    keep: boolean;
    verify: boolean;
    verifyDefault: string | null;
    setDir: string;
  },
): Row {
  const row = plannedRow(run, opts.batch, opts.rigSha);
  const dir = path.join(OUT, "runs", run.runId);
  mkdirSync(dir, { recursive: true });
  const root = mkdtempSync(path.join(tmpdir(), "harness-ab-"));
  const ws = path.join(root, "ws");
  row.artifacts = path.relative(SOURCE, dir);
  try {
    const fixtures = run.task.fixtures ? path.join(opts.setDir, run.task.fixtures) : undefined;
    const [setup, setupMs] = timed(() => {
      const w = makeWorkspace(run.task.base, ws, fixtures);
      const p = writeProfiles(run, ws, dir);
      const exit = install(run.task, ws, p.checkProfile, dir);
      if (exit !== 0)
        throw new Error(`bun install failed (exit ${exit}); see ${row.artifacts}/install.log`);
      return { ...w, ...p };
    });

    const prompt = agentPrompt(run.task, run.arm);
    writeFileSync(path.join(dir, "prompt.md"), prompt);
    const [agent, agentMs] = timed(() =>
      sh(
        "bash",
        [LANE, ...(run.task.implement ? ["--implement"] : []), prompt, ...claudeArgs(run.arm)],
        {
          cwd: ws,
          env: agentEnv(process.env, {
            ...run.arm.env,
            MODUO_LANE_PROFILE: setup.laneProfile,
            MODUO_LANE_SETTINGS: setup.settings,
          }),
          timeout: AGENT_TIMEOUT_MS,
        },
      ),
    );
    writeFileSync(path.join(dir, "stream.jsonl"), agent.stdout);
    writeFileSync(path.join(dir, "agent.stderr.log"), agent.stderr);
    const summary = summarize(agent.stdout);

    const diff = diffStats(ws, setup.start);
    writeFileSync(path.join(dir, "diff.patch"), diff.patch);
    const [verdict, oracleMs] = timed(() => oracle(run.task, ws, setup.checkProfile, dir));
    const verifyCmd = run.task.verify === undefined ? opts.verifyDefault : run.task.verify;
    const [verify, verifyMs] = timed(() => {
      if (!opts.verify || !verifyCmd) return null;
      const exit = sandboxed(ws, setup.checkProfile, verifyCmd, {}, path.join(dir, "verify.log"));
      return { cmd: verifyCmd, exit, ok: exit === 0 };
    });

    Object.assign(row, {
      ms: { setup: setupMs, agent: agentMs, oracle: oracleMs, verify: verifyMs },
      agent: { ...summary, exit: agent.status, result: summary.result.slice(0, 2000) },
      diff: {
        files: diff.files,
        insertions: diff.insertions,
        deletions: diff.deletions,
        testEdits: diff.testEdits,
      },
      oracle: verdict,
      verify,
      safety: { mcpServers: summary.mcpServers, remotes: setup.remotes, hosts: setup.hosts },
    });
    if (summary.mcpServers.length > 0) {
      row.outcome = "error";
      row.error = `the agent saw MCP servers: ${summary.mcpServers.join(", ")}`;
    } else if (summary.isError && agent.stdout.trim() === "") {
      row.outcome = "error";
      row.error = `the agent produced no stream (exit ${agent.status}); see ${row.artifacts}/agent.stderr.log`;
    } else {
      row.outcome = judge({
        task: run.task,
        agent: summary,
        oracle: verdict,
        verify,
        testEdits: diff.testEdits,
      });
    }
  } catch (e) {
    row.outcome = "error";
    row.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (opts.keep) row.error = [row.error, `workspace kept at ${ws}`].filter(Boolean).join("; ");
    else rmSync(root, { recursive: true, force: true });
  }
  return row;
}

/** check-tasks: without a model, the oracle must fail at base (the bug is there) and pass at fix. */
function checkTask(task: Task, setDir: string) {
  const results: Record<string, string> = {};
  for (const [label, sha] of [
    ["base", task.base],
    ["fix", task.fix],
  ] as const) {
    if (!sha) continue;
    const runId = `check-${task.id}-${label}`;
    const dir = path.join(OUT, "runs", runId);
    mkdirSync(dir, { recursive: true });
    const root = mkdtempSync(path.join(tmpdir(), "harness-ab-"));
    const ws = path.join(root, "ws");
    try {
      makeWorkspace(sha, ws, task.fixtures ? path.join(setDir, task.fixtures) : undefined);
      const { checkProfile } = writeProfiles(
        { runId, set: "", task, arm: { id: "none", model: "opus", description: "" }, repeat: 0 },
        ws,
        dir,
      );
      const exit = install(task, ws, checkProfile, dir);
      if (exit !== 0) throw new Error(`bun install failed (exit ${exit})`);
      const v = oracle(task, ws, checkProfile, dir);
      results[label] = v.checks.map((c) => `${c.name}=${c.exit}`).join(" ");
      results[`${label}Ok`] = String(v.ok);
    } catch (e) {
      results[label] = `error: ${e instanceof Error ? e.message : e}`;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  // Sound: doing nothing fails the oracle at base, and the real fix (when there is one) passes it.
  const sound = results.baseOk === "false" && (!task.fix || results.fixOk === "true");
  return { task: task.id, sound, ...results };
}

export function report(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.task}\t${r.arm}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const lines = ["task\tarm\tpass\truns\terrors\tmean cost $\tmean agent min"];
  for (const [key, rs] of [...groups].sort()) {
    const done = rs.filter((r) => r.outcome !== "error" && r.outcome !== "planned");
    const mean = (f: (r: Row) => number | null | undefined) => {
      const xs = done.map(f).filter((x): x is number => typeof x === "number");
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    const cost = mean((r) => r.agent?.costUsd);
    const mins = mean((r) => (r.ms ? r.ms.agent / 60_000 : null));
    lines.push(
      [
        key,
        rs.filter((r) => r.outcome === "pass").length,
        rs.length,
        rs.filter((r) => r.outcome === "error").length,
        cost === null ? "-" : cost.toFixed(2),
        mins === null ? "-" : mins.toFixed(1),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

function flags(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("--")) rest.push(a);
    else if (["--dry-run", "--keep", "--no-verify"].includes(a)) out[a.slice(2)] = true;
    else out[a.slice(2)] = argv[++i] ?? "";
  }
  return { out, rest };
}

const csv = (v: string | boolean | undefined) =>
  typeof v === "string" && v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

function main(argv: string[]) {
  const [cmd, ...args] = argv;
  const { out: f, rest } = flags(args);
  if (cmd === "list") {
    console.log(`task sets (${path.relative(SOURCE, TASKS_DIR)}):`);
    for (const name of listDir(TASKS_DIR, false)) {
      const set = loadSet(name);
      console.log(`  ${name}: ${set.description}`);
      for (const t of set.tasks) console.log(`    ${t.id} [${t.expect}] ${t.title}`);
    }
    console.log(`arms (${path.relative(SOURCE, ARMS_DIR)}):`);
    for (const id of listDir(ARMS_DIR, true)) {
      const arm = loadArm(id);
      console.log(
        `  ${id}: ${arm.model}${arm.effort ? ` @${arm.effort}` : ""}, ${arm.description}`,
      );
    }
    return 0;
  }
  if (cmd === "report") {
    const file = rest[0];
    if (!file) throw new Error("usage: report <results.jsonl>");
    const rows = readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Row);
    console.log(report(rows));
    return 0;
  }
  const setName = typeof f.set === "string" ? f.set : "core";
  const set = loadSet(setName);
  if (cmd === "check-tasks") {
    const only = csv(f.tasks);
    const tasks = only ? set.tasks.filter((t) => only.includes(t.id)) : set.tasks;
    let bad = 0;
    for (const t of tasks) {
      const r = checkTask(t, set.dir);
      if (!r.sound) bad++;
      console.log(JSON.stringify(r));
    }
    return bad ? 1 : 0;
  }
  if (cmd !== "run") {
    console.error(
      "usage: bun run ab list | run --set <set> --arms a,b [--tasks …] [--repeats 3] [--dry-run] [--keep] [--no-verify] | check-tasks --set <set> | report <file>",
    );
    return 64;
  }
  const arms = (csv(f.arms) ?? ["control"]).map((id) => loadArm(id));
  const batch = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const rigSha = git(SOURCE, "rev-parse", "--short=12", "HEAD");
  const runs = plan({
    set,
    arms,
    repeats: typeof f.repeats === "string" ? Number(f.repeats) : 3,
    source: typeof f.source === "string" ? f.source : SOURCE,
    only: csv(f.tasks),
    batch,
  });
  mkdirSync(path.join(OUT, "results"), { recursive: true });
  const results = path.join(
    OUT,
    "results",
    `${batch}-${set.name}${f["dry-run"] ? "-dry" : ""}.jsonl`,
  );
  console.error(`harness-ab: ${runs.length} run(s) → ${path.relative(SOURCE, results)}`);
  for (const run of runs) {
    const row = f["dry-run"]
      ? plannedRow(run, batch, rigSha)
      : execute(run, {
          batch,
          rigSha,
          keep: f.keep === true,
          verify: f["no-verify"] !== true,
          verifyDefault: set.verify,
          setDir: set.dir,
        });
    appendFileSync(results, `${JSON.stringify(row)}\n`);
    console.error(`  ${row.runId}: ${row.outcome}${row.error ? ` (${row.error})` : ""}`);
  }
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(e instanceof RefusedError ? 3 : 1);
  }
}
