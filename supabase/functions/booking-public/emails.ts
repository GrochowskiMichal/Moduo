/**
 * Which booking emails `booking-public` queues, and with what (specs/
 * transactional-email.md TX-5, T15). Pure: no Deno, no database, so Rstest
 * covers it; `index.ts` passes each request to `email_enqueue` /
 * `email_cancel`, and the `email-worker` renders and sends them.
 *
 * Book:   C1 → the booker · C2 → each extra guest, only when Google isn't
 *         inviting them · C3 → the host.
 * Cancel: C4 → the host · C5 → the booker · cancels any queued reminder
 *         (`C7:<booking>`, TX-6). A cancel after the meeting started sends nothing.
 */

import type { BookingEmailData } from "../_shared/email/templates/booking.ts";
import { usableTimeZone } from "../_shared/email/format.ts";

export type BookingEmailKind =
  | "booking_guest_confirmed"
  | "booking_guest_added"
  | "booking_host_new"
  | "booking_host_guest_cancelled"
  | "booking_guest_cancelled";

export type EnqueueRequest = {
  kind: BookingEmailKind;
  to: string;
  toUserId: string | null;
  payload: BookingEmailData;
  dedupeKey: string;
};

/**
 * The zone the guest's emails are written in: the one their booking page sent
 * when it is a real zone, else the host's (AC30: an unusable zone never fails
 * a booking that's already confirmed, and the email names the zone it used).
 */
export function guestTimeZone(requested: unknown, hostZone: string | null | undefined): string {
  return usableTimeZone(requested, usableTimeZone(hostZone));
}

/** What both moments know about the booking. */
export type BookingFacts = {
  bookingId: string;
  link: { name: string; durationMinutes: number; hostZone: string };
  start: string;
  end: string;
  /** The zone the guest picked on the booking page, as sent or stored; checked here with guestTimeZone. */
  guestZone: string;
  /** "Google Meet" / "Zoom". */
  video: string;
  joinUrl: string;
  /** The host as guests see them; `email` is the organizer and the guests' reply-to. */
  host: { name: string; avatarUrl: string | null; email: string };
  /** Where the host's own emails go: their Moduo account. */
  hostInbox: { email: string; userId: string | null };
  guest: { name: string; email: string };
  guests: string[];
  /** Google created the event, so it invites (and later uninvites) the guests itself. */
  googleInvites: boolean;
  /** ISO time of this book or cancel. */
  at: string;
};

function base(facts: BookingFacts, zone: string): BookingEmailData {
  return {
    bookingId: facts.bookingId,
    linkName: facts.link.name,
    start: facts.start,
    end: facts.end,
    durationMinutes: facts.link.durationMinutes,
    zone,
    video: facts.video,
    joinUrl: facts.joinUrl,
    hostName: facts.host.name,
    hostAvatarUrl: facts.host.avatarUrl,
    hostEmail: facts.host.email,
    guestName: facts.guest.name,
    guestEmail: facts.guest.email,
    guests: facts.guests,
    googleInvites: facts.googleInvites,
    at: facts.at,
  };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function bookEmails(
  facts: BookingFacts,
  extra: {
    cancelUrl: string;
    openUrl: string | null;
    note: string | null;
    answers: { label: string; value: string }[];
  },
): EnqueueRequest[] {
  const guestZone = guestTimeZone(facts.guestZone, facts.link.hostZone);
  const hostZone = usableTimeZone(facts.link.hostZone);
  const out: EnqueueRequest[] = [
    {
      kind: "booking_guest_confirmed",
      to: facts.guest.email,
      toUserId: null,
      payload: { ...base(facts, guestZone), cancelUrl: extra.cancelUrl },
      dedupeKey: `C1:${facts.bookingId}`,
    },
  ];
  if (!facts.googleInvites) {
    const seen = new Set<string>();
    for (const address of facts.guests) {
      const key = address.trim().toLowerCase();
      if (!key || seen.has(key) || same(key, facts.guest.email)) continue;
      seen.add(key);
      out.push({
        kind: "booking_guest_added",
        to: address,
        toUserId: null,
        payload: base(facts, guestZone),
        dedupeKey: `C2:${facts.bookingId}:${key}`,
      });
    }
  }
  if (facts.hostInbox.email) {
    out.push({
      kind: "booking_host_new",
      to: facts.hostInbox.email,
      toUserId: facts.hostInbox.userId,
      payload: {
        ...base(facts, hostZone),
        ...(extra.openUrl ? { openUrl: extra.openUrl } : {}),
        note: extra.note || null,
        answers: extra.answers,
      },
      dedupeKey: `C3:${facts.bookingId}`,
    });
  }
  return out;
}

export function cancelEmails(
  facts: BookingFacts,
  extra: { rebookUrl: string; nowMs: number },
): { enqueue: EnqueueRequest[]; cancelPrefixes: string[] } {
  const cancelPrefixes = [`C7:${facts.bookingId}`];
  // The meeting already started: the booking is released, but nobody is emailed.
  if (Date.parse(facts.start) <= extra.nowMs) return { enqueue: [], cancelPrefixes };
  const guestZone = guestTimeZone(facts.guestZone, facts.link.hostZone);
  const hostZone = usableTimeZone(facts.link.hostZone);
  const enqueue: EnqueueRequest[] = [];
  if (facts.hostInbox.email) {
    enqueue.push({
      kind: "booking_host_guest_cancelled",
      to: facts.hostInbox.email,
      toUserId: facts.hostInbox.userId,
      payload: base(facts, hostZone),
      dedupeKey: `C4:${facts.bookingId}`,
    });
  }
  enqueue.push({
    kind: "booking_guest_cancelled",
    to: facts.guest.email,
    toUserId: null,
    payload: { ...base(facts, guestZone), rebookUrl: extra.rebookUrl },
    dedupeKey: `C5:${facts.bookingId}`,
  });
  return { enqueue, cancelPrefixes };
}
