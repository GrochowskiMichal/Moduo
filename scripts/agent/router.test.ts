import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classify, contextLine, parseModelAnswer, route } from "./router";

// The intent router and the scout agent (HV-23: AC3, AC4).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(ROOT, "scripts/agent/router.ts");

describe("route (the rules)", () => {
  it.each([
    ["Run `/s2 HV-23` to build block HV-23", "block"],
    ["/s1 plan the contacts import", "block"],
    ["Build TV-D16 next", "block"],
    ["The checkbox in Today doesn't work after reconnecting", "bug"],
    ["verify fails on main with a type error", "bug"],
    ["What does guard-lane.sh do?", "answer"],
    ["how is the outbox drained", "answer"],
    ["What's the status of HV-23?", "answer"],
    ["Rename the Inbox heading to Capture", "fast"],
    ["Can you rename the Inbox heading to Capture?", "fast"],
    ["Bump the size limit to 34 KB", "fast"],
    ["Rename the error message on the login screen", "fast"],
    ["Fix the crash when sharing a note", "bug"],
    ["Add the fast lane section to the queue docs", "fast"],
    ["Just answer the email from Maciej", "fast"],
  ])("%s → %s", (prompt, lane) => {
    expect(route(prompt).lane).toBe(lane);
  });

  it.each([
    ["The offline outbox drops a write", ["sync"]],
    ["Sign in with a magic link loops", ["auth"]],
    ["Add an RLS policy for shared notes", ["rls"]],
    ["Stripe checkout shows the old price", ["billing"]],
    ["The moduo-mcp connector returns 500", ["mcp"]],
    ["The Tauri updater hangs", ["desktop"]],
    ["Make the button token match the design", ["ui"]],
    ["Tidy the README", []],
  ])("%s → areas %j", (prompt, areas) => {
    expect(route(prompt).areas).toEqual(areas);
  });

  it("names block IDs and task handles, not encodings or hashes", () => {
    expect(route("HV-14a after TV-D16, see MOD-595; UTF-8 and SHA-256 are fine").ids).toEqual([
      "HV-14a",
      "TV-D16",
      "MOD-595",
    ]);
  });

  it.each([
    ["Treat this as a block: rework the sidebar", "block"],
    ["fast lane: the sync conflict copy is wrong, fix the error text", "fast"],
    ["Treat this as a bug, the layout is off", "bug"],
    ["Just answer: should we fix the outbox?", "answer"],
  ])("lets the person override in words: %s → %s", (prompt, lane) => {
    const r = route(prompt);
    expect(r.lane).toBe(lane);
    expect(r.override).toBe(true);
  });

  it("keeps the rules' own lane next to an override, as the label's prediction", () => {
    expect(route("Treat this as a block: the outbox drops a write")).toMatchObject({
      lane: "block",
      predicted: "bug",
      override: true,
    });
    expect(route("Add the fast lane section to the queue docs").override).toBe(false);
  });

  it("classifies a huge paste quickly and names at most ten IDs", () => {
    const paste = `${"AB-".repeat(200_000)} ${Array.from({ length: 30 }, (_, i) => `HV-${i}`).join(" ")}`;
    const started = Date.now();
    const r = route(paste);
    expect(Date.now() - started).toBeLessThan(500);
    expect(r.ids.length).toBeLessThanOrEqual(10);
  });
});

describe("classify (Haiku, fail safe)", () => {
  const prompt = "The offline outbox drops a write";
  const opts = { mode: "haiku", budgetMs: 50 };

  it("uses Haiku's answer when it is valid", async () => {
    const r = await classify(prompt, {
      ...opts,
      ask: async () => 'Sure: {"lane": "block", "areas": ["sync", "nope"]}',
    });
    expect(r).toMatchObject({ lane: "block", areas: ["sync"], source: "haiku" });
  });

  it.each([
    ["throws", async () => Promise.reject(new Error("quota"))],
    ["answers prose", async () => "I think it is a bug"],
    ["names no lane", async () => '{"lane": "urgent"}'],
  ])("falls back to the rules when the model %s", async (_, ask) => {
    expect(await classify(prompt, { ...opts, ask })).toEqual(route(prompt));
  });

  it("never asks the model when the person named the lane", async () => {
    let asked = false;
    const r = await classify("fast lane: fix the outbox bug", {
      ...opts,
      ask: async () => {
        asked = true;
        return '{"lane": "bug", "areas": []}';
      },
    });
    expect(asked).toBe(false);
    expect(r.lane).toBe("fast");
  });

  it("parses nothing from an answer without JSON", () => {
    expect(parseModelAnswer("bug", route(prompt))).toBeNull();
  });
});

