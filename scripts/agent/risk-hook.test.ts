import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classify,
  parseVerdict,
  readDecisions,
  redact,
  type RiskDecision,
  runShadow,
} from "./risk-hook";

// The Haiku risk hook in shadow (HV-24, specs/harness-v3.md AC36): it logs a decision
// for prod-touching commands and risky edits and never returns a block.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOOK = path.join(ROOT, "scripts/agent/risk-hook.ts");
const bash = (command: string) => ({
  session_id: "s1",
  cwd: ROOT,
  tool_name: "Bash",
  tool_input: { command },
});
const edit = (file_path: string, new_string = "x") => ({
  cwd: ROOT,
  tool_name: "Edit",
  tool_input: { file_path, old_string: "y", new_string },
});

describe("classify", () => {
  it.each([
    ["supabase db push", "supabase-cloud"],
    ["bunx supabase functions deploy moduo-mcp", "supabase-cloud"],
    ["supabase db query --linked 'select 1'", "supabase-cloud"],
    ["cd infra && bunx wrangler deploy", "wrangler"],
    ["gh workflow run deploy-prod.yml", "gh-write"],
    ["gh pr merge 12 --merge", "gh-write"],
    ["git push origin develop", "git-publish"],
    ["git push origin HEAD:mike", "git-publish"],
    ["git push --tags", "git-publish"],
    ["git tag v1.2.3", "git-publish"],
    ["bash scripts/release/cut.sh", "release-script"],
    ["psql postgres://u@db.abc.supabase.co:5432/postgres -c 'select 1'", "remote-db"],
    ["curl -s https://mcp.moduo.app/mcp", "prod-http"],
    ["bash -c 'supabase db push'", "supabase-cloud"],
    ["bunx supabase@latest db push", "supabase-cloud"],
    ["supabase migration up --linked", "supabase-cloud"],
    ["supabase functions delete x", "supabase-cloud"],
    ["bunx wrangler@4 deploy", "wrangler"],
    ["wrangler --env production deploy", "wrangler"],
    ["wrangler pages deploy dist", "wrangler"],
    ["git -C apps push origin develop", "git-publish"],
    ["git push origin HEAD:refs/heads/develop", "git-publish"],
    ["git tag -am msg v1.4.0", "git-publish"],
    ["gh api --method=POST repos/x/y/issues", "gh-write"],
    ["gh api repos/x/y/actions/workflows/a.yml/dispatches -f ref=develop", "gh-write"],
    ["gh release upload v1.0.0 a.dmg", "gh-write"],
    ['psql "$DATABASE_URL" -c "select 1"', "remote-db"],
    ["PGHOST=db.x.supabase.co psql", "remote-db"],
  ])("%s → %s", (cmd, rule) => {
    expect(classify(bash(cmd))?.rule).toBe(rule);
  });

  it.each([
    "git push -u origin t/mike/hv-24-risk-hook",
    "git push --force-with-lease origin t/mike/x",
    "bun run verify",
    "supabase status",
    "psql postgresql://postgres@127.0.0.1:54322/postgres -1 -f x.sql",
    "gh pr view 12",
    "git log --oneline mike",
    "git push --force-if-includes origin t/mike/x",
    "curl -s localhost:8081 | grep moduo.app",
  ])("leaves %s alone", (cmd) => {
    expect(classify(bash(cmd))).toBeNull();
  });

  it("matches Supabase MCP writes from any connector", () => {
    expect(
      classify({ tool_name: "mcp__supabase__apply_migration", tool_input: { query: "x" } })?.rule,
    ).toBe("apply_migration");
    expect(classify({ tool_name: "mcp__supabase__list_tables", tool_input: {} })).toBeNull();
  });

  it("matches edits on Tier 2 paths only, absolute or relative", () => {
    expect(classify(edit(path.join(ROOT, "supabase/migrations/20261026_x.sql")))).toMatchObject({
      kind: "edit",
      rule: "tier2:migrations",
      subject: "supabase/migrations/20261026_x.sql",
    });
    expect(classify(edit(".claude/hooks/guard-git.sh"))?.rule).toBe("tier2:agent guards");
    expect(classify(edit(path.join(ROOT, "apps/app/src/features/tasks/model.ts")))).toBeNull();
  });
});

