/**
 * Import materialization bridge (NO-8) — the batched `notes_op_import` op lands
 * each note's `body_md`/`body_text` (immediately searchable + exportable), but
 * the in-editor CRDT doc is built by the LIVE editor on first open (the spec's
 * sanctioned assumption-10 path — building a Lexical-Yjs doc headless is the
 * risk the connector also defers). The wizard registers each imported note's
 * markdown here; the editor's SeedFromMarkdownPlugin converts it into the doc
 * the first time that note is opened THIS session, then drops it.
 *
 * Cross-session/device rendering of an imported body (opened elsewhere before
 * it's ever materialized) is the documented follow-up; the content is never
 * lost — it lives in `body_md`.
 */

const pendingSeeds = new Map<string, string>();

export function registerNoteSeed(noteId: string, md: string): void {
  if (md.trim()) pendingSeeds.set(noteId, md);
}

/** A note's pending import markdown WITHOUT consuming it — the seed plugin
 * peeks first so a fast unmount before the deferred apply doesn't lose it
 * (it re-applies on the next open). */
export function peekNoteSeed(noteId: string): string | null {
  return pendingSeeds.get(noteId) ?? null;
}

/** Consume a note's pending seed (call only once it has actually been applied,
 * or the note is already materialized). */
export function takeNoteSeed(noteId: string): string | null {
  const md = pendingSeeds.get(noteId);
  if (md === undefined) return null;
  pendingSeeds.delete(noteId);
  return md;
}
