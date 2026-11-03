// Outlook Calendar on the web, view only like the desktop app. The refresh
// token lives in user_integrations (the browser can't read the desktop
// keychain); connect and sync go through the calendar-microsoft-web edge
// function. One calendar account per Microsoft login (`outlook:<email>`),
// mirroring all of its calendars, as the desktop app does.

import { getRuntime } from "../../lib/runtime";
import type { ModuoRuntime } from "../../lib/runtime.types";
import { webOrigin } from "../../lib/web-origin";
import {
  clearJustConnected,
  finishConnectReturn,
  justConnected,
  rememberConnectStart,
} from "./connect-return";

/** The function's own refusal codes, as sentences for a toast. */
const SENTENCES: Record<string, string> = {
  outlook_not_connected: "Outlook isn't connected for this account on the web. Connect it again.",
  outlook_reauth: "Outlook stopped accepting Moduo's access. Connect it again.",
  outlook_not_configured: "Outlook Calendar isn't set up on this server yet.",
  outlook_no_url: "Outlook didn't return a sign-in page.",
  unknown_action:
    "This version of the app is ahead of the server. Try again after the next update.",
};

/** A refusal from the runtime's Outlook calls, in words. */
export function outlookErrorText(err: unknown): string {
  const code = err instanceof Error ? err.message : "";
  return SENTENCES[code] ?? "Couldn't reach Outlook. Try again.";
}

function calendarRuntime(): ModuoRuntime["calendar"] {
  const runtime = getRuntime();
  if (!runtime) throw new Error("runtime_not_ready");
  return runtime.calendar;
}

export function outlookAccountId(email: string): string {
  return `outlook:${email.trim().toLowerCase()}`;
}

export async function startWebOutlookConnect(): Promise<void> {
  const start = calendarRuntime().startOutlookConnect;
  if (!start) throw new Error(SENTENCES.unknown_action);
  let url: string;
  try {
    url = await start(webOrigin());
  } catch (err) {
    throw new Error(outlookErrorText(err));
  }
  rememberConnectStart(url);
  window.location.href = url;
}

/** A server that never held a web sign-in (no client, no function yet) has nothing to drop. */
const NOTHING_TO_DROP = new Set(["outlook_not_configured", "outlook_not_deployed"]);

export async function disconnectOutlookLogin(email: string): Promise<void> {
  try {
    await calendarRuntime().disconnectOutlook?.(email);
  } catch (err) {
    if (err instanceof Error && NOTHING_TO_DROP.has(err.message)) return;
    throw new Error(outlookErrorText(err));
  }
}

/**
 * Back from connecting Outlook: finish the connect, then add the login just
 * connected as a calendar account here unless it has a live one (a removed one
 * comes back: the person just connected it again). Only right after this tab
 * connected, and only that login: a token belongs to the person, not the
 * workspace. True when it added one.
 */
export async function ensureOutlookCalendarAccounts(opts: {
  runtime: ModuoRuntime;
  workspaceId: string;
  accounts: { provider: string; externalId: string; deletedAt: string | null }[];
}): Promise<boolean> {
  await finishConnectReturn();
  const email = justConnected("microsoft");
  if (!email) return false;
  const externalId = outlookAccountId(email);
  // The desktop app keeps Microsoft's casing in its account ids.
  const live = opts.accounts.some(
    (a) => a.provider === "microsoft" && !a.deletedAt && a.externalId.toLowerCase() === externalId,
  );
  if (live) {
    clearJustConnected("microsoft");
    return false;
  }
  // The mark goes only once the account is in: a failed add retries on the next load.
  await opts.runtime.calendar.upsertAccount({
    workspaceId: opts.workspaceId,
    provider: "microsoft",
    externalId,
    displayLabel: email,
    color: null,
    status: "ok",
    lastSyncAt: null,
  });
  clearJustConnected("microsoft");
  return true;
}
