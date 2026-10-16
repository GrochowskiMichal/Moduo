import { spawnSync } from "node:child_process";
import { describe, expect, it } from "@rstest/core";

import { EDITOR_CASES, ID, PASTE_CASES, STORED_CASES } from "./corpus";
import { parseStored } from "./parse";
import { mentionsOf } from "./text";

// The server reads a message's references with the client's grammar: for every
// stored text in the spike-4 corpus, plus the bodies below, Postgres'
// chat__body_refs (the "Mentioned in" rows) and chat__mentions (who is
// notified) find exactly what parseStored + mentionsOf find, in the same order.
// Runs against the local stack when it carries CV-13's migration (it adds
// chat__inline_scan), and says so when it can't.

const DB_URL =
  process.env.MODUO_DB_URL ?? "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";
const MIGRATION = "20261016180000_chat_v2_linked_channels.sql";
const TAG = "$moduo_refs_parity$";

const task = `moduo://task/${ID.task}`;
const note = `moduo://note/${ID.note}`;
const person = `moduo://person/${ID.person}`;
const team = `moduo://team/${ID.team}`;

/** Bodies the corpus doesn't spell out: code spans, escapes, link targets, fences in lists. */
const EXTRA: string[] = [
  `\`\`a ${task} b\`\``,
  `\\\`\` ${task} \``,
  `[see docs](https://example.com/${task})`,
  `- item\n  \`\`\`\n  ${task}\n  \`\`\`\n- ${note}`,
  `- one\n\n  \`\`\`\n  ${task}\n  \`\`\`\n- ${note}`,
  `1. ${person}\n2. \`${task}\`\n3. ${team}`,
  `\`\`\`\n${task}\n\`\`\`\n${note}`,
  `\`\`\`\`\n\`\`\`\n${task}\n\`\`\`\`\n${note}`,
  `> ${task}\n> \`${note}\``,
  `moduo\\://task/${ID.task} and ${note}`,
  `\\${task}`,
  `[${note}](${task})`,
  `[title](${task}) and [x](mailto:a@b.co) ${task}`,
  `[a](<${task}>) [b](https://x.test/(${note}))`,
  `\`one\` ${task} \`two\``,
  `\`\`\` ${task} \`\`\` ${note}`,
  `${task}${note}`,
  `@channel ${person} ${person} ${team}`,
  `x@channel ${task}`,
  `**${task}** _${note}_ ~~${person}~~`,
  `a \`unclosed ${task}`,
  `${task.toUpperCase()} moduo://Task/${ID.task}`,
  `moduo://date/2026-10-16 moduo://date/2026-02-30 ${task}`,
];

function stackState(): "ready" | string {
  const probe = spawnSync(
    "psql",
    [
      DB_URL,
      "-X",
      "-At",
      "-c",
      "select to_regprocedure('public.chat__inline_scan(text)') is not null",
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (probe.error) return `psql is not installed (${probe.error.message})`;
  if (probe.status !== 0) return "the local stack is not answering (bun run local:up)";
  if (probe.stdout.trim() !== "t") return `the local stack lacks ${MIGRATION}`;
  return "ready";
}

type Read = { refs: string[]; people: string[]; teams: string[]; channel: boolean };

function clientRead(body: string): Read {
  const m = mentionsOf(parseStored(body));
  // chat__body_refs lists every reference, people and teams included, each once.
  const all: string[] = [];
  const seen = new Set<string>();
  const add = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      all.push(key);
    }
  };
  for (const r of m.refs) add(`${r.type}/${r.id.toLowerCase()}`);
  return {
    refs: all,
    people: m.people.map((id) => id.toLowerCase()),
    teams: m.teams.map((id) => id.toLowerCase()),
    channel: m.channel,
  };
}

function serverRead(bodies: string[]): Read[] {
  const json = JSON.stringify(bodies);
  if (json.includes(TAG)) throw new Error("a body holds the dollar-quote tag");
  const sql = `
    SELECT coalesce(json_agg(json_build_object(
             'refs', (SELECT coalesce(json_agg(r.ref_type || '/' || r.ref_id), '[]'::json)
                        FROM public.chat__body_refs(b.body) r
                       WHERE r.ref_type NOT IN ('person', 'team')),
             'people', m.people, 'teams', m.teams, 'channel', m.everyone) ORDER BY b.o), '[]'::json)
      FROM json_array_elements_text(${TAG}${json}${TAG}::json) WITH ORDINALITY AS b(body, o),
           LATERAL public.chat__mentions(b.body) m;`;
  const out = spawnSync("psql", [DB_URL, "-X", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (out.status !== 0) throw new Error(`psql failed: ${out.stderr}`);
  return JSON.parse(out.stdout.trim()) as Read[];
}

const state = stackState();
// MODUO_REQUIRE_DB=1 (a run that must check the server) fails instead of skipping.
const required = process.env.MODUO_REQUIRE_DB === "1";
const run = state === "ready" || required ? it : it.skip;
if (state !== "ready") console.warn(`chat reference parity: not checked here — ${state}`);

describe("references: the server reads them with the client's grammar", () => {
  run(
    "chat__body_refs and chat__mentions agree with parseStored + mentionsOf on the corpus and the edge bodies",
    () => {
      const bodies = [
        ...EDITOR_CASES.map((c) => c.stored),
        ...PASTE_CASES.map((c) => c.stored),
        ...STORED_CASES.map((c) => c.input),
        ...EXTRA,
      ];
      const server = serverRead(bodies);
      expect(server.length).toBe(bodies.length);
      // Not vacuous: plenty of the bodies hold item references, people and teams.
      expect(server.filter((r) => r.refs.length > 0).length).toBeGreaterThan(20);
      expect(server.filter((r) => (r.people ?? []).length > 0).length).toBeGreaterThan(3);
      const report: string[] = [];
      bodies.forEach((body, i) => {
        const want = clientRead(body);
        const got = server[i] as Read;
        const norm = (r: Read) =>
          JSON.stringify({
            refs: r.refs,
            people: r.people ?? [],
            teams: r.teams ?? [],
            channel: r.channel,
          });
        if (norm(got) !== norm(want)) {
          report.push(`${JSON.stringify(body)}\n  client ${norm(want)}\n  server ${norm(got)}`);
        }
      });
      expect(report.join("\n")).toBe("");
      // The edge bodies are read as the client reads them (spelled out, so a
      // change on both sides still shows up here).
      const edge = serverRead(EXTRA.slice(0, 4)).map((r) => r.refs);
      expect(edge).toEqual([[], [], [], [`task/${ID.task}`, `note/${ID.note}`]]);
    },
    60_000,
  );
});
