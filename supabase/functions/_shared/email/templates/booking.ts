/**
 * C1–C5 · Booking emails (specs/transactional-email.md TX-5, T15). Copy:
 * `.design/transactional-email/email-set.html` (C1–C5).
 *
 * - C1 `booking_guest_confirmed` → the booker. From "<Host> via Moduo", replies
 *   go to the host. Never carries the guest's own note (so the booking form
 *   can't be used to mail someone spam).
 * - C2 `booking_guest_added` → each extra guest, only when Google isn't
 *   inviting them (Zoom-only links, or Google failed).
 * - C3 `booking_host_new` → the host, in the host's zone, replies go to the guest.
 * - C4 `booking_host_guest_cancelled` → the host, replies go to the guest.
 * - C5 `booking_guest_cancelled` → the booker.
 *
 * A calendar file goes with C1/C2 (REQUEST) and C5 (CANCEL, same UID) only when
 * Google isn't sending its own invite (`googleInvites === false`).
 *
 * Everything a template prints, the calendar file's DTSTAMP included, comes
 * from the payload (`booking-public/emails.ts` writes it): a retry must render
 * the same body, or Resend refuses the idempotency key (docs/gotchas/email.md).
 */

import { CANONICAL_APP_ORIGIN } from "../../app-origin.ts";
import { singleLine } from "../../escape.ts";
import {
  type Block,
  button,
  type EmailDoc,
  fixed,
  link,
  lockup,
  muted,
  paragraph,
  sentence,
} from "../blocks.ts";
import { dayLong, dayShort, time24, usableTimeZone, zoneLabel } from "../format.ts";
import { icsAttachment, type IcsEvent } from "../ics.ts";
import type { QueuedEmail } from "../outbox.ts";
import { TEXT_LIMITS } from "../render.ts";
import { viaModuo } from "../send.ts";

/** What every booking email is built from. Written by booking-public, stored as the outbox payload. */
export type BookingEmailData = {
  bookingId: string;
  /** The booking link's name ("Intro call"). */
  linkName: string;
  /** ISO instants. */
  start: string;
  end: string;
  durationMinutes: number;
  /** The zone the email writes times in: the guest's on C1/C2/C5, the host's on C3/C4. */
  zone: string;
  /** "Google Meet" / "Zoom". */
  video: string;
  joinUrl: string;
  hostName: string;
  hostAvatarUrl?: string | null;
  hostEmail: string;
  guestName: string;
  guestEmail: string;
  /** The extra guests the booker added. */
  guests: string[];
  /** Google is sending its own invite (and cancellation) to the guests. */
  googleInvites: boolean;
  /** When the booking (or the cancel) happened, ISO. The calendar file's DTSTAMP. */
  at: string;
  /** C1: the guest's cancel link. */
  cancelUrl?: string;
  /** C5: the host's booking page, to pick another time. */
  rebookUrl?: string;
  /** C3: the event in Moduo. */
  openUrl?: string;
  /** C3: what the guest wrote (host emails only). */
  note?: string | null;
  /** C3: the answers to the link's questions. */
  answers?: { label: string; value: string }[];
};

export const BOOKING_SETTINGS_URL = `${CANONICAL_APP_ORIGIN}/settings?section=preferences`;
const CALENDAR_FILE = "invite.ics";

const name = (value: string) => singleLine(value, TEXT_LIMITS.name);

function firstName(value: string): string {
  const full = name(value);
  return full.split(/\s+/)[0] || full;
}

function minutesPhrase(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return `${minutes} minutes`;
}

type When = { day: string; short: string; time: string; zone: string };

function when(data: BookingEmailData): When {
  const zone = usableTimeZone(data.zone);
  const start = new Date(data.start);
  return { day: dayLong(start, zone), short: dayShort(start, zone), time: time24(start, zone), zone };
}

/** "30 minutes on Google Meet, Warsaw time." */
function detailsLine(data: BookingEmailData, w: When): string {
  return `${minutesPhrase(data.durationMinutes)} on ${name(data.video)}, ${zoneLabel(w.zone)}.`;
}

function guestList(data: BookingEmailData): string {
  return data.guests.map((address) => singleLine(address, 254)).join(", ");
}

function calendarEvent(data: BookingEmailData, method: IcsEvent["method"]): IcsEvent {
  return {
    method,
    uid: `booking-${data.bookingId}@moduo.app`,
    sequence: method === "CANCEL" ? 1 : 0,
    start: new Date(data.start),
    end: new Date(data.end),
    summary: `${singleLine(data.linkName, TEXT_LIMITS.short) || "Meeting"} with ${name(data.hostName)}`,
    description: data.joinUrl ? `${name(data.video)}: ${data.joinUrl}` : undefined,
    url: data.joinUrl || undefined,
    organizer: { name: name(data.hostName), email: data.hostEmail },
    attendees: [{ name: name(data.guestName), email: data.guestEmail }, ...data.guests.map((email) => ({ email }))],
    stamp: new Date(data.at),
  };
}