describe("the hook script", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "router-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // A fake `claude` on PATH: the model is stubbed, the timing is real.
  const stubClaude = (body: string) => {
    const bin = path.join(dir, "bin");
    spawnSync("mkdir", ["-p", bin]);
    writeFileSync(path.join(bin, "claude"), `#!/bin/sh\n${body}\n`);
    chmodSync(path.join(bin, "claude"), 0o755);
    return `${bin}:${process.env.PATH}`;
  };

  const run = (input: string, env: Record<string, string> = {}) => {
    const started = Date.now();
    const result = spawnSync("bun", [SCRIPT], {
      input,
      encoding: "utf8",
      env: { ...process.env, MODUO_ROUTER: "", CLAUDE_PROJECT_DIR: dir, ...env },
    });
    return { ...result, ms: Date.now() - started };
  };
  const hookInput = (prompt: string) =>
    JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s1", prompt });
  const context = (stdout: string) =>
    JSON.parse(stdout).hookSpecificOutput as { hookEventName: string; additionalContext: string };

  it("returns lane and areas as UserPromptSubmit context and logs the decision", () => {
    const r = run(hookInput("The offline outbox drops a write"));
    expect(r.status).toBe(0);
    const out = context(r.stdout);
    expect(out.hookEventName).toBe("UserPromptSubmit");
    expect(out.additionalContext).toContain("lane=bug");
    expect(out.additionalContext).toContain("areas=sync");
    const row = JSON.parse(readFileSync(path.join(dir, ".claude/logs/router.jsonl"), "utf8"));
    expect(row).toMatchObject({ session_id: "s1", lane: "bug", areas: ["sync"], source: "rules" });
    expect(JSON.stringify(row)).not.toContain("outbox");
  });

  it.each([
    ["empty input", ""],
    ["broken JSON", "{"],
    ["no prompt", JSON.stringify({ hook_event_name: "UserPromptSubmit" })],
    ["a task notification", hookInput("<task-notification>\n<status>completed</status> fix HV-17")],
  ])("exits 0 with nothing on %s", (_, input) => {
    const r = run(input);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("adds nothing when switched off", () => {
    const r = run(hookInput("fix the bug"), { MODUO_ROUTER: "off" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("uses Haiku's answer through the CLI", () => {
    const PATH = stubClaude(`echo '{"lane": "block", "areas": ["ui"]}'`);
    const r = run(hookInput("Tidy the README"), { MODUO_ROUTER: "haiku", PATH });
    expect(r.status).toBe(0);
    expect(context(r.stdout).additionalContext).toMatch(/haiku\).*lane=block · areas=ui/);
  });

  it("exits 0 with the rules' answer when the model fails", () => {
    const PATH = stubClaude("echo 'rate limited' >&2; exit 1");
    const r = run(hookInput("The offline outbox drops a write"), { MODUO_ROUTER: "haiku", PATH });
    expect(r.status).toBe(0);
    expect(context(r.stdout).additionalContext).toMatch(/rules\).*lane=bug/);
  });

  it("stays within the time budget when the model hangs", () => {
    const PATH = stubClaude("sleep 10");
    const r = run(hookInput("The offline outbox drops a write"), {
      MODUO_ROUTER: "haiku",
      MODUO_ROUTER_BUDGET_MS: "300",
      PATH,
    });
    expect(r.status).toBe(0);
    expect(context(r.stdout).additionalContext).toContain("lane=bug");
    expect(r.ms).toBeLessThan(2000);
  });

  it("is registered in settings.json as a UserPromptSubmit hook that cannot block", () => {
    const settings = JSON.parse(readFileSync(path.join(ROOT, ".claude/settings.json"), "utf8"));
    type Hook = { type: string; command: string; timeout?: number; onFailure?: string };
    const hooks = (settings.hooks.UserPromptSubmit as { hooks: Hook[] }[])
      .flatMap((e) => e.hooks)
      .filter((h) => h.command.includes("scripts/agent/router.ts"));
    expect(hooks).toHaveLength(1);
    expect(hooks[0].type).toBe("command");
    expect(hooks[0].onFailure).toBeUndefined();
    expect(hooks[0].timeout).toBeLessThanOrEqual(5);
    expect(hooks[0].command).toMatch(/exit 0'?$/);
  });

  it("writes one short line of context", () => {
    expect(contextLine(route("Run /s2 HV-23")).length).toBeLessThan(300);
  });
});

describe("scout agent (AC4)", () => {
  const file = readFileSync(path.join(ROOT, ".claude/agents/scout.md"), "utf8");
  const frontmatter = file.split("---")[1];

  it("runs on Haiku, read-only", () => {
    expect(frontmatter).toMatch(/^name: scout$/m);
    expect(frontmatter).toMatch(/^model: haiku$/m);
    const tools = frontmatter.match(/^tools: (.*)$/m)?.[1].split(/,\s*/) ?? [];
    expect(tools).toEqual(expect.arrayContaining(["Read", "Grep", "Glob"]));
    for (const writer of ["Edit", "Write", "NotebookEdit", "Bash"]) {
      expect(tools).not.toContain(writer);
    }
  });

  it("asks for files, symbols, current decisions and rules with line numbers", () => {
    for (const heading of ["Files", "Symbols", "Decisions", "Rules"]) {
      expect(file).toContain(`**${heading}**`);
    }
    expect(file).toContain("path:line");
  });
});
