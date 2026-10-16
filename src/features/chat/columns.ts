// The message columns a client ever reads (CV-1, CV-0 spike 3): every read and
// the Realtime binding's `select` name exactly these. `search_tsv` and
// `body_text` (search only) and `client_id` (v1's, equal to `id` until CV-23)
// stay off the wire; never `select *` on chat_messages.

export const CHAT_MESSAGE_COLUMN_LIST = [
  "id",
  "workspace_id",
  "channel_id",
  "parent_id",
  "reply_to_id",
  "kind",
  "event",
  "format_version",
  "author_id",
  "author_kind",
  "author_label",
  "body",
  "mentioned_user_ids",
  "mentioned_team_ids",
  "mentions_everyone",
  "reactions",
  "reply_count",
  "last_reply_at",
  "reply_user_ids",
  "wrapped_at",
  "wrapped_by",
  "settled_id",
  "reopened_at",
  "reopened_by",
  // CV-9: how many files it holds (0 when none; the stream reads them only then).
  "file_count",
  "pinned_at",
  "pinned_by",
  "edited_at",
  "deleted_at",
  "created_at",
  "updated_at",
] as const;

export const CHAT_MESSAGE_COLUMNS = CHAT_MESSAGE_COLUMN_LIST.join(", ");
