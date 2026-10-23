/**
 * Decisions as data (HV-11, specs/harness-v3.md AC29). Every entry in
 * docs/decisions/<area>.md carries a status line right under its title:
 *
 *   status: current
 *   status: current · supersedes: tasks 2026-10-10 "TV-D11a"
 *   status: superseded · by: 2026-10-20 "A sign-out keeps what waits to sync"
 *   status: dropped
 *
 * It closes the entry's first paragraph: under a bullet entry it is a
 * sub-bullet (`  - status: …`), under a heading entry its own paragraph after
 * the heading. The first such line in the entry counts. A reference is `[area] [date] "title
 * prefix"` (area defaults to the entry's own) and must match exactly one entry.
 *
 * An entry is a dated `##`/`###` heading, or a top-level `- **…**` bullet that
 * sits outside a dated heading (an undated heading such as "Earlier entries"
 * only groups bullet entries). Bullets inside a dated heading are its parts.
 *
 *   bun run docs:current <area> [--titles] [--all]   the current view of one area
 *   bun run docs:index                              regenerate docs/decisions.md
 *   bun run lint:decisions                          statuses, references, index freshness
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "docs/decisions");
const INDEX = path.join(ROOT, "docs/decisions.md");

export const STATUSES = ["current", "superseded", "dropped"] as const;
export type Status = (typeof STATUSES)[number];

// Reading order of the index: cross-cutting first, then modules. New areas append alphabetically.
const ORDER = [
  "workflow",
  "permissions",
  "billing",
  "meet",
  "desktop-release",
  "toolchain",
  "email",
  "mcp",
  "calendar",
  "notes",
  "contacts",
  "dashboard",
  "data",
  "spine",
  "tasks",
  "chat",
  "design-system",
  "brand",
  "product",
];

export type Ref = { area: string | null; date: string | null; prefix: string };

export type Entry = {
  area: string;
  /** 1-based line of the title. */
  line: number;
  kind: "heading" | "bullet";
  date: string | null;
  title: string;
  /** null when the entry has no status line. */
  status: Status | null;
  supersedes: Ref[];
  by: Ref[];
  /** The entry's lines, title first, trailing blank lines trimmed. */
  lines: string[];
  /** Index into `lines` of the status line, or -1. */
  statusAt: number;
};

export type Area = { name: string; title: string; entries: Entry[] };

const DATE = /^(\d{4}-\d{2}-\d{2}) · /;
const HEADING = /^(#{2,3}) (.*)$/;
const STATUS_LINE = /^(?: {2}- )?status: *(\S+)(.*)$/;

/** The `**` that closes the opening one, skipping any inside backticks (titles quote globs). */
function closingBold(line: string): number {
  let inCode = false;
  for (let i = 4; i < line.length - 1; i++) {
    if (line[i] === "`") inCode = !inCode;
    else if (!inCode && line[i] === "*" && line[i + 1] === "*") return i;
  }
  return -1;
}

function splitDate(head: string): { date: string | null; title: string } {
  const m = head.match(DATE);
  return m ? { date: m[1], title: head.slice(m[0].length).trim() } : { date: null, title: head.trim() };
}

/** Splits `a · b "x · y" · c` on ` · ` outside quotes. */
function splitFields(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    if (!quoted && text.startsWith(" · ", i)) {
      out.push(cur);
      cur = "";
      i += 2;
      continue;
    }
    cur += text[i];
  }
  out.push(cur);
  return out.map((f) => f.trim()).filter(Boolean);
}

export function parseRefs(text: string): Ref[] {
  const refs: Ref[] = [];
  const re = /(?:([a-z][a-z-]*) +)?(?:(\d{4}-\d{2}-\d{2}) +)?"([^"]+)"/g;
  for (const m of text.matchAll(re)) refs.push({ area: m[1] ?? null, date: m[2] ?? null, prefix: m[3] });
  return refs;
}

export class DecisionsError extends Error {}