function calendarFile(data: BookingEmailData, method: IcsEvent["method"]) {
  return data.googleInvites ? undefined : [icsAttachment(calendarEvent(data, method), CALENDAR_FILE)];
}

const attachmentNote = (): Block => ({ type: "attachment", filename: CALENDAR_FILE, label: "Calendar file" });

/** C1 · Booking confirmed (guest). */
export function bookingGuestConfirmedEmail(data: BookingEmailData): EmailDoc {
  const w = when(data);
  const host = name(data.hostName);
  const details = detailsLine(data, w);
  const blocks: Block[] = [
    { type: "host", name: host, avatarUrl: data.hostAvatarUrl ?? null },
    sentence(`You're meeting ${firstName(data.hostName)} on `, fixed(w.day), " at ", fixed(w.time), "."),
    paragraph(data.googleInvites ? `${details} Google is sending the calendar invite separately.` : details),
  ];
  if (data.guests.length > 0) blocks.push({ type: "rows", rows: [{ label: "Also invited", value: guestList(data) }] });
  if (!data.googleInvites) blocks.push(attachmentNote());
  if (data.joinUrl) blocks.push(button(`Join ${name(data.video)}`, data.joinUrl));
  if (data.cancelUrl) blocks.push(link("Can't make it? Cancel the meeting", data.cancelUrl));
  blocks.push(muted(`Questions for ${firstName(data.hostName)}? Reply to this email.`));
  return {
    subject: `Booked: ${host}, ${w.short} at ${w.time}`,
    preheader: details,
    blocks,
    footer: {
      reason: `You got this email because you booked time with ${host} through Moduo.`,
      scheduledWith: true,
    },
  };
}

/** C2 · Added to a booking (extra guest). */
export function bookingGuestAddedEmail(data: BookingEmailData): EmailDoc {
  const w = when(data);
  const host = name(data.hostName);
  const booker = name(data.guestName);
  const details = detailsLine(data, w);
  const blocks: Block[] = [
    { type: "host", name: host, avatarUrl: data.hostAvatarUrl ?? null },
    sentence(`${booker} added you to a meeting with ${firstName(data.hostName)} on `, fixed(w.day), " at ", fixed(w.time), "."),
    paragraph(details),
  ];
  if (!data.googleInvites) blocks.push(attachmentNote());
  if (data.joinUrl) blocks.push(button(`Join ${name(data.video)}`, data.joinUrl));
  blocks.push(muted(`Can't make it? Let ${firstName(data.guestName)} know.`));
  return {
    subject: `${booker} added you: ${host}, ${w.short} at ${w.time}`,
    preheader: details,
    blocks,
    footer: {
      reason: `You got this email because ${booker} added this address when booking time with ${host}.`,
      scheduledWith: true,
    },
  };
}

/** C3 · New booking (host). */
export function bookingHostNewEmail(data: BookingEmailData): EmailDoc {
  const w = when(data);
  const guest = name(data.guestName);
  const linkName = singleLine(data.linkName, TEXT_LIMITS.name) || "booking";
  const rows = [
    { label: "Email", value: singleLine(data.guestEmail, 254) },
    { label: "From your link", value: linkName },
    { label: "Video", value: name(data.video) },
  ];
  if (data.guests.length > 0) rows.push({ label: "Also invited", value: guestList(data) });
  const note = data.note ? data.note.trim() : "";
  if (note) rows.push({ label: "Their note", value: note });
  for (const answer of data.answers ?? []) {
    const label = singleLine(answer.label, TEXT_LIMITS.name);
    if (label && answer.value.trim()) rows.push({ label, value: answer.value.trim() });
  }
  const blocks: Block[] = [
    lockup(),
    sentence(`${guest} booked `, fixed(minutesPhrase(data.durationMinutes)), " with you on ", fixed(w.day), " at ", fixed(w.time), "."),
    { type: "rows", rows },
  ];
  if (data.openUrl) blocks.push(button("Open in Moduo", data.openUrl));
  blocks.push(
    muted(
      `${data.googleInvites ? "It's on your Moduo calendar and your Google Calendar." : "It's on your Moduo calendar."} Reply to this email to reach ${firstName(data.guestName)}.`,
    ),
  );
  return {
    subject: `New booking: ${guest}, ${w.short} at ${w.time}`,
    preheader: `${minutesPhrase(data.durationMinutes)} on ${name(data.video)}, from your ${linkName} link.`,
    blocks,
    footer: {
      reason: "You got this email because someone booked time through your Moduo booking link.",
      links: [{ label: "Notification settings", href: BOOKING_SETTINGS_URL }],
    },
  };
}

/** C4 · Guest canceled (host). */
export function bookingHostGuestCancelledEmail(data: BookingEmailData): EmailDoc {
  const w = when(data);
  const guest = name(data.guestName);
  const linkName = singleLine(data.linkName, TEXT_LIMITS.name) || "booking";
  return {
    subject: `Canceled: ${guest}, ${w.short} at ${w.time}`,
    preheader: `The time is open on your ${linkName} link again.`,
    blocks: [
      lockup(),
      sentence(`${guest} canceled your meeting on `, fixed(w.day), " at ", fixed(w.time), "."),
      paragraph(
        `We took it off your ${data.googleInvites ? "calendars" : "calendar"}, and the time is open on your ${linkName} link again.`,
      ),
    ],
    footer: {
      reason: "You got this email because a booking on your Moduo booking link was canceled.",
      links: [{ label: "Notification settings", href: BOOKING_SETTINGS_URL }],
    },
  };
}

