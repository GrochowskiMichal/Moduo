/**
 * Release notes, from pending `.changes/` files to what people read (REL-1,
 * specs/release-v2.md). `release-notes/releases.json` is the source of truth:
 * the app bundles it (What's new), the landing renders `/changelog` from it,
 * and `CHANGELOG.md` and the updater-manifest notes are rendered from it here.
 *
 *   collect   pending notes → the next version (any `new` → minor, else patch)
 *   release   a releases.json entry: public items grouped New, Improved, Fixed,
 *             Security; internal notes left out; at most two highlights
 *   render    CHANGELOG.md and the Markdown for updater notes
 *
 * Written in erasable TypeScript only, so `node` (type stripping) and `bun` both run it.
 *
 * CLI:
 *   bun scripts/release/changes.ts status                 pending notes and the next version
 *   bun scripts/release/changes.ts prepare [--date D]     bump VERSION, add the release to
 *        [--version X.Y.Z] [--reliability]                releases.json, rewrite CHANGELOG.md,
 *                                                          delete the consumed note files
 *   bun scripts/release/changes.ts notes <X.Y.Z>          updater Markdown for a released version
 *   bun scripts/release/changes.ts coming-next            updater Markdown for pending notes
 *   bun scripts/release/changes.ts changelog              rewrite CHANGELOG.md from releases.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkRepo,
  type Note,
  type NoteType,
  readNotes,
  type Release,
  type ReleaseItem,
  RELEASES_PATH,
  type ReleasesFile,
  ROOT,
  SECURITY_LINE,
} from "./check-notes.ts";

/** The order items are listed in, everywhere. */
const TYPE_ORDER: NoteType[] = ["new", "improved", "fixed", "security"];

const GROUP_TITLES: Record<NoteType, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
  security: "Security",
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

// ── collect and version ──────────────────────────────────────────────────────

/** Notes people will see (internal ones are never published). */
export function publicNotes(notes: Note[]): Note[] {
  return notes.filter((n) => !n.internal);
}

/** The next version: any public `new` note → minor, otherwise patch. */
export function nextVersion(current: string, notes: Note[]): string {
  const m = SEMVER.exec(current.trim());
  if (!m) throw new Error(`VERSION must be X.Y.Z (got "${current}")`);
  const [major, minor, patch] = m.slice(1).map(Number);
  return publicNotes(notes).some((n) => n.type === "new")
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;
}

// ── build a release ──────────────────────────────────────────────────────────

/** Public items in the fixed group order; security notes collapse to one line. */
export function releaseItems(notes: Note[]): ReleaseItem[] {
  const items: ReleaseItem[] = [];
  for (const type of TYPE_ORDER) {
    const ofType = publicNotes(notes).filter((n) => n.type === type);
    if (type === "security") {
      if (ofType.length) items.push({ type, text: SECURITY_LINE });
      continue;
    }
    for (const n of ofType) items.push({ type, text: n.text });
  }
  return items;
}

/**
 * At most two highlights: notes marked `highlight: true`, else the first `new`
 * items, else (a patch release) the first improved and fixed items, so the
 * update toast always has something to show.
 */
export function releaseHighlights(notes: Note[]): string[] {
  const visible = publicNotes(notes).filter((n) => n.type !== "security");
  const marked = visible.filter((n) => n.highlight);
  const fresh = visible.filter((n) => n.type === "new");
  const pick = marked.length ? marked : fresh.length ? fresh : releaseOrder(visible);
  return pick.slice(0, 2).map((n) => n.text);
}

function releaseOrder(notes: Note[]): Note[] {
  return TYPE_ORDER.flatMap((type) => notes.filter((n) => n.type === type));
}

/** The line a release with only internal notes ships with, when shipped anyway. */
export const RELIABILITY_LINE = "Reliability improvements.";

