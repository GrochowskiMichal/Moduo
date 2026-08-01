/**
 * Notes realtime (Wave-3 NO-6, AC7): one Supabase broadcast + presence channel
 * per open note.
 *
 * - Relays local Yjs updates to peers (coalesced per tick) so edits appear
 *   near-live, and applies peers' updates to the live doc with origin
 *   `"remote"` — so the NO-2 engine never re-pushes an echo (its observer
 *   ignores that origin) and durability stays with the outbox + pull path.
 * - Tracks presence for the viewer facepile; closing the note (unmount /
 *   selection change) untracks and removes the channel, clearing presence.
 *
 * Realtime is a LATENCY layer, not the source of truth: a channel failure
 * degrades silently to the engine's refocus/reconnect pulls, never data loss
 * (spec assumption 5). This is the app's first Realtime consumer, so the
 * Supabase client is imported directly rather than through the runtime seam
 * (Realtime is a socket concern, not an RPC).
 */

import { useEffect, useState } from "react";
import * as Y from "yjs";
import { supabaseClient } from "@/lib/runtime.web";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";
import {
  coalesceUpdates,
  NOTE_UPDATE_EVENT,
  type NoteViewer,
  noteChannelName,
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

type Args = {
  engine: NotesSyncEngineV2 | null;
  /** The open note, or null when nothing is selected / it's trashed. */
  noteId: string | null;
  /** Gate: only open a channel with a real identity + workspace. */
  enabled: boolean;
  selfUserId: string | null;
  selfName: string;
};

export function useNoteRealtime({ engine, noteId, enabled, selfUserId, selfName }: Args): {
  viewers: NoteViewer[];
} {
  const [viewers, setViewers] = useState<NoteViewer[]>([]);

  useEffect(() => {
    if (!engine || !noteId || !enabled || !selfUserId) {
      setViewers([]);
      return;
    }

    const session = engine.getOrCreateSession(noteId);
    const doc = session.doc;
    const persistence = session.persistence;
    const channel = supabaseClient.channel(noteChannelName(noteId), {
      config: { broadcast: { self: false }, presence: { key: selfUserId } },
    });

    // ── outbound: coalesce local edits, one merged broadcast per tick ──────
    // `send()` on a channel that isn't JOINED does NOT drop — realtime-js
    // silently REST-falls-back (with a console.warn). So gate the outbound
    // path on a real subscribed state; while joining or after teardown we drop
    // the burst rather than REST-spam or accumulate unbounded — durability
    // rides the outbox + the peer's next pull (realtime is latency, not truth).
    let buffer: Uint8Array[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pushable = false;
    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!pushable) {
        buffer = [];
        return;
      }
      const merged = coalesceUpdates(buffer);
      buffer = [];
      if (!merged || merged.byteLength > MAX_BROADCAST_BYTES) return;
      void channel.send({
        type: "broadcast",
        event: NOTE_UPDATE_EVENT,
        payload: { b64: encodeUint8ToBase64(merged) },
      });
    };
    const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
      // Mirror the engine's own guard (engine-v2 getOrCreateSession observer):
      // ignore remote applications and the IndexedDB replay — relay only
      // genuine local edits.
      if (origin === "remote" || origin === persistence) return;
      buffer.push(update);
      if (!timer) timer = setTimeout(flush, BROADCAST_COALESCE_MS);
    };
    doc.on("update", onLocalUpdate);

    const syncViewers = () =>
      setViewers(presenceViewers(channel.presenceState() as PresenceState, selfUserId));

    channel
      .on("broadcast", { event: NOTE_UPDATE_EVENT }, (msg) => {
        const b64 = (msg.payload as { b64?: unknown } | undefined)?.b64;
        if (typeof b64 !== "string") return;
        try {
          Y.applyUpdate(doc, decodeBase64ToUint8(b64), "remote");
        } catch {
          // A malformed peer update can't wedge us; the next pull reconciles.
        }
      })
      .on("presence", { event: "sync" }, syncViewers)
      .on("presence", { event: "join" }, syncViewers)
      .on("presence", { event: "leave" }, syncViewers)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          pushable = true;
          void channel.track({ userId: selfUserId, name: selfName, at: Date.now() });
        } else {
          // CLOSED / CHANNEL_ERROR / TIMED_OUT — stop pushing, degrade to pull.
          pushable = false;
        }
      });

    return () => {
      pushable = false;
      doc.off("update", onLocalUpdate);
      if (timer) clearTimeout(timer);
      void channel.untrack();
      void supabaseClient.removeChannel(channel);
      setViewers([]);
    };
  }, [engine, noteId, enabled, selfUserId, selfName]);

  return { viewers };
}
