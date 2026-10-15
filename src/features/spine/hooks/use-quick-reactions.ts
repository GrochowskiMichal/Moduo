// Your quick reactions (CV-7c, CH16a): one row per person for every workspace,
// saved in user_preferences.reaction_row (null = Moduo's six). The hover row
// on messages and the reaction button on task and note comments read it here;
// Settings → Chat saves it. One copy per signed-in person, shared by every
// surface, so a change in Settings shows everywhere at once.

import { useEffect, useSyncExternalStore } from "react";

import type { ChatRuntime } from "@/features/chat/model";
import { getRuntime } from "@/lib/runtime";

import { resolveQuickRow } from "../reactions";

type State = {
  /** Whose row this is (a sign-out or switch starts over). */
  userId: string | null;
  /** What you saved; null = Moduo's six. */
  saved: string[] | null;
  loaded: boolean;
};

let state: State = { userId: null, saved: null, loaded: false };
let loading: Promise<void> | null = null;
/** Bumped by every save: an answer that started before the latest save is stale. */
let version = 0;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const l of listeners) l();
}

function chatRuntime(): ChatRuntime | null {
  return getRuntime()?.chat ?? null;
}

function load(userId: string) {
  if (state.userId === userId && (state.loaded || loading)) return;
  if (state.userId !== userId) set({ userId, saved: null, loaded: false });
  const chat = chatRuntime();
  if (!chat) return;
  const started = version;
  const run = chat
    .myPrefs()
    .then((p) => {
      if (state.userId === userId && version === started) {
        set({ userId, saved: p.reactionRow, loaded: true });
      }
    })
    // Unreachable prefs leave Moduo's six; the next mount tries again.
    .catch(() => {})
    .finally(() => {
      if (loading === run) loading = null;
    });
  loading = run;
}

/** Save your row (null = back to Moduo's six). Shown at once; throws on failure
 *  after putting the old row back. */
export async function saveQuickRow(row: string[] | null): Promise<void> {
  const chat = chatRuntime();
  if (!chat) throw new Error("Sign in to change your reactions.");
  const before = state;
  const mine = ++version;
  set({ ...state, saved: row, loaded: true });
  try {
    const p = await chat.setMyPrefs({ reactionRow: row });
    if (state.userId === before.userId && version === mine) {
      set({ ...state, saved: p.reactionRow, loaded: true });
    }
  } catch (e) {
    // Only the latest save puts its old row back (a later one already moved on).
    if (state.userId === before.userId && version === mine) set(before);
    throw e;
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The six keys of your quick row, resolved (yours first, Moduo's six fill in). */
export function useQuickReactions(userId: string | null): {
  row: string[];
  saved: string[] | null;
} {
  const snap = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  useEffect(() => {
    if (userId) load(userId);
  }, [userId]);
  const saved = snap.userId === userId ? snap.saved : null;
  return { row: resolveQuickRow(saved), saved };
}

/** Tests only: forget the cached row. */
export function resetQuickReactionsForTest() {
  state = { userId: null, saved: null, loaded: false };
  loading = null;
  version = 0;
}
