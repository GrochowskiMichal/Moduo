import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "@rstest/core";

import {
  type Arm,
  ARMS_DIR,
  experimentProblems,
  EXPERIMENTS,
  judge,
  listDir,
  loadArm,
  loadSet,
  missingPlugins,
  plan,
  pluginsNotLoaded,
  type Row,
  taskProblems,
} from "./model";
import { claudeArgs, report } from "./rig";
import {
  agentEnv,
  refuseArm,
  RefusedError,
  refuseWorkspace,
  rigProfile,
  type SrtProfile,
} from "./safety";
import { ANCHOR, closeStackPorts, STACK_PORTS } from "./srt-offline.mjs";
import { summarize } from "./stream";

// The A/B rig (specs/harness-v3.md, AC33, AC37): a dry run plans one row per task × arm × repeat, and
// nothing that points at the shared Supabase stack, production or a remote gets past the checks.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RIG = path.join(ROOT, "scripts/harness-ab/rig.ts");
const core = loadSet("core");
const control = loadArm("control");
const lane = JSON.parse(
  readFileSync(path.join(ROOT, ".claude/sandbox/lane.srt.json"), "utf8"),
) as SrtProfile;

const arm = (over: Partial<Arm>): Arm => ({ ...control, id: "x", ...over });
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof RefusedError) return e.refusals.map((r) => r.reason).join("\n");
    throw e;
  }
  throw new Error("expected a refusal");
};
const planWith = (over: Partial<Parameters<typeof plan>[0]>) =>
  plan({ set: core, arms: [control], repeats: 1, source: ROOT, batch: "t", ...over });

describe("dry run", () => {
  let out: string;
  beforeEach(() => {
    out = mkdtempSync(path.join(tmpdir(), "harness-ab-test-"));
  });
  afterEach(() => rmSync(out, { recursive: true, force: true }));
  const cli = (...args: string[]) =>
    spawnSync("bun", [RIG, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, HARNESS_AB_OUT: out },
    });

  it("writes one planned row per task × arm × repeat and runs nothing", () => {
    const run = cli("run", "--set", "core", "--arms", "control,smoke", "--dry-run");
    expect(run.status).toBe(0);
    const results = path.join(out, "results");
    const [file] = readdirSync(results);
    const rows = readFileSync(path.join(results, file ?? ""), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Row);
    expect(rows).toHaveLength(core.tasks.length * 2 * 3);
    expect(new Set(rows.map((r) => r.runId)).size).toBe(rows.length);
    expect(rows.every((r) => r.outcome === "planned" && r.schema === 1)).toBe(true);
    for (const t of core.tasks)
      for (const a of ["control", "smoke"])
        expect(rows.filter((r) => r.task === t.id && r.arm === a).map((r) => r.repeat)).toEqual([
          1, 2, 3,
        ]);
    expect(readdirSync(out)).toEqual(["results"]);
  });

  it("exits 3 and writes nothing for a remote source", () => {
    const run = cli("run", "--dry-run", "--source", "git@github.com:GrochowskiMichal/Moduo.git");
    expect(run.status).toBe(3);
    expect(run.stderr).toContain("remote");
    expect(readdirSync(out)).toEqual([]);
  });
});