/** C5 · You canceled (guest). */
export function bookingGuestCancelledEmail(data: BookingEmailData): EmailDoc {
  const w = when(data);
  const host = name(data.hostName);
  const first = firstName(data.hostName);
  const blocks: Block[] = [
    { type: "host", name: host, avatarUrl: data.hostAvatarUrl ?? null },
    sentence(`You canceled your meeting with ${first} on `, fixed(w.day), " at ", fixed(w.time), "."),
    paragraph(`${first} knows.`),
  ];
  if (!data.googleInvites) blocks.push(attachmentNote());
  if (data.rebookUrl) blocks.push(button("Pick another time", data.rebookUrl));
  return {
    subject: `You canceled your meeting with ${host}`,
    preheader: `${first} knows. Pick another time whenever suits.`,
    blocks,
    footer: { reason: "You got this email because you canceled a meeting booked through Moduo." },
  };
}

// ---- the payload, checked ----

function text(payload: Record<string, unknown>, key: string, required = true): string {
  const value = payload[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (required) throw new Error(`booking: missing ${key}`);
  return "";
}

function iso(payload: Record<string, unknown>, key: string): string {
  const value = text(payload, key);
  if (Number.isNaN(Date.parse(value))) throw new Error(`booking: bad ${key}`);
  return value;
}

/** The payload an outbox row carries, checked. Throws on a shape the templates can't render. */
export function parseBookingPayload(payload: Record<string, unknown>): BookingEmailData {
  const duration = payload.durationMinutes;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("booking: bad durationMinutes");
  }
  if (typeof payload.googleInvites !== "boolean") throw new Error("booking: missing googleInvites");
  const guests = Array.isArray(payload.guests)
    ? payload.guests.filter((item): item is string => typeof item === "string" && item.includes("@"))
    : [];
  const answers = Array.isArray(payload.answers)
    ? payload.answers.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const { label, value } = item as { label?: unknown; value?: unknown };
        return typeof label === "string" && typeof value === "string" ? [{ label, value }] : [];
      })
    : [];
  const optional = (key: string) => text(payload, key, false) || undefined;
  return {
    bookingId: text(payload, "bookingId"),
    linkName: text(payload, "linkName", false),
    start: iso(payload, "start"),
    end: iso(payload, "end"),
    durationMinutes: duration,
    zone: text(payload, "zone"),
    video: text(payload, "video"),
    joinUrl: text(payload, "joinUrl", false),
    hostName: text(payload, "hostName", false) || "Moduo",
    hostAvatarUrl: optional("hostAvatarUrl") ?? null,
    hostEmail: text(payload, "hostEmail"),
    guestName: text(payload, "guestName"),
    guestEmail: text(payload, "guestEmail"),
    guests,
    googleInvites: payload.googleInvites,
    at: iso(payload, "at"),
    cancelUrl: optional("cancelUrl"),
    rebookUrl: optional("rebookUrl"),
    openUrl: optional("openUrl"),
    note: optional("note") ?? null,
    answers,
  };
}

/** The worker's view of each booking kind: the doc plus sender name, reply-to and calendar file. */
export const BOOKING_QUEUED: Record<
  | "booking_guest_confirmed"
  | "booking_guest_added"
  | "booking_host_new"
  | "booking_host_guest_cancelled"
  | "booking_guest_cancelled",
  (payload: Record<string, unknown>) => QueuedEmail
> = {
  booking_guest_confirmed: (payload) => {
    const data = parseBookingPayload(payload);
    return {
      doc: bookingGuestConfirmedEmail(data),
      fromName: viaModuo(data.hostName),
      replyTo: data.hostEmail,
      attachments: calendarFile(data, "REQUEST"),
    };
  },
  booking_guest_added: (payload) => {
    const data = parseBookingPayload(payload);
    return {
      doc: bookingGuestAddedEmail(data),
      fromName: viaModuo(data.hostName),
      attachments: calendarFile(data, "REQUEST"),
    };
  },
  booking_host_new: (payload) => {
    const data = parseBookingPayload(payload);
    return { doc: bookingHostNewEmail(data), replyTo: data.guestEmail };
  },
  booking_host_guest_cancelled: (payload) => {
    const data = parseBookingPayload(payload);
    return { doc: bookingHostGuestCancelledEmail(data), replyTo: data.guestEmail };
  },
  booking_guest_cancelled: (payload) => {
    const data = parseBookingPayload(payload);
    return {
      doc: bookingGuestCancelledEmail(data),
      fromName: viaModuo(data.hostName),
      attachments: calendarFile(data, "CANCEL"),
    };
  },
};
