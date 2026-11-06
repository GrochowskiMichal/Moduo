// Settings → Mail model (MR-15, specs/mail-rebuild.md §Settings → Mail):
// the storage line, disk-cap choices and the list edits over mail settings
// items (rules, custom tabs, Priority people, blocked senders, snippets,
// aliases). Items sync per row through the MR-7 mirror; reordering rewrites
// only the rows whose position changed, so two devices editing different
// rows never lose each other's edits.

import type { EmailSettingsKind } from "@contracts/vocabularies";

import type { EmailSettingsItem } from "@/lib/runtime.types.email";
import type { MailStorageStats } from "@/lib/runtime.types.mail-settings";

const GB = 1024 ** 3;

/** The disk cap choices; 2 GB is the default (S7). */
export const DISK_CAP_CHOICES_GB = [1, 2, 5, 10, 20] as const;
export const DEFAULT_DISK_CAP_BYTES = 2 * GB;

export function formatGb(bytes: number): string {
  const gb = Math.max(bytes, 0) / GB;
  if (gb === 0) return "0 GB";
  if (gb < 0.1) return "< 0.1 GB";
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

/** "mail X GB · attachments Y GB" (S7 / I70): never one combined number. */
export function storageLine(
  stats: Pick<MailStorageStats, "mailBytes" | "attachmentBytes">,
): string {
  return `mail ${formatGb(stats.mailBytes)} · attachments ${formatGb(stats.attachmentBytes)}`;
}

/** The cap choice nearest the stored bytes (a cap set elsewhere still shows). */
export function capChoiceGb(bytes: number): number {
  const gb = bytes / GB;
  let best: number = DISK_CAP_CHOICES_GB[0];
  for (const c of DISK_CAP_CHOICES_GB) if (Math.abs(c - gb) < Math.abs(best - gb)) best = c;
  return best;
}

export function gbToBytes(gb: number): number {
  return Math.round(gb * GB);
}

/** Live items of one kind in list order. */
export function itemsOfKind(
  items: EmailSettingsItem[],
  kind: EmailSettingsKind,
): EmailSettingsItem[] {
  return items
    .filter((i) => i.kind === kind && i.deletedAt === null)
    .sort((a, b) => a.position - b.position || a.updatedAt.localeCompare(b.updatedAt));
}

/** The position a new item takes: after the last one. */
export function nextPosition(list: EmailSettingsItem[]): number {
  return list.reduce((max, i) => Math.max(max, i.position), -1) + 1;
}

/**
 * Move one item up or down; returns the rows to rewrite with their new
 * positions (dense 0…n-1), only those whose position actually changes.
 */
export function moveItem(
  list: EmailSettingsItem[],
  id: string,
  by: -1 | 1,
): { item: EmailSettingsItem; position: number }[] {
  const at = list.findIndex((i) => i.id === id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= list.length) return [];
  const next = [...list];
  [next[at], next[to]] = [next[to]!, next[at]!];
  return next.flatMap((item, position) => (item.position === position ? [] : [{ item, position }]));
}

export function newItemId(): string {
  return crypto.randomUUID();
}

/** A lowercased email address, or null when it isn't one. */
export function normalizeAddress(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

const CONDITION_LABEL: Record<string, string> = {
  from: "From",
  domain: "Domain",
  to: "To",
  subject_contains: "Subject contains",
  is_newsletter: "Is a newsletter",
};

const ACTION_LABEL: Record<string, string> = {
  move_to_folder: "move to",
  add_label: "label",
  put_in_tab: "put in tab",
  mark_read: "mark read",
  skip_inbox: "skip the inbox",
  mark_priority: "mark Priority",
  block: "block",
};

export const RULE_ACTIONS_WITH_ARG = new Set(["move_to_folder", "add_label", "put_in_tab"]);

/** "From anna@x.com → move to Receipts" for a rule row. */
export function describeRule(value: Record<string, unknown>): string {
  const conds = Array.isArray(value.conditions) ? value.conditions : [];
  const acts = Array.isArray(value.actions) ? value.actions : [];
  const when = conds
    .map((c: { field?: string; value?: string }) =>
      c.field === "is_newsletter"
        ? CONDITION_LABEL.is_newsletter
        : `${CONDITION_LABEL[c.field ?? ""] ?? c.field} ${c.value ?? ""}`.trim(),
    )
    .join(" and ");
  const then = acts
    .map((a: { action?: string; arg?: string }) =>
      `${ACTION_LABEL[a.action ?? ""] ?? a.action}${a.arg ? ` ${a.arg}` : ""}`.trim(),
    )
    .join(", ");
  return `${when || "Any mail"} → ${then || "nothing"}`;
}

export { ACTION_LABEL, CONDITION_LABEL };
