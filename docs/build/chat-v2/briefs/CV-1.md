# CV-1: Foundation and conversion (server, large)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-1-foundation`; record `docs/build/chat-v2/CV-1.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **CV-1** Foundation and conversion *(server, large)* | the foundation migration (new columns on the three tables, stamp triggers, `chat_catchup` and `chat_chain_mutes` empty, indexes, the read rule without the plan, the chat branches of the registry, activity and link read rules, the two Realtime topic families and policies, `chat_caps_get` redefined, vocabulary CHECKs, publication and grants) and the conversion migration with its round trip on the local stack; **erasure and export for `chat_catchup` and `chat_chain_mutes`** (`chat_erasure.test.sql` starts here); `supabase/tests/chat_foundation`, `chat_realtime`, `chat_convert` | AC12.5, AC12.4, AC13.1–13.7, AC12.8 (its tables) | 0 (spikes 2, 4, 5) |

**Depends on:** CV-0 spikes 2 (store and `updated_at` + keyset design), 4 (`chat__v1_to_v2` over the research workspace) and 5 (search columns); spikes 2, 4 and 5 draft this block's files. Nothing else.

## 2. What to build

**§1 Words, shape and who sees Chat**
- **Channel names are as typed** ("Acme rebrand", "Launch v1"): spaces and capitals allowed, 1–80 characters, trimmed, unique in the workspace ignoring case among live channels (CH3a). A channel's icon is **one glyph for every channel, plus a lock for a private one you're in**; what it's linked to shows in its header chip and Details, never as an icon (CH32).
- **A new workspace's first open** (CH37): "General" exists, everyone is in it, and the conversation shows a one-line welcome ("Reply to keep answers together · @ links anything in Moduo") that disappears after the first message. Frame 7.

**Edge cases this block handles** (§Edge cases)
- A v1 message with `<@id>`, `<!channel>`, `<moduo:TYPE:ID|Label>` and `_italic_` → one stored v2 body with the person URI, the `@channel` token, `moduo://TYPE/ID` and `*italic*`; drawn identically by the client parser; running the conversion again changes zero rows.
- A v1 thread → a chain whose replies sit in the stream at their own times, counted as read for whoever had read the root.
- A notes-to-self conversation → one private note "Notes to self (from Chat)" in the person's Notes Inbox with every message in order; the conversation is gone from the sidebar.
- A channel on "Every message" set by v1 for its creator → reset to Mentions and replies with one quiet Catch up line; direct messages keep notifying.
- A v1 slug name (`acme-launch`) → kept until someone renames it.

## 3. Acceptance criteria

**AC13 — Converting live v1 data**
- **AC13.1** bodies convert idempotently
- **AC13.2** threads become chains read for whoever had read the root
- **AC13.3** notes-to-self become a private note each
- **AC13.4** channel levels reset with one quiet line, direct messages keep notifying
- **AC13.5** slugs stay
- **AC13.6** General is marked, nobody is added retroactively
- **AC13.7** the bell's old excerpts redraw.

**AC12 — Platform**
- **AC12.4** typing events reach only a conversation's members and name the sender from the session; presence is display only
- **AC12.5** registry, activity and link rows about a conversation are readable only by its readers
- **AC12.8** the lossless export carries every conversation you can read, with files; every new per-person table is erased with the account

**Tests that prove them** (file · name · AC · plain English)

- `supabase/tests/chat_foundation.test.sql` · "read rules follow the conversation" · proves AC12.5, AC10.1 · An outsider, a plain member and a key can't read a private conversation's registry, activity or link rows; its members can; reading never needs the plan.
- `supabase/tests/chat_realtime.test.sql` · "typing is per conversation, sender from the session" · proves AC12.4 · Joining a conversation's typing topic is refused to non-members; a client can't broadcast on it; `chat_op_typing` writes the caller's id, never a passed one.
- `supabase/tests/chat_convert.test.sql` · "v1 → v2, twice" · proves AC13.1–13.7 · Every v1 token converts; running the file again changes zero rows; threads flag as replies; self-DMs become notes; levels reset with one line; General is flagged; old bell excerpts redraw.
- `src/features/chat/export.test.ts` + `supabase/tests/chat_erasure.test.sql` · "export and erasure" · proves AC12.8 · The export holds every readable conversation with chains, reactions, files and custom emoji as files, JSON plus Markdown; the erasure removes every new per-person table and counts them in the preview.

## 4. Decisions that bind it

