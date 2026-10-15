// Your chat settings kept on the server (CV-6a): "Show message text" (the
// server leaves a notice's text out while it's off, CH33) and "Email when
// away". Read with `user_chat_prefs()`, changed only through
// `user_op_set_chat_prefs(patch)` (the columns are op-only).

import { supabaseClient } from "../runtime.web";

export type ChatServerPrefs = {
  noticeShowText: boolean;
  emailWhenAway: boolean;
};

export const DEFAULT_CHAT_SERVER_PREFS: ChatServerPrefs = {
  noticeShowText: true,
  emailWhenAway: true,
};

export function chatServerPrefsFromRow(raw: unknown): ChatServerPrefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    noticeShowText:
      typeof r.notice_show_text === "boolean"
        ? r.notice_show_text
        : DEFAULT_CHAT_SERVER_PREFS.noticeShowText,
    emailWhenAway:
      typeof r.email_when_away === "boolean"
        ? r.email_when_away
        : DEFAULT_CHAT_SERVER_PREFS.emailWhenAway,
  };
}

export async function readChatServerPrefs(): Promise<ChatServerPrefs> {
  const { data, error } = await supabaseClient.rpc("user_chat_prefs");
  if (error) throw new Error(error.message);
  return chatServerPrefsFromRow(data);
}

export async function setChatServerPrefs(
  patch: Partial<ChatServerPrefs>,
): Promise<ChatServerPrefs> {
  const body: Record<string, boolean> = {};
  if (patch.noticeShowText !== undefined) body.notice_show_text = patch.noticeShowText;
  if (patch.emailWhenAway !== undefined) body.email_when_away = patch.emailWhenAway;
  const { data, error } = await supabaseClient.rpc("user_op_set_chat_prefs", { p_patch: body });
  if (error) throw new Error(error.message);
  return chatServerPrefsFromRow(data);
}
