// Why a send failed, read from the server's words (specs/mail-improve.md §5, AC19), so the
// draft row and the reader's banner lead with the cause and offer the action that fits.

/** A failed send, read from the server's words (specs/mail-improve.md §5, AC19): a size
 *  limit (the attachment behind it), a transient failure, or anything else. */
export type SendFailure = {
  kind: "size" | "transient" | "unknown";
  /** Leads the line, never clipped: "Server refused: attachment over 25 MB". */
  cause: string;
  /** The size limit's largest attachment, offered as "Remove {file} and send". */
  file: string | null;
};

const SIZE = /\b552\b|\bsize\b|too (large|big)|exceeds/i;
const TRANSIENT =
  /didn't answer|timed? ?out|timeout|connection|network|temporar|try again|unavailable|\b4\d\d\b/i;

export function sendFailure(
  lastError: string,
  attachments: readonly { filename?: string; size?: number }[],
): SendFailure {
  if (SIZE.test(lastError)) {
    const why = /\(([^)]+)\)/.exec(lastError)?.[1]?.trim() || "the message is too large";
    let largest: { filename?: string; size?: number } | null = null;
    for (const a of attachments) if (!largest || (a.size ?? 0) > (largest.size ?? 0)) largest = a;
    return { kind: "size", cause: `Server refused: ${why}`, file: largest?.filename || null };
  }
  return {
    kind: TRANSIENT.test(lastError) ? "transient" : "unknown",
    cause: lastError,
    file: null,
  };
}
