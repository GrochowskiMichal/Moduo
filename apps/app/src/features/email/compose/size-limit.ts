// The provider size limit, enforced before Send (E45, AC23, specs/mail-v3.md
// AC32). MIME base64 grows attachments by 4/3, so the check is on the encoded
// size, as the server sees it. Inline (pasted) images are attachments, so they
// count. The engine's limit already reflects the transport: Microsoft accounts
// that send through Graph get 3 MB, and the copy still names "Outlook".

import type { MailProvider } from "@contracts/mail";

/** The account's limit in bytes and its provider (for the copy). */
export type SendLimit = { bytes: number; provider: MailProvider | null };

export type SizeCheck =
  | { ok: true; bytes: number }
  | { ok: false; bytes: number; limit: number; largest: string | null; message: string };

export function encodedSize(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

function mb(n: number): string {
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
}

/** The provider as people call it; a plain IMAP server is "Your provider". */
export function sendProviderName(provider: MailProvider | null): string {
  switch (provider) {
    case "gmail":
    case "google_workspace":
      return "Gmail";
    case "icloud":
      return "iCloud";
    case "outlook":
      return "Outlook";
    default:
      return "Your provider";
  }
}

function largestFile(attachments: { size?: number; filename?: string }[]): string | null {
  let best: { size?: number; filename?: string } | null = null;
  for (const a of attachments) if (!best || (a.size ?? 0) > (best.size ?? 0)) best = a;
  return best?.filename || null;
}

/** "This message is 31.2 MB; Gmail accepts up to 25 MB. Remove deck.pdf or share it as a link." */
export function overLimitMessage(bytes: number, limit: SendLimit, largest: string | null): string {
  const head = `This message is ${mb(bytes)}; ${sendProviderName(limit.provider)} accepts up to ${mb(limit.bytes)}.`;
  return largest
    ? `${head} Remove ${largest} or share it as a link.`
    : `${head} Remove some images or text to send.`;
}

export function checkSendSize(
  attachments: { size?: number; filename?: string }[],
  bodyBytes: number,
  limit: number | SendLimit,
): SizeCheck {
  const lim = typeof limit === "number" ? { bytes: limit, provider: null } : limit;
  const bytes = bodyBytes + attachments.reduce((sum, a) => sum + encodedSize(a.size ?? 0), 0);
  if (bytes <= lim.bytes) return { ok: true, bytes };
  const largest = largestFile(attachments);
  return {
    ok: false,
    bytes,
    limit: lim.bytes,
    largest,
    message: overLimitMessage(bytes, lim, largest),
  };
}
