# CV-2a — Message ops v2 (server)

> Branch `t/maciej/cv-2a-message-ops` · head: the commit carrying this line · status: built, not landed
> Migration: `supabase/migrations/20261014150000_chat_v2_core_ops.sql` (released as `20261017103000`) · applied to the local stack: **yes** (as `supabase_admin`, `-1`, on its turn, after CV-1's two migrations and `20261014155205_chat_send_limits.sql`). Before that it was proven in rolled-back transactions (every `supabase/tests/` file as `BEGIN; \i <migration>; _setup; <test>; _finish`, 45 green). Stamp provisional: it must stay after `20261014155205`.

## Delivered against the row

- **New rows are v2:** `chat_messages.format_version` defaults to 2 (the conversion refuses from here on; `chat_convert.test.sql` puts v1's default back inside its own transaction for its fixture). New column `chat_messages.deleted_by` (who deleted it; FK to the person, `ON DELETE SET NULL`, partial index).
- **`chat_op_send(id, channel, body, reply_to_id)`**: the client-minted `id` is the idempotency key (a resent id returns the stored row to its author; two concurrent sends of one id return the winner); the v2 stored form, ≤ 8,000 stored characters refused with the count (`22023`, `DETAIL` `{"length","max"}`), nothing partial; people, teams and `@channel` read from the text on the server (`chat__mentions`); a reply joins its root's chain (`parent_id` = root, `reply_to_id` = what it quotes) and keeps `reply_count`, `last_reply_at`, `reply_user_ids`; the sender's `last_read_id` (and `last_read_at`) moves to the message; announcement channels take their managers' posts only; the bell row as v1 rang it, with a server-built excerpt (`chat__excerpt`, stored form, `payload.format_version = 2`) until CV-5's fan-out.
- **`chat_op_edit(message, body)`**: the author's v2 text, mentions read again, `edited_at`; the same text again is a no-op.
- **`chat_op_delete(message)`** hides at once (`deleted_at`, `deleted_by`), keeps the text for Undo; **`chat_op_restore(message)`** inside the window, by whoever deleted it or anyone with "Delete others' messages"; the minute job **`chat-blank-deleted`** (`chat__blank_deleted`) blanks text, mentions, reactions and pin once the window passed. Delete: the author while they can post, or anyone with "Delete others' messages". Chain counters follow (`chat__chain_refresh`).
- **`chat_op_react(message, key, on)`**: explicit on/off, idempotent, never notifies, readers including viewers, works while chat is paused (`chat_op__reader`, no plan check). The live key check and 20-kind cap kept for CV-7c.
- **`chat_op_pin(message, pinned)`**: messages only, ≤ 100 live pins per conversation, posters (managers in an announcement channel) and holders of "Manage any channel".
- **`chat_op_typing`** from its live body (`20261014155205`: one "typing" per 2.5 s per person and conversation, a "stopped" only to close an open one, for its thread): the sender must also be a member of the conversation who hasn't left; refusals carry codes; people only (no service role).
- **The sending limits** (`chat_send_limit`, from its live body; same numbers and `PT429`): event lines are neither limited nor counted; a row with `api_key_id` counts against that key's own budget (new partial index `chat_messages_api_key_recent_idx`) and not against its person's; an app row without a key id (today's `chat_op_agent_post`) keeps the workspace's shared apps budget.
- **Activity (#15):** one attributed row with ids only for `chat.message_edit`, `chat.message_delete`, `chat.message_restore`, `chat.react`, `chat.pin`, written only when something changed; a plain send and typing write none.
- **Guards with codes:** `chat_op__guard` / `chat_op__channel` answer `42501` (not allowed, the plan included) and `P0002` (gone, a deleted conversation included); input errors are `22023`.
- **`chat_has_cap`** restated: the owner, then members by their role (a custom role reads as member).
- **`share_chat_message_guard`** reads the parsed `mentions_everyone` flag, not the words.
- **The v1 signatures, one release:** `chat_op_send` (7 arguments), `chat_op_edit` (3, its default dropped) and `chat_op_react` (2, a toggle) convert v1 markup with `chat__v1_to_v2` and call the v2 ops. `chat_op_agent_post` (live body) converts its v1 markup and writes v2 rows. v1's screens keep working with no client change.
- **Tests:** `supabase/tests/chat_ops.test.sql` (messages half, 143 checks), `supabase/tests/chat_wrappers.test.sql` (23); CV-1's `chat_foundation`, `chat_privacy` and `chat_convert` files updated for the new truth (codes, v2 rows, members-only typing, the default).

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC12.1 | `chat_ops.test.sql` · send / edit / delete / restore / react / pin / typing as owner, admin, manager, member, custom role, viewer, outsider and a key, and in archived, deleted, left and removed conversations; the plan (react works paused, the rest refuse); a resent id returns the stored row; each logged op writes one attributed row with ids only; a plain send and typing write none |
| AC12.4 | `chat_ops.test.sql` · "typing": members only, sender from the session, a key refused; `chat_privacy.test.sql` · a reader who isn't a member is refused; `chat_send_limits.test.sql` · the pace and the marks hold on the redefined op (its typers made members of #general) |
| Sending limits | `chat_send_limits.test.sql` (54 checks) against the redefined ops; `chat_ops.test.sql` · "Sending limits": twelve event lines aren't held back and don't count, a key's eleventh post in 10 s is refused, the key's posts don't use its person's budget, another key has its own |
| AC1.4 (server half) | `chat_ops.test.sql` · "resend": a retried id returns the stored row, never a second message; concurrent same-id sends collapse to one (unique_violation path). The page-boundary half is the store's (CV-3) |
| AC12.9 (server half) | `chat_wrappers.test.sql` · v1 send/edit/react convert and succeed; v2 calls resolve to v2; the app's post writes v2. The client half (`src/lib/min-build.test.ts`) is unchanged; `min_build` is raised at the release (CV-23) |
| Edge cases | `chat_ops.test.sql` · reply to a reply joins the root's chain; 8,001 characters refused with the count; `@channel` without the switch stored as text, nobody pinged; delete → Undo → too late after the window → blanked; a deleted root keeps its chain |

With the migration applied to the local stack: `bun run db:test chat` passes all 8 chat files (`chat_send_limits` included, against the redefined ops), and every other `supabase/tests` file passed in the rolled-back runs before it. `bun run verify` green, `privacy-rules.test.ts` now running against the applied migration.

**Mentions parity:** `chat__mentions` against the client's `mentionsOf(parseStored(·))` on 23,367 bodies (the 3,032 converted research messages, spike 4's 238 editor and 26 stored cases, 45 hand edge cases, 20,000 fuzzed strings over the meaningful tokens): 0 differences. Crafted 8,000-character bodies take ≤ ~32 ms.

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **Mentions read by a SQL twin of the client's parser** · agent · `chat__mentions` walks blocks as `chat__body_text` does and scans inline runs as `parseInline` does (code spans, escapes, titled references, link targets, emphasis pairing on the line, a reference ending a word), proven at 0 differences on 23,367 bodies · rejected: a regex over the raw text (counts code and escaped text), trusting the client's list.
- **`@channel` without "Mention everyone" is stored as typed, flag off, no error** · agent (brief: "stored as plain text") · the composer says so; v1 refused the send · rejected: refusing, rewriting the text.
- **A resent id answers only its author, in its conversation, while they can read it**; any other use of an existing id is `22023 That message id is already used.` and returns nothing · agent.
- **The v1 send wrapper uses v1's client id as the message id**; a row sent before the release is found by `(author, client_id, channel)` · agent · one idempotency key from now on.
- **Event lines don't count toward the sending limits** · agent (orchestrator's question) · they are written by ops (a move's "moved here"), not sent by a person; a move of many messages must not lock its mover out · rejected: counting every row.
- **A message posted through an API key has its own budget per key** (same numbers), apart from its person's · orchestrator · one busy app can't silence its person or the workspace's other apps. v1's app rows (no key id) still share the workspace's apps budget until CV-21 writes `api_key_id`.
- **Every send writes `client_id = id` while the wrappers live** · agent (validator) · v1 screens and old builds match their optimistic row by `client_id`; without it each v1 send showed twice · rejected: stopping at once (round-3 §2.3's "new sends stop writing it" moves to CV-23).
- **The v1 edit wrapper reads the stored row's format:** a v1 row's text is converted whole; a v2 row's text (every row after the release) is kept, and only the tokens v1's pickers add (`<@id>`, `<!channel>`, `<moduo:type:id|label>`) become references (`chat__v1_tokens`) · agent (validator, code review) · v1's composer opens an edit with the stored text, so converting it again would escape it · rejected: converting always; guessing from the text. v1 emphasis typed during such an edit (`_x_`) stays literal: a transition loss on v1 screens only.
- **The 2-argument `chat_op_react` stays as a toggle wrapper too** (the brief named send and edit) · agent · v1 screens and old desktop builds keep reacting for the release; CV-23 drops it · rejected: dropping it (reactions fail on old builds).
- **The 3-argument `chat_op_edit` lost its default** (DROP + CREATE, grants re-stated) · agent · otherwise a 2-argument call is ambiguous in SQL and in PostgREST.
- **The bell rings as v1 rang it until CV-5** (mentioned people, the conversation on `@channel`, the chain's people and the quoted message's author on a reply), only people who can read the conversation, never the sender; teams aren't expanded (CV-5) · agent.
- **Replies:** a reply to a deleted message is refused (`P0002`); a reply to a live reply in a deleted root's chain is taken; event lines can't be replied to, pinned or reacted to (`22023`); replies move the conversation's `last_message_at` (they post at the bottom) · agent.
- **Chain counters are recounted on delete and restore** ("N replies" counts live replies) · agent · v1 decremented on delete and had no restore.
- **Posting in a public channel joins it, or back** (clears `left_at`), as v1 joined on post · agent.
- **The Undo window:** 8 s in the app, the server takes a restore up to 10 s after the delete (the request in flight), and the job blanks after 10 s; `deleted_at` is stamped from the clock · agent.
- **Who deletes:** the author while their role can post, or "Delete others' messages" · §12 + agent (a viewer can't delete even an old message of theirs).
- **Who undoes a delete:** the person who deleted it (while they still may), or anyone with "Delete others' messages"; an author can't undo an admin's delete. Needs `deleted_by` (new column) · agent · rejected: "as delete" read literally (the author could put back a message an admin took down).
- **An archived conversation is read-only:** no sending (v1), editing, reacting or pinning; deleting (and its Undo) still works · agent · rejected: v1's edits, reactions and pins in archived channels.
- **Someone a manager removed doesn't post, edit or pin** in that public channel any more (`42501 You were removed from this conversation.`), though they still read it and may react; someone who left on their own posts and is back in · agent · it takes effect once CV-2b's `chat_op_remove_member` stamps `removed_by` (v1's deletes the row); CV-2b's join decides whether a removed person may rejoin.
- **The bell's excerpt of a deleted message is blanked with the message** by the minute job · agent · the excerpt is the only text a bell row carries.
- **Pins in one conversation are taken one at a time** (an advisory lock per conversation in pin and in a restore of a pinned message), so the 100-pin cap holds under concurrency · agent.
- **v1 text is measured after conversion:** a v1 message close to 8,000 characters that grows past it when converted is refused with the count · agent · the stored limit is the v2 one (#3).
- **Who pins:** whoever can post there (managers only in an announcement channel) and holders of "Manage any channel" · agent (round-3 "Poster").
- **Edit needs the author's role to still post** · agent.
- **A restored pinned message comes back unpinned when its conversation filled its 100 pins meanwhile** · agent.
- **Activity rows only on a change** (a resent react, pin, delete or restore writes none); entity `chat_channel`, payload `message_id` (+ `key`/`on`, `pinned`) · agent.
- **`chat_op_agent_post`: one change** · agent · the default flipped to v2, so it converts its v1 markup and writes `format_version = 2` (and quotes its thread root); CV-21 redefines it.
- **Excerpt:** the stored form's first 140 characters without half a reference (CV-1's format, drawn by CV-11) · agent.

## Gotchas (area: supabase · chat)

- **(supabase)** A `STABLE` test helper reads the snapshot of the statement that calls it: `PERFORM test.ok(op() = 'ok' AND (stable_read()).x)` misses what `op()` just wrote. Make read helpers `VOLATILE`.
- **(supabase)** A v1 function with a defaulted trailing argument shadows a shorter v2 signature: `f(uuid, text)` beside `f(uuid, text, uuid[] DEFAULT …)` is "not unique" in SQL and ambiguous in PostgREST. Drop the default (DROP + CREATE + grants).
- **(supabase)** Inside one transaction `now()` is frozen; a window measured with `clock_timestamp()` needs its stamp from `clock_timestamp()` too, or a slow test (or op) drifts out of it.
- **(chat)** `perm_enforce_write` fires before `share_chat_message_guard` (trigger names sort): a viewer's insert reads "Your role can't add messages" unless the op checks "post" first.
- **(chat)** `chat__is_iso_day(NULL)` is false, not NULL.
- **(supabase)** A plain subquery inside a `PERFORM test.ok(…)` expression reads the expression's snapshot: an op called earlier in the same expression isn't seen. Run the op into a variable first.

## For later blocks

- **CV-2b:** `chat_op_remove_member` must stamp `removed_by` (send reads it to refuse a removed person); `chat_op__reader(channel)` is the plan-free guard for mark_read / mark_unread / set_prefs / leave; the guards now raise `42501` / `P0002`; extend `chat_ops.test.sql` (cast and helpers are there; `test.msg`/`test.acts` are VOLATILE on purpose). `chat_unread_counts` should count replies (they are stream messages now).
- **CV-3:** v2 send is `chat_op_send(p_id, p_channel_id, p_body, p_reply_to_id)`; a resend returns the stored row; `22023 That message id is already used.` means the id is someone else's; a length refusal carries `DETAIL` `{"length":…,"max":8000}`; a deleted conversation answers `P0002`. `client_id` equals `id` on new rows until CV-23; don't read it.
- **CV-5:** replace the bell block at the end of `chat_op_send` (and add edit's first-time mentions there); team mentions are stored, not expanded. `chat__read_mentions(channel, body, actor)` is the one place mentions are read and filtered; `chat__check_body` the one place the text is checked.
- **CV-7a:** draw the `@channel` pill only when `mentions_everyone` (otherwise it is the typed text); a deleted row's body is blank after the window.
- **CV-7c:** the key check of `chat_op_react(uuid, text, boolean)` becomes `reactions__key_ok`; the 2-argument wrapper calls it.
- **CV-9:** delete/restore send files to and from the trash clock; the blank job is `chat__blank_deleted`.
- **CV-10:** `chat__mentions_inline` collects only people and teams; "Mentioned in" needs the other references too.
- **CV-12:** a new reply reopens a wrapped chain inside `chat_op_send`.
- **CV-21:** write `api_key_id` on the app's posts: the per-key sending budget applies from then on (until then they share the workspace's apps budget). `chat_op_agent_post` now writes v2 rows; redefine from its live body. Still v1 there: a reply doesn't move `last_message_at` or `reply_user_ids`, and its mentions come from the `<@id>` regex filtered by workspace membership, not by `chat__can_read_channel_as` (use `chat__read_mentions`).
- **CV-23:** drop the wrappers `chat_op_send(uuid, text, uuid, uuid[], boolean, uuid, text)`, `chat_op_edit(uuid, text, uuid[])`, `chat_op_react(uuid, text)`, and stop writing `client_id` in `chat_op_send`.
- **CV-14:** event lines (`kind = 'event'`) are not counted by `chat_send_limit`; write them inside ops as usual.
- **Orchestrator:** this migration redefines `chat_op_typing` and `chat_send_limit` from `20261014155205`'s bodies and must stay after it; when its stamp is re-cut, update `MIGRATION` in `src/features/chat/privacy-rules.test.ts`. `chat_send_limits.test.sql` now makes its typers members of #general (typing is the members').

## Manual checklist (step → expect → surface)

- [ ] Apply the migration, then `bun run db:test chat` → 7 files pass → terminal
- [ ] v1 Chat, send `hi @Anna _soon_` → it posts; `select format_version, body, mentioned_user_ids from chat_messages order by created_at desc limit 1` → `2`, `hi moduo://person/… *soon*`, Anna's id → psql
- [ ] v1 Chat: edit it, react 👍 twice (on, off), pin, delete → each works; `module_activity` has one row per change, ids only → Chat + psql
- [ ] Delete a message and run `select chat_op_restore('<id>')` as its author within 10 s → it is back; delete again, wait a minute → its body is blank → psql
- [ ] As a member whose role can't "Mention everyone", send `@channel hi` → it posts, nobody gets a bell row → Chat + bell

## Verify before release

- Release order: foundation → convert_v1 → the v1 hotfix (already on prod) → this file; `chat-blank-deleted` is scheduled on prod after it.
- v1 clients show new messages' mentions as `moduo://person/…` and the bell shows stored-form excerpts until the v2 client (CV-3, CV-7a) and CV-11 ship with it; old desktop builds send through the wrappers until `min_build` passes them (CV-23).
- Prod applies as `postgres`: the redefined functions keep `postgres` as owner; the new helpers are executable by the ops' owner.
