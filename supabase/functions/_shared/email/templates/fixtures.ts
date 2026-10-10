/**
 * Example data for every built template, using the brand's example cast
 * (brand brief §11: Tom Becker, Anna Carter, Northwind Studio). Feeds the unit
 * tests and the Storybook email gallery.
 */

import type { BookingEmailData } from "./booking.ts";
import type { BuiltEmailKind, EmailTemplateData } from "./index.ts";

/** Tom Becker books 30 minutes with Anna Carter (Google connected, so Google invites). */
export const BOOKING_FIXTURE: BookingEmailData = {
  bookingId: "8f0c2a4e-1b6d-4c3a-9e7f-2d5b8a1c6e90",
  linkName: "Intro call",
  start: "2026-10-16T12:00:00Z",
  end: "2026-10-16T12:30:00Z",
  durationMinutes: 30,
  zone: "Europe/Warsaw",
  video: "Google Meet",
  joinUrl: "https://meet.google.com/abc-defg-hij",
  hostName: "Anna Carter",
  hostAvatarUrl: null,
  hostEmail: "anna@northwind.studio",
  guestName: "Tom Becker",
  guestEmail: "tom@becker.studio",
  guests: ["sam@lee.design", "priya@nair.dev"],
  googleInvites: true,
  at: "2026-10-09T09:12:00Z",
  cancelUrl: "https://moduo.app/book/cancel?token=3c1e6f7a",
  rebookUrl: "https://moduo.app/book/anna",
  openUrl: "https://app.moduo.app/calendar?event=5e2b9c1d-7a4f-4e8b-b3c6-0d9f1a2e4b7c",
  note: "Keen to talk about the redesign.",
  answers: [],
};

/** The same booking on a Zoom-only link: no Google invite, so calendar files go out. */
export const BOOKING_ZOOM_FIXTURE: BookingEmailData = {
  ...BOOKING_FIXTURE,
  video: "Zoom",
  joinUrl: "https://us02web.zoom.us/j/81234567890",
  googleInvites: false,
};

export const EMAIL_FIXTURES: { [K in BuiltEmailKind]: EmailTemplateData[K] } = {
  auth_code: { code: "482913", email: "tom@becker.studio" },
  ops_alert: {
    reason: "failures",
    windowMinutes: 10,
    authCodeFailed: 1,
    otherFailed: 2,
    errors: [
      { error: "resend_http_500", count: 2 },
      { error: "timeout", count: 1 },
    ],
    detectedAt: "2026-10-16T12:05:00Z",
  },
  booking_guest_confirmed: BOOKING_FIXTURE,
  booking_guest_added: BOOKING_ZOOM_FIXTURE,
  booking_host_new: { ...BOOKING_FIXTURE, zone: "Europe/Warsaw" },
  booking_host_guest_cancelled: BOOKING_FIXTURE,
  booking_guest_cancelled: BOOKING_ZOOM_FIXTURE,
};

/** A label for each kind in the gallery, matching the IDs in the ratified email set. */
export const EMAIL_LABELS: Record<BuiltEmailKind, string> = {
  auth_code: "A1 · Sign-in code",
  ops_alert: "Ops alert (internal)",
  booking_guest_confirmed: "C1 · Booking confirmed (guest)",
  booking_guest_added: "C2 · Added to a booking (extra guest)",
  booking_host_new: "C3 · New booking (host)",
  booking_host_guest_cancelled: "C4 · Guest canceled (host)",
  booking_guest_cancelled: "C5 · You canceled (guest)",
};