describe("refusals", () => {
  it("refuses the shared local stack", () => {
    expect(refused(() => planWith({ arms: [arm({ network: ["127.0.0.1:54321"] })] }))).toMatch(
      /shared local Supabase stack/,
    );
    expect(
      refused(() => planWith({ arms: [arm({ env: { SUPABASE_URL: "http://localhost:54321" } })] })),
    ).toMatch(/shared local Supabase stack/);
  });

  it("refuses production: hosted Supabase and the Moduo MCP", () => {
    expect(
      refused(() =>
        planWith({ arms: [arm({ env: { SUPABASE_URL: "https://abc.supabase.co" } })] }),
      ),
    ).toMatch(/hosted Supabase/);
    expect(refused(() => planWith({ arms: [arm({ network: ["mcp.moduo.app"] })] }))).toMatch(
      /production Moduo/,
    );
    expect(
      refused(() =>
        planWith({ arms: [arm({ settings: { mcpServers: { m: { type: "http" } } } })] }),
      ),
    ).toMatch(/MCP servers/);
    expect(refused(() => planWith({ arms: [arm({ args: ["--mcp-config", "{}"] })] }))).toMatch(
      /set by the rig/,
    );
  });

  it("refuses a remote", () => {
    expect(refused(() => planWith({ source: "https://github.com/x/y.git" }))).toMatch(/remote/);
    expect(refused(() => planWith({ arms: [arm({ network: ["github.com"] })] }))).toMatch(
      /git remote host/,
    );
    const pushy = { ...core, tasks: [{ ...core.tasks[0]!, prompt: "fix it, then git push" }] };
    expect(refused(() => planWith({ set: pushy }))).toMatch(/write to a remote/);
    expect(
      refuseWorkspace({ dir: "/tmp/ws", source: ROOT, remotes: ["origin"] })[0]?.reason,
    ).toMatch(/has remotes/);
    expect(refuseWorkspace({ dir: `${ROOT}/x`, source: ROOT, remotes: [] })).toHaveLength(1);
  });

  it("refuses a model that isn't Anthropic's", () => {
    expect(refused(() => planWith({ arms: [arm({ model: "gpt-5" })] }))).toMatch(/Anthropic/);
    expect(() => planWith({ arms: [arm({ model: "claude-opus-5-5" })] })).not.toThrow();
  });
});

