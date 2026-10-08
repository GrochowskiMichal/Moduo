// CAL-8b — the CalDAV/ICS connect orchestration (desktop-only). Rust owns the
// protocol + the keychain; this layer sequences discover → save creds → upsert
// one cloud account row per selected calendar, and the ICS add / reconnect /
// keychain-cleanup flows. Credentials never touch Supabase — only the
// non-secret descriptor (server + username) rides the account's sync_token.

import { parseOrError } from "@contracts/errors";
import { caldavCalendarSchema } from "@contracts/rows";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import type { ModuoRuntime } from "../../lib/runtime.types";
import { accountHue } from "./accounts";
import type { CalendarAccountModel } from "./events";
import { buildCaldavDescriptor, buildIcsDescriptor, parseSyncDescriptor } from "./sync";

export type CaldavCalendar = { url: string; name: string; color: string | null };

/** A connect-dialog preset: prefilled server + the right credential hint. */
export type CaldavPreset = {
  id: "icloud" | "fastmail" | "nextcloud" | "other";
  label: string;
  /** Prefilled server address (empty = the user pastes their own). */
  serverUrl: string;
  /** Whether the server field is editable (self-hosted / other) or fixed. */
  serverEditable: boolean;
  hint: string;
  usernamePlaceholder: string;
};

export const CALDAV_PRESETS: CaldavPreset[] = [
  {
    id: "icloud",
    label: "iCloud",
    serverUrl: "https://caldav.icloud.com",
    serverEditable: false,
    hint: "Use an app-specific password — create one at appleid.apple.com → Sign-In & Security.",
    usernamePlaceholder: "you@icloud.com",
  },
  {
    id: "fastmail",
    label: "Fastmail",
    serverUrl: "https://caldav.fastmail.com",
    serverEditable: false,
    hint: "Use an app password — Fastmail → Settings → Privacy & Security → App passwords.",
    usernamePlaceholder: "you@fastmail.com",
  },
  {
    id: "nextcloud",
    label: "Nextcloud",
    serverUrl: "",
    serverEditable: true,
    hint: "Paste your Nextcloud address, e.g. https://cloud.example.com/remote.php/dav",
    usernamePlaceholder: "username",
  },
  {
    id: "other",
    label: "Other",
    serverUrl: "",
    serverEditable: true,
    hint: "Paste the CalDAV server address. Moduo connects over https only.",
    usernamePlaceholder: "username or email",
  },
];

/** Probe a server and list its event calendars (saves nothing). */
export async function discoverCaldavCalendars(input: {
  serverUrl: string;
  username: string;
  password: string;
}): Promise<CaldavCalendar[]> {
  const raw = await invoke<unknown>("calendar_caldav_discover", input);
  const parsed = parseOrError(z.array(caldavCalendarSchema), raw);
  if (!parsed.success) return [];
  return parsed.data.map((c) => ({
    url: c.url,
    name: c.name,
    color: c.color ?? null,
  }));
}

/**
 * Connect the chosen calendars: save the (server, username) credentials once,
 * then upsert one account row per calendar with its CalDAV descriptor. Returns
 * the number of rows created/updated.
 */
export async function connectCaldavCalendars(args: {
  runtime: ModuoRuntime;
  workspaceId: string;
  serverUrl: string;
  username: string;
  password: string;
  calendars: CaldavCalendar[];
}): Promise<number> {
  const { runtime, workspaceId, serverUrl, username, password, calendars } = args;
  await invoke("calendar_caldav_save_credentials", { serverUrl, username, password });
  const now = new Date().toISOString();
  let created = 0;
  try {
    for (const cal of calendars) {
      await runtime.calendar.upsertAccount({
        workspaceId,
        provider: "caldav",
        externalId: cal.url,
        displayLabel: `${cal.name} — ${username}`,
        color: cal.color ? accountHue(cal.color) : null,
        status: "ok",
        lastSyncAt: now,
        syncToken: buildCaldavDescriptor({
          serverUrl,
          username,
          calendarUrl: cal.url,
          calendarName: cal.name,
        }),
      });
      created += 1;
    }
  } catch (err) {
    // If NOT ONE row landed, roll the just-saved credential back so a failed
    // connect can't orphan a password in the keychain with no account row
    // pointing at it. A partial success keeps its creds (the rows are real and
    // a retry is idempotent on externalId).
    if (created === 0) {
      await invoke("calendar_caldav_delete_credentials", { serverUrl, username }).catch(() => {});
    }
    throw err;
  }
  return created;
}

