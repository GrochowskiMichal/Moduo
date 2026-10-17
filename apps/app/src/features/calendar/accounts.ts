// Account attribution helpers (CAL-6, AC12) — the left-rail account map + the
// external-chip color come from here. Colors stay token-routed: an account's
// hue is one of the bounded label names (tag-colors.ts → the [data-label]
// tokens), never a raw hex applied inline. Providers hand us their own hex,
// but at alpha we assign a spread hue deterministically so accounts stay
// visually distinct and theme-safe; a user override wins.

import { LABEL_COLORS, type LabelColor, normalizeLabelColor } from "../../components/tag-colors";
import type { CalendarAccountModel, CalendarEventModel } from "./events";
import { parseGoogleExternalId } from "./google-account";
import { parseSyncDescriptor } from "./sync";

/** Human provider name for attribution ("Personal — Google"). */
export function providerLabel(provider: string): string {
  switch (provider) {
    case "google":
      return "Google";
    case "microsoft":
      return "Outlook";
    case "caldav":
      return "CalDAV";
    case "ics":
      return "ICS feed";
    case "moduo":
      return "Moduo";
    default:
      return provider ? provider[0].toUpperCase() + provider.slice(1) : "Calendar";
  }
}

/** "Personal — Google · synced 12 min ago" building block: the source line. */
export function accountSourceLabel(account: CalendarAccountModel): string {
  const label = account.displayLabel || providerLabel(account.provider);
  return `${label} — ${providerLabel(account.provider)}`;
}

/**
 * Resolve each account's hue: a user override wins, then a stored bounded name,
 * else a deterministic spread (least-used colored hue in account order) so
 * accounts stay distinct without needing a hex→hue conversion.
 */
export function resolveAccountHues(
  accounts: Pick<CalendarAccountModel, "id" | "color">[],
  overrides: Record<string, string> = {},
): Record<string, LabelColor> {
  const out: Record<string, LabelColor> = {};
  // Colored hues only (gray is the fallback), spread by usage.
  const colored = LABEL_COLORS.filter((c) => c !== "gray");
  const counts = new Map<LabelColor, number>(colored.map((c) => [c, 0]));
  const isName = (v: string | null | undefined): v is LabelColor =>
    !!v && (LABEL_COLORS as readonly string[]).includes(v);

  // First pass: honor explicit overrides / stored names and count them.
  for (const a of accounts) {
    const explicit = isName(overrides[a.id])
      ? (overrides[a.id] as LabelColor)
      : isName(a.color)
        ? (a.color as LabelColor)
        : null;
    if (explicit) {
      out[a.id] = explicit;
      counts.set(explicit, (counts.get(explicit) ?? 0) + 1);
    }
  }
  // Second pass: assign the rest the least-used colored hue (deterministic).
  for (const a of accounts) {
    if (out[a.id]) continue;
    let best: LabelColor = colored[0];
    let bestCount = Number.POSITIVE_INFINITY;
    for (const c of colored) {
      const n = counts.get(c) ?? 0;
      if (n < bestCount) {
        best = c;
        bestCount = n;
      }
    }
    out[a.id] = best;
    counts.set(best, (counts.get(best) ?? 0) + 1);
  }
  return out;
}

/** Coerce a stored/override color to a known hue (for a single account). */
export function accountHue(color: string | null | undefined): LabelColor {
  return normalizeLabelColor(color);
}

/** Drop mirrored events whose account is toggled off. Native events always show. */
export function visibleEvents(
  events: CalendarEventModel[],
  hiddenAccountIds: Iterable<string>,
): CalendarEventModel[] {
  const hidden = new Set(hiddenAccountIds);
  if (hidden.size === 0) return events;
  return events.filter((e) => e.sourceAccountId === null || !hidden.has(e.sourceAccountId));
}

// ── rail grouping (CAL-8) ─────────────────────────────────────────────────────
//
// The left rail (§3a) shows OAuth accounts as flat rows (Google/Outlook parity),
// but a CalDAV server holds several calendars — each its own row — grouped under
// a small account header; ICS feeds collapse under one "Feeds" header.

