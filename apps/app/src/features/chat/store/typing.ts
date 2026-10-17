// Who's typing (CV-3, round-3 §2.7): its own small store, so a keystroke redraws
// no message row.
//
// Only the open conversation's private topic `chat:typing:<id>` is joined
// (left on switch); only its members may join it (CV-1). "I'm typing" goes
// through `chat_op_typing`, which takes the sender from the session, at most
// once every 3 s, with a stop on send or blur; nothing is broadcast from here.
// An entry expires ~6 s after its last event. A refused or failed join is an
// error state ("Typing isn't available"), never an empty line (AC1.9).

import type { ChatRuntime } from "../model";
import { type ChatSocket, leaveTopic, whenTopicFree } from "../realtime";

export type TypingEntry = {
  userId: string;
  channelId: string;
  parentId: string | null;
  until: number;
};

export type ChatTypingSnapshot = {
  entries: TypingEntry[];
  /** The open conversation's typing couldn't be joined. */
  error: string | null;
};

export const TYPING_TTL_MS = 6_000;
export const TYPING_THROTTLE_MS = 3_000;
const TYPING_ERROR = "Typing isn't available";

type RealtimeChannel = ReturnType<ChatSocket["channel"]>;

const typingTopic = (channelId: string) => `chat:typing:${channelId}`;

export class ChatTypingStore {
  private snapshot: ChatTypingSnapshot = { entries: [], error: null };
  private listeners = new Set<() => void>();
  private topics = new Map<string, { channel: RealtimeChannel | null; refs: number }>();
  private lastSent = new Map<string, number>();
  private sweep: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly socket: ChatSocket,
    private readonly transport: Pick<ChatRuntime, "typing">,
    readonly selfId: string,
    private readonly now: () => number = Date.now,
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): ChatTypingSnapshot => this.snapshot;

  private set(next: Partial<ChatTypingSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const fn of this.listeners) fn();
  }

  /**
   * Follow one conversation (the open one): joins its topic, shared between
   * holders. Release on switch or unmount; the last release leaves the topic
   * and forgets its entries.
   */
  watch(channelId: string): () => void {
    let entry = this.topics.get(channelId);
    if (!entry) {
      const fresh: { channel: RealtimeChannel | null; refs: number } = { channel: null, refs: 0 };
      entry = fresh;
      this.topics.set(channelId, fresh);
      const topic = typingTopic(channelId);
      whenTopicFree(this.socket, topic, () => {
        // Released (or disposed) while an earlier channel on the topic was leaving.
        if (this.topics.get(channelId) !== fresh) return;
        const channel = this.socket.channel(topic, { config: { private: true } });
        fresh.channel = channel;
        channel
          .on("broadcast", { event: "typing" }, (msg: { payload: unknown }) =>
            this.receive(msg.payload),
          )
          .subscribe((status) => {
            if (this.topics.get(channelId) !== fresh) return;
            if (status === "SUBSCRIBED") {
              if (this.snapshot.error) this.set({ error: null });
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              this.set({ error: TYPING_ERROR });
            }
          });
      });
    }
    const held = entry;
    held.refs += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      held.refs -= 1;
      if (held.refs > 0 || this.topics.get(channelId) !== held) return;
      this.topics.delete(channelId);
      if (held.channel) leaveTopic(this.socket, typingTopic(channelId), held.channel);
      this.set({
        entries: this.snapshot.entries.filter((t) => t.channelId !== channelId),
        error: this.topics.size === 0 ? null : this.snapshot.error,
      });
    };
  }

  /** A typing event the server wrote: its `userId` is the sender's session. */
  private receive(payload: unknown): void {
    const p = payload as Partial<TypingEntry> & { stop?: boolean };
    if (typeof p?.userId !== "string" || typeof p.channelId !== "string") return;
    if (p.userId === this.selfId) return;
    const parentId = p.parentId ?? null;
    const entries = this.snapshot.entries.filter(
      (t) => !(t.userId === p.userId && t.channelId === p.channelId && t.parentId === parentId),
    );
    if (!p.stop) {
      entries.push({
        userId: p.userId,
        channelId: p.channelId,
        parentId,
        until: this.now() + TYPING_TTL_MS,
      });
      this.startSweep();
    }
    this.set({ entries });
  }

  private startSweep(): void {
    if (this.sweep) return;
    this.sweep = setInterval(() => {
      const now = this.now();
      const entries = this.snapshot.entries.filter((t) => t.until > now);
      if (entries.length !== this.snapshot.entries.length) this.set({ entries });
      if (entries.length === 0 && this.sweep) {
        clearInterval(this.sweep);
        this.sweep = null;
      }
    }, 1_000);
  }

  /** "I'm typing", at most once every 3 s; `stop` clears it at once (send, blur). */
  send(channelId: string, parentId: string | null, stop = false): void {
    const key = `${channelId}:${parentId ?? ""}`;
    const now = this.now();
    if (!stop && now - (this.lastSent.get(key) ?? Number.NEGATIVE_INFINITY) < TYPING_THROTTLE_MS)
      return;
    if (stop && !this.lastSent.has(key)) return;
    if (stop) this.lastSent.delete(key);
    else this.lastSent.set(key, now);
    void this.transport.typing({ channelId, parentId, stop });
  }

  dispose(): void {
    for (const [id, t] of this.topics) {
      if (t.channel) leaveTopic(this.socket, typingTopic(id), t.channel);
    }
    this.topics.clear();
    if (this.sweep) clearInterval(this.sweep);
    this.sweep = null;
    this.listeners.clear();
  }
}
