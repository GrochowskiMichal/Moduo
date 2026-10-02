/**
 * Request-body / query schemas for Edge Functions (zod-enum-foundation task 6).
 */

import { z } from "zod";

import { parseOrStructured } from "./errors.ts";
import { httpUrl, nonEmptyString, uuid } from "./primitives.ts";
import { waitlistSourceSchema } from "./vocabularies.ts";

export const emailBodySchema = z.object({
  email: z.email(),
});

export const issueFounderCouponBodySchema = z.object({
  email: z.email(),
  sendEmail: z.boolean().optional(),
});

export const foundersApplyBodySchema = z.object({
  email: z.email(),
  message: z.string().optional(),
  name: z.string().optional(),
});

/** `website` is a honeypot (must stay empty); `elapsedMs` = time on page before submit. */
export const waitlistJoinBodySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  source: waitlistSourceSchema,
  website: z.string().max(200).optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
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
  coupon: z.string().optional(),
  couponCode: z.string().optional(),
});

export const manageIntegrationBodySchema = z.object({
  user_id: uuid,
  provider: nonEmptyString,
  access_token_enc: nonEmptyString,
  refresh_token_enc: z.union([z.string(), z.null()]).optional(),
  token_expiry: z.union([z.string(), z.null()]).optional(),
  updated_at: z.string().optional(),
});

export const manageIntegrationQuerySchema = z.object({
  provider: nonEmptyString,
  user_id: uuid,
});

export const workspaceInviteWebhookBodySchema = z.object({
  record: z.object({ token: z.string().optional() }).optional(),
  token: z.string().optional(),
});

export const notesPublicTokenSchema = nonEmptyString;

export function parseJsonBody<T>(schema: z.ZodType<T>, input: unknown) {
  return parseOrStructured(schema, input);
}
