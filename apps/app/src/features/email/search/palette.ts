// MR-13 — the rebuilt engine's answers shaped for ⌘K's Email group (AC32), and
// the saved-search items that pin a query to Mail's rail. Pure.

import type { SearchAllRow } from "@contracts/search";

import type { EmailSettingsItem } from "../../../lib/runtime.types.email";
import type { MailThreadRow } from "../../../lib/runtime.types.mail-engine";

/** Rows ⌘K asks the engine for (one group in full, as the server's most). */
export const MAIL_PALETTE_LIMIT = 50;

function senderOf(row: MailThreadRow): string | null {
  const last = row.senders[row.senders.length - 1];
  if (!last) return null;
  return last.name.trim() || last.email || null;
}

/** The engine's matches as Email rows, newest first. A thread pulled into
 * Moduo goes by its `email_refs` id, so it is one row with the server's. */
export function engineMailRows(
  rows: readonly MailThreadRow[],
  refIdByThread: ReadonlyMap<string, string> = new Map(),
): SearchAllRow[] {
  return [...rows]
    .sort((a, b) => b.lastDateMs - a.lastDateMs)
    .map((row) => ({
      entity_type: "email_thread",
      entity_id: refIdByThread.get(row.threadId) ?? row.threadId,
      title: row.subject,
      context: senderOf(row),
      snippet: null,
      icon: null,
      match: "title",
      rank: 0.5,
      updated_at: new Date(row.lastDateMs).toISOString(),
      archived: false,
      score: 0.5,
      type_total: 0,
      top: false,
    }));
}

/** A server-escalation hit (an envelope the Rust server search upserted). */
export type ServerHit = {
  threadId?: string | null;
  messageKey?: string | null;
  id?: string | null;
  subject?: string | null;
  sender?: string | null;
  senderEmail?: string | null;
  date?: string | null;
  timestampMs?: number | null;
};

export function serverMailRows(hits: readonly ServerHit[]): SearchAllRow[] {
  const seen = new Set<string>();
  const out: SearchAllRow[] = [];
  for (const h of hits) {
    const id = h.threadId || h.messageKey || h.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ms = h.timestampMs ?? (h.date ? Date.parse(h.date) : Number.NaN);
    out.push({
      entity_type: "email_thread",
      entity_id: id,
      title: h.subject?.trim() || "(no subject)",
      context: h.sender?.trim() || h.senderEmail || null,
      snippet: null,
      icon: null,
      match: "body",
      rank: 0.25,
      updated_at: new Date(Number.isNaN(ms) ? 0 : ms).toISOString(),
      archived: false,
      score: 0.25,
      type_total: 0,
      top: false,
    });
  }
  return out;
}

export type SavedSearch = { id: string; name: string; query: string; position: number };

/** The `saved_search` settings item's value. */
export function savedSearchValue(query: string, name?: string): Record<string, unknown> {
  const q = query.trim();
  return { name: name?.trim() || q, query: q };
}

/** Live saved searches from the settings items, in rail order. */
export function readSavedSearches(items: readonly EmailSettingsItem[]): SavedSearch[] {
  const out: SavedSearch[] = [];
  for (const item of items) {
    if (item.kind !== "saved_search" || item.deletedAt) continue;
    const query = typeof item.value.query === "string" ? item.value.query.trim() : "";
    if (!query) continue;
    const name = typeof item.value.name === "string" && item.value.name.trim() ? item.value.name.trim() : query;
    out.push({ id: item.id, name, query, position: item.position });
  }
  return out.sort((a, b) => a.position - b.position);
}

/** Already pinned: the same query (case and spacing aside). */
export function isSavedSearch(saved: readonly SavedSearch[], query: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return saved.some((s) => norm(s.query) === norm(query));
}