/** Parses one area file. Throws on a malformed status line; a missing one is reported by `validate`. */
export function parseArea(name: string, text: string): Area {
  const src = text.split("\n");
  const title = text.match(/^# Decisions:\s*(.+)$/m)?.[1]?.trim() ?? name;
  const entries: Entry[] = [];
  let open: { start: number; kind: Entry["kind"]; head: string } | null = null;
  // Inside a dated heading, top-level bullets are that entry's parts.
  let inDatedHeading = false;

  const close = (end: number) => {
    if (!open) return;
    const lines = src.slice(open.start, end);
    while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
    entries.push(build(name, open.start + 1, open.kind, open.head, lines));
    open = null;
  };

  src.forEach((line, i) => {
    const h = line.match(HEADING);
    if (h) {
      close(i);
      inDatedHeading = DATE.test(h[2]);
      if (inDatedHeading) open = { start: i, kind: "heading", head: h[2] };
      return;
    }
    if (line.startsWith("# ")) {
      close(i);
      inDatedHeading = false;
      return;
    }
    if (!inDatedHeading && line.startsWith("- **")) {
      close(i);
      const end = closingBold(line);
      open = { start: i, kind: "bullet", head: end === -1 ? line.slice(4) : line.slice(4, end) };
    }
  });
  close(src.length);
  return { name, title, entries };
}

function build(area: string, line: number, kind: Entry["kind"], head: string, lines: string[]): Entry {
  const { date, title } = splitDate(head);
  const entry: Entry = { area, line, kind, date, title, status: null, supersedes: [], by: [], lines, statusAt: -1 };
  const i = lines.findIndex((l, n) => n > 0 && STATUS_LINE.test(l));
  if (i === -1) return entry;
  const m = lines[i].match(STATUS_LINE) as RegExpMatchArray;
  const where = `docs/decisions/${area}.md:${line + i}`;
  if (!(STATUSES as readonly string[]).includes(m[1]))
    throw new DecisionsError(`${where}: unknown status "${m[1]}" (use ${STATUSES.join(", ")})`);
  entry.status = m[1] as Status;
  entry.statusAt = i;
  for (const field of splitFields(m[2].replace(/^ *· */, ""))) {
    const kv = field.match(/^(supersedes|by): *(.*)$/);
    if (!kv) throw new DecisionsError(`${where}: unknown field "${field}" (use supersedes: or by:)`);
    const refs = parseRefs(kv[2]);
    if (refs.length === 0) throw new DecisionsError(`${where}: ${kv[1]}: needs a reference like 2026-10-20 "Title start"`);
    if (kv[1] === "by") entry.by.push(...refs);
    else entry.supersedes.push(...refs);
  }
  return entry;
}

const norm = (s: string) =>
  s
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export function resolveRef(areas: Area[], from: Entry, ref: Ref): Entry[] {
  const area = areas.find((a) => a.name === (ref.area ?? from.area));
  if (!area) return [];
  const prefix = norm(ref.prefix);
  return area.entries.filter((e) => (ref.date === null || e.date === ref.date) && norm(e.title).startsWith(prefix));
}

export const label = (e: Entry) => `${e.area} ${e.date ? `${e.date} ` : ""}"${e.title.slice(0, 60)}"`;

/** Every problem across the areas: missing statuses, superseded without a successor, dangling or ambiguous references. */
export function validate(areas: Area[]): string[] {
  const problems: string[] = [];
  for (const area of areas) {
    for (const e of area.entries) {
      const at = `docs/decisions/${e.area}.md:${e.line}`;
      if (e.status === null) {
        problems.push(`${at}: no status line under ${label(e)} (add "status: current" right under the title)`);
        continue;
      }
      if (e.status === "superseded" && e.by.length === 0)
        problems.push(`${at}: superseded but names no successor (add · by: <date> "<title start>")`);
      if (e.status !== "superseded" && e.by.length > 0) problems.push(`${at}: by: is only for superseded entries`);
      for (const [kind, refs] of [
        ["supersedes", e.supersedes],
        ["by", e.by],
      ] as const) {
        for (const ref of refs) {
          const hits = resolveRef(areas, e, ref);
          const shown = `${ref.area ? `${ref.area} ` : ""}${ref.date ? `${ref.date} ` : ""}"${ref.prefix}"`;
          if (hits.length === 0) problems.push(`${at}: ${kind}: ${shown} matches no entry`);
          else if (hits.length > 1) problems.push(`${at}: ${kind}: ${shown} matches ${hits.length} entries; quote more of the title`);
          else if (hits[0] === e) problems.push(`${at}: ${kind}: ${shown} points at the entry itself`);
          else if (kind === "supersedes" && hits[0].status === "superseded" && !hits[0].by.some((r) => resolveRef(areas, hits[0], r)[0] === e))
            problems.push(`${at}: supersedes ${label(hits[0])}, which is superseded but doesn't name this entry in by:`);
        }
      }
    }
  }
  return problems;
}

export function readAreas(dir = DIR): Area[] {
  const names = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
  const ordered = [...ORDER.filter((a) => names.includes(a)), ...names.filter((a) => !ORDER.includes(a)).sort()];
  return ordered.map((name) => parseArea(name, fs.readFileSync(path.join(dir, `${name}.md`), "utf8")));
}

const indexLine = (e: Entry) => `- ${e.date ? `${e.date} · ` : ""}${e.title}`;

export function renderIndex(areas: Area[]): string {
  const sections = areas.map((area) => {
    const current = area.entries.filter((e) => e.status === "current" || e.status === null);
    const hidden = area.entries.length - current.length;
    const tail = hidden > 0 ? `\n\n${hidden} superseded or dropped ${hidden === 1 ? "entry is" : "entries are"} left out; they stay in the area file.` : "";
    return `## ${area.title} → [decisions/${area.name}.md](decisions/${area.name}.md)\n\n${current.map(indexLine).join("\n")}${tail}`;
  });
  return `# Decisions log (index)

<!-- GENERATED by \`bun run docs:index\` from docs/decisions/*.md (scripts/docs/decisions.ts). Do not edit by hand; CI fails when it is stale. -->

The current decisions, one line each, grouped by area, in each area file's order (newest first). Superseded and dropped entries are left out. The full entry lives in the area file linked in each heading; \`bun run docs:current <area>\` prints an area's current entries in full.

**Adding a decision:** write the full entry at the top of \`docs/decisions/<area>.md\` (one bold title sentence, then the why and a pointer to the authoritative doc) with \`- status: current\` as its first sub-bullet (a \`##\` entry takes \`status: current\` as its first paragraph). When it replaces an earlier entry, add \`· supersedes: <area> <date> "<title start>"\` to its status line and mark the old one \`status: superseded · by: <area> <date> "<title start>"\`. Then run \`bun run docs:index\`. If no area fits, use \`product\`.

> Migration-status clauses inside older entries ("deploy-ready but unapplied") describe the day they were written, not today. Probe the database before treating one as a task. See [decisions/data.md](decisions/data.md).

${sections.join("\n\n")}
`;
}

/** The current view of one area: current entries in full (or as index lines), superseded and dropped hidden unless `all`. */
export function renderCurrent(area: Area, opts: { titles?: boolean; all?: boolean } = {}): string {
  const shown = area.entries.filter((e) => opts.all || e.status === "current" || e.status === null);
  const hidden = area.entries.length - shown.length;
  const head = `# Decisions: ${area.title} (${opts.all ? "all" : "current"} · ${shown.length} of ${area.entries.length}${hidden ? `, ${hidden} superseded or dropped hidden` : ""})`;
  const body = opts.titles
    ? shown.map((e) => `${indexLine(e)}  (docs/decisions/${e.area}.md:${e.line})`).join("\n")
    : shown.map((e) => `<!-- docs/decisions/${e.area}.md:${e.line} -->\n${e.lines.join("\n")}`).join("\n\n");
  return `${head}\n\n${body}\n`;
}

function main(argv: string[]): void {
  const [cmd, ...rest] = argv;
  const areas = readAreas();
  switch (cmd) {
    case "current": {
      const name = rest.find((a) => !a.startsWith("--"));
      const area = areas.find((a) => a.name === name);
      if (!area) {
        const rows = areas.map((a) => {
          const n = (s: Status) => a.entries.filter((e) => e.status === s).length;
          return `  ${a.name.padEnd(16)} ${n("current")} current · ${n("superseded")} superseded · ${n("dropped")} dropped`;
        });
        throw new DecisionsError(
          `${name ? `No area "${name}". ` : ""}usage: bun run docs:current <area> [--titles] [--all]\n${rows.join("\n")}`,
        );
      }
      process.stdout.write(renderCurrent(area, { titles: rest.includes("--titles"), all: rest.includes("--all") }));
      return;
    }
    case "index": {
      fs.writeFileSync(INDEX, renderIndex(areas));
      console.log(`Wrote docs/decisions.md (${areas.reduce((n, a) => n + a.entries.length, 0)} entries across ${areas.length} areas).`);
      return;
    }
    case "check": {
      const problems = validate(areas);
      if (fs.readFileSync(INDEX, "utf8") !== renderIndex(areas))
        problems.push("docs/decisions.md is stale: run `bun run docs:index` and commit it.");
      if (problems.length > 0) throw new DecisionsError(problems.join("\n"));
      console.log(`Decisions OK: ${areas.reduce((n, a) => n + a.entries.length, 0)} entries, index current.`);
      return;
    }
    default:
      throw new DecisionsError("usage: decisions.ts current <area> [--titles] [--all] | index | check");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
