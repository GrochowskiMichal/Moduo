// Tasks realtime (TV-D5) — one shared connection per workspace.
//
// One Supabase channel, `tasks-db:<ws>:<me>`, with `postgres_changes` on
// tasks, buckets, tags, tag_links and task_queue, filtered by workspace.
// Realtime applies the subscriber's row-level security to inserts and
// updates, so nobody receives a row they couldn't read; a delete carries only
// the row's id (docs/gotchas/supabase.md §Realtime). Every surface that runs
// `useTasksModule` (Tasks, Calendar, Notes, Email) shares the channel through a
// ref count, like chat's.
//
// Realtime is a latency layer, not the source of truth: after a reconnect, on
// coming back to the window or the network, listeners get a `resync` and
// refetch (the hook throttles it). A missed event can never become a missing
// task for longer than that.
//
// Like chat and notes realtime (NO-6) this imports the Supabase client
// directly: Realtime is a socket concern, not an RPC, so it sits outside the
// runtime seam.
//
// TV-D11b's tables (completions, and the grant feed `access_changes`) listen
// on channels of their own: a channel naming a table that isn't published yet
// (a build ahead of its database) silently delivers nothing for any table.

import { normalizeAccessChangeResource } from "@contracts/vocabularies";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseClient } from "@/lib/runtime.web";
import type { AccessChange } from "@/lib/sync/types";
import {
  LIVE_SIDE_TABLES,
  LIVE_TABLES,
  type LiveChange,
  type LivePayload,
  parseLiveChange,
} from "./live";

/** A grant feed row (`access_changes`) → the change, or null. */
export function parseAccessChange(payload: LivePayload): AccessChange | null {
  if (payload.eventType !== "INSERT") return null;
  const raw = payload.new as
    | { id?: unknown; resource_type?: unknown; resource_id?: unknown; changed_at?: unknown }
    | null
    | undefined;
  if (typeof raw?.resource_type !== "string" || typeof raw.resource_id !== "string") return null;
  return {
    id: raw.id === undefined || raw.id === null ? undefined : String(raw.id),
    // One this build doesn't know reads as the whole workspace: check everything.
    resourceType: normalizeAccessChangeResource(raw.resource_type),
    resourceId: raw.resource_id,
    changedAt: typeof raw.changed_at === "string" ? raw.changed_at : "",
  };
}

/**
 * `resync` asks for a refetch: `reconnect` after the socket rejoined or the
 * network came back (changes may have been missed), `return` when the window
 * comes back into view or focus (both fire on one return; the hook coalesces).
 */
export type TasksLiveEvent =
  | { type: "change"; change: LiveChange }
  | { type: "resync"; reason: "reconnect" | "return" }
  /** Who can see a project or a task changed (the grant feed, TV-D11b). */
  | { type: "access"; change: AccessChange };
type Listener = (event: TasksLiveEvent) => void;

class TasksLink {
  private refs = 0;
  private channel: RealtimeChannel | null = null;
  /** TV-D11b's tables, one channel each (see the header). */
  private sideChannels: RealtimeChannel[] = [];
  private joinedOnce = false;
  private listeners = new Set<Listener>();

  constructor(
    readonly workspaceId: string,
    readonly selfId: string,
  ) {}

  get refCount(): number {
    return this.refs;
  }

  acquire(): void {
    this.refs += 1;
    if (this.refs === 1) this.open();
  }

  release(): void {
    this.refs -= 1;
    if (this.refs <= 0) this.close();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private open(): void {
    const ws = this.workspaceId;
    let channel = supabaseClient.channel(`tasks-db:${ws}:${this.selfId}`);
    for (const table of LIVE_TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `workspace_id=eq.${ws}` },
        (payload) => {
          const change = parseLiveChange(table, payload as LivePayload);
          if (change) this.emit({ type: "change", change });
        },
      );
    }
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // The first join is the initial load's job; every later join is a
      // reconnect that may have missed changes.
      if (this.joinedOnce) this.emit({ type: "resync", reason: "reconnect" });
      this.joinedOnce = true;
    });
    this.channel = channel;
    this.sideChannels = [
      ...LIVE_SIDE_TABLES.map((table) =>
        supabaseClient
          .channel(`tasks-db:${table}:${ws}:${this.selfId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table, filter: `workspace_id=eq.${ws}` },
            (payload) => {
              const change = parseLiveChange(table, payload as LivePayload);
              if (change) this.emit({ type: "change", change });
            },
          )
          .subscribe(),
      ),
      // The grant feed: rows for you or for everyone in the workspace (RLS).
      supabaseClient
        .channel(`tasks-access:${ws}:${this.selfId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "access_changes",
            filter: `workspace_id=eq.${ws}`,
          },
          (payload) => {
            const change = parseAccessChange(payload as LivePayload);
            if (change) this.emit({ type: "access", change });
          },
        )
        .subscribe(),
    ];
    if (typeof window !== "undefined") {
      window.addEventListener("focus", this.onReturn);
      window.addEventListener("online", this.onOnline);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  private close(): void {
    if (this.channel) void supabaseClient.removeChannel(this.channel);
    this.channel = null;
    for (const side of this.sideChannels) void supabaseClient.removeChannel(side);
    this.sideChannels = [];
    this.joinedOnce = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", this.onReturn);
      window.removeEventListener("online", this.onOnline);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
  }

  private onReturn = () => this.emit({ type: "resync", reason: "return" });

  private onOnline = () => this.emit({ type: "resync", reason: "reconnect" });

  private onVisibility = () => {
    if (document.visibilityState === "visible") this.onReturn();
  };

  private emit(event: TasksLiveEvent): void {
    for (const fn of this.listeners) fn(event);
  }
}

const links = new Map<string, TasksLink>();

/**
 * Listen to live Tasks changes in a workspace. Call the returned function on
 * unmount; the channel closes when the last listener lets go.
 */
export function listenTasksLive(
  workspaceId: string,
  selfId: string,
  listener: Listener,
): () => void {
  const key = `${workspaceId}:${selfId}`;
  let link = links.get(key);
  if (!link) {
    link = new TasksLink(workspaceId, selfId);
    links.set(key, link);
  }
  const held = link;
  const unsubscribe = held.subscribe(listener);
  held.acquire();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    unsubscribe();
    held.release();
    if (held.refCount <= 0) links.delete(key);
  };
}
