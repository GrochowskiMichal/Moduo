/**
 * Request-body / query schemas for Edge Functions (zod-enum-foundation task 6).
 */

import { z } from "zod";

import { parseOrStructured } from "./errors.ts";
import { httpUrl, nonEmptyString } from "./primitives.ts";
import { integrationProviderSchema, waitlistSourceSchema } from "./vocabularies.ts";

export const emailBodySchema = z.object({
  email: z.email(),
});

export const issueFounderCouponBodySchema = z.object({
  email: z.email(),
  sendEmail: z.boolean().optional(),
});

/**
 * `website` is a honeypot (must stay empty); `elapsedMs` = time on page before submit;
 * `updates` = the optional build-updates opt-in offered after someone joins (a request,
 * confirmed by email before anything is sent).
 */
export const waitlistJoinBodySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  source: waitlistSourceSchema,
  website: z.string().max(200).optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
  updates: z.boolean().optional(),
});

export const createPortalSessionBodySchema = z.object({
  returnUrl: httpUrl.optional(),
});

export const createCheckoutSessionBodySchema = z.object({
  plan: z.string().optional(),
  interval: z.string().optional(),
  billing_cycle: z.string().optional(),
  billing: z.string().optional(),
  priceId: z.string().optional(),
  price_id: z.string().optional(),
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
});

/**
 * manage-integration (MOD-554): the desktop app hands over a Google Calendar
 * login's OAuth tokens, in plaintext over TLS, authenticated by the person's
 * own session. The function encrypts them and takes the user from the verified
 * JWT, never from the request. Only Google Calendar: Zoom and Meet connect
 * through booking links on every platform (EB-1).
 */
export const manageIntegrationProviderSchema = integrationProviderSchema.extract(["google_calendar"]);

export const manageIntegrationBodySchema = z.strictObject({
  provider: manageIntegrationProviderSchema,
  access_token: nonEmptyString,
  refresh_token: z.union([nonEmptyString, z.null()]).optional(),
  /** Unix seconds at which the access token expires. */
  expires_at: z.union([z.number().int().positive(), z.null()]).optional(),
});

export const workspaceInviteWebhookBodySchema = z.object({
  record: z.object({ token: z.string().optional() }).optional(),
  token: z.string().optional(),
});

export const notesPublicTokenSchema = nonEmptyString;

export function parseJsonBody<T>(schema: z.ZodType<T>, input: unknown) {
  return parseOrStructured(schema, input);
}
