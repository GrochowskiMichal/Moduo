/**
 * ⌘K on a selection (NR-4, AC8): link the selected text to a URL or a note.
 * The pure part: what the typed text means and which rows the dialog offers.
 */

import type { Note } from "../model";
import { NOTE_LINK_LIMIT, noteLinkRows } from "./note-link";

/**
 * The URL a typed string links to, or null when it isn't one. A bare domain
 * (`moduo.app/pricing`) gets `https://`; `mailto:`/`tel:` stay as typed. Any
 * other scheme (`javascript:`, `data:`, …) is refused.
 */
export function linkUrlFrom(input: string): string | null {
  const raw = input.trim();
  if (raw === "" || /\s/.test(raw)) return null;
  if (/^(mailto|tel):/i.test(raw)) return raw;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // A bare word ("roadmap") is a note search, not a host.
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
  return withScheme;
}

export type LinkDialogRow =
  | { kind: "url"; url: string }
  | { kind: "note"; id: string; title: string }
  | { kind: "unlink" };

/** URL first (when the text is one), then matching notes, then "Remove link"
 * when the selection already holds one. */
export function linkDialogRows(
  input: string,
  notes: readonly Note[],
  currentNoteId: string | null,
  hasLink: boolean,
): LinkDialogRow[] {
  const rows: LinkDialogRow[] = [];
  const url = linkUrlFrom(input);
  if (url) rows.push({ kind: "url", url });
  for (const row of noteLinkRows(notes, input, currentNoteId, NOTE_LINK_LIMIT)) {
    if (row.kind === "note") rows.push(row);
  }
  if (hasLink) rows.push({ kind: "unlink" });
  return rows;
}
