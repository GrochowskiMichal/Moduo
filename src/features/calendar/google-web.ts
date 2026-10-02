// Web Google Calendar. The refresh token lives in user_integrations; the
// desktop keychain is not available in the browser. Sync and create both go
// through the calendar-google-web edge function.

import type { ModuoRuntime } from "../../lib/runtime.types";
import { supabaseClient } from "../../lib/runtime.web";
export type LinkedGoogleCalendar = {
  email: string;
  accountId: string;
  summary: string;
  googleCalendarId: string;
};

async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseClient.functions.invoke("calendar-google-web", { body });
  if (error) throw new Error(error.message || "Google Calendar is unavailable.");
  const payload = (data ?? {}) as Record<string, unknown>;
  if (typeof payload.error === "string" && payload.error.length > 0) {
    throw new Error(payload.error);
  }
  return payload;
}

export async function loadLinkedGoogleCalendars(): Promise<LinkedGoogleCalendar[]> {
  const payload = await invoke({ action: "status" });
  const rows = Array.isArray(payload.calendars) ? payload.calendars : [];
  return rows.filter((row): row is LinkedGoogleCalendar => {
    if (!row || typeof row !== "object") return false;
    const item = row as LinkedGoogleCalendar;
    return (
      typeof item.email === "string" &&
      typeof item.accountId === "string" &&
      typeof item.summary === "string" &&
      typeof item.googleCalendarId === "string"
    );
  });
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
}): Promise<Record<string, unknown>> {
  const payload = await invoke({ action: "push", ...input });
  const event = payload.event;
  if (!event || typeof event !== "object") throw new Error("Google did not return the event.");
  return event as Record<string, unknown>;
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
  if (error || !data) return new Set();
  return new Set(
    data
      .map((row) => row.external_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
}

/**
 * Make sure each Google calendar behind a stored token has a calendar-account
 * row. A desktop connect already stores one row per login (`google:{email}`)
 * that mirrors every calendar in that login — don't add a second copy.
 */
export async function ensureGoogleCalendarAccounts(opts: {
  runtime: ModuoRuntime;
  workspaceId: string;
  accounts: { provider: string; externalId: string; deletedAt: string | null }[];
}): Promise<boolean> {
  const linked = await loadLinkedGoogleCalendars();
  const live = opts.accounts.filter((account) => !account.deletedAt);
  const revive = sessionStorage.getItem("moduo:google-connect") === "1";
  if (revive) sessionStorage.removeItem("moduo:google-connect");
  const removed = revive ? new Set<string>() : await tombstonedGoogleIds(opts.workspaceId);
  let added = false;
  for (const cal of linked) {
    const loginId = `google:${cal.email}`;
    if (live.some((account) => account.provider === "google" && account.externalId === loginId)) {
      continue;
    }
    if (live.some((account) => account.externalId === cal.accountId)) continue;
    if (removed.has(cal.accountId)) continue;
    await opts.runtime.calendar.upsertAccount({
      workspaceId: opts.workspaceId,
      provider: "google",
      externalId: cal.accountId,
      displayLabel: cal.summary || cal.email,
      color: null,
      status: "ok",
      lastSyncAt: null,
    });
    added = true;
  }
  return added;
}
