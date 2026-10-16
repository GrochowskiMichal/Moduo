/**
 * Notes realtime (Wave-3 NO-6, AC7; secured in NR-7, AC12): following the
 * open note live, through the runtime (`notesV2.joinLive`).
 *
 * - Edits reach peers when they are SAVED: the server tells the people who
 *   have the note open (re-checking their access every time) that it
 *   changed, and the editor pulls through the normal access-checked read.
 *   No note content travels over Realtime, and nothing peer-to-peer. Agent
 *   (MCP) writes arrive the same way, so the stored row says who wrote them.
 * - Presence: the server says who has the note open (from each person's
 *   session); names and photos come from the workspace's member list.
 *
 * Realtime is a LATENCY layer, not the source of truth: a refused or failed
 * channel degrades silently to the engine's refocus/reconnect pulls, never
 * data loss (spec assumption 5).
 */

import { useEffect, useMemo, useState } from "react";
import type { ModuoRuntime } from "@/lib/runtime";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";
import { type NoteViewer, type PresencePerson, presenceViewers } from "../sync/notes-realtime";

const NOBODY: string[] = [];

type Args = {
  /** The runtime's notes surface; null until the runtime is ready. */
  notes: Pick<ModuoRuntime["notesV2"], "joinLive"> | null;
  engine: NotesSyncEngineV2 | null;
  /** The open note, or null when nothing is selected / it's trashed. */
  noteId: string | null;
  /** Gate: only follow a note with a real identity + workspace. */
  enabled: boolean;
  selfUserId: string | null;
  /** A workspace member by user id (`useCommentPeople().personOf`). */
  personOf: (userId: string) => PresencePerson | null;
};

export function useNoteRealtime({ notes, engine, noteId, enabled, selfUserId, personOf }: Args): {
  viewers: NoteViewer[];
} {
  const [viewerIds, setViewerIds] = useState<string[]>(NOBODY);

  useEffect(() => {
    setViewerIds(NOBODY);
    if (!notes || !engine || !noteId || !enabled || !selfUserId) return;

    engine.getOrCreateSession(noteId);
    // One pull at a time: saves that land meanwhile ask for one more, after.
    let disposed = false;
    let pulling = false;
    let again = false;
    const pull = () => {
      if (disposed) return;
      if (pulling) {
        again = true;
        return;
      }
      pulling = true;
      void engine.pullNote(noteId).finally(() => {
        pulling = false;
        if (again) {
          again = false;
          pull();
        }
      });
    };
    const live = notes.joinLive({
      noteId,
      selfUserId,
      onPull: pull,
      onViewers: setViewerIds,
    });

    return () => {
      disposed = true;
      live.close();
      setViewerIds(NOBODY);
    };
  }, [notes, engine, noteId, enabled, selfUserId]);

  const viewers = useMemo(
    () => presenceViewers(viewerIds, selfUserId, personOf),
    [viewerIds, selfUserId, personOf],
  );
  return { viewers };
}
