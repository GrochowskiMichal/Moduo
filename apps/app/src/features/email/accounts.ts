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

/**
 * Per-account sync health, partitioned (AC12).
 *
 * Sync is per-account all the way down: the Rust engine loops accounts and
 * catches per account, so one mailbox erroring never aborts the others' sync —
 * it only flips that account's own `status`/`lastError`. This mirrors that
 * contract on the read side so the UI reports the broken ones by name while the
 * healthy ones keep listing mail.
 */
export interface AccountSyncHealth {
  /** Accounts still syncing normally. */
  active: SavedAccount[];
  /** Accounts that have stopped syncing, for whatever reason. */
  broken: SavedAccount[];
  /** The subset of `broken` a reconnect can actually fix (expired auth). */
  reconnectable: SavedAccount[];
}

export function accountSyncHealth(accounts: SavedAccount[]): AccountSyncHealth {
  const active: SavedAccount[] = [];
  const broken: SavedAccount[] = [];
  const reconnectable: SavedAccount[] = [];
  for (const account of accounts) {
    if (account.status === "active") {
      active.push(account);
      continue;
    }
    broken.push(account);
    if (account.status === "reauth_required") reconnectable.push(account);
  }
  return { active, broken, reconnectable };
}
