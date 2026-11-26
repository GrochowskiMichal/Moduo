// Connecting (or reconnecting) a Google or Outlook calendar login from the
// desktop app: the provider sign-in runs in Rust and keeps its token in this
// Mac's keychain; this registers the login in Supabase so web and desktop both
// see it, and hands a Google token to the web side too.

import { invoke } from "@tauri-apps/api/core";

import type { ModuoRuntime } from "../../lib/runtime.types";
import { loginRows } from "./accounts";
import type { CalendarAccountModel } from "./events";
import { loadGoogleStatus } from "./google-web";

type OAuthResult = {
  accountId: string;
  email: string;
  displayName: string;
  calendars: { id: string; name: string; color: string }[];
};

/**
 * Calendars picked on the web sync through the Google token in Supabase, also
 * on the desktop. A sign-in kept only in this Mac's keychain never replaced a
 * token Google had revoked, so Reconnect here changed nothing. Hand the new
 * token over (one row per login), then read the status once: a working token
 * clears the login's reauth mark. Best effort: the keychain sign-in stands.
 */
export async function shareGoogleSignIn(
  accountId: string,
  deps: { publish: (accountId: string) => Promise<unknown>; refresh: () => Promise<unknown> } = {
    publish: (id) => invoke("calendar_google_publish_booking_token", { accountId: id }),
    refresh: loadGoogleStatus,
  },
): Promise<void> {
  try {
    await deps.publish(accountId);
    await deps.refresh();
  } catch (e) {
    console.warn("[calendar] google token not shared:", e);
  }
}

export async function connectCalendarOnDesktop(input: {
  runtime: ModuoRuntime;
  workspaceId: string;
  provider: "google" | "microsoft";
  /** The Rust sign-in command. */
  command: string;
  accounts: CalendarAccountModel[];
}): Promise<void> {
  const { runtime, workspaceId, provider, command, accounts } = input;
  const result = await invoke<OAuthResult>(command);
  // A login already added on the web (its id lowercased) keeps its rows, or
  // every event would show twice; it syncs through the web sign-in. Calendars
  // picked under the login are its rows too: no extra login row beside them.
  const rows = loginRows(accounts, provider, result.accountId);
  const sameLogin = rows.find((a) => a.externalId.toLowerCase() === result.accountId.toLowerCase());
  if (sameLogin || rows.length === 0) {
    await runtime.calendar.upsertAccount({
      workspaceId,
      provider,
      externalId: sameLogin?.externalId ?? result.accountId,
      displayLabel: result.email || result.displayName,
      color: null,
      status: "ok",
      lastSyncAt: new Date().toISOString(),
    });
  }
  if (provider === "google") await shareGoogleSignIn(result.accountId);
}
