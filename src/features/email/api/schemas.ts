import { z } from "zod";

export const emailProviderSchema = z.enum(["gmail", "outlook", "apple", "custom"]);
export const emailAuthModeSchema = z.enum(["oauth", "app_password", "smtp_imap", "smtp_pop3"]);

export const emailAddressSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(200).optional().nullable(),
});

export const emailSendInputSchema = z.object({
  accountId: z.string().uuid(),
  to: z.array(emailAddressSchema).min(1).max(100),
  cc: z.array(emailAddressSchema).max(100).optional(),
  bcc: z.array(emailAddressSchema).max(100).optional(),
  subject: z.string().trim().max(998),
  bodyText: z.string().max(1_000_000).optional(),
  bodyHtml: z.string().max(2_000_000).optional(),
  replyThreadId: z.string().uuid().nullable().optional(),
});

export const emailConnectInitSchema = z.object({
  provider: emailProviderSchema,
  workspaceId: z.string().uuid(),
  authMode: emailAuthModeSchema.optional(),
});

export const emailConnectCallbackSchema = z.object({
  provider: emailProviderSchema,
  workspaceId: z.string().uuid(),
  emailAddress: z.string().email().optional(),
  displayName: z.string().max(200).optional().nullable(),
  authMode: emailAuthModeSchema.default("oauth"),
  accessToken: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
  authorizationCode: z.string().min(1).optional(),
  idToken: z.string().min(1).optional(),
  authToken: z.string().min(1).optional(),
});

export const emailListThreadsSchema = z.object({
  accountId: z.string().uuid(),
  folderId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
  search: z.string().max(300).optional(),
  unreadOnly: z.boolean().optional(),
});

export type EmailSendInputParsed = z.infer<typeof emailSendInputSchema>;
export type EmailConnectInitParsed = z.infer<typeof emailConnectInitSchema>;
export type EmailConnectCallbackParsed = z.infer<typeof emailConnectCallbackSchema>;
export type EmailListThreadsParsed = z.infer<typeof emailListThreadsSchema>;
