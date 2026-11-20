---
paths: ["supabase/migrations/*chat*.sql", "supabase/tests/chat_*.test.sql"]
incident: "Chat v2's SQL cost hours on per-message access checks, tsquery regexes and manager checks done the short way (CV-1…CV-22; HV-14a compiled these gotchas)"
expires: 2027-01-31
---

# Chat SQL

- Never call `chat_can_read_channel` per message (~83 µs a call): compute the readable set once with `chat__readable_channel_ids(workspace, person)`.
- A regex that adds `:*` to tsquery text (`chat__search_query`) anchors on the lexeme's opening quote (`(^|[ (])'…'`), or it matches the gap between two lexemes.
- Manage checks go through `chat__can_manage` / `chat__is_manager`, never `EXISTS (… chat_channel_managers …)`.
- Check a membership rule in the op before any membership upsert it makes; the row trigger is only the backstop.
- A removal is `removed_at`, never `removed_by` (it goes null with the remover's account); CHECK `chat_members_removal_check` ties the two, so a test writing a removal sets both.
- Reopening a Catch up item goes through `chat__reopen` (one open item per chain or line).
- A chain op locks the root first, then the reply, as `chat_op_wrap_up` does.
- A chat op that tombstones or restores an `entities` row updates `entities` directly: `entities_op_tombstone` checks links edit access a chat manager may lack.
- `share_chat_message_guard` checks the announcement-channel rule on event lines too, and `perm_enforce_write` refuses a viewer before it: an op writing in someone's name checks "post" and that rule itself first, for the right message.
- `chat_op_send`'s sending limit counts every recent row by the author, directly inserted ones too: seed messages with an older `created_at` (as `chat_notices.test.sql`'s `test.send` does), or a later send gets `PT429`.
