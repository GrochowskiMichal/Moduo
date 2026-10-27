// The intent router (Harness v3, HV-23: AC3). A UserPromptSubmit command hook
// that adds one hidden line of context to every prompt: the lane (answer,
// fast, bug, block), the risk areas it touches and any block or task IDs it
// names. It only advises: it never blocks, never asks, and any failure (bad
// input, model error, timeout) ends in exit 0, with the rules' answer or none.
//
//   MODUO_ROUTER=rules   (default) keyword rules, a few milliseconds
//   MODUO_ROUTER=haiku   asks Haiku through `claude -p` within the budget and
//                        falls back to the rules when it is late or wrong
//   MODUO_ROUTER=off     adds nothing
//   MODUO_ROUTER_BUDGET_MS  the Haiku budget (default 1800); a rig arm that
//                        wants Haiku's answers raises it and the hook's
//                        timeout in .claude/settings.json together (~5–7 s)
//
// Haiku through `claude -p` on the Max login takes ~4.5 s today (CLI start
// plus the call), over AC3's ~2 s, so the rules are the default and Haiku is
// an arm for the A/B rig. Every decision goes to .claude/logs/router.jsonl
// (gitignored, no prompt text) as the rig's data; an override in words
// ("treat this as a block", "fast lane") is logged as a label.

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const LANES = ["answer", "fast", "bug", "block"] as const;
export const AREAS = ["sync", "auth", "rls", "billing", "mcp", "desktop", "ui"] as const;
export type Lane = (typeof LANES)[number];
export type Area = (typeof AREAS)[number];
export type Route = {
  lane: Lane;
  areas: Area[];
  /** Block IDs (HV-23, TV-D16) and task handles (MOD-595) the prompt names. */
  ids: string[];
  /** The person named the lane in words; it wins over any classifier. */
  override: boolean;
  /** With an override, the lane the rules would have picked: the label's prediction. */
  predicted?: Lane;
  source: "rules" | "haiku";
};

// "Treat this as …" anywhere; a bare "fast lane" only as the prompt's opening
// words, so "add the fast lane section to the docs" isn't a label.
const OVERRIDES: [RegExp, Lane][] = [
  [/\btreat (?:this|it) as an? block\b|^block lane\b/i, "block"],
  [/\btreat (?:this|it) as an? bug\b|^bug lane\b/i, "bug"],
  [/\btreat (?:this|it) as (?:a )?fast(?: lane)?\b|^fast lane\b/i, "fast"],
  [/\btreat (?:this|it) as an? question\b|^just answer\s*[:,-]/i, "answer"],
];

const AREA_WORDS: [Area, RegExp][] = [
  ["sync", /\b(?:sync(?:ing|ed)?|offline|outbox|realtime|yjs|lib\/sync|conflicts?)\b/i],
  [
    "auth",
    /\b(?:auth\w*|log ?in|log ?out|sign(?:ing)?[ -]?(?:in|up|out)|sessions?|passwords?|oauth|magic link|jwt)\b/i,
  ],
  [
    "rls",
    /\b(?:rls|polic(?:y|ies)|permissions?|row[- ]level|security definer|migrations?|grants?|service[- ]role)\b/i,
  ],
  [
    "billing",
    /\b(?:billing|stripe|subscriptions?|invoices?|checkout|pric(?:e|es|ing)|plan tiers?)\b/i,
  ],
  ["mcp", /\b(?:mcp|moduo-mcp|connectors?)\b/i],
  ["desktop", /\b(?:desktop|tauri|rust|redb|updater|src-tauri|cargo)\b/i],
  [
    "ui",
    /\b(?:ui|ux|design|tokens?|css|tailwind|buttons?|layouts?|screens?|components?|storybook|dark mode|styles?|styling|shadcn|modal|dialog)\b/i,
  ],
];

const ID = /\b(?:[A-Z]{1,6}-)+[A-Z]?\d+[a-z]?\b/g;
const NOT_IDS = /^(?:UTF|ISO|SHA|RFC|CVE|ES|TLS|HTTP|P)-/;
const BUILD_VERB =
  /\b(?:build|claim|implement|plan|spec|ship|land|wrap|execute|start|run|pick up|work on)\b/i;
const BUG =
  /\b(?:bugs?|broken|breaks|crash(?:es|ed|ing)?|regress(?:ion|ed)?|doesn'?t work|isn'?t working|not working|fails?|failing|failed|errors?|exceptions?|stack ?trace|flak(?:y|e|es)|drops?|dropped|lost|loses|stuck|hangs?|freezes?|loops)\b/i;
const QUESTION_START =
  /^(?:what|why|how|where|when|which|who|whose|is|are|was|were|do|does|did|can|could|should|would|will|explain|tell me|show me)\b/i;
