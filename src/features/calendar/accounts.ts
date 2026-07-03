// Account attribution helpers (CAL-6, AC12) — the left-rail account map + the
// external-chip color come from here. Colors stay token-routed: an account's
// hue is one of the bounded label names (tag-colors.ts → the [data-label]
// tokens), never a raw hex applied inline. Providers hand us their own hex,
// but at alpha we assign a spread hue deterministically so accounts stay
// visually distinct and theme-safe; a user override wins.

import {
  LABEL_COLORS,
  normalizeLabelColor,
  type LabelColor,
} from "../../components/tag-colors";
import type { CalendarAccountModel, CalendarEventModel } from "./events";

/** Human provider name for attribution ("Personal — Google"). */
export function providerLabel(provider: string): string {
  switch (provider) {
    case "google":
      return "Google";
    case "microsoft":
      return "Outlook";
    case "caldav":
      return "CalDAV";
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
  return events.filter(
    (e) => e.sourceAccountId === null || !hidden.has(e.sourceAccountId),
  );
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
