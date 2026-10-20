// The workspace's custom emoji, one copy per workspace shared by every
// surface that draws them (chat, task and note comments, the picker, Settings)
// (CV-20). Read once through the table's rule, kept live over its own
// Realtime channel (an add or a removal shows everywhere at once), and the
// private images reached through short-lived links signed in batches.

import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { ChatRuntime } from "@/features/chat/model";
import { getRuntime } from "@/lib/runtime";

import { type CustomEmoji, liveEmoji, mapCustomEmoji, mergeEmoji } from "./model";

/** Links last this long; they're signed again well before. */
const URL_TTL_S = 6 * 60 * 60;
const URL_REFRESH_MS = 5 * 60 * 60 * 1000;

type WsState = {
  rows: CustomEmoji[];
  loaded: boolean;
  /** Path → signed link. */
  urls: ReadonlyMap<string, string>;
  signedAt: number;
};

export type EmojiStoreDeps = {
  runtime: () => ChatRuntime | null;
  /** Row changes for one workspace; returns the unsubscribe. */
  live: (workspaceId: string, onRow: (row: unknown) => void) => () => void;
  now: () => number;
};

let seq = 0;
const defaultDeps: EmojiStoreDeps = {
  runtime: () => getRuntime()?.chat ?? null,
  live: (workspaceId, onRow) => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void import("@/lib/runtime.web.client").then(({ supabaseClient }) => {
      if (cancelled) return;
      seq += 1;
      // Inserts and updates only: a removal is an update (soft delete), so it
      // passes the read rule on its way here.
      const changes = {
        schema: "public",
        table: "chat_custom_emoji",
        filter: `workspace_id=eq.${workspaceId}`,
      } as const;
      const channel = supabaseClient
        .channel(`chat-emoji:${workspaceId}:${seq}`)
        .on("postgres_changes", { event: "INSERT", ...changes }, (p) => onRow(p.new))
        .on("postgres_changes", { event: "UPDATE", ...changes }, (p) => onRow(p.new))
        .subscribe();
      stop = () => {
        void supabaseClient.removeChannel(channel);
      };
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  },
  now: () => Date.now(),
};
let deps = defaultDeps;

const EMPTY: WsState = { rows: [], loaded: false, urls: new Map(), signedAt: 0 };
const states = new Map<string, WsState>();
const loading = new Map<string, Promise<void>>();
const holders = new Map<string, { count: number; stop: () => void }>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function get(ws: string): WsState {
  return states.get(ws) ?? EMPTY;
}

function put(ws: string, next: WsState) {
  states.set(ws, next);
  emit();
}

/** Sign links for the paths that have none (or all, when they're getting old). */
async function sign(ws: string, rows: readonly CustomEmoji[], all = false) {
  const chat = deps.runtime();
  if (!chat) return;
  const have = get(ws).urls;
  const paths = new Set<string>();
  for (const e of rows) {
    if (e.deletedAt) continue;
    for (const p of [e.posterPath, e.storagePath]) if (all || !have.has(p)) paths.add(p);
  }
  if (paths.size === 0) return;
  try {
    const signed = await chat.emojiUrls([...paths], URL_TTL_S);
    const cur = get(ws);
    const urls = new Map(all ? [] : cur.urls);
    for (const [p, u] of signed) urls.set(p, u);
    put(ws, { ...cur, urls, signedAt: all || cur.signedAt === 0 ? deps.now() : cur.signedAt });
  } catch {
    // An image that can't be reached draws as its `:name:`.
  }
}

/** Rows our ops or Realtime merged in while a read was in flight (the read's older answer mustn't drop them). */
const touched = new Map<string, CustomEmoji[]>();

/**
 * Read the workspace's emoji (first time, or when the links are getting old),
 * or else sign links for any live emoji still without one (a signing that
 * failed earlier is tried again here).
 */
function load(ws: string) {
  if (loading.has(ws)) return;
  const chat = deps.runtime();
  if (!chat) return;
  const cur = get(ws);
  const stale = cur.signedAt > 0 && deps.now() - cur.signedAt > URL_REFRESH_MS;
  if (cur.loaded && !stale) {
    const run = sign(ws, cur.rows).finally(() => loading.delete(ws));
    loading.set(ws, run);
    return;
  }
  touched.set(ws, []);
  const run = chat
    .customEmoji(ws)
    .then(async (read) => {
      let rows = read;
      for (const e of touched.get(ws) ?? []) rows = mergeEmoji(rows, e);
      put(ws, { ...get(ws), rows, loaded: true });
      await sign(ws, rows, stale);
    })
    // Unreachable: nothing custom shows (names read as text); the next check tries again.
    .catch(() => {})
    .finally(() => {
      touched.delete(ws);
      loading.delete(ws);
    });
  loading.set(ws, run);
}

/** A row from Realtime or from one of our own ops. */
export function applyEmojiRow(row: unknown) {
  const e = mapCustomEmoji(row);
  if (e) applyEmoji(e);
}

/** An emoji our own op answered with: shown at once, before Realtime. */
export function applyEmoji(e: CustomEmoji) {
  const cur = get(e.workspaceId);
  touched.get(e.workspaceId)?.push(e);
  put(e.workspaceId, { ...cur, rows: mergeEmoji(cur.rows, e) });
  if (!e.deletedAt) void sign(e.workspaceId, [e]);
}

/** How often an open workspace checks its links (re-signed past URL_REFRESH_MS, missing ones retried). */
const CHECK_MS = 10 * 60 * 1000;

function hold(ws: string): () => void {
  const h = holders.get(ws);
  if (h) h.count += 1;
  else {
    const stopLive = deps.live(ws, applyEmojiRow);
    const timer = setInterval(() => load(ws), CHECK_MS);
    holders.set(ws, {
      count: 1,
      stop: () => {
        clearInterval(timer);
        stopLive();
      },
    });
  }
  return () => {
    const cur = holders.get(ws);
    if (!cur) return;
    cur.count -= 1;
    if (cur.count === 0) {
      cur.stop();
      holders.delete(ws);
    }
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export type WorkspaceEmoji = {
  /** Live, newest first. */
  list: CustomEmoji[];
  byName: ReadonlyMap<string, CustomEmoji>;
  loaded: boolean;
  /** The image's link, or null while it isn't signed (draw the name). */
  urlOf: (path: string) => string | null;
};

const NONE: WorkspaceEmoji = {
  list: [],
  byName: new Map(),
  loaded: false,
  urlOf: () => null,
};

/** Pure: the view a surface reads. */
export function viewOf(state: WsState): WorkspaceEmoji {
  const list = liveEmoji(state.rows);
  return {
    list,
    byName: new Map(list.map((e) => [e.name, e])),
    loaded: state.loaded,
    urlOf: (path) => state.urls.get(path) ?? null,
  };
}

/** The workspace's custom emoji, live (an empty set without a workspace). */
export function useWorkspaceEmoji(workspaceId: string | null | undefined): WorkspaceEmoji {
  const state = useSyncExternalStore(
    subscribe,
    () => (workspaceId ? get(workspaceId) : EMPTY),
    () => EMPTY,
  );
  useEffect(() => {
    // No chat runtime (signed out, or a surface rendered on its own): nothing
    // to read, so no live channel either.
    if (!workspaceId || !deps.runtime()?.customEmoji) return;
    load(workspaceId);
    return hold(workspaceId);
  }, [workspaceId]);
  return useMemo(() => (workspaceId ? viewOf(state) : NONE), [state, workspaceId]);
}

/** Tests only. */
export function setEmojiStoreDepsForTest(next: Partial<EmojiStoreDeps> | null) {
  deps = next ? { ...defaultDeps, ...next } : defaultDeps;
  states.clear();
  loading.clear();
  touched.clear();
  for (const h of holders.values()) h.stop();
  holders.clear();
}

/** Tests only: wait for a workspace's read to settle. */
export function emojiLoadForTest(ws: string): Promise<void> {
  load(ws);
  return loading.get(ws) ?? Promise.resolve();
}

/** Tests only: the raw state. */
export function emojiViewForTest(ws: string): WorkspaceEmoji {
  return viewOf(get(ws));
}
