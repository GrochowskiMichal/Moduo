/**
 * Notes realtime (Wave-3 NO-6, AC7; secured in NR-7) — the pure part: turning
 * the user ids the server says have a note open into the people shown in the
 * facepile, named from the workspace's member list.
 *
 * The transport lives behind the runtime (`notesV2.joinLive`); the hook that
 * drives it is `hooks/use-note-realtime.ts`.
 */

/** A distinct person currently viewing the note (self excluded, tabs merged). */
export type NoteViewer = {
  userId: string;
  name: string;
  avatarUrl: string | null;
};

/** What presence needs to know about a workspace member. */
export type PresencePerson = { name: string; avatarUrl?: string | null };

/**
 * The people viewing the note, from the user ids the server says have it
 * open. Names and photos come from the workspace's member list; an id the
 * list doesn't know is left out, and so is self. One avatar per person;
 * sorted by name, then id.
 */
export function presenceViewers(
  userIds: readonly string[],
  selfUserId: string | null,
  personOf: (userId: string) => PresencePerson | null,
): NoteViewer[] {
  const viewers = new Map<string, NoteViewer>();
  for (const id of userIds) {
    if (!id || id === selfUserId || viewers.has(id)) continue;
    const person = personOf(id);
    if (!person) continue;
    viewers.set(id, { userId: id, name: person.name, avatarUrl: person.avatarUrl ?? null });
  }
  return [...viewers.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
  );
}