**Already live, not on this branch:** `supabase/migrations/20261014090000_chat_privacy_rules.sql` (local stack and prod; on `origin/maciej` once PR #365 merges; don't fetch it here): `perm_can_see_entity`'s chat branches, the per-conversation typing topic with `chat_op_typing(p_channel_id uuid, p_parent_id uuid default null, p_stop boolean default false)` as its only writer, `chat_caps_get`, `share_op_announce`. Reusable once PR #365 lands (neither is on this branch): `supabase/probes/chat-typing.probe.ts`, `supabase/tests/chat_privacy.test.sql`. **Start from those live bodies, don't redo them**: read each in the catalog, build only what the row lists and the catalog lacks. `chat_can_read_channel` still requires the plan; dropping that is yours (CH4a).

- **Columns** (round-3 §2.1, §2.2; #1–#3, #11): messages `updated_at` (stamp trigger, `clock_timestamp()`), `format_version`, `body_text`, `search_tsv` (generated: `simple` + `chat__unaccent`), `reply_to_id`, `v1_thread_reply`, `kind` + `event`, `mentioned_team_ids`, `mentions_everyone`, `api_key_id`; channels `updated_at`, `is_default`, `deleted_at/by`; members `last_read_id`, `left_at`, `removed_by`, `updated_at`; new empty `chat_catchup` and `chat_chain_mutes` (own-rows RLS, ops-only writes, grants re-stated; `chat_catchup` published). Chain, decision, move, link and emoji columns are later blocks'.
- **Vocabularies** (#29), `@contracts` array + Zod + `parse*`/`normalize*`/`is*` and a CHECK in the same migration: `CHAT_MESSAGE_KINDS`, `CHAT_EVENT_TYPES` (`moved_out`, `moved_in`), `CHAT_CATCHUP_REASONS` (round-3 §2.2), `CHAT_CATCHUP_DONE_HOW` (`done`, `read`, `bell`, `closed`).
- **Indexes** round-3 §2.5 (the rows for these columns; new names, `if not exists`). **Search plumbing** (§2.5): `unaccent` extension, `chat__unaccent` (`IMMUTABLE`, schema-qualified dictionary), `chat__body_text`.
- **Read rules** (§2.25 a, #6): read rule without the plan, dropping `left_at` people and deleted channels; `perm_can_see_entity`, `spine__visible_to` and the `entity_links` read policy get conversation and message branches via `chat_can_read_channel`. They land **before** any chat row reaches the registry, activity or links.
- **Realtime** (§2.7, #17): typing topic read-policy only, no write policy; presence `chat:<ws>` read + presence-write for members of a workspace with chat; `chat_realtime_topic_allowed` from its live body; re-assert the publication.
- **Conversion** (§2.6, #27): idempotent per step: `chat__v1_to_v2` (person URI spelling from spike 4), replies flagged, self-DMs to a private note per person, channels to Mentions and replies with one `level_reset` item, slugs kept, `is_default` on the first `general` (nobody added), `last_read_id`, channels registered, backfills, bell excerpts rewritten. **Round trip before the block ends:** dump the research workspace (`669be464-0b9a-4d84-8537-544ac04dba5f`; read only) to a scratch fixture first, add a hand-made set (every token, a self-DM, a thread, an agent post, an Every-message channel), apply, check (no v1 token left, counts equal except replies of unread roots), apply again: zero rows change.
- **Erasure** (#31): both tables go with the account and the preview counts them (`account_erase_workspace_data`, from its live body); the export carries neither.

## 5. Files

New: `supabase/migrations/<stamp>_chat_v2_foundation.sql`, `<stamp>_chat_v2_convert_v1.sql` (#35); `supabase/tests/chat_foundation.test.sql`, `chat_realtime.test.sql`, `chat_convert.test.sql`, `chat_erasure.test.sql` (harness `supabase/tests/_setup.sql`). Touch: `supabase/functions/_shared/contracts/vocabularies.ts`, `index.ts`, `vocabularies.test.ts`, `drift-gates.test.ts`. Leave `src/features/chat/ui/*` alone: v1's screens keep mounting until CV-8a.

## 6. From earlier blocks

CV-0 spikes 2, 4, 5 (the `updated_at` + keyset design, `chat__v1_to_v2` and corpus, the unaccent wrapper); the orchestrator gives the paths; if one is missing, say so, don't redo it.

## 7. Watch out

- Round-3 §5 risks 2 (read live bodies), 4 (conversion on prod data), 5 (table rewrite: set `lock_timeout`), 10 (`unaccent` on prod), 11 (registry and link rows reaching more readers: test as outsider, plain member and key).
- The local stack has no Realtime publication until a migration adds it.
- **Tier 2** (migrations, RLS, contracts, moduo-mcp, src/lib/runtime*): one `/code-review high` and one security scan of the diff at the end; scan findings go only into the hand-back.
- **Migration:** stamp provisional (re-cut on apply day, chat's order kept); redefine from live bodies (`pg_get_functiondef`); re-state grants by name (`DROP` + `CREATE` resets them); re-assert the Realtime publication if you publish a table; apply only on your migration turn, then `bun run db:test chat`; never `local:reset` or `migration up` (runbook, `docs/gotchas/supabase.md`).
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

Every op and the v1 wrappers (CV-2a, 2b); the store (CV-3); the plan source (CV-4); Catch up writes (CV-5); `chat_search` (CV-19); v1 leftovers (CV-23). The client parser and `parity.test.ts` (AC12.6) are CV-7b's; your output must parse with it.