export type RailAccountRow = {
  account: CalendarAccountModel;
  /** The calendar's own name within its account (falls back to the label). */
  label: string;
  /**
   * A row inside a login is one calendar. Removing it does not disconnect
   * the mailbox. A flat row is the login itself.
   */
  scope: "calendar" | "account" | "feed";
};

export type RailGroup =
  | { kind: "flat"; row: RailAccountRow }
  | { kind: "group"; key: string; header: string; detail?: string; rows: RailAccountRow[] };

/** A CalDAV account's group key + header (its server + username), or null. */
function caldavGroupOf(
  account: CalendarAccountModel,
): { key: string; header: string; calendarName: string } | null {
  const desc = parseSyncDescriptor(account.syncToken);
  if (desc?.kind !== "caldav") return null;
  return {
    key: `caldav:${desc.serverUrl}|${desc.username}`,
    header: desc.username || desc.serverUrl,
    calendarName: desc.calendarName || account.displayLabel || providerLabel(account.provider),
  };
}

/** Google calendars that share a mailbox group under that login. */
function googleGroupOf(account: CalendarAccountModel): {
  key: string;
  header: string;
  detail: string;
  calendarName: string;
  scope: "calendar" | "account";
} | null {
  if (account.provider !== "google") return null;
  const parsed = parseGoogleExternalId(account.externalId);
  if (!parsed) return null;
  return {
    key: `google:${parsed.email}`,
    header: "Google",
    detail: parsed.email,
    calendarName: account.displayLabel || parsed.email,
    scope: parsed.calendarId ? "calendar" : "account",
  };
}

/**
 * Order external accounts into rail groups. Google calendars that share a
 * mailbox sit under that login (platform + address). CalDAV rows bucket under
 * their (server, username) header. ICS feeds collapse under "Feeds". A single
 * login with no inner calendars stays a flat row. Groups appear in the input
 * order of their first member, so the rail stays stable across reloads.
 */
export function groupRailAccounts(accounts: CalendarAccountModel[]): RailGroup[] {
  const out: RailGroup[] = [];
  const groupIndex = new Map<string, number>(); // key → index in `out`

  const ensureGroup = (
    key: string,
    header: string,
    detail?: string,
  ): RailGroup & { kind: "group" } => {
    const existing = groupIndex.get(key);
    if (existing !== undefined) return out[existing] as RailGroup & { kind: "group" };
    const group: RailGroup & { kind: "group" } = { kind: "group", key, header, detail, rows: [] };
    groupIndex.set(key, out.length);
    out.push(group);
    return group;
  };

  for (const account of accounts) {
    if (account.provider === "ics") {
      ensureGroup("ics:feeds", "Feeds").rows.push({
        account,
        label: account.displayLabel || providerLabel(account.provider),
        scope: "feed",
      });
      continue;
    }
    const google = googleGroupOf(account);
    if (google) {
      ensureGroup(google.key, google.header, google.detail).rows.push({
        account,
        label: google.calendarName,
        scope: google.scope,
      });
      continue;
    }
    const caldav = caldavGroupOf(account);
    if (caldav) {
      ensureGroup(caldav.key, caldav.header).rows.push({
        account,
        label: caldav.calendarName,
        scope: "calendar",
      });
      continue;
    }
    out.push({
      kind: "flat",
      row: {
        account,
        label: account.displayLabel || providerLabel(account.provider),
        scope: "account",
      },
    });
  }
  return out;
}

/** How many logins are connected. Several calendars in one mailbox count as one. */
export function connectedLoginCount(accounts: CalendarAccountModel[]): number {
  return groupRailAccounts(accounts).length;
}

/** The freshest sync across accounts as a quiet age label, or null if none. */
export function syncAgeLabel(
  accounts: Pick<CalendarAccountModel, "lastSyncAt">[],
  now: number = Date.now(),
): string | null {
  let freshest = -Infinity;
  for (const a of accounts) {
    if (!a.lastSyncAt) continue;
    const t = Date.parse(a.lastSyncAt);
    if (Number.isFinite(t) && t > freshest) freshest = t;
  }
  if (freshest === -Infinity) return null;
  const secs = Math.max(0, Math.round((now - freshest) / 1000));
  if (secs < 60) return "synced just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `synced ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `synced ${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `synced ${days}d ago`;
}
