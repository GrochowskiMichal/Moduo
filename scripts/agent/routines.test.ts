import { readFileSync } from "node:fs";
import path from "node:path";

import type { Rpc } from "./moduo-sync";
import { assertPublishable, writeNote } from "./numbers";
import {
  addedEntries,
  createBody,
  fileBug,
  isStale,
  latestRelease,
  localTask,
  parseLog,
  pickSeed,
  postToChannel,
  prodRelevantFailures,
  readPrompt,
  renderWatch,
  RETRO_PARENT,
  routine,
  ROUTINES,
  ruleActivity,
  type WatchFacts,
  watchStatus,
  type WorkflowRun,
} from "./routines";

// specs/harness-v3.md AC35 · HV-22: the four routines are defined with a prompt, a cadence and
// what they need; the cloud ones print a valid RemoteTrigger body, the local one a scheduled-task
// definition; the prod watch is read-only; and the deterministic halves the prompts call (seed,
// watch, retro facts, Moduo writes) behave.

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCRIPTS = Object.keys(
  (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: object })
    .scripts,
);
const COMMANDS = ["list", "body", "task", "seed", "watch", "retro-facts", "post", "note", "bug"];

function fakeRpc(answers: Record<string, unknown>) {
  const calls: [string, Record<string, unknown>][] = [];
  const rpc: Rpc = async (tool, args) => {
    calls.push([tool, args]);
    return answers[tool] ?? { ok: true };
  };
  return { rpc, calls };
}

