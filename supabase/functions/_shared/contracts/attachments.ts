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

const MiB = 1048576;

/** The hosted project's global upload cap, in bytes: every plan's per-file
 *  limit is held under it until the org moves to Supabase Pro (AT-1 decision).
 *  Mirrors `attachments__platform_file_cap()`; attachments.test.ts checks it. */
export const ATTACHMENT_PLATFORM_FILE_CAP_BYTES = 50 * MiB;

/** Per-file limit by the workspace owner's plan (keys = PLAN_TIERS), in bytes,
 *  before the platform cap. Mirrors `storage__limits_for_owner` (Free 20 MB ·
 *  Pro/Duo 200 MB · Team/Founder 500 MB); the server decides, the app only
 *  words its refusal. Plain object so this file stays import-free; the drift
 *  test checks the keys against PLAN_TIERS and the numbers against the SQL. */
export const ATTACHMENT_PER_FILE_BYTES = {
  free: 20 * MiB,
  pro: 200 * MiB,
  duo: 200 * MiB,
  team: 500 * MiB,
  founder: 500 * MiB,
} as const;

/** The most files one chat message holds (CV-9): the eleventh is refused
 *  before upload. Mirrors `attachments__chat_file_cap()`; attachments.test.ts
 *  checks it. */
export const CHAT_FILES_PER_MESSAGE = 10;

/** How long a signed link to a chat file lives, in seconds (CV-9): shorter
 *  than a task's, so someone who leaves a conversation keeps no working link
 *  for long. The stream re-signs a minute before expiry (signed-urls.ts). */
export const CHAT_FILE_LINK_TTL_SECONDS = {
  /** Inline previews in the stream and the Files view. */
  preview: 600,
  /** The original, opened or downloaded. */
  original: 180,
} as const;
