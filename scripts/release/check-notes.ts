/**
 * The release-notes leak check (REL-1, specs/release-v2.md). Release notes are
 * written by agents and published with no human review, so this is the only
 * gate between a note and the people reading it. A published note says what
 * people can do; it never names code, files, database objects or
 * infrastructure. The writing rules: docs/release-notes.md.
 *
 * It checks every pending note in `.changes/` and every text in
 * `release-notes/releases.json`, and fails naming each offending word.
 *
 * The deny-list of database and function names is read from the codebase at
 * run time (table, view and SQL function names in supabase/migrations, Edge
 * Function directory names in supabase/functions), so new ones are covered
 * without editing this file. Names that are a single plain word (`tasks`,
 * `contacts`) are product vocabulary and stay allowed; every other name has an
 * underscore or a hyphen and is also caught by the identifier rules.
 *
 * Written in erasable TypeScript only, so `node` (type stripping) and `bun` both run it.
 *
 * CLI: bun scripts/release/check-notes.ts   (part of `bun run verify` as `lint:notes`)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const NOTE_TYPES = ["new", "improved", "fixed", "security"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

/** The one text a `security` note may have. */
export const SECURITY_LINE = "Security and reliability improvements.";

export const MAX_NOTE_LENGTH = 200;

export type Note = {
  /** The file name without `.md`. */
  slug: string;
  type: NoteType;
  internal: boolean;
  highlight: boolean;
  text: string;
};

export type Leak = { word: string; reason: string };

/** Files in `.changes/` that aren't notes. */
const NOT_NOTES = new Set(["README.md"]);

// ── parsing ──────────────────────────────────────────────────────────────────

/**
 * Parses one note file: YAML front matter (`type`, `internal`, optional
 * `highlight`) and the text. Throws a readable error on a malformed file.
 */