/** Re-save a CalDAV password for an existing account and clear its error. */
export async function reconnectCaldavAccount(args: {
  runtime: ModuoRuntime;
  workspaceId: string;
  account: CalendarAccountModel;
  password: string;
}): Promise<void> {
  const { runtime, workspaceId, account, password } = args;
  const desc = parseSyncDescriptor(account.syncToken);
  if (desc?.kind !== "caldav") throw new Error("Not a CalDAV account.");
  // One keychain secret per (server, username) → this repairs every calendar
  // row of that account at once.
  await invoke("calendar_caldav_save_credentials", {
    serverUrl: desc.serverUrl,
    username: desc.username,
    password,
  });
  await runtime.calendar.upsertAccount({
    workspaceId,
    provider: "caldav",
    externalId: account.externalId,
    displayLabel: account.displayLabel,
    color: account.color,
    status: "ok",
    lastSyncAt: new Date().toISOString(),
  });
}

/** Add an ICS feed: save the URL secret, resolve a name, upsert one row. */
export async function addIcsFeed(args: {
  runtime: ModuoRuntime;
  workspaceId: string;
  url: string;
  name?: string;
}): Promise<CalendarAccountModel> {
  const { runtime, workspaceId, url } = args;
  const feedId = await invoke<string>("calendar_ics_save_feed", { url });
  let name = args.name?.trim() || "";
  if (!name) {
    // Default to the feed's X-WR-CALNAME (one fetch), else its host.
    try {
      const raw = await invoke<Record<string, unknown>[]>("calendar_ics_fetch", { feedId });
      const ics = typeof raw[0]?.ics === "string" ? (raw[0].ics as string) : "";
      const { icsCalendarName } = await import("./ics-mirror");
      name = (ics && icsCalendarName(ics)) || hostOf(url) || "ICS feed";
    } catch {
      name = hostOf(url) || "ICS feed";
    }
  }
  return runtime.calendar.upsertAccount({
    workspaceId,
    provider: "ics",
    externalId: feedId,
    displayLabel: name,
    color: null,
    status: "ok",
    lastSyncAt: new Date().toISOString(),
    syncToken: buildIcsDescriptor(),
  });
}

/**
 * Delete the keychain secret(s) an account owned, when appropriate, BEFORE the
 * Supabase row is removed. For CalDAV, only delete the shared (server,
 * username) credential when this was the LAST calendar row of that account
 * (`allAccounts` still includes the row being removed). No-op on non-desktop
 * or for OAuth/native rows.
 */
export async function cleanupCredentialsForRemoval(args: {
  isDesktop: boolean;
  removed: CalendarAccountModel;
  allAccounts: CalendarAccountModel[];
}): Promise<void> {
  const { isDesktop, removed, allAccounts } = args;
  if (!isDesktop) return;
  if (removed.provider === "ics") {
    await invoke("calendar_ics_delete_feed", { feedId: removed.externalId }).catch(() => {});
    return;
  }
  const desc = parseSyncDescriptor(removed.syncToken);
  if (desc?.kind !== "caldav") return;
  if (isLastCaldavRowForAccount(allAccounts, removed)) {
    await invoke("calendar_caldav_delete_credentials", {
      serverUrl: desc.serverUrl,
      username: desc.username,
    }).catch(() => {});
  }
}

/**
 * True when `removed` is the only remaining live CalDAV row sharing its
 * (server, username) — i.e. removing it orphans the shared keychain secret.
 * Pure (testable); `allAccounts` includes `removed`.
 */
export function isLastCaldavRowForAccount(
  allAccounts: CalendarAccountModel[],
  removed: CalendarAccountModel,
): boolean {
  const rd = parseSyncDescriptor(removed.syncToken);
  if (rd?.kind !== "caldav") return false;
  const key = `${rd.serverUrl}|${rd.username}`;
  for (const a of allAccounts) {
    if (a.id === removed.id || a.deletedAt) continue;
    const d = parseSyncDescriptor(a.syncToken);
    if (d?.kind === "caldav" && `${d.serverUrl}|${d.username}` === key) return false;
  }
  return true;
}

function hostOf(url: string): string {
  try {
    return new URL(url.replace(/^webcal:/i, "https:")).host;
  } catch {
    return "";
  }
}
