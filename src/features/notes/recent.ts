/**
 * Pure shaper for the Recent-notes dashboard widget (Wave-3 NO-10, AC13).
 *
 * Input rows come from `runtime.notesV2.recent` (trashed already excluded,
 * newest-first). This shapes them into widget rows: latest-touched first, a
 * one-line snippet from the derived body text, a relative "touched" label, and
 * the deep-link target (`{ type: 'note', id }` → `moduo:entity:open`).
 */

const SNIPPET_MAX = 120;

export type RecentNoteRow = {
  id: string;
  title: string;
  bodyText: string;
  updatedAt: string;
  isArchived: boolean;
  publishedAt: string | null;
};

export type RecentNoteItem = {
  id: string;
  title: string;
  snippet: string;
  updatedAt: string;
  touchedLabel: string;
  isArchived: boolean;
  isPublished: boolean;
};

export function displayNoteTitle(title: string): string {
  const t = (title ?? "").trim();
  return t || "Untitled";
}

/** Collapse the derived body text into a single-line snippet; a body that only
 * repeats the title (first line = title) contributes nothing. */
function snippetFrom(title: string, bodyText: string): string {
  const firstLine = displayNoteTitle(title);
  const rest = (bodyText ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    // Drop the leading line if it's just the title echoed back.
    .filter((l, i) => !(i === 0 && l === firstLine))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!rest) return "";
  return rest.length > SNIPPET_MAX ? `${rest.slice(0, SNIPPET_MAX).trimEnd()}…` : rest;
}

/** Human "touched N ago" — pure (now injected), calendar-agnostic (elapsed ms). */
export function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function shapeRecentNotes(
  rows: RecentNoteRow[],
  opts: { limit?: number; now: Date },
): RecentNoteItem[] {
  const limit = opts.limit ?? 6;
  return [...rows]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      title: displayNoteTitle(r.title),
      snippet: snippetFrom(r.title, r.bodyText),
      updatedAt: r.updatedAt,
      touchedLabel: timeAgo(r.updatedAt, opts.now),
      isArchived: r.isArchived,
      isPublished: Boolean(r.publishedAt),
    }));
}
