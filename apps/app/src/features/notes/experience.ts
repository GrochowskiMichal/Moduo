/**
 * The "New Notes" switch (specs/notes-refresh.md NR-2, AC1).
 *
 * A synced user preference, `notesExperience`, picks the classic page or the
 * refreshed shell. Both read and write the same notes, so switching never
 * touches data; it only flushes the open note's pending edits first, so the
 * UI that mounts next starts from what you just typed. Off (classic) until
 * NR-12 flips the default.
 */

import { useCallback } from "react";

import {
  type NotesExperience,
  type Preferences,
  updatePreferences,
  usePreferencesValue,
} from "../../lib/preferences";

export type { NotesExperience };

/** The experience a preferences record asks for (classic when unset). */
export function notesExperienceOf(prefs: Pick<Preferences, "notesExperience">): NotesExperience {
  return prefs.notesExperience === "next" ? "next" : "classic";
}

/**
 * Swap experiences: flush the open note's pending updates, THEN write the
 * preference. A failed flush never blocks the swap, because the edits are
 * already safe in the local outbox and the next UI's engine pushes them.
 */
export async function switchNotesExperience(
  next: NotesExperience,
  deps: {
    flushOpenNote?: () => Promise<void>;
    write: (patch: Pick<Preferences, "notesExperience">) => void;
  },
): Promise<void> {
  try {
    await deps.flushOpenNote?.();
  } catch {
    // The outbox keeps the edits; the other UI's engine pushes them.
  }
  deps.write({ notesExperience: next });
}

/** Read the switch reactively and get a setter that flushes before it swaps. */
export function useNotesExperience(): [
  NotesExperience,
  (next: NotesExperience, flushOpenNote?: () => Promise<void>) => Promise<void>,
] {
  const experience = notesExperienceOf(usePreferencesValue());
  const setExperience = useCallback(
    (next: NotesExperience, flushOpenNote?: () => Promise<void>) =>
      switchNotesExperience(next, { flushOpenNote, write: updatePreferences }),
    [],
  );
  return [experience, setExperience];
}
