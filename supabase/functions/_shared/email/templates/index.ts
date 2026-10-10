/**
 * Every built email template, keyed by its kind (`EMAIL_KINDS` in @contracts).
 * Each TX block adds its templates here — one line per kind — plus a fixture in
 * `fixtures.ts`, which feeds the tests and the Storybook gallery.
 *
 * The renderer flattens and caps every string, but a name written into a
 * sentence or paragraph only gets the paragraph cap. Templates pass every
 * user-typed name through `singleLine(name, TEXT_LIMITS.name)` before placing it.
 */

import type { EmailKind } from "../../contracts/vocabularies.ts";
import type { EmailDoc } from "../blocks.ts";
import { type RenderedEmail, type RenderOptions, renderEmail } from "../render.ts";
import { type AuthCodeData, authCodeEmail } from "./auth-code.ts";
import {
  type BookingEmailData,
  bookingGuestAddedEmail,
  bookingGuestCancelledEmail,
  bookingGuestConfirmedEmail,
  bookingHostGuestCancelledEmail,
  bookingHostNewEmail,
} from "./booking.ts";
import { type OpsAlertData, opsAlertEmail } from "./ops-alert.ts";
import { type WaitlistInviteData, waitlistInviteEmail } from "./waitlist-invite.ts";

export { AUTH_CODE_VALID_MINUTES } from "./auth-code.ts";
export { EMAIL_RUNBOOK_URL, OPS_ALERT_RECIPIENT, type OpsAlertData, parseOpsAlertPayload } from "./ops-alert.ts";
export { BOOKING_QUEUED, BOOKING_SETTINGS_URL, type BookingEmailData, parseBookingPayload } from "./booking.ts";
export {
  MAC_DOWNLOAD_URL,
  parseWaitlistInvitePayload,
  type WaitlistInviteData,
} from "./waitlist-invite.ts";
export {
  type AuthConfirmCodeData,
  type AuthInviteData,
  authConfirmCodeEmail,
  authInviteEmail,
} from "./auth-variants.ts";

export interface EmailTemplateData {
  auth_code: AuthCodeData;
  waitlist_invite: WaitlistInviteData;
  ops_alert: OpsAlertData;
  booking_guest_confirmed: BookingEmailData;
  booking_guest_added: BookingEmailData;
  booking_host_new: BookingEmailData;
  booking_host_guest_cancelled: BookingEmailData;
  booking_guest_cancelled: BookingEmailData;
}

export type BuiltEmailKind = keyof EmailTemplateData & EmailKind;

export const EMAIL_TEMPLATES: { [K in BuiltEmailKind]: (data: EmailTemplateData[K]) => EmailDoc } = {
  auth_code: authCodeEmail,
  waitlist_invite: waitlistInviteEmail,
  ops_alert: opsAlertEmail,
  booking_guest_confirmed: bookingGuestConfirmedEmail,
  booking_guest_added: bookingGuestAddedEmail,
  booking_host_new: bookingHostNewEmail,
  booking_host_guest_cancelled: bookingHostGuestCancelledEmail,
  booking_guest_cancelled: bookingGuestCancelledEmail,
};

export const BUILT_EMAIL_KINDS = Object.keys(EMAIL_TEMPLATES) as BuiltEmailKind[];

/** The doc one template builds. Generic, so a loop over every kind type-checks. */
export function templateDoc<K extends BuiltEmailKind>(kind: K, data: EmailTemplateData[K]): EmailDoc {
  return EMAIL_TEMPLATES[kind](data);
}

export function renderTemplate<K extends BuiltEmailKind>(
  kind: K,
  data: EmailTemplateData[K],
  options?: RenderOptions,
): RenderedEmail {
  return renderEmail(EMAIL_TEMPLATES[kind](data), options);
}
