/**
 * A note's private live channel (NR-7, specs/notes-refresh.md AC12), behind
 * `notesV2.joinLive`.
 *
 * Topic `note:<id>`, joined with `private: true`, so Realtime checks the
 * `realtime.messages` policies (migration 20261016120000_notes_live_channel):
 * view access to receive and appear in presence, edit access to broadcast.
 * Someone without access is refused by the server, whatever the client does.
 *
 * Realtime is a LATENCY layer, not the source of truth: a refused or dropped
 * channel degrades to the engine's refocus/reconnect pulls, never data loss.
 */

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { NOTE_UPDATE_EVENT, noteChannelName } from "../features/notes/sync/notes-realtime";
import type { NoteLiveChannel, NoteLiveJoin } from "./runtime.types";

type LiveClient = Pick<SupabaseClient, "rpc" | "channel" | "removeChannel">;

/** A note created moments ago may not be saved yet, so "no access" can be a
 * race, not a refusal: re-ask a few times before giving up. */
const ACCESS_ATTEMPTS = 5;
const ACCESS_RETRY_MS = 1500;

export function joinNoteLive(
  client: LiveClient,
  { noteId, selfUserId, onBroadcast, onPresence }: NoteLiveJoin,
  { retryMs = ACCESS_RETRY_MS }: { retryMs?: number } = {},
): NoteLiveChannel {
  let closed = false;
  let joined = false;
  let channel: RealtimeChannel | null = null;

  void (async () => {
    // Asking first keeps a person who can't see the note from retrying a
    // refused join forever; the server's policy is still what refuses them.
    let permitted = false;
    for (let attempt = 0; attempt < ACCESS_ATTEMPTS && !closed; attempt++) {
      const allowed = await client.rpc("share_can", {
        p_type: "note",
        p_id: noteId,
        p_min: "view",
      });
      if (allowed.data === true) {
        permitted = true;
        break;
      }
      if (attempt < ACCESS_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, retryMs));
    }
    if (closed || !permitted) return;

    const live = client.channel(noteChannelName(noteId), {
      config: { private: true, broadcast: { self: false }, presence: { key: selfUserId } },
    });
    channel = live;
    const syncPresence = () => onPresence(live.presenceState());
    live
      .on("broadcast", { event: NOTE_UPDATE_EVENT }, (msg) =>
        onBroadcast(msg.payload as Record<string, unknown> | undefined),
      )
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe((status) => {
        // CLOSED / CHANNEL_ERROR / TIMED_OUT stop the relay; the pull path
        // carries everything until the socket rejoins.
        joined = status === "SUBSCRIBED" && !closed;
        // The presence key says who; the payload carries nothing a peer
        // would show (names come from the member list).
        if (joined) void live.track({ at: Date.now() });
      });
  })();

  return {
    sendUpdate(updateB64) {
      // `send()` on a channel that isn't joined doesn't drop: realtime-js
      // falls back to REST. Gate on the joined state instead.
      if (!joined || !channel) return;
      void channel.send({
        type: "broadcast",
        event: NOTE_UPDATE_EVENT,
        payload: { b64: updateB64 },
      });
    },
    close() {
      closed = true;
      joined = false;
      if (!channel) return;
      const live = channel;
      channel = null;
      void live.untrack();
      void client.removeChannel(live);
    },
  };
}
