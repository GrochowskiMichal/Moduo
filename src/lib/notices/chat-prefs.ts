// Your chat settings kept on the server (CV-6a): "Show message text" (the
// server leaves a notice's text out while it's off, CH33), "Email when
// away", and (CV-17) "Show me as online" and "Show what I'm focusing on".
// Read with `user_chat_prefs()`, changed only through
// `user_op_set_chat_prefs(patch)` (the columns are op-only). The last read is
// kept for the tab, for the signed-in person only, so presence can follow
// "Show me as online"; a change in one tab tells the person's other tabs.
// A sign-out forgets it.

import { supabaseClient } from "@/lib/runtime.web";

export type ChatServerPrefs = {
  noticeShowText: boolean;
  emailWhenAway: boolean;
  /** Track yourself on the presence topic (on by default). */
  showOnline: boolean;
  /** Teammates who can see the task see which one you're focusing on. */
  showFocusTask: boolean;
};

export const DEFAULT_CHAT_SERVER_PREFS: ChatServerPrefs = {
  noticeShowText: true,
  emailWhenAway: true,
  showOnline: true,
  showFocusTask: false,
};

export function chatServerPrefsFromRow(raw: unknown): ChatServerPrefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    noticeShowText: flag(r.notice_show_text, DEFAULT_CHAT_SERVER_PREFS.noticeShowText),
    emailWhenAway: flag(r.email_when_away, DEFAULT_CHAT_SERVER_PREFS.emailWhenAway),
    showOnline: flag(r.show_online, DEFAULT_CHAT_SERVER_PREFS.showOnline),
    showFocusTask: flag(r.show_focus_task, DEFAULT_CHAT_SERVER_PREFS.showFocusTask),
  };
}

// ── the tab's copy, for one person ──────────────────────────────────────────

let current: { userId: string; prefs: ChatServerPrefs } | null = null;
const listeners = new Set<() => void>();
const CHANNEL = "moduo-chat-prefs";
let tabs: BroadcastChannel | null = null;
/** Bumped by a sign-out or a save: a read (or save) that started before it
 *  keeps nothing. */
let generation = 0;

function notify(): void {
  for (const fn of listeners) fn();
}

async function sessionUserId(): Promise<string | null> {
  const { data } = await supabaseClient.auth.getSession();
  return data.session?.user?.id ?? null;
}

function keep(userId: string | null, prefs: ChatServerPrefs, since: number): ChatServerPrefs {
  if (userId && since === generation) {
    current = { userId, prefs };
    notify();
  }
  return prefs;
}

/** The person's prefs as last read or saved in this tab (null until read, or
 *  when they were read for someone else). */
export function currentChatServerPrefs(userId: string | null): ChatServerPrefs | null {
  return current && userId && current.userId === userId ? current.prefs : null;
}

export function subscribeChatServerPrefs(fn: () => void): () => void {
  listeners.add(fn);
  listenToOtherTabs();
  return () => {
    listeners.delete(fn);
  };
}

/** Forget the copy (sign-out, account switch). */
export function forgetChatServerPrefs(): void {
  generation += 1;
  current = null;
  notify();
}

/** Another tab changed them: read again (for whoever is signed in now). */
function listenToOtherTabs(): void {
  if (tabs || typeof BroadcastChannel === "undefined") return;
  tabs = new BroadcastChannel(CHANNEL);
  tabs.onmessage = () => {
    if (current) void readChatServerPrefs().catch(() => undefined);
  };
}

export async function readChatServerPrefs(): Promise<ChatServerPrefs> {
  const since = generation;
  const userId = await sessionUserId();
  const { data, error } = await supabaseClient.rpc("user_chat_prefs");
  if (error) throw new Error(error.message);
  return keep(userId, chatServerPrefsFromRow(data), since);
}

export async function setChatServerPrefs(
  patch: Partial<ChatServerPrefs>,
): Promise<ChatServerPrefs> {
  const body: Record<string, boolean> = {};
  if (patch.noticeShowText !== undefined) body.notice_show_text = patch.noticeShowText;
  if (patch.emailWhenAway !== undefined) body.email_when_away = patch.emailWhenAway;
  if (patch.showOnline !== undefined) body.show_online = patch.showOnline;
  if (patch.showFocusTask !== undefined) body.show_focus_task = patch.showFocusTask;
  // A read that started before this save must not put the old value back.
  generation += 1;
  const since = generation;
  const userId = await sessionUserId();
  const { data, error } = await supabaseClient.rpc("user_op_set_chat_prefs", { p_patch: body });
  if (error) throw new Error(error.message);
  const prefs = keep(userId, chatServerPrefsFromRow(data), since);
  listenToOtherTabs();
  tabs?.postMessage("changed");
  return prefs;
}