export function parseNote(slug: string, source: string): Note {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error("needs YAML front matter between two `---` lines");
  const fields = new Map<string, string>();
  for (const raw of match[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const kv = /^([a-z]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!kv) throw new Error(`front matter line is not "key: value": ${line}`);
    if (fields.has(kv[1])) throw new Error(`front matter repeats "${kv[1]}"`);
    const value = kv[2].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
    fields.set(kv[1], value);
  }
  for (const key of fields.keys()) {
    if (!["type", "internal", "highlight"].includes(key)) {
      throw new Error(`unknown front matter key "${key}" (allowed: type, internal, highlight)`);
    }
  }
  const type = fields.get("type");
  if (!type || !(NOTE_TYPES as readonly string[]).includes(type)) {
    throw new Error(`type must be one of ${NOTE_TYPES.join(", ")} (got ${type ?? "nothing"})`);
  }
  const internal = parseBool(fields.get("internal"), "internal", true);
  const highlight = parseBool(fields.get("highlight"), "highlight", false) ?? false;
  const text = match[2].trim().replace(/\s+/g, " ");
  if (!text) throw new Error("has no text after the front matter");
  return { slug, type: type as NoteType, internal: internal as boolean, highlight, text };
}

function parseBool(value: string | undefined, key: string, required: boolean): boolean | null {
  if (value === undefined) {
    if (required) throw new Error(`needs "${key}: true" or "${key}: false"`);
    return null;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${key} must be true or false (got ${value})`);
}

/** Reads every pending note in `.changes/`, sorted by file name. */
export function readNotes(root = ROOT): { notes: Note[]; errors: string[] } {
  const dir = path.join(root, ".changes");
  const notes: Note[] = [];
  const errors: string[] = [];
  if (!fs.existsSync(dir)) return { notes, errors };
  for (const name of fs.readdirSync(dir).sort()) {
    if (NOT_NOTES.has(name) || name.startsWith(".")) continue;
    const rel = `.changes/${name}`;
    if (!name.endsWith(".md")) {
      errors.push(`${rel}: a note file ends in .md`);
      continue;
    }
    try {
      notes.push(parseNote(name.slice(0, -3), fs.readFileSync(path.join(dir, name), "utf8")));
    } catch (error) {
      errors.push(`${rel}: ${(error as Error).message}`);
    }
  }
  return { notes, errors };
}

// ── the deny-list, read from the codebase ────────────────────────────────────

export type DenyList = Map<string, string>;

const DB_OBJECT =
  /\bcreate\s+(?:or\s+replace\s+)?(table|view|materialized\s+view|function)\s+(?:if\s+not\s+exists\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)/gi;

/**
 * Names a note must never use: tables, views and SQL functions created in
 * supabase/migrations, and Edge Function directories in supabase/functions.
 * Keys are lowercase; values say what the name is.
 */
export function buildDenyList(root = ROOT): DenyList {
  const deny: DenyList = new Map();
  const add = (name: string, what: string) => {
    const key = name.toLowerCase();
    // A single plain word (`tasks`) is product vocabulary, not an internal name.
    if (!/[_-]/.test(key) || ALLOWED_WORDS.has(key)) return;
    if (!deny.has(key)) deny.set(key, what);
  };
  const migrations = path.join(root, "supabase", "migrations");
  if (fs.existsSync(migrations)) {
    for (const file of fs.readdirSync(migrations)) {
      if (!file.endsWith(".sql")) continue;
      const sql = fs.readFileSync(path.join(migrations, file), "utf8");
      for (const m of sql.matchAll(DB_OBJECT)) {
        const kind = m[1].toLowerCase().includes("function") ? "SQL function name" : "table name";
        add(m[2].replace(/"/g, "").split(".").pop() as string, kind);
      }
    }
  }
  const functions = path.join(root, "supabase", "functions");
  if (fs.existsSync(functions)) {
    for (const entry of fs.readdirSync(functions, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith(".")) {
        add(entry.name, "Edge Function name");
      }
    }
  }
  return deny;
}

// ── the rules ────────────────────────────────────────────────────────────────

/** Internal words, matched whole and case-insensitively (with plurals). */
const BANNED_TERMS: Array<[RegExp, string]> = [
  [/\brls\b/gi, "RLS"],
  [/\bmigrations?\b/gi, "migration"],
  [/\bsupabase\b/gi, "Supabase"],
  [/\btauri\b/gi, "Tauri"],
  [/\brust\b/gi, "Rust"],
  [/\bcloudflare\b/gi, "Cloudflare"],
  [/\bworkers?\b/gi, "Worker"],
  [/\bendpoints?\b/gi, "endpoint"],
  [/\btokens?\b/gi, "token"],
  [/\bsecrets?\b/gi, "secret"],
  [/\bcves?\b/gi, "CVE"],
  [/\bexploits?\b/gi, "exploit"],
  [/\bvulnerabilit(?:y|ies)\b/gi, "vulnerability"],
  [/\bvalidators?\b/gi, "validator"],
  [/\bturborepo\b/gi, "Turborepo"],
  [/\bworkflows?\b/gi, "workflow"],
  // Not in the spec's list, but just as internal.
  [/\bpostgres(?:ql)?\b/gi, "Postgres"],
  [/\bsql\b/gi, "SQL"],
  [/\bedge functions?\b/gi, "Edge Function"],
  [/\bservice[ -]role\b/gi, "service role"],
];

/**
 * Product words that sound technical but name things people use: agents,
 * Claude Desktop, MCP, GitHub pull requests (the GitHub-on-tasks feature).
 * None of the rules flag them; this set also keeps them out of the deny-list.
 */
const ALLOWED_WORDS = new Set(["agent", "agents", "claude", "desktop", "mcp", "github", "pull"]);

/** Brand spellings with an inner capital that aren't code (lowercased). */
const BRAND_CASE = new Set([
  "macos",
  "ios",
  "ipados",
  "iphone",
  "ipad",
  "icloud",
  "github",
  "gitlab",
  "youtube",
  "linkedin",
  "whatsapp",
  "paypal",
  "macbook",
  "facetime",
  "airpods",
  "hubspot",
  "wordpress",
  "quickbooks",
  "clickup",
  "duckduckgo",
]);

/** Hyphenated English that a kebab-case identifier rule would otherwise catch. */
const HYPHENATED_WORDS = new Set([
  "sign-in",
  "sign-up",
  "sign-out",
  "log-in",
  "check-in",
  "follow-up",
  "built-in",
  "add-on",
  "add-ons",
  "to-do",
  "to-dos",
  "pop-up",
  "drop-down",
  "one-click",
  "right-click",
  "double-click",
  "drag-and-drop",
  "real-time",
  "read-only",
  "up-to-date",
  "end-to-end",
  "two-factor",
  "day-to-day",
  "time-zone",
  "dark-mode",
  "e-mail",
  "opt-in",
  "opt-out",
  "set-up",
  "per-person",
  "per-task",
  "per-project",
  "wi-fi",
]);

/** First parts that make an ordinary English compound (`re-open`, `non-blocking`). */
const HYPHEN_PREFIXES = new Set([
  "re",
  "co",
  "non",
  "pre",
  "multi",
  "self",
  "cross",
  "half",
  "full",
  "all",
  "well",
  "auto",
  "one",
  "two",
  "three",
  "first",
  "last",
  "long",
  "short",
  "high",
  "low",
  "fast",
  "faster",
  "slow",
  "easy",
  "hard",
  "in",
  "out",
  "off",
  "on",
  "up",
  "under",
  "over",
]);

const FILE_EXTENSION =
  /\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|json|jsonc|md|sql|rs|toml|ya?ml|sh|css|html?|lock|env|wasm|dmg|exe|msi)\b/gi;
const PATH = /(?:^|[\s(])(?:\.{0,2}\/)?[\w.@-]+(?:\/[\w.@-]+)+\/?/g;
const CAMEL_CASE = /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;
const PASCAL_CASE = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g;
const SNAKE_CASE = /\b[A-Za-z0-9]*_[A-Za-z0-9_]*\b/g;
const KEBAB_CASE = /\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b/g;
const BLOCK_ID = /\b[A-Z]{2,5}-[A-Z]?\d+[a-z]?\b/g;
const BLOCK_ID_WHOLE = /^[A-Z]{2,5}-[A-Z]?\d+[a-z]?$/;
const CALL = /\w\(|\(\)/g;

/** Every leak in one published text, in reading order, each word once. */
export function findLeaks(text: string, deny: DenyList): Leak[] {
  const leaks: Array<Leak & { at: number }> = [];
  const seen = new Set<string>();
  const push = (word: string, reason: string, at: number) => {
    const key = `${word.toLowerCase()}\u0000${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    leaks.push({ word, reason, at });
  };
  const each = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    for (const m of text.matchAll(re)) fn(m);
  };

  each(/`/g, (m) => push("`", "backtick (code formatting)", m.index ?? 0));
  each(CALL, (m) => push(m[0], "parentheses after a word (a code call)", m.index ?? 0));
  each(FILE_EXTENSION, (m) => push(m[0], "file name", m.index ?? 0));
  each(PATH, (m) => push(m[0].trim().replace(/^\(/, ""), "file path", m.index ?? 0));
  each(BLOCK_ID, (m) => push(m[0], "block or ticket ID", m.index ?? 0));
  each(/#\d+\b/g, (m) => push(m[0], "pull request or issue number", m.index ?? 0));
  each(/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/g, (m) =>
    push(m[0], "commit hash", m.index ?? 0),
  );
  each(CAMEL_CASE, (m) => {
    if (!BRAND_CASE.has(m[0].toLowerCase())) push(m[0], "camelCase identifier", m.index ?? 0);
  });
  each(PASCAL_CASE, (m) => {
    if (!BRAND_CASE.has(m[0].toLowerCase())) push(m[0], "PascalCase identifier", m.index ?? 0);
  });
  each(SNAKE_CASE, (m) => {
    if (m[0].includes("_") && /[A-Za-z]/.test(m[0])) {
      push(m[0], "snake_case identifier", m.index ?? 0);
    }
  });
  each(KEBAB_CASE, (m) => {
    const word = m[0];
    const lower = word.toLowerCase();
    if (!/[a-z]/i.test(word) || BLOCK_ID_WHOLE.test(word)) return;
    if (deny.has(lower)) return; // named below with what it is
    if (/^\d+-[a-z]+$/.test(lower)) return; // 3-minute, 24-hour
    const parts = lower.split("-");
    if (HYPHENATED_WORDS.has(lower) || (parts.length === 2 && HYPHEN_PREFIXES.has(parts[0]))) {
      return;
    }
    push(word, "kebab-case identifier", m.index ?? 0);
  });
  for (const [re, term] of BANNED_TERMS) {
    each(re, (m) => push(m[0], `internal term (${term})`, m.index ?? 0));
  }
  each(/[A-Za-z0-9_-]+/g, (m) => {
    const what = deny.get(m[0].toLowerCase());
    if (what) push(m[0], what, m.index ?? 0);
  });

  return leaks.sort((a, b) => a.at - b.at).map(({ word, reason }) => ({ word, reason }));
}

/** Shape problems with a published text: length, sentences, the security line. */
export function shapeProblems(text: string, type: NoteType): string[] {
  if (type === "security") {
    return text === SECURITY_LINE ? [] : [`a security note must be exactly "${SECURITY_LINE}"`];
  }
  const problems: string[] = [];
  if (text.length > MAX_NOTE_LENGTH) {
    problems.push(`is ${text.length} characters (at most ${MAX_NOTE_LENGTH})`);
  }
  if (!/[.!?]$/.test(text)) problems.push("must end a sentence with . ! or ?");
  const sentences = text
    .replace(/\b(?:e\.g|i\.e|etc|vs)\./gi, "")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean).length;
  if (sentences > 2) problems.push(`has ${sentences} sentences (one or two)`);
  return problems;
}

/** All problems with one published text, as readable lines. */
export function checkText(text: string, type: NoteType, deny: DenyList): string[] {
  const leaks = findLeaks(text, deny);
  const lines = shapeProblems(text, type);
  if (leaks.length) {
    lines.push(`leaks internal words: ${leaks.map((l) => `"${l.word}" (${l.reason})`).join(", ")}`);
  }
  return lines;
}

// ── releases.json ────────────────────────────────────────────────────────────

export type ReleaseItem = { type: NoteType; text: string };
export type Release = {
  version: string;
  date: string;
  highlights: string[];
  items: ReleaseItem[];
};
export type ReleasesFile = { releases: Release[] };

export const RELEASES_PATH = path.join("release-notes", "releases.json");

/** Problems with the shape of releases.json (the texts are checked separately). */
export function releasesShapeProblems(data: unknown): string[] {
  const problems: string[] = [];
  const file = data as ReleasesFile;
  if (!file || !Array.isArray(file.releases)) return ['needs { "releases": [ … ] }'];
  const versions = new Set<string>();
  file.releases.forEach((r, i) => {
    const at = `releases[${i}]`;
    if (!/^\d+\.\d+\.\d+$/.test(r?.version ?? "")) problems.push(`${at}.version is not X.Y.Z`);
    if (versions.has(r?.version)) problems.push(`${at}: version ${r.version} appears twice`);
    versions.add(r?.version);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r?.date ?? "")) problems.push(`${at}.date is not YYYY-MM-DD`);
    if (!Array.isArray(r?.highlights) || r.highlights.length > 2) {
      problems.push(`${at}.highlights must be a list of at most 2 texts`);
    }
    if (!Array.isArray(r?.items)) problems.push(`${at}.items must be a list`);
    for (const [j, item] of (r?.items ?? []).entries()) {
      if (!(NOTE_TYPES as readonly string[]).includes(item?.type)) {
        problems.push(`${at}.items[${j}].type must be one of ${NOTE_TYPES.join(", ")}`);
      }
    }
  });
  return problems;
}

// ── the whole check ──────────────────────────────────────────────────────────

/** Runs the check over a repo root; returns one line per problem (empty = pass). */
export function checkRepo(root = ROOT, deny = buildDenyList(root)): string[] {
  const { notes, errors } = readNotes(root);
  const problems = [...errors];
  for (const note of notes) {
    if (note.internal) continue; // never published
    for (const line of checkText(note.text, note.type, deny)) {
      problems.push(`.changes/${note.slug}.md: ${line}`);
    }
  }
  const releasesFile = path.join(root, RELEASES_PATH);
  if (fs.existsSync(releasesFile)) {
    let data: ReleasesFile | null = null;
    try {
      data = JSON.parse(fs.readFileSync(releasesFile, "utf8"));
    } catch (error) {
      problems.push(`${RELEASES_PATH}: not valid JSON (${(error as Error).message})`);
    }
    if (data) {
      for (const line of releasesShapeProblems(data)) problems.push(`${RELEASES_PATH}: ${line}`);
      for (const r of data.releases ?? []) {
        for (const item of r.items ?? []) {
          for (const line of checkText(item.text ?? "", item.type, deny)) {
            problems.push(`${RELEASES_PATH} ${r.version}: "${item.text}" ${line}`);
          }
        }
        for (const text of r.highlights ?? []) {
          for (const line of checkText(text, "new", deny)) {
            problems.push(`${RELEASES_PATH} ${r.version} highlight: "${text}" ${line}`);
          }
        }
      }
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkRepo();
  if (problems.length) {
    console.error("Release notes failed the leak check (rules: docs/release-notes.md):\n");
    for (const line of problems) console.error(`  ✗ ${line}`);
    console.error("\nRewrite each note in plain words about what people can now do.");
    process.exit(1);
  }
  const { notes } = readNotes();
  console.log(
    `Release notes OK (${notes.length} pending, ${buildDenyList().size} internal names).`,
  );
}
