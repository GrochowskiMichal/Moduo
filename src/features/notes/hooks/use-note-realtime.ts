/**
 * Notes realtime (Wave-3 NO-6, AC7; secured in NR-7, AC12): following the
 * open note live, through the runtime (`notesV2.joinLive`).
 *
 * - Edits reach peers when they are SAVED: the server hands each save to the
 *   people who have the note open, re-checking their access every time. This
 *   hook applies them to the live doc with origin `"remote"`, so the engine
 *   never re-pushes an echo. Nothing is relayed peer-to-peer.
 * - An MCP write is announced, never relayed: the editor pulls, so the stored
 *   row says who wrote it (gotchas §Agent writes).
 * - Presence: the server says who has the note open (from each person's
 *   session); names and photos come from the workspace's member list.
 *
 * Realtime is a LATENCY layer, not the source of truth: a refused or failed
 * channel degrades silently to the engine's refocus/reconnect pulls, never
 * data loss (spec assumption 5).
 */

import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import type { ModuoRuntime } from "@/lib/runtime";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";
import { type NoteViewer, type PresencePerson, presenceViewers } from "../sync/notes-realtime";
import { decodeBase64ToUint8 } from "../utils/base64";

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

    const doc = engine.getOrCreateSession(noteId).doc;
    const live = notes.joinLive({
      noteId,
      selfUserId,
      onUpdates: (updates) => {
        for (const b64 of updates) {
          try {
            Y.applyUpdate(doc, decodeBase64ToUint8(b64), "remote");
          } catch {
            // A malformed update can't wedge us; the next pull reconciles.
          }
        }
      },
      onPull: () => void engine.pullNote(noteId),
      onViewers: setViewerIds,
    });

    return () => {
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