describe("redact", () => {
  const cases: [string, string][] = [
    ["SUPABASE_ACCESS_TOKEN=sbp_0123456789abcdef supabase db push", "sbp_0123456789abcdef"],
    ["curl -H 'Authorization: Bearer abc.def.ghi' https://mcp.moduo.app", "abc.def.ghi"],
    ["curl -H 'x-api-key: moduo_sk_live1234567890' x", "moduo_sk_live1234567890"],
    ["psql postgres://postgres:hunter2pass@db.x.supabase.co/postgres", "hunter2pass"],
    [
      "wrangler secret put X --token=ghp_abcdefghijklmnopqrstuvwxyz0123",
      "ghp_abcdefghijklmnopqrstuvwxyz0123",
    ],
    ["export ANTHROPIC_API_KEY=sk-ant-api03-aaaaaaaaaaaaaaaa", "sk-ant-api03-aaaaaaaaaaaaaaaa"],
    ["stripe sk_live_51Habcdefghijklmnop", "sk_live_51Habcdefghijklmnop"],
    ["key AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlX3Zh", "eyJhbGciOiJIUzI1NiJ9"],
    ["opaque Xk29fLm3Qp8Rt5Vw7Yz1Ab4Cd6Ef0Gh2Jk9", "Xk29fLm3Qp8Rt5Vw7Yz1Ab4Cd6Ef0Gh2Jk9"],
    ["gh secret set X --body s3cr3tvalue", "s3cr3tvalue"],
    ["supabase secrets set STRIPE_WEBHOOK=whatever123 OTHER=v2", "whatever123"],
    ["echo plainvalue | bunx wrangler secret put RESEND", "plainvalue"],
    ["curl -u admin:pw1secret https://x.moduo.app", "pw1secret"],
    ["curl --user admin:pw2secret https://x.moduo.app", "pw2secret"],
    ["supabase db push -p pw3secret", "pw3secret"],
    ['supabase secrets set KEY="two words4"', "two words4"],
    ['gh secret set K --body "two words5"', "two words5"],
    ['gh secret set K -b"pw6secret"', "pw6secret"],
    ['PASSWORD="a b7"', "a b7"],
    ["wrangler secret put X <<< pw8secret", "pw8secret"],
    ["psql postgres://u:p@ss9@db.x.supabase.co/postgres", "ss9"],
    ["curl -H 'cookie: a=x1; b=y2secret' https://moduo.app", "y2secret"],
    ["alter role x with password 'pw10secret'", "pw10secret"],
    ["select vault.create_secret('pw11secret')", "pw11secret"],
    ['curl -d \'{"password":"pw12secret"}\' https://x.moduo.app', "pw12secret"],
    ["git push https://abcdefghijklmnopqrst12@github.com/x/y develop", "abcdefghijklmnopqrst12"],
    ["curl -H 'X-Moduo-Key: pw13secret' https://moduo.app", "pw13secret"],
  ];
  it.each(cases)("hides the secret in %s", (input, secret) => {
    const out = redact(input);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]");
  });

  it("keeps commands, paths and git SHAs readable", () => {
    const cmd =
      "git push origin develop && cat apps/app/src/lib/sync/outbox-store-implementation.ts";
    expect(redact(cmd)).toBe(cmd);
    const sha = "git show 5a1234c8c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5";
    expect(redact(sha)).toBe(sha);
  });
});

describe("MCP input redaction", () => {
  it("redacts by value and by key, never the JSON-escaped text", () => {
    const t = classify({
      tool_name: "mcp__supabase__execute_sql",
      tool_input: {
        query: "alter role x with password 'pwsecret'",
        password: "plain",
        note: 'API_KEY = "v1secret"',
      },
    });
    expect(t?.detail).not.toMatch(/pwsecret|plain|v1secret/);
  });
});

describe("MultiEdit", () => {
  it("sends each edit's text and counts it", () => {
    const t = classify({
      cwd: ROOT,
      tool_name: "MultiEdit",
      tool_input: {
        file_path: "supabase/migrations/x.sql",
        edits: [{ old_string: "a", new_string: "drop policy p" }],
      },
    });
    expect(t?.chars).toBe(14);
    expect(t?.detail).toContain("drop policy p");
  });
});

