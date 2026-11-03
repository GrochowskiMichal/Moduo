// The provider size limit, enforced before Send (E45, AC23). MIME base64 grows
// attachments by 4/3, so the check is on the encoded size, as the server sees it.

export type SizeCheck =
  { ok: true; bytes: number } | { ok: false; bytes: number; limit: number; message: string };

export function encodedSize(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

function mb(n: number): string {
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
}

export function checkSendSize(
  attachments: { size?: number }[],
  bodyBytes: number,
  limit: number,
): SizeCheck {
  const bytes = bodyBytes + attachments.reduce((sum, a) => sum + encodedSize(a.size ?? 0), 0);
  if (bytes <= limit) return { ok: true, bytes };
  return {
    ok: false,
    bytes,
    limit,
    message: `This message is ${mb(bytes)}; your provider accepts up to ${mb(limit)}. Remove an attachment to send.`,
  };
}
