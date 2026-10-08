/**
 * Calendar files (RFC 5545) for booking emails that Google isn't already
 * covering with its own invite (specs/transactional-email.md T15): a REQUEST
 * when a meeting is booked, a CANCEL with the same UID when it is cancelled,
 * so the event lands in — and later leaves — the guest's calendar.
 */

import { base64Utf8, type EmailAttachment } from "./send.ts";

export type IcsPerson = { name?: string | null; email: string };

export type IcsEvent = {
  method: "REQUEST" | "CANCEL";
  /** Stable per booking, e.g. `booking-<id>@moduo.app`. */
  uid: string;
  /** Bump on every change to the same event; a CANCEL should be higher than the REQUEST it cancels. */
  sequence?: number;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  /** The join link, also used as the location. */
  url?: string;
  organizer: IcsPerson;
  attendees: IcsPerson[];
  /** When the file was made. Defaults to now. */
  stamp?: Date;
};

const CRLF = "\r\n";

/** UTC basic format: 20261016T120000Z */
export function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** TEXT value escaping (RFC 5545 §3.3.11). */
export function icsText(value: string): string {
  return value
    .replace(/\r\n|\r/g, "\n")
    // RFC 5545 TEXT allows tab and the escaped newline, no other control character.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** A quoted parameter value (CN): no quotes, no control characters. */
function icsParam(value: string): string {
  return `"${value.replace(/["\u0000-\u001f\u007f]/g, "").trim()}"`;
}

function person(prop: "ORGANIZER" | "ATTENDEE", who: IcsPerson, extra = ""): string {
  const email = who.email.replace(/[\s<>"]/g, "");
  const cn = who.name ? `;CN=${icsParam(who.name)}` : "";
  return `${prop}${cn}${extra}:mailto:${email}`;
}

/** Folds a content line at 75 octets (RFC 5545 §3.1), never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (currentBytes + size > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

/** Field caps, so user-typed booking text can't grow the attachment without bound. */
const ICS_LIMITS = { summary: 200, description: 2000, name: 80, url: 2048, uid: 200, attendees: 20 } as const;

function cap(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join("")}…`;
}

export function buildIcs(input: IcsEvent): string {
  const event: IcsEvent = {
    ...input,
    uid: cap(input.uid, ICS_LIMITS.uid),
    summary: cap(input.summary, ICS_LIMITS.summary),
    description: input.description === undefined ? undefined : cap(input.description, ICS_LIMITS.description),
    url: input.url && input.url.length <= ICS_LIMITS.url ? input.url : undefined,
    organizer: { ...input.organizer, name: input.organizer.name ? cap(input.organizer.name, ICS_LIMITS.name) : input.organizer.name },
    attendees: input.attendees
      .slice(0, ICS_LIMITS.attendees)
      .map((who) => ({ ...who, name: who.name ? cap(who.name, ICS_LIMITS.name) : who.name })),
  };
  const cancelled = event.method === "CANCEL";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Moduo//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${event.method}`,
    "BEGIN:VEVENT",
    `UID:${event.uid.replace(/[\r\n]/g, "")}`,
    `SEQUENCE:${Math.max(0, Math.trunc(event.sequence ?? (cancelled ? 1 : 0)))}`,
    `DTSTAMP:${icsDate(event.stamp ?? new Date())}`,
    `DTSTART:${icsDate(event.start)}`,
    `DTEND:${icsDate(event.end)}`,
    `SUMMARY:${icsText(event.summary)}`,
    ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
    ...(event.url ? [`LOCATION:${icsText(event.url)}`, `URL:${event.url.replace(/[\r\n]/g, "")}`] : []),
    person("ORGANIZER", event.organizer),
    ...event.attendees.map((who) =>
      person("ATTENDEE", who, ";CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE"),
    ),
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}

/** The .ics as a Resend attachment. */
export function icsAttachment(event: IcsEvent, filename = "invite.ics"): EmailAttachment {
  return {
    filename,
    content: base64Utf8(buildIcs(event)),
    contentType: `text/calendar; charset=utf-8; method=${event.method}`,
  };
}
