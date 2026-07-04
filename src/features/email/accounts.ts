// Account presentation helpers (EM-4): hue attribution + provider labels. Mirrors
// the CAL-6 pattern — a bounded, deterministic tag-color per account so the rail
// and rows share one hue dot. No raw hex — hues resolve to `data-label` tokens.

import { LABEL_COLORS, type LabelColor } from "../../components/tag-colors";
import type { MailboxProvider, SavedAccount } from "./model/email-types";

// Colored hues only (gray is the fallback, never assigned round-robin).
const COLORED: LabelColor[] = LABEL_COLORS.filter((c) => c !== "gray");

/**
 * Assign each account a stable colored hue. Honors a stored/override color when it
 * is a valid LabelColor; otherwise spreads the colored hues deterministically by
 * the account's sorted position so the same account keeps its hue across reloads.
 */
export function resolveAccountHues(
  accounts: Pick<SavedAccount, "id">[],
  overrides: Record<string, string> = {},
): Record<string, LabelColor> {
  const out: Record<string, LabelColor> = {};
  const ordered = [...accounts].sort((a, b) => a.id.localeCompare(b.id));
  let next = 0;
  for (const account of ordered) {
    const override = overrides[account.id];
    if (override && (COLORED as string[]).includes(override)) {
      out[account.id] = override as LabelColor;
      continue;
    }
    out[account.id] = COLORED[next % COLORED.length];
    next += 1;
  }
  return out;
}

export function providerLabel(provider: MailboxProvider | string): string {
  switch (provider) {
    case "gmail":
      return "Gmail";
    case "icloud":
      return "iCloud";
    case "outlook":
      return "Outlook";
    case "custom":
      return "IMAP";
    default:
      return provider;
  }
}