describe("cost on hostile input", () => {
  it("stays fast on many hyphenated flags and long unbroken runs", () => {
    const t0 = Date.now();
    classify(bash(`supabase ${"--a-b ".repeat(40)}status`));
    classify(bash(`supabase db push ${"a-".repeat(100_000)}`));
    redact("token_".repeat(30_000).slice(0, 4_000));
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});

describe("parseVerdict", () => {
  it("reads the JSON answer, even wrapped in prose", () => {
    expect(parseVerdict('Sure. {"decision":"Block","risk":"high","reason":"prod push"}')).toEqual({
      decision: "block",
      risk: "high",
      reason: "prod push",
    });
  });
  it("rejects anything that is not allow, ask or block", () => {
    expect(parseVerdict('{"decision":"maybe"}')).toBeNull();
    expect(parseVerdict("no json")).toBeNull();
  });
});

describe("runShadow", () => {
  it("logs the model's decision and never enforces it", () => {
    const rows: RiskDecision[] = [];
    let prompt = "";
    const row = runShadow(bash("SUPABASE_ACCESS_TOKEN=sbp_secretsecret123 supabase db push"), {
      ask: (p) => {
        prompt = p;
        return '{"decision":"block","risk":"high","reason":"pushes migrations to prod"}';
      },
      log: (r) => rows.push(r),
    });
    expect(rows).toEqual([row]);
    expect(row).toMatchObject({
      mode: "shadow",
      decision: "block",
      enforced: false,
      rule: "supabase-cloud",
    });
    expect(prompt).not.toContain("sbp_secretsecret123");
    expect(JSON.stringify(rows)).not.toContain("sbp_secretsecret123");
  });

  it("logs edits by path and size, never their content", () => {
    const rows: RiskDecision[] = [];
    runShadow(
      edit("supabase/migrations/x.sql", "create policy p on t using (true); -- password=letmein"),
      {
        ask: () => '{"decision":"ask","risk":"medium","reason":"opens a policy"}',
        log: (r) => rows.push(r),
      },
    );
    expect(rows[0]).toMatchObject({ subject: "supabase/migrations/x.sql", decision: "ask" });
    expect(rows[0].chars).toBeGreaterThan(0);
    expect(JSON.stringify(rows[0])).not.toContain("create policy");
  });

  it("logs an error row when the model fails, and never throws", () => {
    const rows: RiskDecision[] = [];
    expect(() =>
      runShadow(bash("gh workflow run deploy-prod.yml"), {
        ask: () => {
          throw new Error("quota");
        },
        log: (r) => rows.push(r),
      }),
    ).not.toThrow();
    expect(rows[0]).toMatchObject({ decision: "error", reason: "quota" });
    expect(
      runShadow(bash("gh workflow run x"), { ask: () => "garbage", log: () => {} })?.decision,
    ).toBe("error");
    expect(() =>
      runShadow(bash("gh workflow run x"), {
        ask: () => '{"decision":"allow"}',
        log: () => {
          throw new Error("disk full");
        },
      }),
    ).not.toThrow();
  });

  it("does nothing for out-of-scope calls", () => {
    let asked = false;
    expect(runShadow(bash("ls"), { ask: () => ((asked = true), ""), log: () => {} })).toBeNull();
    expect(asked).toBe(false);
  });
});

describe("the hook process", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "risk-hook-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const fakeClaude = (body: string) => {
    const bin = path.join(dir, "claude");
    writeFileSync(bin, `#!/bin/sh\ncat >/dev/null\n${body}\n`);
    chmodSync(bin, 0o755);
    return bin;
  };
  const run = (input: string, bin: string, extra: Record<string, string> = {}) => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      MODUO_RISK_LOG: path.join(dir, "log", "risk.jsonl"),
      MODUO_RISK_HOOK_CLAUDE: bin,
    };
    delete env.MODUO_RISK_HOOK_CHILD;
    delete env.MODUO_RISK_HOOK;
    Object.assign(env, extra);
    return spawnSync("bun", [HOOK], { input, encoding: "utf8", env, timeout: 30_000 });
  };
  const logRows = () => readDecisions(path.join(dir, "log", "risk.jsonl"));

  it("prints nothing and exits 0 even when the model says block", () => {
    const bin = fakeClaude(`echo '{"decision":"block","risk":"high","reason":"prod deploy"}'`);
    const out = run(JSON.stringify(bash("bunx wrangler deploy")), bin);
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("");
    expect(logRows()).toMatchObject([
      { decision: "block", enforced: false, rule: "wrangler", session: "s1" },
    ]);
  });

  it("fails safe: a crashing or missing claude, or garbage input, still exits 0 silently", () => {
    const crash = run(JSON.stringify(bash("git push --tags")), fakeClaude("exit 3"));
    expect([crash.status, crash.stdout]).toEqual([0, ""]);
    expect(logRows()[0]).toMatchObject({ decision: "error", reason: "claude exited 3" });

    const missing = run(JSON.stringify(bash("git push --tags")), path.join(dir, "nope"));
    expect([missing.status, missing.stdout]).toEqual([0, ""]);
    expect(logRows()[1].decision).toBe("error");

    const garbage = run("{not json", fakeClaude("exit 0"));
    expect([garbage.status, garbage.stdout]).toEqual([0, ""]);
    expect(logRows()).toHaveLength(2);
  });

  it("never reviews its own claude -p, and can be switched off", () => {
    const bin = fakeClaude(`echo '{"decision":"allow"}'`);
    run(JSON.stringify(bash("git push --tags")), bin, { MODUO_RISK_HOOK_CHILD: "1" });
    run(JSON.stringify(bash("git push --tags")), bin, { MODUO_RISK_HOOK: "off" });
    expect(logRows()).toHaveLength(0);
  });

  it("logs nothing (and creates no .git) outside a git repo", () => {
    const bin = fakeClaude(`echo '{"decision":"allow"}'`);
    const env: Record<string, string | undefined> = { ...process.env, MODUO_RISK_HOOK_CLAUDE: bin };
    for (const k of [
      "MODUO_RISK_LOG",
      "MODUO_RISK_HOOK_CHILD",
      "MODUO_RISK_HOOK",
      "CLAUDE_PROJECT_DIR",
    ])
      delete env[k];
    const input = JSON.stringify({ ...bash("git push --tags"), cwd: dir });
    const out = spawnSync("bun", [HOOK], {
      input,
      encoding: "utf8",
      env,
      cwd: dir,
      timeout: 30_000,
    });
    expect([out.status, out.stdout]).toEqual([0, ""]);
    expect(existsSync(path.join(dir, ".git"))).toBe(false);
  });

  it("writes the log owner-only", () => {
    run(JSON.stringify(bash("git push --tags")), fakeClaude(`echo '{"decision":"allow"}'`));
    const mode = spawnSync("stat", ["-f", "%Lp", path.join(dir, "log", "risk.jsonl")], {
      encoding: "utf8",
    });
    if (mode.status === 0) expect(mode.stdout.trim()).toBe("600");
    else expect(readFileSync(path.join(dir, "log", "risk.jsonl"), "utf8")).toContain('"v":1');
  });
});

describe("settings.json", () => {
  const settings = JSON.parse(readFileSync(path.join(ROOT, ".claude/settings.json"), "utf8"));
  const hooks = (
    settings.hooks.PreToolUse as { matcher: string; hooks: Record<string, unknown>[] }[]
  ).flatMap((e) => e.hooks.map((h) => ({ ...h, matcher: e.matcher })));
  const risk = hooks.filter((h) => String(h.command).includes("scripts/agent/risk-hook.ts"));

  it("runs the risk hook async, fail-open, on Bash, edits and Supabase MCP writes", () => {
    expect(risk).toHaveLength(1);
    expect(risk[0].async).toBe(true);
    expect(risk[0].onFailure).toBeUndefined();
    for (const tool of [
      "Bash",
      "Edit",
      "Write",
      "NotebookEdit",
      "mcp__supabase__apply_migration",
    ]) {
      expect(new RegExp(`^(?:${risk[0].matcher})$`).test(tool)).toBe(true);
    }
  });
});
