// Comment-thread rules shared by every surface that hosts comments (Notes'
// Comments panel, the Tasks detail feed): who wrote a comment, which @mentions
// still notify, where the inline `@` picker is, and how a body splits around
// the mentions it names. Pure, so the composer's behavior is tested without a
// DOM or a runtime.

import type { SpineComment } from "@/lib/runtime.types";
import { replaceSlashDates } from "./grammar";
import { dateUri, referenceUri } from "./references/text";
import type { ReferenceRef } from "./references/types";

/** A person who can be @mentioned in a comment, or who wrote one. */
export type CommentPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

/** A mention picked in the composer: who, and the label typed into the text. */
export type PickedMention = { id: string; label: string };

/** Is `@label` still present in the text at a word boundary? Boundary-matched
 * so mentioning "@Anna" doesn't also notify a bystander "Ann" (NO-7 validator M1). */
export function mentionStillPresent(text: string, label: string): boolean {
  const needle = `@${label}`;
  let from = 0;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i < 0) return false;
    const after = text[i + needle.length];
    if (after === undefined || !/\w/.test(after)) return true;
    from = i + 1;
  }
}

/** The mentioned people a posted body still names, de-duplicated. Only they are notified. */
export function keptMentionIds(text: string, mentions: PickedMention[]): string[] {
  const ids = new Set<string>();
  for (const m of mentions) if (mentionStillPresent(text, m.label)) ids.add(m.id);
  return [...ids];
}

/** A thing picked after `@` in the composer (RF-1): written `@Title` while typing. */
export type PickedThing = { ref: ReferenceRef; label: string };

/**
 * The body a comment stores (RF-1, research §8): every picked thing still
 * written `@Title` becomes its reference (`moduo://task/<id>`) and every
 * `/today` · `/tomorrow` · `/next week` a date chip (`moduo://date/…`), so
 * the stored text carries no title for anyone to read, notifications
 * included. A person mention keeps its `@Name` (people win a name clash).
 */
export function commentBodyWithReferences(
  text: string,
  things: PickedThing[],
  people: PickedMention[],
  now: Date = new Date(),
): string {
  const personLabels = new Set(people.map((p) => p.label));
  // Longest first, so "@Brand guidelines PDF" wins over "@Brand".
  const picked = [...things]
    .filter((t) => !personLabels.has(t.label))
    .sort((a, b) => b.label.length - a.label.length);
  let out = text;
  for (const thing of picked) {
    const needle = `@${thing.label}`;
    let from = 0;
    for (;;) {
      const i = out.indexOf(needle, from);
      if (i < 0) break;
      const before = out[i - 1];
      const after = out[i + needle.length];
      const atStart = i === 0 || /\s/.test(before ?? "");
      const atEnd = after === undefined || !/\w/.test(after);
      if (atStart && atEnd && !insidePersonMention(out, i, people)) {
        const uri = referenceUri(thing.ref);
        out = `${out.slice(0, i)}${uri}${out.slice(i + needle.length)}`;
        from = i + uri.length;
      } else {
        from = i + 1;
      }
    }
  }
  return replaceSlashDates(out, dateUri, now);
}

/** Whether `@` at `i` starts a picked person's longer name ("@Anna Lee" for a thing "Anna"). */
function insidePersonMention(text: string, i: number, people: PickedMention[]): boolean {
  return people.some((p) => {
    const needle = `@${p.label}`;
    if (!text.startsWith(needle, i)) return false;
    const after = text[i + needle.length];
    return after === undefined || !/\w/.test(after);
  });
}

/**
 * The `@query` the caret sits at the end of, or null. An `@` counts only at the
 * start of the text or after whitespace, so an email address never opens the
 * picker. The query is the word typed so far (letters, digits, `.`, `-`, `_`).
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([\p{L}\p{N}._-]*)$/u.exec(before);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

/** Replace the `@query` at `start…caret` with `@Label ` and return the new caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  label: string,
): { text: string; caret: number } {
  const inserted = `@${label} `;
  const after = text.slice(caret).replace(/^ /, "");
  return {
    text: `${text.slice(0, start)}${inserted}${after}`,
    caret: start + inserted.length,
  };
}

/** People whose name matches the typed query (case-insensitive, any word start first). */
export function filterPeople(people: CommentPerson[], query: string, limit = 6): CommentPerson[] {
  const q = query.trim().toLowerCase();
  if (!q) return people.slice(0, limit);
  const starts: CommentPerson[] = [];
  const contains: CommentPerson[] = [];
  for (const p of people) {
    const name = p.name.toLowerCase();
    if (name.split(/\s+/).some((w) => w.startsWith(q))) starts.push(p);
    else if (name.includes(q)) contains.push(p);
  }
  return [...starts, ...contains].slice(0, limit);
}

export type CommentSegment = { text: string; mention: boolean };

/**
 * Split a comment body into plain runs and `@Name` runs, for the names given
 * (longest first, so "@Ann Lee" wins over "@Ann"). A mention needs a word
 * boundary after it, like `mentionStillPresent`.
 */
export function splitMentions(text: string, names: string[]): CommentSegment[] {
  const labels = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  const out: CommentSegment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "@" && (i === 0 || /\s/.test(text[i - 1]))) {
      const label = labels.find((l) => {
        if (!text.startsWith(`@${l}`, i)) return false;
        const after = text[i + l.length + 1];
        return after === undefined || !/\w/.test(after);
      });
      if (label) {
        if (plain) out.push({ text: plain, mention: false });
        plain = "";
        out.push({ text: `@${label}`, mention: true });
        i += label.length + 1;
        continue;
      }
    }
    plain += text[i];
    i += 1;
  }
  if (plain) out.push({ text: plain, mention: false });
  return out;
}

/**
 * Who a comment reads as: "You", the member's name, the app that wrote it over
 * an API key (never shown as the person), or "Former member".
 */
export function commentAuthorName(
  comment: Pick<SpineComment, "createdBy" | "authorKind" | "authorLabel">,
  currentUserId: string | null,
  nameOf: (userId: string) => string | null,
): string {
  if (comment.authorKind === "api_key") return `${comment.authorLabel ?? "App"} (app)`;
  if (comment.createdBy && comment.createdBy === currentUserId) return "You";
  return (comment.createdBy && nameOf(comment.createdBy)) || "Former member";
}

/** "just now" · "5m ago" · "3h ago" · "2d ago" · "Oct 6". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
