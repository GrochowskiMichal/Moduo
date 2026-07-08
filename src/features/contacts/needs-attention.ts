// "Needs attention" — the Contacts dashboard widget's selector (block CO-5,
// AC11). Quiet, never a red guilt wall: it surfaces contacts with (1) an overdue
// follow-up, (2) no touch in > 14 days (active contacts), or (3) a stale lead
// untouched > 30 days. Thresholds are constants (sensible defaults; later
// configurable). Pure + runtime-free so it unit-tests the boundaries; the live
// reads (contacts + the overdue-follow-up join) are the runtime's job.
//
// "Last touch" here is approximated by the contact's `updatedAt` (a cheap proxy —
// it bumps on status/name/import/merge but not on a link made from the other
// side; the precise cross-entity last-touch is the CO-2 deferral). The widget is
// a quiet heuristic, not an audit, so the proxy is acceptable.

import type { Contact } from "./model";

/** Default thresholds (decision 7). Encoded as constants so they're easy to tune. */
export const NEEDS_ATTENTION_THRESHOLDS = {
  /** Active contact untouched longer than this → "no touch". */
  noTouchDays: 14,
  /** Lead untouched longer than this → "stale lead". */
  staleLeadDays: 30,
} as const;

export type AttentionReason = "overdue-followup" | "no-touch" | "stale-lead";

export type NeedsAttentionItem = {
  contactId: string;
  name: string;
  status: string;
  reason: AttentionReason;
  /** Quiet detail, e.g. "Follow-up due 3 days ago" / "No touch in 18 days". */
  detail: string;
};

/** A contact with a follow-up task past its due date (from the runtime read). */
export type OverdueFollowup = {
  contactId: string;
  /** The task's due date (YYYY-MM-DD). */
  dueDate: string;
};

export type SelectNeedsAttentionInput = {
  contacts: Contact[];
  overdue: OverdueFollowup[];
  now: Date;
};

const DAY_MS = 86_400_000;

function daysSince(iso: string, now: Date): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.floor((now.getTime() - then) / DAY_MS);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Reason priority for ordering (most urgent first).
const REASON_RANK: Record<AttentionReason, number> = {
  "overdue-followup": 0,
  "no-touch": 1,
  "stale-lead": 2,
};

/**
 * Classify each contact into its single highest-priority attention reason (or
 * none). Overdue follow-up wins over no-touch wins over stale-lead. Returns the
 * flagged contacts, most-urgent first then by name.
 */
export function selectNeedsAttention({ contacts, overdue, now }: SelectNeedsAttentionInput): NeedsAttentionItem[] {
  const { noTouchDays, staleLeadDays } = NEEDS_ATTENTION_THRESHOLDS;

  // Earliest overdue due date per contact (so the detail shows the worst one).
  const overdueByContact = new Map<string, string>();
  for (const o of overdue) {
    const prev = overdueByContact.get(o.contactId);
    if (!prev || o.dueDate < prev) overdueByContact.set(o.contactId, o.dueDate);
  }

  const items: NeedsAttentionItem[] = [];
  for (const c of contacts) {
    const base = { contactId: c.id, name: c.name || "Unnamed", status: c.status };

    const due = overdueByContact.get(c.id);
    if (due) {
      const d = daysSince(due, now);
      items.push({ ...base, reason: "overdue-followup", detail: `Follow-up due ${plural(d, "day")} ago` });
      continue;
    }

    const idle = daysSince(c.updatedAt, now);
    if (c.status === "active" && idle > noTouchDays) {
      items.push({ ...base, reason: "no-touch", detail: `No touch in ${plural(idle, "day")}` });
      continue;
    }
    if (c.status === "lead" && idle > staleLeadDays) {
      items.push({ ...base, reason: "stale-lead", detail: `Lead untouched for ${plural(idle, "day")}` });
    }
  }

  return items.sort((a, b) =>
    REASON_RANK[a.reason] !== REASON_RANK[b.reason]
      ? REASON_RANK[a.reason] - REASON_RANK[b.reason]
      : a.name.localeCompare(b.name),
  );
}