// A change asked politely ("can you rename …?") is still a change, not a question.
const CHANGE_START =
  /^(?:(?:can|could|would|will) you (?:please )?|please )?(?:add|make|change|rename|remove|delete|update|fix|move|bump|write|create|refactor|replace|set|turn|use|let'?s)\b/i;

/** The keyword rules: instant, deterministic, the default router. */
export function route(prompt: string): Route {
  // A huge paste is classified by its start: the ID pattern backtracks on long runs.
  const text = prompt.trim().slice(0, 8000);
  const ids = [...new Set(text.match(ID) ?? [])].filter((id) => !NOT_IDS.test(id)).slice(0, 10);
  const areas = AREA_WORDS.filter(([, re]) => re.test(text)).map(([area]) => area);

  const blockIds = ids.filter((id) => !id.startsWith("MOD-"));
  let lane: Lane = "fast";
  if (
    /(?:^|\s)\/s[123]\b/.test(text) ||
    (blockIds.length > 0 && BUILD_VERB.test(text)) ||
    /\bspecs\/|\bnew (?:module|feature)\b/i.test(text)
  ) {
    lane = "block";
  } else if (CHANGE_START.test(text) && !/^(?:\w+ you (?:please )?|please )?fix\b/i.test(text)) {
    // "Rename the error message" is an edit that mentions an error, not a bug.
    lane = "fast";
  } else if (BUG.test(text)) {
    lane = "bug";
  } else if ((text.endsWith("?") || QUESTION_START.test(text)) && !CHANGE_START.test(text)) {
    lane = "answer";
  }
  const override = OVERRIDES.find(([re]) => re.test(text));
  if (override) {
    return { lane: override[1], areas, ids, override: true, predicted: lane, source: "rules" };
  }
  return { lane, areas, ids, override: false, source: "rules" };
}

/** Reads Haiku's `{"lane": …, "areas": […]}`; null when it is anything else. */
export function parseModelAnswer(text: string, rules: Route): Route | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const answer = JSON.parse(json) as { lane?: unknown; areas?: unknown };
    if (!LANES.includes(answer.lane as Lane)) return null;
    const areas = Array.isArray(answer.areas)
      ? AREAS.filter((area) => (answer.areas as unknown[]).includes(area))
      : [];
    return { ...rules, lane: answer.lane as Lane, areas, source: "haiku" };
  } catch {
    return null;
  }
}

export function modelPrompt(prompt: string): string {
  return [
    "Classify this request to a coding agent in the Moduo repo.",
    "Lanes: answer (a question, no code change), fast (a small change that fits one sentence),",
    "bug (something is broken), block (planned feature work, a spec block, /s1 /s2 /s3).",
    `Risk areas, zero or more: ${AREAS.join(", ")}.`,
    'Reply with JSON only: {"lane": "...", "areas": ["..."]}',
    "Request:",
    "<<<",
    prompt.slice(0, 4000),
    ">>>",
  ].join("\n");
}

/** Asks Haiku through the logged-in CLI, hooks off, no tools; rejects past the budget. */
export function askHaiku(prompt: string, budgetMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "--model",
        "haiku",
        "--settings",
        '{"disableAllHooks":true}',
        "--tools",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--output-format",
        "text",
        modelPrompt(prompt),
      ],
      {
        cwd: tmpdir(),
        env: { ...process.env, MODUO_ROUTER: "off" },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("router: model over budget"));
    }, budgetMs);
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`router: model exited ${code}`));
    });
  });
}

export async function classify(
  prompt: string,
  opts: { mode: string; budgetMs: number; ask?: typeof askHaiku },
): Promise<Route> {
  const rules = route(prompt);
  if (opts.mode !== "haiku" || rules.override) return rules;
  try {
    const text = await (opts.ask ?? askHaiku)(prompt, opts.budgetMs);
    return parseModelAnswer(text, rules) ?? rules;
  } catch {
    return rules;
  }
}

export function contextLine(r: Route): string {
  const parts = [`lane=${r.lane}`, `areas=${r.areas.length ? r.areas.join(",") : "none"}`];
  if (r.ids.length) parts.push(`ids=${r.ids.join(",")}`);
  if (r.override) parts.push("override=the person's own words");
  return `Router (HV-23, advisory, ${r.source}): ${parts.join(" · ")}. The person can override in words ("treat this as a block", "fast lane"); when the lane looks wrong, follow the request, not this note.`;
}

/** A task notification or another event Claude Code feeds in as a prompt: no one's request. */
export function isEvent(prompt: string): boolean {
  return /^<[a-z][a-z-]*[\s>]/.test(prompt.trimStart());
}

function log(r: Route, sessionId: unknown, ms: number) {
  try {
    const dir = path.join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), ".claude/logs");
    mkdirSync(dir, { recursive: true });
    const row = { at: new Date().toISOString(), session_id: sessionId ?? null, ...r, ms };
    appendFileSync(path.join(dir, "router.jsonl"), `${JSON.stringify(row)}\n`);
  } catch {
    // The log is the rig's data, never a reason to fail the prompt.
  }
}

async function main() {
  const mode = process.env.MODUO_ROUTER ?? "rules";
  if (mode === "off") return;
  const input = JSON.parse(await new Response(Bun.stdin.stream()).text()) as {
    prompt?: unknown;
    session_id?: unknown;
  };
  if (typeof input.prompt !== "string" || !input.prompt.trim() || isEvent(input.prompt)) return;
  const started = performance.now();
  const budgetMs = Number(process.env.MODUO_ROUTER_BUDGET_MS) || 1800;
  const r = await classify(input.prompt, { mode, budgetMs });
  log(r, input.session_id, Math.round(performance.now() - started));
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: contextLine(r) },
    }),
  );
}

if (import.meta.main) {
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