export function buildRelease(version: string, date: string, notes: Note[]): Release {
  if (!SEMVER.test(version)) throw new Error(`version must be X.Y.Z (got "${version}")`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date must be YYYY-MM-DD (got "${date}")`);
  return { version, date, highlights: releaseHighlights(notes), items: releaseItems(notes) };
}

/** releases.json with the new release first; refuses a version it already has. */
export function addRelease(file: ReleasesFile, release: Release): ReleasesFile {
  if (file.releases.some((r) => r.version === release.version)) {
    throw new Error(`releases.json already has ${release.version}`);
  }
  return { releases: [release, ...file.releases] };
}

// ── render ───────────────────────────────────────────────────────────────────

function groupedLines(items: ReleaseItem[], heading: string): string[] {
  const lines: string[] = [];
  for (const type of TYPE_ORDER) {
    const ofType = items.filter((i) => i.type === type);
    if (!ofType.length) continue;
    lines.push(`${heading} ${GROUP_TITLES[type]}`, "");
    for (const item of ofType) lines.push(`- ${item.text}`);
    lines.push("");
  }
  return lines;
}

/**
 * The Markdown for one release's updater notes (the manifest's `notes`, which
 * the update toast and What's new read). Highlights first, then the groups.
 */
export function renderReleaseMarkdown(release: Release): string {
  const lines: string[] = [];
  if (release.highlights.length) {
    for (const h of release.highlights) lines.push(`**${h}**`, "");
  }
  lines.push(...groupedLines(release.items, "###"));
  return `${lines.join("\n").trim()}\n`;
}

/** The staging manifest's notes: what's pending, under "Coming next". */
export function renderComingNextMarkdown(notes: Note[]): string {
  const items = releaseItems(notes);
  if (!items.length) return "Coming next: reliability improvements.\n";
  return `${["## Coming next", "", ...groupedLines(items, "###")].join("\n").trim()}\n`;
}

/** CHANGELOG.md, every release newest first, in the same words people see in the app. */
export function renderChangelog(file: ReleasesFile): string {
  const lines = [
    "# Changelog",
    "",
    "What changed in each Moduo release, newest first. Also in the app (What's new) and at",
    "https://moduo.app/changelog.",
    "",
    "<!-- Generated from release-notes/releases.json by scripts/release/changes.ts. Don't edit by hand. -->",
    "",
  ];
  for (const r of file.releases) {
    lines.push(`## ${r.version} · ${r.date}`, "", ...groupedLines(r.items, "###"));
  }
  return `${lines.join("\n").trim()}\n`;
}

// ── files ────────────────────────────────────────────────────────────────────

export function readReleases(root = ROOT): ReleasesFile {
  const file = path.join(root, RELEASES_PATH);
  if (!fs.existsSync(file)) return { releases: [] };
  return JSON.parse(fs.readFileSync(file, "utf8")) as ReleasesFile;
}

export function writeReleases(file: ReleasesFile, root = ROOT): void {
  const target = path.join(root, RELEASES_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`);
}

export type Prepared = { version: string; release: Release; consumed: string[] };

/**
 * Cuts a release from the pending notes: bumps VERSION, adds the release to
 * releases.json, rewrites CHANGELOG.md and deletes the consumed note files
 * (internal ones too). Refuses while any note fails the leak check.
 */
export function prepareRelease(
  opts: { root?: string; date: string; version?: string; reliability?: boolean } = {
    date: today(),
  },
): Prepared {
  const root = opts.root ?? ROOT;
  const problems = checkRepo(root);
  if (problems.length) throw new Error(`notes fail the leak check:\n${problems.join("\n")}`);
  const { notes } = readNotes(root);
  const current = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
  // Nothing people can notice: refuse, unless asked to ship a "Reliability improvements." patch.
  const shown = publicNotes(notes);
  if (!shown.length && !opts.reliability) {
    throw new Error("no public notes since the last release (pass --reliability to ship anyway)");
  }
  const released = shown.length
    ? notes
    : [
        {
          slug: "reliability",
          type: "improved" as const,
          internal: false,
          highlight: false,
          text: RELIABILITY_LINE,
        },
      ];
  const version = opts.version ?? nextVersion(current, released);
  if (compareSemver(version, current) <= 0) {
    throw new Error(`version ${version} must be higher than VERSION ${current}`);
  }
  const release = buildRelease(version, opts.date, released);
  const releases = addRelease(readReleases(root), release);
  writeReleases(releases, root);
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), renderChangelog(releases));
  fs.writeFileSync(path.join(root, "VERSION"), `${version}\n`);
  const consumed = notes.map((n) => `.changes/${n.slug}.md`);
  for (const rel of consumed) fs.rmSync(path.join(root, rel));
  return { version, release, consumed };
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(args: string[]): void {
  const [command, ...rest] = args;
  switch (command) {
    case "status": {
      const { notes, errors } = readNotes();
      if (errors.length) throw new Error(errors.join("\n"));
      const current = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
      const shown = publicNotes(notes);
      console.log(`VERSION ${current} → next ${nextVersion(current, notes)}`);
      console.log(`${shown.length} public note(s), ${notes.length - shown.length} internal`);
      for (const n of shown) console.log(`  ${n.type.padEnd(8)} ${n.text}`);
      return;
    }
    case "prepare": {
      const result = prepareRelease({
        date: flag(rest, "--date") ?? today(),
        version: flag(rest, "--version"),
        reliability: rest.includes("--reliability"),
      });
      console.log(`Prepared ${result.version}: ${result.consumed.length} note file(s) consumed.`);
      return;
    }
    case "notes": {
      const version = rest[0];
      const release = readReleases().releases.find((r) => r.version === version);
      if (!release) throw new Error(`releases.json has no ${version ?? "(no version given)"}`);
      process.stdout.write(renderReleaseMarkdown(release));
      return;
    }
    case "coming-next": {
      process.stdout.write(renderComingNextMarkdown(readNotes().notes));
      return;
    }
    case "changelog": {
      fs.writeFileSync(path.join(ROOT, "CHANGELOG.md"), renderChangelog(readReleases()));
      return;
    }
    default:
      throw new Error(
        "usage: changes.ts status | prepare | notes <X.Y.Z> | coming-next | changelog",
      );
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
