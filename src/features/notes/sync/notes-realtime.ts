/**
 * Notes realtime (Wave-3 NO-6, AC7; secured in NR-7) — pure helpers for the
 * per-note private Supabase channel: coalescing a burst of outbound Yjs
 * updates into one message, and turning raw presence state into the people
 * viewing the note, named from the workspace's member list.
 *
 * The transport (private join, subscribe, track) lives behind the runtime
 * (`notesV2.joinLive`); the hook that drives it is `hooks/use-note-realtime.ts`.
 * Keeping this logic pure makes it unit-testable without a socket.
 */

import * as Y from "yjs";

/** The broadcast event name for a relayed Yjs update (kept terse — it rides on
 * every keystroke burst). */
export const NOTE_UPDATE_EVENT = "u";

/** A distinct person currently viewing the note (self excluded, tabs merged). */
export type NoteViewer = {
  userId: string;
  name: string;
  avatarUrl: string | null;
};

/** What presence needs to know about a workspace member. */
export type PresencePerson = { name: string; avatarUrl?: string | null };

/** Supabase `presenceState()` shape: presence-key → array of tracked metas. */
export type PresenceState = Record<string, Array<Record<string, unknown>>>;

/** Topic of a note's private live channel (edits, the agent cue, presence).
 * Note ids are globally unique (uuid), so the id alone namespaces it. The
 * `realtime.messages` policies (`notes_realtime_topic_allowed`) parse exactly
 * this shape; any other topic is refused. */
export function noteChannelName(noteId: string): string {
  return `note:${noteId}`;
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

/**
 * The people viewing the note, from Supabase presence state.
 *
 * A presence entry is keyed by the user id its client claimed, and nothing
 * else in it is trusted: names and photos come from the workspace's member
 * list, so a client can't put words in the facepile, and an id the list
 * doesn't know is left out. Self is excluded and two tabs of one person are
 * one avatar; sorted by name, then id.
 */
export function presenceViewers(
  state: PresenceState,
  selfUserId: string | null,
  personOf: (userId: string) => PresencePerson | null,
): NoteViewer[] {
  const viewers = new Map<string, NoteViewer>();
  for (const [key, metas] of Object.entries(state)) {
    if (!key || key === selfUserId || viewers.has(key) || metas.length === 0) continue;
    const person = personOf(key);
    if (!person) continue;
    viewers.set(key, { userId: key, name: person.name, avatarUrl: person.avatarUrl ?? null });
  }
  return [...viewers.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
  );
}
