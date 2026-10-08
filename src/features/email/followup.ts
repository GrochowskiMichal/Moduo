// Follow-up reply-clearing (EM-6, AC7). Pure rule: a follow-up on a sent thread
// clears silently when the COUNTERPART replies — a reply from one of your OWN
// addresses (any connected account) never counts (AC7 self-replies edge case).
// The hook runs this over each awaiting follow-up on every sync; no I/O here.

/** One thread message, reduced to what the rule needs. */
export type FollowUpMessage = {
  fromEmail: string;
  timestampMs: number;
};

/**
 * True when a counterpart has replied since the follow-up was armed — i.e. there's
 * a message from an address that is NOT one of the user's own, timestamped after
 * `armedAtMs` (or at all, when `armedAtMs` is null). A message from any of the
 * user's connected accounts is a self-reply and is ignored, so following up on a
 * thread and then replying to it yourself doesn't clear the reminder.
 */
export function followUpClearedByReply(args: {
  messages: FollowUpMessage[];
  /** The user's own addresses across all connected accounts, any case. */
  selfAddresses: string[];
  /** When the follow-up was set; a reply must be newer. Null = any reply clears. */
  armedAtMs: number | null;
}): boolean {
  const self = new Set(args.selfAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean));
  return args.messages.some((m) => {
    const from = m.fromEmail.trim().toLowerCase();
    if (!from || self.has(from)) return false; // self-reply never clears (AC7)
    return args.armedAtMs == null || m.timestampMs > args.armedAtMs;
  });
}
