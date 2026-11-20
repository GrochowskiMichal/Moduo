// The desktop update toast's notes (REL-4, AC9). The updater manifest carries
// the next version's release notes as Markdown (`notes`, the Tauri update's
// `body`), rendered by the release pipeline from release-notes/releases.json.
// This build doesn't bundle that version yet, so the toast reads its two
// highlights, and What's new its grouped items, from the Markdown.
//
// The pipeline writes the highlights first, each as its own bold line
// (`**…**`), then `### New` / `### Improved` / `### Fixed` with `- ` bullets
// (scripts/release/changes.ts renderReleaseMarkdown). Read leniently: a
// Highlights heading with bullets works too, headings match by prefix at any
// level, and with no highlights at all the first two bullets stand in.

import { type NoteType, type Release, SECURITY_LINE } from "../whats-new/releases";

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.+?)\s*$/;
const BOLD_LINE = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/;

type Section = "highlights" | NoteType | null;

function sectionFor(title: string): Section {
  const t = title.trim().toLowerCase();
  if (t.startsWith("highlight")) return "highlights";
  if (t === "new" || t.startsWith("new ")) return "new";
  if (t.startsWith("improved")) return "improved";
  if (t.startsWith("fixed")) return "fixed";
  if (t.startsWith("security")) return "security";
  return null;
}

/** Plain text from one Markdown line: no emphasis, code ticks or link targets. */
function plain(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .trim();
}

function parse(body: string | null | undefined) {
  const highlights: string[] = [];
  const bullets: string[] = [];
  const items: Release["items"] = [];
  let section: Section = null;
  for (const raw of (body ?? "").split(/\r?\n/)) {
    const heading = HEADING.exec(raw);
    if (heading) {
      section = sectionFor(heading[1] ?? "");
      continue;
    }
    // A bold line before any group heading is a highlight.
    const bold = section === null || section === "highlights" ? BOLD_LINE.exec(raw) : null;
    if (bold) {
      const text = plain(bold[1] ?? "");
      if (text) highlights.push(text);
      continue;
    }
    const bullet = BULLET.exec(raw);
    if (!bullet) continue;
    const text = plain(bullet[1] ?? "");
    if (!text) continue;
    bullets.push(text);
    if (section === "highlights") highlights.push(text);
    else if (section === "security") items.push({ type: "security", text: SECURITY_LINE });
    else if (section) items.push({ type: section, text });
  }
  return { highlights: highlights.length ? highlights : bullets, items };
}

/** The next version's two highlights for the update toast (none when the notes have none). */
export function manifestHighlights(body: string | null | undefined): string[] {
  return parse(body).highlights.slice(0, 2);
}

/** The next version as a release What's new can show, or null when its notes say nothing. */
export function releaseFromManifest(update: {
  version: string;
  body: string | null;
  date: string | null;
}): Release | null {
  const { highlights, items } = parse(update.body);
  if (!items.length && !highlights.length) return null;
  const day = update.date ? new Date(update.date) : null;
  const date =
    day && Number.isFinite(day.getTime())
      ? day.toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  return {
    version: update.version,
    date,
    highlights,
    // No grouped notes: the highlights stand in as what's new.
    items: items.length ? items : highlights.map((text) => ({ type: "new", text })),
  };
}