describe("the four routines", () => {
  it("are the hunt, the retro, the prod watch and the numbers, each with a prompt", () => {
    expect(ROUTINES.map((r) => r.id)).toEqual(["variant-hunt", "retro", "prod-watch", "numbers"]);
    for (const r of ROUTINES) {
      const prompt = readPrompt(r.id, ROOT);
      expect(prompt.length).toBeGreaterThan(200);
      expect(() => assertPublishable(prompt)).not.toThrow();
      expect(r.cron.split(" ")).toHaveLength(5);
      expect(r.needs.length).toBeGreaterThan(0);
    }
  });

  it("runs in the cloud on Anthropic models, hourly or slower, except the numbers on Mike's Mac", () => {
    for (const r of ROUTINES.filter((x) => x.where === "cloud")) {
      expect(r.model).toMatch(/^claude-(opus|sonnet|haiku|fable)-/);
      // Cloud routines take at most one run an hour: the minute field is a fixed number.
      expect(r.cron.split(" ")[0]).toMatch(/^\d+$/);
    }
    expect(routine("numbers").where).toBe("local");
    expect(routine("prod-watch").model).toMatch(/haiku/);
  });

  it("keeps the prod watch read-only: no file tools, and only the watch and the post", () => {
    expect(routine("prod-watch").allowedTools).toEqual(["Bash", "Read"]);
    const prompt = readPrompt("prod-watch", ROOT);
    const runs = [...prompt.matchAll(/`bun run (?:--silent )?routine (\S+)/g)].map((m) => m[1]);
    expect(new Set(runs)).toEqual(new Set(["watch", "post"]));
    expect(prompt).toMatch(/Never apply a migration, deploy/);
  });

  it("names only scripts and routine commands that exist", () => {
    for (const r of ROUTINES) {
      const prompt = readPrompt(r.id, ROOT);
      for (const m of prompt.matchAll(
        /bun run (?:--silent |--cwd \S+ )*([\w:.-]+)(?: ([\w-]+))?/g,
      )) {
        // `bun run local:*` names a family the prompts forbid, not one script.
        if (m[1]!.endsWith(":")) continue;
        expect(SCRIPTS).toContain(m[1]);
        if (m[1] === "routine") expect(COMMANDS).toContain(m[2]);
      }
    }
  });
});

describe("createBody / localTask", () => {
  it("prints the RemoteTrigger create shape with the prompt as a user message", () => {
    const r = routine("prod-watch");
    const body = createBody(r, "hello", { environmentId: "env_x", uuid: "u-1" }) as {
      cron_expression: string;
      job_config: { ccr: Record<string, unknown> };
    };
    expect(body).toMatchObject({ name: r.name, cron_expression: "0 6 * * *", enabled: true });
    expect(body.job_config.ccr).toEqual({
      environment_id: "env_x",
      session_context: {
        model: "claude-haiku-5-5",
        sources: [{ git_repository: { url: "https://github.com/GrochowskiMichal/Moduo" } }],
        allowed_tools: ["Bash", "Read"],
      },
      events: [
        {
          data: {
            uuid: "u-1",
            session_id: "",
            type: "user",
            parent_tool_use_id: null,
            message: { content: "hello", role: "user" },
          },
        },
      ],
    });
  });

  it("generates a fresh v4 uuid by default", () => {
    const body = JSON.stringify(createBody(routine("retro"), "p"));
    expect(body).toMatch(
      /"uuid":"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/,
    );
  });

  it("keeps each kind to its own printer", () => {
    expect(() => createBody(routine("numbers"), "p")).toThrow(/locally/);
    expect(() => localTask(routine("retro"), "p")).toThrow(/cloud/);
    expect(localTask(routine("numbers"), "p")).toEqual({
      taskId: "moduo-numbers",
      title: "Moduo weekly numbers",
      description: routine("numbers").cadence,
      cronExpression: "0 7 * * 1",
      prompt: "p",
    });
  });
});

describe("pickSeed", () => {
  const now = new Date("2026-10-27T01:00:00Z");
  const escapes = [
    { id: "509-1", addedAt: "2026-10-01T00:00:00Z" },
    { id: "509-2", addedAt: "2026-10-01T00:00:00Z" },
    { id: "645-1", addedAt: "2026-10-26T12:00:00Z" },
    { id: "645-2", addedAt: "2026-10-26T15:00:00Z" },
  ];

  it("hunts the newest escape of the last two days first", () => {
    expect(pickSeed(escapes, now)?.id).toBe("645-2");
  });

  it("otherwise takes turns by day", () => {
    const later = (d: number) => new Date(now.getTime() + d * 86_400_000);
    const ids = [3, 4, 5, 6].map((d) => pickSeed(escapes, later(d))?.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("answers null with no escapes", () => {
    expect(pickSeed([], now)).toBeNull();
  });
});

describe("prod watch", () => {
  it("finds the newest release tag, peeled", () => {
    const ls = [
      `${"a".repeat(40)}\trefs/tags/v1.9.0`,
      `${"b".repeat(40)}\trefs/tags/v1.10.0`,
      `${"c".repeat(40)}\trefs/tags/v1.10.0^{}`,
      `${"d".repeat(40)}\trefs/tags/v1.10.0-rc1`,
    ].join("\n");
    expect(latestRelease(ls)).toEqual({ tag: "v1.10.0", sha: "c".repeat(40) });
    expect(latestRelease("")).toBeNull();
  });

  const run = (o: Partial<WorkflowRun>): WorkflowRun => ({
    name: "checks",
    event: "push",
    head_branch: "develop",
    conclusion: "failure",
    created_at: "2026-10-27T00:00:00Z",
    html_url: "https://example.test/run",
    ...o,
  });

  it("keeps red runs on shared branches, tags and schedules, not task branches or cancels", () => {
    const kept = prodRelevantFailures([
      run({}),
      run({ head_branch: "v1.4.0", event: "push" }),
      run({ head_branch: "t/mike/x", event: "schedule" }),
      run({ head_branch: "t/mike/x", event: "pull_request" }),
      run({ conclusion: "cancelled" }),
      run({ conclusion: "success" }),
    ]);
    expect(kept.map((r) => `${r.head_branch}/${r.event}`)).toEqual([
      "develop/push",
      "v1.4.0/push",
      "t/mike/x/schedule",
    ]);
  });

  it("says all clear only when every check passed and nothing went red", () => {
    const facts: WatchFacts = {
      at: "2026-10-27T06:00:00Z",
      release: { tag: "v1.4.0", sha: "668a65d6a065" },
      checks: [{ name: "app · GET /", ok: true, detail: "200" }],
      failedRuns: [],
    };
    expect(watchStatus(facts)).toBe("ok");
    expect(renderWatch(facts)).toMatch(/all clear[\s\S]*v1\.4\.0 \(668a65d\)/);
    const bad = { ...facts, failedRuns: [run({})] };
    expect(watchStatus(bad)).toBe("attention");
    expect(renderWatch(bad)).toMatch(/needs a look[\s\S]*checks · push · develop · failure/);
    const down = { ...facts, checks: [{ name: "x", ok: false, detail: "HTTP 503" }] };
    expect(watchStatus(down)).toBe("attention");
  });
});

describe("retro facts", () => {
  const rule = (file: string, paths: string[], expires = "2027-01-31") => ({
    file,
    paths,
    expires,
    text: "",
  });

  it("marks a rule stale when no commit touched its paths or cited it in 30 days", () => {
    const commits = parseLog(
      [
        "",
        "Fix grants\n\nSee .claude/rules/supabase.md\x01\nsupabase/migrations/1.sql\n",
        "Tweak button\x01\napps/app/src/components/ui/button.tsx\n",
      ].join("\0"),
    );
    expect(commits).toEqual([
      {
        message: "Fix grants\n\nSee .claude/rules/supabase.md",
        files: ["supabase/migrations/1.sql"],
      },
      { message: "Tweak button", files: ["apps/app/src/components/ui/button.tsx"] },
    ]);
    const out = ruleActivity(
      [
        rule(".claude/rules/supabase.md", ["supabase/**"]),
        rule(".claude/rules/desktop-rust.md", ["apps/desktop/src-tauri/**"]),
        rule(".claude/rules/old.md", ["apps/**"], "2026-10-01"),
      ],
      commits,
      "2026-10-27",
    );
    expect(out.map((r) => [r.file, r.touched, r.cited, r.expired, isStale(r)])).toEqual([
      [".claude/rules/supabase.md", 1, 1, false, false],
      [".claude/rules/desktop-rust.md", 0, 0, false, true],
      [".claude/rules/old.md", 1, 0, true, false],
    ]);
  });

  it("lists entries a diff adds, not ones it only moved", () => {
    const diff = [
      "+- **New trap.** body",
      "+- **Moved trap.** body",
      "-- **Moved trap.** body",
      "+- **New trap.** again",
      " - **Old trap.** context",
    ].join("\n");
    expect(addedEntries(diff)).toEqual(["New trap."]);
  });
});

describe("Moduo writes", () => {
  it("posts to an existing channel by id", async () => {
    const { rpc, calls } = fakeRpc({
      chat_list_channels: [
        { id: "c-old", name: "prod-watch", archived: true },
        { id: "c-1", name: "prod-watch", archived: false },
      ],
    });
    expect(await postToChannel(rpc, "prod-watch", "all clear")).toBe("c-1");
    expect(calls.at(-1)).toEqual(["chat_post", { channel: "c-1", text: "all clear" }]);
  });

  it("never creates a channel, and never posts a secret or an oversized message", async () => {
    const { rpc, calls } = fakeRpc({ chat_list_channels: [{ id: "g", name: "general" }] });
    await expect(postToChannel(rpc, "prod-watch", "hi")).rejects.toThrow(/a person creates it/);
    await expect(postToChannel(rpc, "general", `sk-${"x".repeat(30)}`)).rejects.toThrow(/secret/);
    await expect(postToChannel(rpc, "general", "x".repeat(8001))).rejects.toThrow(/8,000/);
    expect(calls.map(([t]) => t)).toEqual(["chat_list_channels"]);
  });

  it("files a confirmed variant as a bug task in the Moduo project, keyed for re-runs", async () => {
    const { rpc, calls } = fakeRpc({
      projects_list: [
        { id: "p-inbox", name: "Inbox" },
        { id: "p-moduo", name: "Moduo" },
      ],
      tasks_create: { id: "t", handle: "MOD-700" },
    });
    expect(await fileBug(rpc, "509-1", "Layout lost (variant of 509-1)", "damage")).toBe("MOD-700");
    expect(calls.at(-1)).toEqual([
      "tasks_create",
      {
        title: "Layout lost (variant of 509-1)",
        description: "damage",
        project_id: "p-moduo",
        tags: ["bug", "variant-hunt"],
        imported_from: { source: "variant-hunt", key: "509-1:Layout lost (variant of 509-1)" },
      },
    ]);
  });

  it("writes the retro note under its own parent", async () => {
    const { rpc, calls } = fakeRpc({ notes_search: [], notes_create: { id: "n" } });
    await writeNote(rpc, "Weekly retro · w", "body", RETRO_PARENT);
    const creates = calls.filter(([t]) => t === "notes_create").map(([, a]) => a);
    expect(creates[0]).toEqual({ title: "Harness weekly retro", markdown: RETRO_PARENT.intro });
    expect(creates[1]).toMatchObject({ title: "Weekly retro · w", parent_id: "n" });
  });
});
