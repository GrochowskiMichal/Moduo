// Who's online (CV-3): display only, on the workspace's private topic
// `chat:<ws>`, held app-wide while Chat is on (the chrome's badge holds it, so
// you appear online anywhere in Moduo). A refused or failed join is an error
// state ("Presence isn't available"), never "everyone away" (AC1.9).
// CV-17: you track yourself only while "Show me as online" is on (else you
// read others but show as offline), with `away` after 10 minutes idle; a
// person is away only when every tab of theirs is.

import { type ChatSocket, leaveTopic, whenTopicFree } from "../realtime";
import type { PresenceSelf } from "./presence-self";

export type ChatPresenceStatus = "connecting" | "online" | "error";

export type ChatPresenceSnapshot = {
  status: ChatPresenceStatus;
  /** Who's online. Meaningless while `status` is "error": show the error, not an empty list. */
  online: ReadonlySet<string>;
  /** Online, but idle in every open tab (CV-17). */
  away: ReadonlySet<string>;
  error: string | null;
};

const PRESENCE_ERROR = "Presence isn't available";
const CONNECTING: ChatPresenceSnapshot = {
  status: "connecting",
  online: new Set(),
  away: new Set(),
  error: null,
};

/** Who's online and who's away, from the topic's state (one entry per tab). */
export function presenceSets(state: Record<string, ReadonlyArray<{ away?: unknown }>>): {
  online: Set<string>;
  away: Set<string>;
} {
  const online = new Set<string>();
  const away = new Set<string>();
  for (const [id, metas] of Object.entries(state)) {
    if (metas.length === 0) continue;
    online.add(id);
    if (metas.every((m) => m.away === true)) away.add(id);
  }
  return { online, away };
}

type RealtimeChannel = ReturnType<ChatSocket["channel"]>;

export class ChatPresenceStore {
  private snapshot: ChatPresenceSnapshot = CONNECTING;
  private listeners = new Set<() => void>();
  private channel: RealtimeChannel | null = null;
  private opening: object | null = null;
  private refs = 0;
  private joined = false;
  /** What this tab last told the topic: "here", "away" or nothing. */
  private tracked: "here" | "away" | null = null;
  private stopSelf: (() => void) | null = null;

  constructor(
    private readonly socket: ChatSocket,
    readonly workspaceId: string,
    readonly selfId: string,
    private readonly self: PresenceSelf | null = null,
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): ChatPresenceSnapshot => this.snapshot;

  private set(next: ChatPresenceSnapshot): void {
    this.snapshot = next;
    for (const fn of this.listeners) fn();
  }

  /** Hold presence while mounted; the last release leaves the topic. */
  acquire(): () => void {
    this.refs += 1;
    if (this.refs === 1) this.open();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs -= 1;
      if (this.refs <= 0) this.close();
    };
  }

  /** Track, re-track or untrack to match "Show me as online" and idleness. */
  private syncSelf(): void {
    const channel = this.channel;
    if (!channel || !this.joined) return;
    const me = this.self?.get() ?? { track: true, away: false };
    const want = me.track ? (me.away ? "away" : "here") : null;
    if (want === this.tracked) return;
    const was = this.tracked;
    this.tracked = want;
    if (want === null) {
      if (was !== null) void channel.untrack();
    } else {
      void channel.track({ at: new Date().toISOString(), away: want === "away" });
    }
  }

  private open(): void {
    // A marker until the channel exists: a release meanwhile clears it.
    const ticket = {};
    this.opening = ticket;
    const topic = this.topic();
    whenTopicFree(this.socket, topic, () => {
      if (this.opening !== ticket) return;
      this.opening = null;
      const channel = this.socket.channel(topic, {
        config: { private: true, presence: { key: this.selfId } },
      });
      channel
        .on("presence", { event: "sync" }, () => {
          if (this.channel !== channel) return;
          const sets = presenceSets(
            channel.presenceState() as Record<string, ReadonlyArray<{ away?: unknown }>>,
          );
          this.set({ status: "online", ...sets, error: null });
        })
        .subscribe((status) => {
          if (this.channel !== channel) return;
          if (status === "SUBSCRIBED") {
            this.joined = true;
            this.tracked = null;
            this.syncSelf();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            this.joined = false;
            this.set({ status: "error", online: new Set(), away: new Set(), error: PRESENCE_ERROR });
          }
        });
      this.channel = channel;
      this.stopSelf?.();
      this.stopSelf = this.self ? this.self.subscribe(() => this.syncSelf()) : null;
    });
  }

  hasSelf(self: PresenceSelf | null): boolean {
    return this.self === self;
  }

  /** Leave now, whoever still holds it (sign-out). */
  dispose(): void {
    this.refs = 0;
    this.close();
  }

  private topic(): string {
    return `chat:${this.workspaceId}`;
  }

  private close(): void {
    const channel = this.channel;
    this.channel = null;
    this.opening = null;
    this.joined = false;
    this.tracked = null;
    this.stopSelf?.();
    this.stopSelf = null;
    if (channel) leaveTopic(this.socket, this.topic(), channel);
    this.set(CONNECTING);
  }
}

const stores = new Map<string, ChatPresenceStore>();

/** The workspace's presence store for this person (one per tab). */
export function chatPresence(
  socket: ChatSocket,
  workspaceId: string,
  selfId: string,
  self: PresenceSelf | null = null,
): ChatPresenceStore {
  const key = `${selfId}:${workspaceId}`;
  let store = stores.get(key);
  // A store made for an earlier "me" (signed out, then back) is never reused.
  if (!store || !store.hasSelf(self)) {
    store?.dispose();
    store = new ChatPresenceStore(socket, workspaceId, selfId, self);
    stores.set(key, store);
  }
  return store;
}

/** Sign-out: leave every presence topic and forget the stores. */
export function forgetChatPresenceStores(): void {
  for (const store of stores.values()) store.dispose();
  stores.clear();
}