describe("sandbox and environment", () => {
  const profile = rigProfile(lane, { source: ROOT });

  it("leaves only the model API and npm reachable", () => {
    const hosts = profile.network.allowedDomains;
    expect(hosts).toContain("api.anthropic.com");
    expect(hosts).toContain("registry.npmjs.org");
    for (const gone of ["127.0.0.1:54321", "127.0.0.1:54322", "mcp.moduo.app", "github.com"])
      expect(hosts).not.toContain(gone);
    expect(hosts.some((h) => h.startsWith("127.") || h.startsWith("localhost"))).toBe(false);
    expect(profile.network.allowLocalBinding).toBe(true);
    expect(profile.filesystem.denyRead).toEqual(
      expect.arrayContaining([`${ROOT}/.env.local`, "~/.config/gh"]),
    );
    expect(() => rigProfile(lane, { source: ROOT, extraHosts: ["github.com"] })).toThrow(
      RefusedError,
    );
  });

  it("the agent gets no keys, tokens or Supabase URLs", () => {
    const env = agentEnv({
      PATH: "/usr/bin",
      HOME: "/h",
      SUPABASE_URL: "x",
      PUBLIC_SUPABASE_URL: "x",
      MODUO_MCP_KEY: "k",
      GH_TOKEN: "t",
      CLOUDFLARE_API_TOKEN: "c",
      ANTHROPIC_BASE_URL: "https://elsewhere.example",
    });
    expect(Object.keys(env).sort()).toEqual(["HOME", "PATH"]);
  });

  it("runs Claude with no MCP servers and a stream-json transcript", () => {
    const args = claudeArgs(control);
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args).toContain("--strict-mcp-config");
    expect(at("--mcp-config")).toBe('{"mcpServers":{}}');
    expect(at("--output-format")).toBe("stream-json");
    expect(args).toContain("--verbose");
    expect(at("--model")).toBe("opus");
    expect(at("--effort")).toBe("high");
    expect(at("--setting-sources")).toBe("project");
  });

  it("lane.sh runs a clone elsewhere with the rig profile and its own checkout's settings", () => {
    const bin = mkdtempSync(path.join(tmpdir(), "harness-ab-bin-"));
    const ws = mkdtempSync(path.join(tmpdir(), "harness-ab-ws-"));
    try {
      spawnSync("git", ["init", "-q", ws]);
      const jq = spawnSync("sh", ["-c", "command -v jq"], { encoding: "utf8" }).stdout.trim();
      writeFileSync(path.join(bin, "claude"), "#!/bin/sh\necho outside\n");
      writeFileSync(
        path.join(bin, "srt"),
        `#!/bin/bash\n{ echo "cmd=$4"; cat "$2"; } > "${bin}/srt.out"\n`,
      );
      chmodSync(path.join(bin, "claude"), 0o755);
      chmodSync(path.join(bin, "srt"), 0o755);
      const rigFile = path.join(bin, "rig.srt.json");
      writeFileSync(rigFile, JSON.stringify(profile));
      const run = spawnSync("bash", [path.join(ROOT, "scripts/agent/lane.sh"), "go"], {
        cwd: ws,
        encoding: "utf8",
        env: {
          HOME: process.env.HOME ?? "/tmp",
          PATH: `${bin}:${path.dirname(jq)}:/usr/bin:/bin`,
          MODUO_LANE_PROFILE: rigFile,
        },
      });
      expect(run.stderr).toBe("");
      const [cmd, ...rest] = readFileSync(path.join(bin, "srt.out"), "utf8").split("\n");
      expect(cmd).toContain(`--settings ${ROOT}/.claude/settings.lane.json`);
      const composed = JSON.parse(rest.join("\n")) as SrtProfile;
      expect(composed.network.allowedDomains).not.toContain("127.0.0.1:54321");
      expect(composed.filesystem.allowWrite).toContain(realpath(ws));
    } finally {
      rmSync(bin, { recursive: true, force: true });
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe("srt-offline: the stack's ports stay closed with local binding on", () => {
  it("adds a deny per stack port after srt's localhost allow, and fails closed without it", () => {
    const out = closeStackPorts(`(version 1)\n${ANCHOR}\n(allow network-bind)`);
    const lines = out.split("\n");
    const at = lines.indexOf(ANCHOR);
    expect(lines.slice(at + 1, at + 1 + STACK_PORTS.length)).toEqual(
      STACK_PORTS.map((p) => `(deny network-outbound (remote tcp "localhost:${p}"))`),
    );
    expect(STACK_PORTS).toEqual(expect.arrayContaining([54321, 54322]));
    expect(() => closeStackPorts("(version 1)")).toThrow(/refusing/);
  });

  const hasSrt =
    process.platform === "darwin" &&
    spawnSync("sh", ["-c", "command -v srt"], { encoding: "utf8" }).status === 0;
  it.skipIf(!hasSrt)(
    "live: a stack port is refused, any other local port and a bind work",
    async () => {
      const net = await import("node:net");
      const listen = (port: number) =>
        new Promise<import("node:net").Server | null>((resolve) => {
          const server = net.createServer((s) => s.end());
          server.once("error", () => resolve(null));
          server.listen(port, "127.0.0.1", () => resolve(server));
        });
      // A stack port that's free here (the stack may hold the others), and any free port.
      let stack: import("node:net").Server | null = null;
      let stackPort = 0;
      for (const p of [...STACK_PORTS].reverse()) {
        stack = await listen(p);
        if (stack) {
          stackPort = p;
          break;
        }
      }
      const other = await listen(0);
      if (!other) throw new Error("no free local port");
      const otherPort = (other.address() as import("node:net").AddressInfo).port;
      const dir = mkdtempSync(path.join(tmpdir(), "harness-ab-srt-"));
      try {
        const file = path.join(dir, "p.json");
        const p = rigProfile(lane, { source: ROOT });
        writeFileSync(
          file,
          JSON.stringify({
            ...p,
            $comment: undefined,
            filesystem: { ...p.filesystem, allowWrite: [dir] },
          }),
        );
        const probe = (port: number) =>
          `nc -z -w 2 127.0.0.1 ${port} >/dev/null 2>&1 && echo ${port}=open || echo ${port}=closed`;
        const cmd = [stackPort ? probe(stackPort) : "true", probe(otherPort)].join("; ");
        const run = spawnSync(
          path.join(ROOT, "scripts/harness-ab/srt-offline.mjs"),
          ["--settings", file, "-c", cmd],
          {
            encoding: "utf8",
          },
        );
        expect(run.status).toBe(0);
        if (stackPort) expect(run.stdout).toContain(`${stackPort}=closed`);
        expect(run.stdout).toContain(`${otherPort}=open`);
      } finally {
        stack?.close();
        other.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

const realpath = (p: string) =>
  spawnSync("sh", ["-c", `cd "${p}" && pwd -P`], { encoding: "utf8" }).stdout.trim();

describe("rows", () => {
  const stream = [
    JSON.stringify({ type: "system", subtype: "init", model: "claude-haiku-5-5", mcp_servers: [] }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "bun test ./harness-fixture" } },
          { type: "tool_use", name: "Edit", input: {} },
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "bun run --cwd apps/app test src/lib/x.test.ts" },
          },
          { type: "tool_use", name: "Bash", input: { command: "bun run typecheck" } },
        ],
      },
    }),
    "not json",
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 4,
      total_cost_usd: 0.12,
      duration_ms: 9000,
      result: "## DEFECT REPORT\nThe test wants 1:01, SPEC.md rule 2 says 1:02.",
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
  ].join("\n");

  it("summarizes the stream: model, tools, test tries, the defect report", () => {
    const s = summarize(stream);
    expect(s).toMatchObject({
      model: "claude-haiku-5-5",
      mcpServers: [],
      turns: 4,
      costUsd: 0.12,
      testRuns: 2,
      tools: { Bash: 3, Edit: 1 },
      defectReport: true,
      isError: false,
    });
    expect(summarize("").isError).toBe(true);
  });

  it("a defect report passes only with no test edits and the contradiction still failing", () => {
    const task = core.tasks.find((t) => t.id === "impossible-spec")!;
    const agent = summarize(stream);
    const oracle = { ok: true, checks: [] };
    expect(judge({ task, agent, oracle, verify: null, testEdits: [] })).toBe("pass");
    expect(
      judge({ task, agent, oracle, verify: null, testEdits: ["harness-fixture/duration.test.ts"] }),
    ).toBe("fail");
    expect(
      judge({ task, agent, oracle: { ok: false, checks: [] }, verify: null, testEdits: [] }),
    ).toBe("fail");
  });

  it("reports pass rate and cost per task and arm", () => {
    const row = (outcome: Row["outcome"], cost: number): Row =>
      ({ task: "t", arm: "a", outcome, agent: { costUsd: cost }, ms: { agent: 60_000 } }) as Row;
    expect(report([row("pass", 1), row("fail", 3), row("error", 9)]).split("\n")[1]).toBe(
      "t\ta\t1\t3\t1\t2.00\t1.0",
    );
  });
});

describe("experiment arms (AC37)", () => {
  const arms = listDir(ARMS_DIR, true).map((id) => loadArm(id));
  const experiment = (name: string) => arms.filter((a) => a.experiment?.name === name);
  const out = mkdtempSync(path.join(tmpdir(), "harness-ab-test-"));
  const home = mkdtempSync(path.join(tmpdir(), "harness-ab-home-"));
  afterAll(() => {
    rmSync(out, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  // An empty HOME: no plugin is installed, so a real run of the Ponytail arm stops before it starts.
  const cli = (...args: string[]) =>
    spawnSync("bun", [RIG, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, HARNESS_AB_OUT: out, HOME: home },
    });

  it("every arm is refusal-clean and runs an Anthropic model", () => {
    expect(arms.flatMap(refuseArm)).toEqual([]);
  });

  it("each experiment arm differs from its baseline only in what the experiment varies", () => {
    for (const a of arms.filter((x) => x.experiment))
      expect(experimentProblems(a, loadArm(a.experiment?.baseline ?? ""))).toEqual([]);
    expect(Object.keys(EXPERIMENTS).every((name) => experiment(name).length > 0)).toBe(true);
    expect(
      experimentProblems(
        arm({
          id: "sneaky",
          experiment: { name: "effort", baseline: "control" },
          effort: "medium",
          model: "sonnet",
        }),
        control,
      ),
    ).toEqual(["sneaky: model differs from control, outside the effort experiment"]);
    expect(
      experimentProblems(
        arm({ id: "same", experiment: { name: "effort", baseline: "control" } }),
        control,
      ),
    ).toEqual(["same: identical to control"]);
  });

  it("effort is medium against control's high", () => {
    expect(control.effort).toBe("high");
    expect(experiment("effort").map((a) => [a.id, a.model, a.effort])).toEqual([
      ["effort-medium", "opus", "medium"],
    ]);
  });

  it("Ponytail is on only in its arm, and a run whose plugin didn't load is caught", () => {
    const on = arms.filter((a) => JSON.stringify(a.settings ?? {}).includes("ponytail"));
    expect(on.map((a) => a.id)).toEqual(["ponytail"]);
    const ponytail = loadArm("ponytail");
    expect(ponytail.model).toBe("opus");
    expect(pluginsNotLoaded(ponytail, [])).toEqual(["ponytail@ponytail"]);
    expect(pluginsNotLoaded(ponytail, ["ponytail@ponytail"])).toEqual([]);
    expect(pluginsNotLoaded(control, [])).toEqual([]);
    // Only a user-scope install loads in the rig's temp clone; a project-scoped one never does.
    const install = (scope: string) => ({ plugins: { "ponytail@ponytail": [{ scope }] } });
    expect(missingPlugins([ponytail], install("project"))).toEqual(["ponytail@ponytail"]);
    expect(missingPlugins([ponytail], install("user"))).toEqual([]);
    expect(missingPlugins([control], {})).toEqual([]);
  });

  it("the test-prompt arms are tdd and contract-first, framed after the task", () => {
    const prompts = experiment("test-prompt");
    expect(prompts.map((a) => a.id).sort()).toEqual(["prompt-contract-first", "prompt-tdd"]);
    for (const a of prompts) {
      expect(a.promptSuffix).toBeTruthy();
      expect(a.promptPrefix).toBeUndefined();
    }
    expect(loadArm("prompt-tdd").promptSuffix).toMatch(/test-first/);
    expect(loadArm("prompt-contract-first").promptSuffix).toMatch(/contract-first/);
  });

  it("a dry run plans every experiment arm; a real Ponytail run without the plugin stops first", () => {
    const ids = arms.filter((a) => a.experiment).map((a) => a.id);
    const dry = cli(
      "run",
      "--set",
      "core",
      "--arms",
      ["control", ...ids].join(","),
      "--repeats",
      "1",
      "--dry-run",
    );
    expect(dry.status).toBe(0);
    expect(dry.stderr).toContain("warning: plugins not installed at user scope: ponytail@ponytail");
    const [file] = readdirSync(path.join(out, "results"));
    const rows = readFileSync(path.join(out, "results", file ?? ""), "utf8")
      .trim()
      .split("\n");
    expect(rows).toHaveLength(core.tasks.length * (ids.length + 1));

    const real = cli(
      "run",
      "--set",
      "core",
      "--tasks",
      "impossible-spec",
      "--arms",
      "ponytail",
      "--repeats",
      "1",
    );
    expect(real.status).toBe(1);
    expect(real.stderr).toContain("claude plugin install ponytail@ponytail --scope user");
    expect(readdirSync(path.join(out, "results"))).toEqual([file]);
  });

  it("reads the plugins a session loaded, without the builtins", () => {
    const init = {
      type: "system",
      subtype: "init",
      plugins: [
        { name: "ponytail", source: "ponytail@ponytail" },
        { name: "cc-plugin-telemetry", source: "cc-plugin-telemetry@builtin" },
      ],
    };
    expect(summarize(JSON.stringify(init)).plugins).toEqual(["ponytail@ponytail"]);
  });
});

describe("the core task set", () => {
  const shallow =
    spawnSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: ROOT,
      encoding: "utf8",
    }).stdout.trim() === "true";

  it("has 5 past fixes, #509 and the impossible spec, all well formed", () => {
    expect(core.tasks.flatMap(taskProblems)).toEqual([]);
    expect(core.tasks.filter((t) => t.expect === "fix")).toHaveLength(6);
    expect(core.tasks.some((t) => t.source.pr === 509)).toBe(true);
    expect(core.tasks.filter((t) => t.expect === "defect-report").map((t) => t.id)).toEqual([
      "impossible-spec",
    ]);
  });

  it.skipIf(shallow)(
    "every base and fix commit exists, and every oracle file is in its fix",
    () => {
      for (const t of core.tasks) {
        for (const sha of [t.base, t.fix].filter(Boolean))
          expect(
            spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ROOT }).status,
          ).toBe(0);
        for (const f of t.oracle.files ?? [])
          expect(spawnSync("git", ["cat-file", "-e", `${t.fix}:${f}`], { cwd: ROOT }).status).toBe(
            0,
          );
      }
    },
  );
});
