// Pure smart-inbox classifier (EM-10). Deterministic, explainable, no ML — over
// the header signals the Rust engine now fetches (List-Unsubscribe / Precedence /
// Auto-Submitted) plus the known-sender signal and per-sender overrides. Never
// blocks the list render (it's a synchronous grouping over already-shaped threads).

import type { EmailThread } from "./model/email-types";

export type EmailSection = "personal" | "notifications" | "newsletters";

/** Display order — Personal first (the work queue), bulk after. */
export const EMAIL_SECTIONS: EmailSection[] = ["personal", "notifications", "newsletters"];

export const SECTION_LABEL: Record<EmailSection, string> = {
  personal: "Personal",
  notifications: "Notifications",
  newsletters: "Newsletters",
};

/** The classification-relevant subset of a thread. */
export type ClassifySignals = {
  fromEmail: string;
  listUnsubscribe?: string | null;
  precedence?: string | null;
  autoSubmitted?: string | null;
};

// A no-reply / automated sender local-part or mailbox (bounded to token boundaries
// so a real "john.notify" address isn't over-matched mid-word).
const NO_REPLY_RE =
  /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|noreply|mailer-?daemon|postmaster|notifications?|alerts?|bounce[s]?)([._+-]|@)/i;

function isBulkPrecedence(precedence?: string | null): boolean {
  if (!precedence) return false;
  const value = precedence.trim().toLowerCase();
  return value === "bulk" || value === "list" || value === "auto" || value === "junk";
}

function isAutoSubmitted(autoSubmitted?: string | null): boolean {
  if (!autoSubmitted) return false;
  // RFC 3834: anything other than "no" is machine-generated.
  return autoSubmitted.trim().toLowerCase() !== "no";
}

/**
 * Deterministic section for one thread. Order (documented — a dogfood tuning pass
 * is sanctioned before any ML):
 * 1. explicit per-sender override wins (teaches the inbox);
 * 2. a known contact / prior correspondent pulls a human back to Personal;
 * 3. Auto-Submitted or a no-reply/automated sender → Notifications (machine mail);
 * 4. List-Unsubscribe present → Newsletters (opt-in bulk you can leave);
 * 5. bulk/list Precedence → Notifications (system bulk, no unsubscribe);
 * 6. default → Personal (the unmatched human).
 */
export function classifyThread(
  signals: ClassifySignals,
  opts: { override?: EmailSection; isKnownSender?: boolean } = {},
): EmailSection {
  if (opts.override) return opts.override;
  if (opts.isKnownSender) return "personal";
  if (isAutoSubmitted(signals.autoSubmitted) || NO_REPLY_RE.test(signals.fromEmail)) {
    return "notifications";
  }
  if (signals.listUnsubscribe && signals.listUnsubscribe.trim()) {
    return "newsletters";
  }
  if (isBulkPrecedence(signals.precedence)) {
    return "notifications";
  }
  return "personal";
}

export type EmailSectionGroup = {
  section: EmailSection;
  label: string;
  threads: EmailThread[];
};

/** Normalize a from-address to the override / known-sender lookup key. */
export function senderKey(fromEmail: string): string {
  return fromEmail.trim().toLowerCase();
}

/**
 * Group already-shaped threads into the smart-inbox sections, preserving the
 * incoming order within each bucket (so pinned-first / newest ordering carries
 * through). Empty sections are dropped. `overrides` is keyed by [`senderKey`].
 */
export function groupThreadsBySection(
  threads: EmailThread[],
  opts: {
    overrides?: Record<string, EmailSection>;
    isKnownSender?: (senderKey: string) => boolean;
  } = {},
): EmailSectionGroup[] {
  const buckets: Record<EmailSection, EmailThread[]> = {
    personal: [],
    notifications: [],
    newsletters: [],
  };
  for (const thread of threads) {
    const key = senderKey(thread.fromEmail);
    const section = classifyThread(thread, {
      override: opts.overrides?.[key],
      isKnownSender: opts.isKnownSender?.(key) ?? false,
    });
    buckets[section].push(thread);
  }
  return EMAIL_SECTIONS.map((section) => ({
    section,
    label: SECTION_LABEL[section],
    threads: buckets[section],
  })).filter((group) => group.threads.length > 0);
}

/** Flatten grouped sections back to a single ordered list (keyboard nav order). */
export function flattenSections(groups: EmailSectionGroup[]): EmailThread[] {
  return groups.flatMap((group) => group.threads);
}
