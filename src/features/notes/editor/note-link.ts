/**
 * `[[` note links (NR-4, AC8): typing `[[` opens a note picker; picking a note
 * replaces `[[query` with a live note chip (the Reference node) and records a
 * `references` link from this note; "Create '…'" makes the note first. The
 * picker rides the shared caret-menu keys (spine/editor/menu-keys). This file
 * is the pure part: the trigger, the candidates and the insert.
 */

import { $createTextNode, $getNodeByKey, $isTextNode, type NodeKey } from "lexical";
import { $createEntityRefNode } from "../../spine/editor/entity-ref-schema";
import type { MentionCandidate } from "../../spine/mention";
import type { Note } from "../model";
import { displayTitle } from "../title";

/** The longest query the picker follows; past it `[[` is just text. */
export const NOTE_LINK_MAX_QUERY = 80;
export const NOTE_LINK_LIMIT = 8;

/** `[[query` right before the caret: where it starts and what was typed. */
export function noteLinkQueryAt(textBefore: string): { start: number; query: string } | null {
  const start = textBefore.lastIndexOf("[[");
  if (start < 0) return null;
  const query = textBefore.slice(start + 2);
  if (query.length > NOTE_LINK_MAX_QUERY || /[[\]\n]/.test(query)) return null;
  return { start, query };
}

export type NoteLinkRow =
  | { kind: "note"; id: string; title: string }
  | { kind: "create"; title: string };

/**
 * The picker's rows. Live notes only (not trashed, not archived, never the
 * note you're in); title-prefix hits before other hits, then the most recently
 * edited. An empty query lists recent notes. "Create '…'" is offered when no
 * title matches the query exactly: the top row when nothing matches at all,
 * the last row otherwise.
 */
export function noteLinkRows(
  notes: readonly Note[],
  query: string,
  currentNoteId: string | null,
  limit = NOTE_LINK_LIMIT,
): NoteLinkRow[] {
  const q = query.trim().toLowerCase();
  const live = notes.filter((n) => !n.deletedAt && !n.isArchived && n.id !== currentNoteId);
  const scored = live
    .map((n) => {
      const title = n.title.trim().toLowerCase();
      const rank = q === "" ? 1 : title.startsWith(q) ? 0 : title.includes(q) ? 1 : -1;
      return { n, rank };
    })
    .filter((s) => s.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.n.updatedAt.localeCompare(a.n.updatedAt))
    .slice(0, limit);
  const rows: NoteLinkRow[] = scored.map(({ n }) => ({
    kind: "note",
    id: n.id,
    title: displayTitle(n.title),
  }));
  if (q === "") return rows;
  const exact = live.some((n) => n.title.trim().toLowerCase() === q);
  if (exact) return rows;
  const create: NoteLinkRow = { kind: "create", title: query.trim() };
  return rows.length === 0 ? [create] : [...rows, create];
}

/** A picked note as the spine's link candidate (`references`, origin `ref`). */
export function noteLinkCandidate(id: string, title: string): MentionCandidate {
  return { kind: "entity", ref: { type: "note", id }, label: title, icon: "note" };
}

/** Where the typed `[[query` sits in the text node. */
export type NoteLinkToken = { nodeKey: NodeKey; start: number; end: number };

/**
 * Replace the typed `[[query` (and an auto-closed `]]` right after it) with a
 * note chip and a space, caret after them. Run inside `editor.update`.
 * Returns false when the token is gone (the text changed underneath).
 */
export function $insertNoteLink(
  token: NoteLinkToken,
  note: { id: string; title: string },
): boolean {
  const node = $getNodeByKey(token.nodeKey);
  if (!$isTextNode(node)) return false;
  const text = node.getTextContent();
  if (text.slice(token.start, token.start + 2) !== "[[" || token.end > text.length) return false;
  const end = text.slice(token.end, token.end + 2) === "]]" ? token.end + 2 : token.end;
  const [target] =
    token.start === 0
      ? node.splitText(end)
      : (() => {
          const parts = node.splitText(token.start, end);
          return [parts[1]];
        })();
  if (!target) return false;
  const chip = $createEntityRefNode({
    entityType: "note",
    entityId: note.id,
    label: note.title,
    icon: "note",
  });
  const space = $createTextNode(" ");
  target.replace(chip);
  chip.insertAfter(space);
  space.select(1, 1);
  return true;
}

/** A note title as the markdown of a one-line doc (so it reads back as text). */
export function titleAsMarkdown(title: string): string {
  return title.replace(/[\\`*_[\]#>~|<-]/g, (ch) => `\\${ch}`);
}
