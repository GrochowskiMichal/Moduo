// Your chat settings kept on the server (CV-6a): "Show message text" (the
// server leaves a notice's text out while it's off, CH33), "Email when
// away", and (CV-17) "Show me as online" and "Show what I'm focusing on".
// Read with `user_chat_prefs()`, changed only through
// `user_op_set_chat_prefs(patch)` (the columns are op-only). The last read is
// kept for the tab, so presence can follow "Show me as online".

import { supabaseClient } from "../runtime.web";

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

// ── the tab's copy ──────────────────────────────────────────────────────────

let current: ChatServerPrefs | null = null;
const listeners = new Set<() => void>();

function keep(prefs: ChatServerPrefs): ChatServerPrefs {
  current = prefs;
  for (const fn of listeners) fn();
  return prefs;
}

/** The last prefs read or saved in this tab (null until the first read). */
export function currentChatServerPrefs(): ChatServerPrefs | null {
  return current;
}

export function subscribeChatServerPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function readChatServerPrefs(): Promise<ChatServerPrefs> {
  const { data, error } = await supabaseClient.rpc("user_chat_prefs");
  if (error) throw new Error(error.message);
  return keep(chatServerPrefsFromRow(data));
}

export async function setChatServerPrefs(
  patch: Partial<ChatServerPrefs>,
): Promise<ChatServerPrefs> {
  const body: Record<string, boolean> = {};
  if (patch.noticeShowText !== undefined) body.notice_show_text = patch.noticeShowText;
  if (patch.emailWhenAway !== undefined) body.email_when_away = patch.emailWhenAway;
  if (patch.showOnline !== undefined) body.show_online = patch.showOnline;
  if (patch.showFocusTask !== undefined) body.show_focus_task = patch.showFocusTask;
  const { data, error } = await supabaseClient.rpc("user_op_set_chat_prefs", { p_patch: body });
  if (error) throw new Error(error.message);
  return keep(chatServerPrefsFromRow(data));
}
