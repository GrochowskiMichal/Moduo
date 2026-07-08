/**
 * Notes realtime (Wave-3 NO-6, AC7) — pure helpers for the per-note Supabase
 * broadcast channel: coalescing a burst of outbound Yjs updates into one
 * message, and shaping raw presence state into a de-duplicated viewer list.
 *
 * The transport (channel wiring, subscribe, track) lives in
 * `hooks/use-note-realtime.ts`; keeping this logic pure makes it unit-testable
 * without a socket, and mirrors how the rest of the sync layer is factored.
 */

import * as Y from "yjs";

/** The broadcast event name for a relayed Yjs update (kept terse — it rides on
 * every keystroke burst). */
export const NOTE_UPDATE_EVENT = "u";

/** One presence record a client tracks on the channel (its own identity). */
export type NotePresence = {
  userId: string;
  name: string;
  /** ms epoch of when this session joined — only used to break ties. */
  at: number;
};

/** A distinct person currently viewing the note (self excluded, tabs merged). */
export type NoteViewer = {
  userId: string;
  name: string;
  initials: string;
};

/** Supabase `presenceState()` shape: presence-key → array of tracked metas. */
export type PresenceState = Record<string, Array<Record<string, unknown>>>;

/** Channel name for a note's realtime doc + presence. Note ids are globally
 * unique (uuid), so the id alone namespaces the channel. */
export function noteChannelName(noteId: string): string {
  return `notes:${noteId}`;
}

/**
 * Merge a burst of local Yjs updates into ONE update for a single broadcast.
 * Typing fires many tiny transactions; sending one merged message per tick
 * keeps us under Realtime's per-client message rate without losing content.
 * Returns null for an empty burst; passes a lone update through untouched.
 */
export function coalesceUpdates(updates: Uint8Array[]): Uint8Array | null {
  if (updates.length === 0) return null;
  if (updates.length === 1) return updates[0];
  return Y.mergeUpdates(updates);
}

/** Two-letter initials for the avatar fallback (splits on spaces + the common
 * email/handle separators so `ada.lovelace` → `AL`). */
export function initialsFor(name: string): string {
  const parts = name
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A friendly display name from an email local-part (members carry no display
 * name in the workspace model — see NO-6 decision). */
export function nameFromEmail(email: string | null | undefined): string {
  if (!email) return "Someone";
  const local = email.split("@")[0]?.trim();
  return local && local.length > 0 ? local : "Someone";
}

/**
 * Flatten Supabase presence state into distinct viewers: EXCLUDE self,
 * de-duplicate by userId (two tabs of one person = one avatar), keep the
 * earliest join time, and sort stably by name then id.
 */
export function presenceViewers(
  state: PresenceState,
  selfUserId: string | null,
): NoteViewer[] {
  const byUser = new Map<string, NotePresence>();
  for (const metas of Object.values(state)) {
    for (const meta of metas) {
      const userId = typeof meta.userId === "string" ? meta.userId : null;
      if (!userId || userId === selfUserId) continue;
      const name = typeof meta.name === "string" && meta.name ? meta.name : "Someone";
      const at = typeof meta.at === "number" ? meta.at : 0;
      const existing = byUser.get(userId);
      if (!existing || at < existing.at) byUser.set(userId, { userId, name, at });
    }
  }
  return [...byUser.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId))
    .map((p) => ({ userId: p.userId, name: p.name, initials: initialsFor(p.name) }));
}
