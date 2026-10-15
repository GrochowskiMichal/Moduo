// Who's online (CV-3): display only, on the workspace's private topic
// `chat:<ws>`, held app-wide while Chat is on (the chrome's badge holds it, so
// you appear online anywhere in Moduo). A refused or failed join is an error
// state ("Presence isn't available"), never "everyone away" (AC1.9). The
// "Show me as online" preference and the presence shapes are CV-17's.

import type { ChatSocket } from "../realtime";

export type ChatPresenceStatus = "connecting" | "online" | "error";

export type ChatPresenceSnapshot = {
  status: ChatPresenceStatus;
  /** Who's online. Meaningless while `status` is "error": show the error, not an empty list. */
  online: ReadonlySet<string>;
  error: string | null;
};

const PRESENCE_ERROR = "Presence isn't available";
const CONNECTING: ChatPresenceSnapshot = { status: "connecting", online: new Set(), error: null };

type RealtimeChannel = ReturnType<ChatSocket["channel"]>;

export class ChatPresenceStore {
  private snapshot: ChatPresenceSnapshot = CONNECTING;
  private listeners = new Set<() => void>();
  private channel: RealtimeChannel | null = null;
  private refs = 0;

  constructor(
    private readonly socket: ChatSocket,
    readonly workspaceId: string,
    readonly selfId: string,
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

  private open(): void {
    const channel = this.socket.channel(`chat:${this.workspaceId}`, {
      config: { private: true, presence: { key: this.selfId } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        if (this.channel !== channel) return;
        this.set({
          status: "online",
          online: new Set(Object.keys(channel.presenceState())),
          error: null,
        });
      })
      .subscribe((status) => {
        if (this.channel !== channel) return;
        if (status === "SUBSCRIBED") {
          void channel.track({ at: new Date().toISOString() });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.set({ status: "error", online: new Set(), error: PRESENCE_ERROR });
        }
      });
    this.channel = channel;
  }

  private close(): void {
    const channel = this.channel;
    this.channel = null;
    if (channel) void this.socket.removeChannel(channel);
    this.set(CONNECTING);
  }
}

const stores = new Map<string, ChatPresenceStore>();

/** The workspace's presence store for this person (one per tab). */
export function chatPresence(
  socket: ChatSocket,
  workspaceId: string,
  selfId: string,
): ChatPresenceStore {
  const key = `${selfId}:${workspaceId}`;
  let store = stores.get(key);
  if (!store) {
    store = new ChatPresenceStore(socket, workspaceId, selfId);
    stores.set(key, store);
  }
  return store;
}
