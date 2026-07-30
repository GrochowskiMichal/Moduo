/**
 * Email history depth (IM-2c) — the pure half. No React here.
 *
 * Depth is **per device**: the mail store is local, so two machines can hold
 * different depths and neither truncates the other. It is also a **floor** — a
 * promise about what *is* synced — never a ceiling that evicts, so lowering it
 * stops fetching and deletes nothing.
 *
 * The copy says "as you use Mail", not "in the background", on purpose: the walk
 * advances inside a sync round and there is no background driver yet (IM-2c-b).
 * Promising more than the engine does is worse than promising less.
 */

export const EMAIL_HISTORY_DEPTHS = [
  "threeMonths",
  "sixMonths",
  "twelveMonths",
  "everything",
] as const;

export type EmailHistoryDepth = (typeof EMAIL_HISTORY_DEPTHS)[number];

/** The connect-time default (AC6). */
export const DEFAULT_HISTORY_DEPTH: EmailHistoryDepth = "twelveMonths";

const LABELS: Record<EmailHistoryDepth, string> = {
  threeMonths: "3 months",
  sixMonths: "6 months",
  twelveMonths: "12 months",
  everything: "Everything",
};

export function historyDepthLabel(depth: EmailHistoryDepth): string {
  return LABELS[depth];
}

/**
 * Coerce whatever the store handed back into a depth this build understands.
 *
 * An account written by a *newer* build can carry a depth this one has never
 * heard of (the desktop binary is drop-in replaced, so rollbacks happen). Falling
 * back to the default keeps the account usable and the picker rendering; the
 * stored value is only overwritten if the user actually picks something.
 */
export function asHistoryDepth(raw: unknown): EmailHistoryDepth {
  return EMAIL_HISTORY_DEPTHS.includes(raw as EmailHistoryDepth)
    ? (raw as EmailHistoryDepth)
    : DEFAULT_HISTORY_DEPTH;
}

/**
 * What changing depth from `from` to `to` will actually do, in the user's terms.
 *
 * The asymmetry is the whole point and is not guessable from the control: going
 * deeper backfills in the background, going shallower is **not** destructive. A
 * picker that doesn't say so reads like it might delete mail.
 */
export function describeDepthChange(
  from: EmailHistoryDepth,
  to: EmailHistoryDepth,
): string | null {
  if (from === to) return null;
  const deeper = EMAIL_HISTORY_DEPTHS.indexOf(to) > EMAIL_HISTORY_DEPTHS.indexOf(from);
  return deeper
    ? `Moduo starts fetching older mail, back to ${historyDepthLabel(to).toLowerCase()}. It fills in as you use Mail.`
    : `Moduo stops fetching older mail. Nothing already synced is deleted.`;
}
