/**
 * A note's live channel (NR-7, specs/notes-refresh.md AC12), behind
 * `notesV2.joinLive`.
 *
 * Clients send nothing over Realtime. Each person listens on one private
 * topic of their own, `notes-live:<uid>` (only they may read it, nobody may
 * write it), and the server talks on it (migration
 * 20261016120000_notes_live_channel):
 *   • `changed`: something was saved to an open note: pull it (the message
 *     never carries note content, which would linger in realtime.messages);
 *   • `viewers`: who has the note open, stamped from each caller's session.
 * Being "here" is the `notes_live_here` heartbeat, which checks view access
 * every time; the server re-checks each listener's access on every save, so a
 * person whose share is taken away hears nothing more.
 *
 * Realtime is a LATENCY layer, not the source of truth: a refused or dropped
 * channel degrades to the engine's pulls, never data loss.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Db } from "./runtime.db";
import type { NoteLiveChannel, NoteLiveJoin } from "./runtime.types";

type LiveClient = Pick<Db, "rpc" | "channel" | "removeChannel">;

/** The server forgets a tab after a minute of silence. */
export const HEARTBEAT_MS = 20_000;
/** A note created moments ago may not be saved yet, so "no access" can be a
 * race, not a refusal: re-ask quickly a few times first. */
const EARLY_ATTEMPTS = 5;
const EARLY_RETRY_MS = 1500;

type Listener = {
  noteId: string;
  onChanged(): void;
  onViewers(userIds: string[]): void;
  onRejoin(): void;
};

/** One topic per person per client, shared by every open note. */
type Personal = { channel: RealtimeChannel; listeners: Set<Listener> };
const personal = new WeakMap<LiveClient, Map<string, Personal>>();

export function liveTopic(userId: string): string {
  return `notes-live:${userId}`;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function acquire(client: LiveClient, userId: string, listener: Listener): () => void {
  let byUser = personal.get(client);
  if (!byUser) {
    byUser = new Map();
    personal.set(client, byUser);
  }
  const users = byUser;
  let entry = users.get(userId);
  if (!entry) {
    const channel = client.channel(liveTopic(userId), { config: { private: true } });
    const made: Personal = { channel, listeners: new Set() };
    const forNote = (
      payload: unknown,
      run: (l: Listener, body: Record<string, unknown>) => void,
    ) => {
      const body = (payload ?? {}) as Record<string, unknown>;
      for (const l of made.listeners) if (l.noteId === body.noteId) run(l, body);
    };
    channel
      .on("broadcast", { event: "changed" }, (msg) => forNote(msg.payload, (l) => l.onChanged()))
      .on("broadcast", { event: "viewers" }, (msg) =>
        forNote(msg.payload, (l, b) => l.onViewers(stringList(b.viewers))),
      )
      .subscribe((status) => {
        // Anything said before (or while) this topic was joined went to
        // nobody: every join catches up with a pull.
        if (status !== "SUBSCRIBED") return;
        for (const l of made.listeners) l.onRejoin();
      });

    entry = made;
    users.set(userId, made);
  }
  const held = entry;
  held.listeners.add(listener);
  return () => {
    held.listeners.delete(listener);
    if (held.listeners.size > 0) return;
    users.delete(userId);
    void client.removeChannel(held.channel);
  };
}

export function joinNoteLive(
  client: LiveClient,
  { noteId, selfUserId, onPull, onViewers }: NoteLiveJoin,
  {
    earlyRetryMs = EARLY_RETRY_MS,
    heartbeatMs = HEARTBEAT_MS,
    sessionId = crypto.randomUUID(),
  }: { earlyRetryMs?: number; heartbeatMs?: number; sessionId?: string } = {},
): NoteLiveChannel {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let accepted = false;
  /** The heartbeat in flight, so the goodbye can't overtake it. */
  let inFlight: Promise<unknown> = Promise.resolve();

  async function beat(attempt: number) {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = null;
    const call = client.rpc("notes_live_here", {
      p_note_id: noteId,
      p_session_id: sessionId,
      p_leaving: false,
    });
    inFlight = Promise.resolve(call).catch(() => {});
    const res = await call;
    if (closed) return;
    const ids = Array.isArray(res.data) ? stringList(res.data) : null;
    onViewers(ids ?? []);
    // Saves made before the server knew we were here were sent to nobody:
    // catch up once we are let in (first time, or after a refusal).
    if (ids !== null && !accepted) onPull();
    accepted = ids !== null;
    // Refused (or not saved yet): retry quickly at first, then keep the
    // slow beat, so a share granted later starts working without a reload.
    const early = ids === null && attempt < EARLY_ATTEMPTS - 1;
    timer = setTimeout(() => void beat(attempt + 1), early ? earlyRetryMs : heartbeatMs);
  }

  const release = acquire(client, selfUserId, {
    noteId,
    onChanged() {
      if (!closed) onPull();
    },
    onViewers(ids) {
      if (!closed) onViewers(ids);
    },
    onRejoin() {
      if (closed) return;
      onPull();
      void beat(0);
    },
  });
  void beat(0);

  return {
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      release();
      void inFlight.then(() =>
        client.rpc("notes_live_here", {
          p_note_id: noteId,
          p_session_id: sessionId,
          p_leaving: true,
        }),
      );
    },
  };
}
