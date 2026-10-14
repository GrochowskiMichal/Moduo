# CV-1 — Foundation and conversion

> Branch `t/maciej/cv-1-foundation` · head: the commit carrying this line · status: built, not landed
> Migrations: `supabase/migrations/20261014100000_chat_v2_foundation.sql` · applied to the local stack: **yes** (as `supabase_admin`, like `scripts/local/stack.sh`) · `supabase/migrations/20261014100100_chat_v2_convert_v1.sql` · applied to the local stack: **no, on purpose**: the stack's only v1 rows are the research workspace, which the runbook says never to write. It was round-tripped in a rolled-back transaction over the research workspace plus a hand-made set (below). Apply it with `psql "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261014100100_chat_v2_convert_v1.sql` when the research data may be converted, **and before CV-2a's migration**: it refuses once v2 data exists (its v1 rows are dumped at the scratch path in §Converter run). Stamps are provisional.

## Delivered against the row

- **Search plumbing and the stored form** (foundation §1): `unaccent` in `extensions`; `chat__unaccent` (IMMUTABLE wrapper); `chat__body_text` (+ `chat__inline_text`, `chat__list_marker`, `chat__is_iso_day`): spike 4's `toBodyText(parseStored(·))` in SQL; the converter `chat__v1_to_v2` (+ `chat__v1_inline`, `chat__v1_prose`) adopted from `drafts/chat_v1_to_v2.sql` with `search_path = ''` and qualified calls.
- **Columns** (§2): messages `updated_at`, `format_version` (1/2), `body_text`, `search_tsv` (generated, `simple` + `chat__unaccent`), `reply_to_id`, `v1_thread_reply`, `kind` + `event`, `mentioned_team_ids`, `mentions_everyone`, `api_key_id`; channels `is_default`, `deleted_at/by`, a trimmed-name CHECK; members `last_read_id`, `left_at`, `removed_by`, `updated_at`. `updated_at` added without a volatile default, backfilled `greatest(created_at, edited_at, deleted_at, pinned_at, last_reply_at)` (members: `greatest(joined_at, last_read_at)`), then default `clock_timestamp()` + NOT NULL.
- **Triggers** (§3): `zz_stamp_updated_at` on the three tables and `chat_catchup` (`chat__stamp_updated_at`, `clock_timestamp()`); `chat_messages_body_text` keeps `body_text` from the body (a v1 row is read through the converter, so it's searchable before conversion).
- **Indexes** (§4): stream `(channel_id, created_at, id)`, delta `(workspace_id, updated_at, id)`, GIN search (`deleted_at IS NULL`), live-name unique `(workspace_id, lower(name))` among live channels, one General, channel delta/deleted, member delta; Catch up's four (+ one per level_reset line).
- **`chat_catchup` and `chat_chain_mutes`** (§5): own-rows RLS, `SELECT` for signed-in people only, writes only through ops (none yet), `chat_catchup` published. Grants on the three chat tables re-stated (`SELECT` only).
- **Read rules** (§6): `chat_can_read_channel` without the plan, dropping people who left and deleted channels (and deleted workspaces); `chat__can_read_channel_as(channel, person)` for "can this person see it"; `spine__visible_to` gains `chat_channel`/`chat_message` branches; the `entity_links` read policy hides a row with a conversation or message at either end from people who can't read it. `perm_can_see_entity`'s chat branches were already live (20261014090000) and read the new rule.
- **Realtime** (§7): a typing topic is read by the conversation's members who haven't left (and can read it); presence on `chat:<ws>` unchanged (members of a workspace with chat); publication re-asserted for the three tables and `chat_catchup`. Writes unchanged (presence on the workspace topic only; typing only through `chat_op_typing`).
- **The conversion** (§8): `chat__convert_v1(p_workspace_id default null)`, refusing to run once v2 data exists (`format_version` defaulting to 2, a `left_at`, an event line, a quote, a key id, a team mention, a non-`level_reset` Catch up item or a chain mute), then seven idempotent steps (bodies + replies flagged + `mentions_everyone`; notes to self → a private note; Every message → Mentions and replies with a `level_reset` line; General flagged; `last_read_id`; registry; bell excerpts). `…_convert_v1.sql` runs it, asserts, runs it again and fails unless the second pass is all zeros.
- **Erasure** (§9): `account_erase_workspace_data` patched from its live body by anchored replace (the TV-U2 pattern): counts and deletes `chat_catchup` and `chat_chain_mutes` (`chat_catchup_deleted`, `chat_chain_mutes_deleted`); "nobody else is in it" and the manager handover count only members who haven't left. The export carries neither table (no export exists yet: CV-22).
- **Contracts**: `CHAT_MESSAGE_KINDS`, `CHAT_EVENT_TYPES`, `CHAT_CATCHUP_REASONS`, `CHAT_CATCHUP_DONE_HOW` with schema, `is*`, `normalize*`, `parse*`, re-exported from `@contracts/index`, unit-tested, drift-gated against the foundation's CHECK text.
- **`share_op_announce`** asks `chat_op__guard` itself: it got the plan only through the read rule, which no longer asks it (live body, one line added).
- **Already satisfied, not redone**: `chat_caps_get` (members only, live since 20261014090000).

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC12.5 | `supabase/tests/chat_foundation.test.sql` · "read rules follow the conversation": member / plain member / viewer / outsider / key, plan off, left, deleted; parity of the two written-out rules with `perm_user_has` |
| AC12.4 | `supabase/tests/chat_realtime.test.sql` · "typing is per conversation, sender from the session"; `chat_privacy.test.sql` updated for the members-only topic |
| AC13.1–13.7 | `supabase/tests/chat_convert.test.sql` · "v1 → v2, twice" (spike 4's 68 pairs, every token, notes to self, thread counts, levels, slugs, General, excerpts, zero rows on the second run, refusals) + the full round trip below |
| AC12.8 (its tables) | `supabase/tests/chat_erasure.test.sql` · "export and erasure": preview counts, delete, others untouched, the profile cascade. The export half is CV-22's (`src/features/chat/export.test.ts`) |

`bun run db:test chat`: 5 files, 34 + 9 + 44 + 60 + 19 checks. Full `bun run db:test`: 42 files pass. `bun run verify` green.

## Converter run (round-3 §2.6 round trip)

- Dump first: `pg_dump --data-only` of `chat_channels`, `chat_members`, `chat_messages`, `chat_channel_managers` (the research workspace is the stack's only chat data) to the session scratchpad `cv1/fixture/research-chat-v1.sql` (782 KB).
- In one transaction (REPEATABLE READ, rolled back): the hand-made set of `chat_convert.test.sql` (79 messages: the 68 bodies, an app post, a thread, notes to self, an Every-message channel, an archived one, a DM with a former member, three bell rows), then `…_convert_v1.sql` applied, checked, applied again.
- First apply: 3,111 bodies in 0.49 s; second apply: every step 0 and **zero row versions changed** (ctid of every chat row, Catch up, note, registry, grant and chat activity row).
- Checks (all pass): message, membership, conversation and bell counts unchanged; nothing left at `format_version` 1; every reply flagged; unread and mention counts per membership equal v1's plus only the replies whose root was unread; one `level_reset` line per person and live non-archived conversation on Every message; one note per notes-to-self conversation with messages, all closed; one General per workspace with a `general`; no bell excerpt keeps a v1 token.
- Research workspace (3,032): 6 bodies change text; `check_v1_to_v2.ts`: 3,032 drawn as v1 drew them, 0 tokens, 0 labels, 3,031 canonical, all settle in one save (same as spike 4). 3 replies flagged, 1 note, 6 `level_reset` lines, 1 General, 16 of 21 read marks, 9 conversations registered, 6 excerpts rewritten.
- Hand set (79): the 10 deliberate drawing differences spike 4 lists (f04, f14/46/47/48, f22–f24, f66, f67), everything else drawn the same.
- `body_text` against the client's `toBodyText(parseStored(·))`: 3,111 / 3,111 rows equal, and 290 / 290 of spike 4's corpus strings.

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **Convert_v1 round-tripped, not left applied on the local stack** · agent · the stack's only v1 rows are the research workspace, which the runbook and the brief say never to write; a rolled-back transaction proves the same file on the same rows · rejected: converting the fixture in place (irreversible for other builders reading it as v1).
- **Converter and stripper functions live in the foundation; `…_convert_v1` only calls `chat__convert_v1()`** · agent · `chat_convert.test.sql` must pass under `db:test` on a stack where the conversion isn't applied, and CV-2a's v1 wrappers will need `chat__v1_to_v2` · rejected: functions only in the convert file.
- **`format_version` defaults to 1 for now** · agent · v1's live ops keep writing v1 text until CV-2a; a default of 2 would mark their rows converted and the conversion would skip them · rejected: round-3's default 2 in this block (CV-2a writes 2 explicitly and can flip the default).
- **One `level_reset` line per person and conversation, none for an archived channel** · agent · the copy names one conversation ("Acme now notifies you…") and its Change opens that conversation's setting; `channel_id` stays NOT NULL · rejected: one line per person (which conversation would it name?).
- **Notes-to-self note format**: each message under a bold `YYYY-MM-DD HH:MM` line (the person's Time & region zone, else `UTC` named), blank line between, deleted messages left out, inserted like `notes_op_import` (`body_md`, no `doc_state`), the workspace grant `share_note_after` adds removed so only its person reads it; an empty notes-to-self conversation is closed without a note; a DM whose other people left is not notes to self (`dm_key` must be the one person) · agent.
- **The conversion refuses rather than truncates**: a v1 body holding U+0001/U+0002 (the converter's markers) or one that would grow past 8,000 characters stops it before any change · agent · no silent data loss · rejected: widening the 8,000 CHECK for converted rows.
- **`mentions_everyone` on converted rows** from the v1 body containing `<!channel>` (inside code too, rare) · agent.
- **Bell excerpts: only those holding a v1 token are rewritten; every chat excerpt is marked `payload.format_version = 2`** · agent · the v1 client writes excerpts as plain text with names filled in (`use-chat-module.ts` `toPlainText`), which the converter would only escape; a server-written raw body carries tokens; the marker makes the step idempotent (the converter isn't) · rejected: converting every excerpt (escapes `2*3`, `C:\\x`).
- **The conversion runs once, before the v2 ops, and refuses after them** · agent (validator round 1) · steps 2–4 can't tell a v1 setting from a v2 choice (a late run would reset someone's v2 Every message) · rejected: per-row v1 markers on memberships.
- **Link rows gated at both ends** (source or target a conversation/message) · agent · a link from a task to a private message must not reveal it · rejected: source only (round-3's wording).
- **The read rule is written out in `chat_can_read_channel` and `chat__can_read_channel_as`, without nested definer calls**, guarded by a parity test against `perm_user_has` · agent · the RLS policies call it per row: 3,032 rows read in 406 ms with nested calls, 23–26 ms written out · rejected: one function calling the other (and `perm_user_has`), which kept the logic in one place but cost ~100 µs a row.
- **`chat__inline_text`'s look-aheads share a budget of 2 × length + 1,000 characters** (past it, an unclosed backtick run or a `](` reads as text) and emphasis markers pair in two linear passes · agent · it runs on every message write; crafted 8,000-character bodies now take ≤ ~70 ms (one took 4.4 s before) · rejected: the client's unbounded scans (fast in JS, quadratic in plpgsql). Only text built to be slow reads differently from the client.
- **Typing topics for members only**: a person who reads a public channel without being in it gets no typing line there (spec #17, round-3 §2.7). **`supabase/tests/chat_privacy.test.sql` changed on purpose**: its check "realtime: C reads the public channel Q's typing topic" (C reads Q but isn't in it) now expects 0 and adds that Q's member A reads it. Any branch that still carries the old line fails that one check against a stack with this foundation, until it merges CV-1.
- **General is flagged only on a public, unarchived "general"** (new members are joined to it) · agent (code review) · rejected: flagging whatever is named general.
- **In the notes-to-self note, a person mention reads `@Name`** (Notes draws no person reference); other references stay `moduo://` URIs for Notes' reference grammar · agent (code review) · rejected: leaving `moduo://person/<id>` in the note.
- **`chat_catchup` stays own-rows only**, not gated on the conversation's read rule: a "removed" line must reach the person who can no longer read the conversation; items carry ids only, and CV-11 closes items (`closed`) when access goes.
- **`normalizeChatMessageKind`**: a missing kind is a message, an unknown one is skipped (null), like event types and reasons.
- **`chat_channels_name_trimmed` is `NOT VALID`**: new and changed names are checked, existing v1 slugs aren't re-scanned at release · agent · one untrimmed prod name would otherwise roll the foundation back.
- **The body_text trigger is `zx_body_text`**, sorting after `perm_enforce_write` and `share_chat_message_guard`, so a refused write doesn't pay for the parse.
- **Migrations applied as `supabase_admin`** (the stack's own applying role in `stack.sh`): `spine__visible_to` is owned by `supabase_admin` locally, so `postgres` couldn't redefine it.

## Gotchas (area: supabase · chat)

- **(supabase)** A nested `SECURITY DEFINER` + `SET search_path` call inside a function an RLS policy calls per row costs ~100 µs a row; a 3,032-row read went 406 ms → 26 ms by writing the rule out. Keep per-row read rules free of definer hops, and guard the copy with a parity test.
- **(supabase)** plpgsql character loops are ~100× slower than the same loop in JS: a scan the client can afford per character (`](` looking for its `)`) became 4.4 s for 8,000 characters. Bound every look-ahead in a trigger-time parser.
- **(supabase)** `text[] || 'literal'` resolves the literal as an array and fails ("malformed array literal"): cast it, `o || '['::text`.
- **(supabase)** `perm_members_resolve` recomputes `workspace_members.perms` on update: a test that removes a permission by hand must bypass the trigger (`session_replication_role = replica`).
- **(supabase)** The shared stack has functions owned by `supabase_admin` (applied by `stack.sh`): redefine as `supabase_admin` locally; prod's role is `postgres`.
- **(supabase)** A whole-database "zero rows changed" check in READ COMMITTED sees other sessions' commits: run it REPEATABLE READ. Compare `ctid`s, not `xmin` (one transaction keeps one `xmin`).
- **(chat)** `share_chat_message_guard` (BEFORE INSERT) fires before CHECKs: a probe without an author gets `42501`, not the CHECK's `23514`.

## For later blocks

- **CV-2a:** write `format_version = 2` in every redefined op and **flip the column default to 2 in CV-2a's own migration** (the conversion's refusal keys on it); then `chat_convert.test.sql` must set the default back to 1 inside its own transaction before calling `chat__convert_v1` (as its refusal case does), and `chat_foundation.test.sql`'s default check (`'1'`) changes; the v1 signature wrappers convert v1 input with `public.chat__v1_to_v2` (internal, server-only). `share_chat_message_guard` should read `mentions_everyone`, not the text. Typing is the members' now (the topic's read rule): `chat_op_typing` should ask membership too, as round-3 §2.7 says. The body_text trigger keeps `body_text`; don't write it from ops.
- **CV-2b:** `chat_op_open_dm` must skip a deleted DM (the conversion deletes notes-to-self DMs, and `chat_channels_dm_uq` still covers deleted rows: make it partial or reuse the row). `chat_unread_counts` counts replies, skips `v1_thread_reply` rows whose root is at or before the mark, and reads `last_read_id`; `chat_sync_ids` (spike 2's draft) on `chat__can_read_channel_as`; the General-join trigger and `chat_op_bootstrap` set `is_default`; leaving stamps `left_at` (the read rule, typing topic and erasure already honour it). `share_chat_channel_guard` still exempts a channel *named* `general` from the create caps: key it on `is_default` when bootstrap sets it.
- **CV-5 / ❓ orchestrator:** no block names the bell drawing chat excerpts with the stored-form parser; today's bell prints `p.excerpt` as text (`src/features/spine/activity.ts`), so a converted excerpt shows `moduo://person/<id>` until something parses it (AC13.7's "redraw" is complete only then).
- **CV-8a:** v1's `watchTyping` joins the open conversation's typing topic with no status handler; a reader who isn't a member of a public channel is now refused that join (no typing shown). The v2 client should join only as a member.
- **CV-3:** `updated_at` and the delta index exist; Realtime events carry every column (spike 3), so bind with `select` and never `select *` (`search_tsv`, `body_text` off the wire).
- **CV-5:** `chat_catchup` is empty but published; its unique `(user_id, message_id, reason)` makes fan-out retries safe.
- **CV-15:** the 30-day purge of deleted channels (the conversion's notes-to-self DMs are deleted, `deleted_by` = their person); drop `chat_channels_name_uq` once deletion can free a name (the live-name index already exists).
- **CV-19:** `chat__readable_channel_ids` must mirror the written-out rule exactly (deleted workspace, owner or `chat.view`, live conversation, public or active member).
- **CV-22:** the export (`src/features/chat/export.test.ts`); it carries neither `chat_catchup` nor `chat_chain_mutes`.
- **CV-23:** drop v1's `chat_messages_channel_idx` and `chat_normalize_channel_name`; `VALIDATE CONSTRAINT chat_channels_name_trimmed` once prod has no untrimmed name.
- **Orchestrator:** decide whether the research workspace may be converted: if so, apply `…_convert_v1.sql` to the local stack **before CV-2a's migration** (afterwards it refuses); if not, the local stack keeps it as v1 rows (`format_version` 1, searchable through the trigger) and the conversion is proven only by the rolled-back round trip and `chat_convert.test.sql`.
- **Release (not fixed here, noted):** the conversion runs `chat__v1_to_v2` over every v1 body three times (the foundation's `body_text` backfill, the 8,000-character pre-check, step 1) and `chat_messages` is rewritten three times (backfill, `search_tsv`, step 1): 3,111 rows took 0.5 s locally; at prod's size, consider computing the converted bodies once into a temp table.

## Manual checklist (step → expect → surface)

- [ ] `bun run db:test chat` with the local stack up → 5 files pass → terminal
- [ ] As a member of a Duo workspace, open v1 Chat, send a message with `_italic_` → it posts; `select format_version, body_text from chat_messages order by created_at desc limit 1` → `1`, the words without `_` → psql
- [ ] Switch the owner to Free and reload Chat → history still loads; sending says "Chat is available on the Duo and Team plans." → Chat
- [ ] Two people in one public channel, a third who only reads it: the two see "… is typing", the third doesn't → Chat composer line

## Verify before release

- On prod, read-only, before the train: no v1 body holds U+0001/U+0002; no body grows past 8,000 characters through `chat__v1_to_v2`; record the counts the conversion would change (re-run `check_v1_to_v2.ts` over prod's v1 messages).
- `unaccent` is in prod's `pg_available_extensions`.
- The release applies foundation → convert_v1 → CV-2a's ops back to back, and the v2 client ships with them (v1's notes-to-self can't open a converted, deleted DM).
- The deploy-time Realtime burst: the backfill touches every message and membership row, so v1 subscribers receive one UPDATE event per row.
- The foundation's table rewrite (`search_tsv`) and backfill at prod's row count fit inside `lock_timeout`'s quiet hour (0.8 s per 100,000 rows locally).
- Prod applies as `postgres`: `spine__visible_to` and the other redefined functions must be owned by `postgres` there.
