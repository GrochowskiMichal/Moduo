// Web Google Calendar. The refresh token lives in user_integrations; the
// desktop keychain is not available in the browser. Sync and create both go
// through the calendar-google-web edge function.

import { DbError } from "../../lib/runtime.db";
import type { ModuoRuntime } from "../../lib/runtime.types";
import { supabaseClient } from "../../lib/runtime.web.client";
import {
  type CalendarPick,
  type GoogleStatus,
  loginsAwaitingPick,
  parseGoogleStatus,
  planGooglePicks,
} from "./account-picks";
import { finishConnectReturn, rememberConnectStart } from "./connect-return";
import type { CalendarMirrorEventInput } from "./events";
import { mapGoogleEvent } from "./mirror";
export type LinkedGoogleCalendar = {
  email: string;
  accountId: string;
  summary: string;
  googleCalendarId: string;
  primary: boolean;
  /** Google lets you only read it (reader, free/busy). */
  readOnly: boolean;
};

/**
 * The reason a failed function call gives. A non-2xx answer (`FunctionsHttpError`)
 * carries the Response in `context`: its JSON `error` is the function's own reason
 * (Google's, for a refused write). Otherwise the error's message.
 */
export async function readFunctionError(error: unknown): Promise<string> {
  const fallback = error instanceof Error && error.message ? error.message : "";
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const payload = (await context.clone().json()) as { error?: unknown };
      if (typeof payload?.error === "string" && payload.error) return payload.error;
    } catch {
      // Not JSON: the message is all there is.
    }
  }
  return fallback;
}

/** The function's own error codes, as sentences for a toast; Google's reasons pass through. */
const FUNCTION_ERRORS: Record<string, string> = {
  google_not_connected:
    "Google isn't connected for this account on the web. Reconnect it in Settings › Integrations.",
  google_reauth: "Google stopped accepting Moduo's access. Reconnect it in Calendar accounts.",
  google_not_configured: "Google Calendar isn't set up on this server.",
  bad_patch: "Google events can't change that here yet.",
  bad_event: "That event is missing something Google needs.",
  bad_account: "That event belongs to another Google account.",
  unknown_action:
    "This version of the app is ahead of the server. Try again after the next update.",
};

function sentenceFor(reason: string): string {
  return FUNCTION_ERRORS[reason] ?? reason;
}

async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseClient.functions.invoke("calendar-google-web", { body });
  if (error) {
    throw new Error(
      sentenceFor(await readFunctionError(error)) || "Google Calendar is unavailable.",
    );
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  if (typeof payload.error === "string" && payload.error.length > 0) {
    throw new Error(sentenceFor(payload.error));
  }
  return payload;
}

/** Every Google calendar behind a stored token, and the logins Google stopped accepting. */
export async function loadGoogleStatus(): Promise<GoogleStatus> {
  return parseGoogleStatus(await invoke({ action: "status" }));
}

export async function loadLinkedGoogleCalendars(): Promise<LinkedGoogleCalendar[]> {
  return (await loadGoogleStatus()).calendars;
}

export async function fetchGoogleWebEvents(input: {
  externalAccountId: string;
  timeMin: string;
  timeMax: string;
}): Promise<Record<string, unknown>[]> {
  const payload = await invoke({ action: "events", ...input });
  return Array.isArray(payload.events) ? (payload.events as Record<string, unknown>[]) : [];
}

export async function pushGoogleWebEvent(input: {
  externalAccountId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  description?: string;
  rrule?: string | null;
  timeZone: string;
  /** CALR-9: a place, the guests Google invites, and a Meet link Google makes. */
  location?: string;
  attendees?: { email: string; name?: string }[];
  meet?: "add";
  /** CALR-20b: the id this app made for the event, so a retry can't make a second one. */
  eventId?: string;
}): Promise<Record<string, unknown>> {
  // Optional keys go only when set: the push action reads each one if present.
  const body: Record<string, unknown> = { action: "push" };
  for (const [key, value] of Object.entries(input)) if (value !== undefined) body[key] = value;
  const payload = await invoke(body);
  const event = payload.event;
  if (!event || typeof event !== "object") throw new Error("Google did not return the event.");
  return event as Record<string, unknown>;
}

/**
 * The event Google has under the id this app made for it, or null when it has
 * none. Throws when it can't tell (offline, an older server without "get").
 */
export async function getGoogleWebEvent(input: {
  externalAccountId: string;
  eventId: string;
}): Promise<Record<string, unknown> | null> {
  const payload = await invoke({ action: "get", ...input });
  if (!("event" in payload)) throw new Error("Google did not answer.");
  const event = payload.event;
  return event && typeof event === "object" ? (event as Record<string, unknown>) : null;
}

/** Save a change to a Google event on Google (CALR-8). Returns Google's answer, mapped for the mirror. */
export async function updateGoogleWebEvent(input: {
  externalAccountId: string;
  calendarId: string;
  eventId: string;
  patch: Record<string, unknown>;
  timeZone: string;
}): Promise<CalendarMirrorEventInput | null> {
  const payload = await invoke({ action: "update", ...input });
  const event = payload.event;
  if (!event || typeof event !== "object") throw new Error("Google did not return the event.");
  return mapGoogleEvent(event as Record<string, unknown>);
}

