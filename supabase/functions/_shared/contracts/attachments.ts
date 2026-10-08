/**
 * Attachment storage constants shared by the app, the Edge Functions and the
 * SQL (AT-1, specs/attachments.md). Plain constants, no Zod, so functions that
 * only need these (delete-account, purge-deleted) stay dependency-free. The
 * closed vocabularies (statuses, deleted reasons, preview formats) live in
 * vocabularies.ts.
 */

/** The private Storage bucket that holds attachment bytes, at
 *  {workspace id}/{attachment id}/original.{ext} and …/preview.{ext}. */
export const ATTACHMENTS_BUCKET = "attachments";

/** How long a signed link to an attachment lives, in seconds (spec decision 11). */
export const ATTACHMENT_LINK_TTL_SECONDS = {
  /** Thumbnails in the panel and on tiles. */
  preview: 3600,
  /** The original, opened in the viewer or downloaded. */
  original: 600,
  /** Links handed to an agent over MCP. */
  mcp: 300,
} as const;
