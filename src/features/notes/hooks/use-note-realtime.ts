/**
 * Notes realtime (Wave-3 NO-6, AC7; secured in NR-7, AC12): the open note's
 * private live channel, joined through the runtime (`notesV2.joinLive`).
 *
 * - Relays local Yjs updates to peers (coalesced per tick) so edits appear
 *   near-live, and applies peers' updates to the live doc with origin
 *   `"remote"` — so the engine never re-pushes an echo (its observer ignores
 *   that origin) and durability stays with the outbox + pull path.
 * - An MCP write is announced by a content-free cue, never relayed: the
 *   editor pulls, so the stored row says who wrote it (gotchas §Agent writes).
 * - Presence: who else has the note open, named and pictured from the
 *   workspace's member list (`personOf`), never from what a peer sent.
 *   Closing the note (unmount / selection change) leaves the channel.
 *
 * Realtime is a LATENCY layer, not the source of truth: a refused or failed
 * channel degrades silently to the engine's refocus/reconnect pulls, never
 * data loss (spec assumption 5).
 */

import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import type { ModuoRuntime } from "@/lib/runtime";
import { isAgentWriteCue, isForeignOrigin } from "../sync/agent-origin";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";
import {
  coalesceUpdates,
  type NoteViewer,
  type PresencePerson,
  type PresenceState,
  presenceViewers,
} from "../sync/notes-realtime";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../utils/base64";

/** Buffer local edits this long before one merged broadcast — keeps typing
 * under the per-client message rate while staying sub-perceptible. */
const BROADCAST_COALESCE_MS = 180;

/** Skip broadcasting an outsized merged update (a huge paste); the durable
 * outbox + the peer's next pull carry it — realtime is latency, not truth. */
const MAX_BROADCAST_BYTES = 200_000;

const NO_PRESENCE: PresenceState = {};

type Args = {
  /** The runtime's notes surface; null until the runtime is ready. */
  notes: Pick<ModuoRuntime["notesV2"], "joinLive"> | null;
  engine: NotesSyncEngineV2 | null;
  /** The open note, or null when nothing is selected / it's trashed. */
  noteId: string | null;
  /** Gate: only open a channel with a real identity + workspace. */
  enabled: boolean;
  selfUserId: string | null;
  /** A workspace member by user id (`useCommentPeople().personOf`). */
  personOf: (userId: string) => PresencePerson | null;
};

export function useNoteRealtime({ notes, engine, noteId, enabled, selfUserId, personOf }: Args): {
  viewers: NoteViewer[];
} {
  const [presence, setPresence] = useState<PresenceState>(NO_PRESENCE);

  useEffect(() => {
    setPresence(NO_PRESENCE);
    if (!notes || !engine || !noteId || !enabled || !selfUserId) return;

    const session = engine.getOrCreateSession(noteId);
    const doc = session.doc;
    const persistence = session.persistence;

    const live = notes.joinLive({
      noteId,
      selfUserId,
      onBroadcast: (payload) => {
        if (isAgentWriteCue(payload)) {
          void engine.pullNote(noteId);
          return;
        }
        const b64 = payload?.b64;
        if (typeof b64 !== "string") return;
        try {
          Y.applyUpdate(doc, decodeBase64ToUint8(b64), "remote");
        } catch {
          // A malformed peer update can't wedge us; the next pull reconciles.
        }
      },
      onPresence: setPresence,
    });

    // ── outbound: coalesce local edits, one merged broadcast per tick ────────
    let buffer: Uint8Array[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const merged = coalesceUpdates(buffer);
      buffer = [];
      if (!merged || merged.byteLength > MAX_BROADCAST_BYTES) return;
      live.sendUpdate(encodeUint8ToBase64(merged));
    };
    const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
      // Mirror the engine's own guard: ignore remote applications and the
      // IndexedDB replay — relay only genuine local edits.
      if (isForeignOrigin(origin, persistence)) return;
      buffer.push(update);
      if (!timer) timer = setTimeout(flush, BROADCAST_COALESCE_MS);
    };
    doc.on("update", onLocalUpdate);

    return () => {
      doc.off("update", onLocalUpdate);
      if (timer) clearTimeout(timer);
      live.close();
      setPresence(NO_PRESENCE);
    };
  }, [notes, engine, noteId, enabled, selfUserId]);

  const viewers = useMemo(
    () => presenceViewers(presence, selfUserId, personOf),
    [presence, selfUserId, personOf],
  );
  return { viewers };
}