/** Delete a Google event on Google, telling its guests (CALR-8). */
export async function removeGoogleWebEvent(input: {
  externalAccountId: string;
  calendarId: string;
  eventId: string;
}): Promise<void> {
  await invoke({ action: "delete", ...input });
}

export async function startWebGoogleConnect(): Promise<void> {
  const { data, error } = await supabaseClient.functions.invoke("booking-google-connect", {
    body: { origin: window.location.origin },
  });
  if (error) throw new Error(error.message || "Could not connect Google.");
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error("Google connect did not return a sign-in page.");
  // Coming back from Google should show every calendar again, including ones
  // the user had removed from this mailbox.
  sessionStorage.setItem("moduo:google-connect", "1");
  rememberConnectStart(url);
  window.location.href = url;
}

export async function disconnectGoogleLogin(email: string): Promise<void> {
  await invoke({ action: "disconnect", email });
}

async function tombstonedGoogleIds(workspaceId: string): Promise<Set<string>> {
  const { data, error } = await supabaseClient
    .from("calendar_accounts")
    .select("external_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "google")
    .not("deleted_at", "is", null);
  // A failed read is not "none removed": re-adding from it would bring a removed
  // calendar back. Throw; the callers skip this pass and the next load retries.
  if (error) throw new DbError(error);
  return new Set(
    (data ?? [])
      .map((row) => row.external_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
}

/**
 * Back from connecting Google: finish the connect, then name the logins whose
 * calendars wait for the picker (CALR-20: only picked calendars sync). A login
 * removed here doesn't come back unless this tab just connected it again.
 */
export async function ensureGoogleCalendarAccounts(opts: {
  /** With it, a synced calendar whose Google access changed is updated (read-only or not). */
  runtime?: ModuoRuntime;
  workspaceId: string;
  accounts: {
    provider: string;
    externalId: string;
    displayLabel?: string;
    deletedAt: string | null;
    readOnly?: boolean;
  }[];
  /** Leave the "just connected" mark for the Calendar page (Settings only peeks). */
  peek?: boolean;
}): Promise<{ awaiting: string[]; linked: LinkedGoogleCalendar[] }> {
  // Back from Google: the new token is only saved once the connect finishes.
  await finishConnectReturn();
  const linked = await loadLinkedGoogleCalendars();
  const revive = sessionStorage.getItem("moduo:google-connect") === "1";
  if (revive && !opts.peek) sessionStorage.removeItem("moduo:google-connect");
  // A token belongs to the person, not the workspace: the picker opens only
  // right after this tab connected, never on every visit (a login connected in
  // another workspace shows in Calendar accounts, off, until you pick there).
  // A failed read of removed calendars throws, so callers skip this pass.
  const removed = revive ? new Set<string>() : await tombstonedGoogleIds(opts.workspaceId);
  const awaiting = revive
    ? loginsAwaitingPick(linked, opts.accounts).filter(
        (email) =>
          ![...removed].some((id) => id === `google:${email}` || id.startsWith(`google:${email}:`)),
      )
    : [];
  if (opts.runtime)
    await refreshGoogleAccess(opts.runtime, opts.workspaceId, opts.accounts, linked);
  return { awaiting, linked };
}

/** Calendars synced before Google said which are read-only learn it here. */
async function refreshGoogleAccess(
  runtime: ModuoRuntime,
  workspaceId: string,
  accounts: Parameters<typeof ensureGoogleCalendarAccounts>[0]["accounts"],
  linked: readonly LinkedGoogleCalendar[],
): Promise<void> {
  for (const cal of linked) {
    const row = accounts.find(
      (a) => !a.deletedAt && a.provider === "google" && a.externalId === cal.accountId,
    );
    if (!row || (row.readOnly ?? false) === cal.readOnly) continue;
    await runtime.calendar
      .upsertAccount({
        workspaceId,
        provider: "google",
        externalId: cal.accountId,
        displayLabel: row.displayLabel ?? "",
        readOnly: cal.readOnly,
      })
      .catch(() => {});
  }
}

/** Sync the picked calendars of a login; returns the new account ids to hide from the week. */
export async function saveGooglePicks(opts: {
  runtime: ModuoRuntime;
  workspaceId: string;
  picks: readonly CalendarPick[];
}): Promise<{ accountIds: string[]; hiddenIds: string[] }> {
  const plan = planGooglePicks(opts.picks);
  const accountIds: string[] = [];
  const hiddenIds: string[] = [];
  for (const cal of plan.add) {
    const account = await opts.runtime.calendar.upsertAccount({
      workspaceId: opts.workspaceId,
      provider: "google",
      externalId: cal.externalId,
      displayLabel: cal.displayLabel,
      color: null,
      status: "ok",
      lastSyncAt: null,
      readOnly: cal.readOnly,
      busyDefault: cal.busyDefault,
    });
    accountIds.push(account.id);
    if (plan.hide.includes(cal.externalId)) hiddenIds.push(account.id);
  }
  return { accountIds, hiddenIds };
}
