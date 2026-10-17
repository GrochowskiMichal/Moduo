// Extra people the booker invites. They are attendees on the Google event,
// so Google emails each of them the Meet calendar invite. Ten is Calendly's cap.

export const MAX_BOOKING_GUESTS = 10;

// No spaces, brackets, quotes or list separators: a booker's address goes
// straight into Resend's `to`, where "Name <a@b>" or "a@b, c@d" would be
// read as a display name or several recipients.
const EMAIL = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

export function isEmailAddress(value: string): boolean {
  return EMAIL.test(value);
}

export function parseGuestEmails(
  raw: unknown,
  bookerEmail: string,
): { ok: true; emails: string[] } | { ok: false } {
  if (raw == null) return { ok: true, emails: [] };
  if (!Array.isArray(raw)) return { ok: false };
  const booker = bookerEmail.trim().toLowerCase();
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return { ok: false };
    const email = item.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL.test(email) || email === booker || seen.has(email)) return { ok: false };
    seen.add(email);
    emails.push(email);
    if (emails.length > MAX_BOOKING_GUESTS) return { ok: false };
  }
  return { ok: true, emails };
}
