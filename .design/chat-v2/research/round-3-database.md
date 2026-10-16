> Round 3 of the Chat v2 re-plan, 2026-10-13 (branch `t/maciej/chat-replan`, which carries the Tasks v3 integration branch). Written for Mike, who built Chat v1 on 2026-10-06. Nothing here is a new product call: every server behaviour comes from a decided call (CH…) or a technical decision in REPLAN §6. Where neither settles it, the choice is marked **my choice** with the rejected alternative. Block names (CV-…) and file names were provisional; the spec (`specs/chat-v2.md`) fixed them on 2026-10-14 (its §Execution blocks maps this file's names to the final ids) and resolved the ❓ items (CH73–CH75).

# Chat v2, round 3: v1's code and the database change list

## 0. In one page

**What stays.** v1's engine: the three tables, every write through a `chat_op_*` op, reactions and reply counts on the message row, soft deletes, idempotent sends, PERM-7's role switches, managers and announcement mode. REPLAN §6 #1 decided this, and nothing found in this round changes it.

**What goes.** Everything a person touches: the page, the sidebar, the message list, the composer, the panels, the dialogs, the 990-line page hook, the badge hook and the widget. They are rebuilt on Tasks v3's pieces (REPLAN §8, round 2).

**What the database gains**, in one line each:
- the message row learns to sync (a server stamp), to be searched (plain text + a full-text column), to quote (`reply_to_id`), to be a decision, to close a chain (Wrap up) and to move;
- the channel row learns to link to a project, client or team, to be deleted for 30 days, and to know it is General;
- the membership row learns to remember leaving, and to mark "read" at a message, not at a time;
- one per-person table holds Catch up (and Later, Remind me, and the quiet lines);
- reactions widen for chat **and** task comments; custom emoji get a table;
- statuses (with saved ones) and quiet hours join the person's settings;
- chat writes rows into Tasks v3's notification pipeline, with three additions: push at once, one device rings, an email after an hour.

**Headline numbers** (detail in §2 and §3):

| | Count |
| --- | --- |
| Chat tables kept | 5 (`chat_channels`, `chat_members`, `chat_messages`, `chat_channel_managers`, `workspace_chat_caps`) |
| New tables | 6 (`chat_catchup`, `chat_chain_mutes`, `chat_custom_emoji`, `user_statuses`, `user_saved_statuses`, `user_clients`) |
| Other modules' tables extended | 8 (`comment_reactions`, `user_preferences`, `notice_deliveries`, `workspace_members`, `attachments`, `entity_links`, `email_outbox`, `workspace_api_keys`) |
| Chat ops changed | 18 (every v1 `chat_op_*`, redefined from its live body) |
| Chat ops added | 20 writes + 10 reads |
| Person-level ops added | 8 (statuses, chat preferences, workspace pause, client heartbeat, notice ack) |
| Retired | 2 functions (`share_op_announce`, `chat_normalize_channel_name`) after one release; the v1 signatures of `chat_op_send` / `chat_op_edit` kept as wrappers for one release |
| Migrations | 20, in 15 data blocks (§3) |
| Open PRs touching chat | 0 of 9 (§4) |

## How to read this

| § | What it covers |
| --- | --- |
| §1 | v1, piece by piece: keep, re-scope, salvage or retire, with effort and order |
| §2 | The database change list: tables, columns, ops (with who may call each), indexes, the conversion, Realtime, and every decided call that needs the server |
| §3 | Migrations, grouped per future block, with file names, dependencies and the local-stack order |
| §4 | In-flight work: open PRs and branches |
| §5 | Risks, and what each of the five spikes must prove |

**Words.** *Keep* = stays as is. *Re-scope* = stays, but changes what it does. *Salvage* = the code goes, an idea or a test case comes along. *Retire* = deleted. **Effort:** S ≤ half a day, M 1–2 days, L 3 days or more. *Live body* = the function's current definition read from the local stack's catalog (`pg_get_functiondef`), which is what a redefinition starts from (local build mode: the local stack is prod).

**Sources:** REPLAN.md (CH1–CH72, §6 #1–#28, §7), `research/current-state.md`, `tech-blueprint.md`, `gap-audit.md`, `early-decisions-audit.md`; the v1 migrations (`20261006150000_chat_module`, `…151000_chat_edit_mention_scope`, `…160000_chat_agent_access`, PERM-7's parts of `20261006210000_perm_sharing`, `20261008010323`, `20261008124000`); the Tasks v3 migrations up to `20261013230000_templates_starter`; read-only catalog probes on the local stack (2026-10-13).

---

## 1. v1, piece by piece

**The order in one line:** spikes → the data foundation (server first) → the new screens replace v1's in one block (CV-4) → v1's client code is deleted in that same block. Between CV-1 and CV-4, v1's screens still open on the local stack but show converted messages as raw text; nobody uses them there, and the release ships CV-1 to CV-4 together, so nothing of v1's interface ships next to v2's.

### 1.1 Screens and components (`src/features/chat/ui/*`, `src/routes/pages/chat-page.tsx`)

All retire (REPLAN round 2: "the screens go entirely"). What each one hands over is a behaviour to re-test, never code.

| v1 part | Lines | Verdict | Replaced by | Salvage | Effort to retire | When |
| --- | --- | --- | --- | --- | --- | --- |
| `chat-page.tsx` (route page) | 802 | **Re-scope** | A thin page adapter for `/chat` (AGENTS.md: no new routes), mounting the 3×3 layout | The `?c=` / `?m=` / `?t=` search params become `?c=` / `?m=` (a chain opens from the message) | S | CV-4 |
| `chat-sidebar.tsx` | 250 | Retire | NavRow + GroupHeader + MetaCount (CH5) | — | S | CV-4 |
| `message-list.tsx` | 217 | Retire | `MessageStream` on TanStack Virtual (§6 #18) | The "load older near the top" trigger, as a test case | S | CV-4 |
| `message-item.tsx` | 515 | Retire | The message row, north-star piece (CH29, CH29f) | Mark unread, ↑ edits your last, emoji-only "jumbo" rows: as test cases | S | CV-4 |
| `message-body.tsx` | 150 | Retire | The parsed tree drawn with RF-1's `Reference` (§6 #3, #4) | — | S | CV-4 |
| `composer.tsx` | 595 | Retire | The shared Lexical editor with RF-1's menus (CH15, CH29g) | Drafts per conversation kept across reloads (`composer.tsx:48-70`): the rule carries, the code doesn't | S | CV-4 |
| `conversation-header.tsx` | 274 | Retire | The toolbar grammar (A7) | — | S | CV-4 |
| `side-panels.tsx` | 374 | Retire | Chat's views in the panel registry (§6 #8) | — | S | CV-4 |
| `chat-dialogs.tsx` | 635 | Retire | New conversation, Browse channels, Details settings (round 5 surfaces) | Browse's "Archived" toggle, as a test case | S | CV-4 |
| `chat-locked.tsx` | 102 | Retire | The paused line in the composer's place (CH4a) | — | S | CV-4 |
| `emoji-picker.tsx` | 126 | Retire | Frimousse with self-hosted Emojibase data (§6 #20) | — | S | CV-4 |
| `person-avatar.tsx` | 55 | Retire | The kit's `PersonAvatar` (§5) | — | S | CV-4 |
| `chat.stories.tsx` | 360 | Retire | One story per north-star piece (AGENTS.md: primitives need stories) | Its fixture conversations, as story data | S | CV-4 |
| Home "Conversations" widget (`widget.ts`, `dashboard/ui/widgets/chat-widget.tsx`) | 60 + 179 | Retire | "Catch up" widget + Chat's line in the one "Team" widget (CH35, CH70) | "What needs you first" ordering, as a test case | S | CV-16 |
| Settings → chat caps panel (`features/sharing/chat-caps-panel.tsx`) | 98 | **Re-scope** | Chat's rows inside the role editor; "Start calls" hidden until Meet ships (§6 #11) | The panel's switch list | S | CV-11 |

### 1.2 State, hooks and Realtime

| v1 part | Lines | Verdict | Replaced by | Salvage | Effort | When |
| --- | --- | --- | --- | --- | --- | --- |
| `hooks/use-chat-module.ts` (page state) | 989 | Retire | `ChatStore`, a sibling on TV-D11a's pattern (§6 #2, #17) | Its behaviours become the store's test list (optimistic send, resync, mark unread, General join) | M (the test list) | CV-1 (store), deleted in CV-4 |
| `hooks/use-chat-badge.ts` | 95 | Retire | The store's unread slice + Tauri badge + tab title (blueprint §8) | The muted/archived rules, as test cases | S | CV-3 |
| `hooks/use-chat-live.ts` | 32 | **Salvage** | Typing and presence in their own small stores (blueprint §11) | The pattern (a separate store so typing redraws no row) | S | CV-1 |
| `realtime.ts` | 290 | **Re-scope** | The store's live merge: rows applied from the event with zero requests; typing on one topic per conversation; presence errors shown, not swallowed (§6 #19) | The ref-counted shared link per workspace | M | CV-1 |
| `src/lib/runtime.chat.web.ts` (runtime seam) | 294 | **Re-scope** | The store's ops and reads: keyset pages by `(created_at, id)`, delta reads by `updated_at`, client-minted ids (§6 #2) | The "check `error`, never throw" discipline | M | CV-1 |
| `src/lib/entity-open.ts` (`chat_channel` case) | — | **Re-scope** | Opens the conversation **at the message** (and its chain) from `payload.message_id` (trust bug 6) | — | S | CV-3 |

### 1.3 Pure logic (unit-tested)

| v1 part | Lines | Verdict | Becomes | Effort | When |
| --- | --- | --- | --- | --- | --- |
| `markup.ts` + `markup.test.ts` | 257 + 139 | **Salvage** | Its `Block` / `Inline` tree shape is the new parser's (blueprint §2.2), swapped to the Markdown subset + `moduo://` URIs; its token list is what the SQL converter rewrites (§2.6); its tests join the parity corpus (spike 4) | M | CV-0 (spike 4), CV-1 |
| `timeline.ts` + test | 210 + 213 | **Re-scope** | Grouping, day separators and the "New" line on `(created_at, id)`; the badge formula becomes "addressed to you" (CH5, CH6) | M | CV-4 |
| `mappers.ts` | 114 | Re-scope | Mappers for the new columns | S | CV-1 |
| `model.ts` | 145 | Re-scope | Types for the store; the `ChatRuntime` interface is replaced by the store's API | S | CV-1 |
| `emoji.ts` | 196 | Retire | Emojibase data through Frimousse; "is this emoji-only" moves into the parser | S | CV-4 |
| `search.ts` + test | 24 + 14 | Retire | `chat_search` on the server (§6 #7) | S | CV-13 |
| `ops-manifest.ts` | 41 | **Re-scope** | The v2 op list (§2.3) and agent ops (§6 #25) | S | CV-15 |

### 1.4 The server (tables, helpers, triggers, ops)

| v1 part | Verdict | What changes | Effort | When |
| --- | --- | --- | --- | --- |
| `chat_channels` | **Keep** | Columns added (§2.1) | — | CV-1 |
| `chat_members` | **Keep** | Columns added; leaving becomes a stamp instead of a deleted row (§2.1) | — | CV-1 |
| `chat_messages` | **Keep** | Columns added; the stored text changes form (§2.1, §2.6) | — | CV-1 |
| `chat_channel_managers` | **Keep** | Ops to add and remove managers (§6 #11) | — | CV-11 |
| `workspace_chat_caps` | **Keep** | One switch added (custom emoji, CH16b); "Start calls" hidden in the app, column kept | — | CV-14 |
| `chat_workspace_enabled` | **Re-scope** | Reads the workspace's effective plan, so a dated grant opens chat (CH25, CH67) | S | CV-2 |
| `chat_can_read_channel` (the RLS read rule) | **Re-scope** | Reading no longer needs the plan (CH4a: history stays readable when chat is paused); people who left and deleted channels drop out | S | CV-1 |
| `chat_can_access_workspace`, `chat_is_workspace_member`, `chat_op__guard`, `chat_op__channel` | Keep | `chat_op__guard` keeps the plan check for writes | — | — |
| `chat_is_workspace_admin` | **Re-scope** | Ops ask "Manage any channel" / "Delete others' messages" or the channel's managers instead (§6 #11) | S | CV-1 |
| `chat_normalize_channel_name` | **Retire** | Names as typed (CH3a); replaced by a trim-and-length check | S | CV-1 (unused), dropped after one release |
| `chat_realtime_topic_allowed` + its two `realtime.messages` policies | **Re-scope** | Two topic families: the workspace's presence topic, and one typing topic per conversation readable only by its members (§2.7) | S | CV-1 |
| `chat_unread_counts` | **Re-scope** | Counts replies too (they're ordinary messages now), reads the mark as a message, returns the "addressed to you" number (CH5) | S | CV-1 |
| `chat_key_scope` | **Re-scope** | Reads KEYS-1's effective scope (capped by the creator) | S | CV-15 |
| `chat_has_cap` | Keep | — | — | — |
| `chat_caps_get` / `chat_caps_set` | **Re-scope** / keep | `chat_caps_get` redefined from its live body (the role editor reads it) | S | CV-1 |
| `share_op_announce` | **Retire** | Replaced by `chat_op_set_announcement` (§2.3) | S | CV-11, dropped after one release |
| Trigger `share_chat_channel_guard` | Keep | General is found by its flag, not by its name | S | CV-1 |
| Trigger `share_chat_message_guard` | **Re-scope** | "Mention everyone" reads the parsed flag, not words in the text (audit A24); event lines pass | S | CV-1 |
| Trigger `perm_enforce_write('chat')` | Keep | Already fires on message insert, update and delete, and on channel insert (checked in the catalog) | — | — |
| Every `chat_op_*` (18) | **Re-scope** | One by one in §2.3 | L in total | CV-1 onward |

### 1.5 MCP tools (`supabase/functions/moduo-mcp/modules/chat.ts`)

| v1 tool | Verdict | v2 (§6 #25) | Effort | When |
| --- | --- | --- | --- | --- |
| `chat_list_channels` | **Re-scope** | "List conversations": public channels, plus private ones the creator is in when the key's "Include private channels I'm in" is on (CH18); names as typed (a name lookup can't lower-case any more) | S | CV-15 |
| `chat_read` | **Re-scope** | "Read a conversation or a chain": the v2 stored form, chains instead of threads | S | CV-15 |
| `chat_search` | **Re-scope** | Calls the server's `chat_search` as the key's creator instead of a hand-filtered query | S | CV-15 |
| `chat_post` | **Re-scope** | Posts as the key's creator "via <key>" (§6 #12), replies with the quote, rate-limited | S | CV-15 |
| — | **New** | React; what's addressed to me (never direct messages); mark a decision; wrap up; create a channel | M | CV-15 |

The deployed connector keeps working on the converted data until CV-15 redeploys it: it reads public channels by id, and the converted text is plain Markdown. Lookups by a name with capitals fail until then (§5 risk 9).

### 1.6 Tests and docs

| v1 part | Verdict | Becomes |
| --- | --- | --- |
| Unit tests (`markup`, `timeline`, `search`, `widget`, `use-chat-live`, `use-chat-module`) | **Salvage** as cases | The parity corpus (spike 4), the store's tests, the stream's redraw test (blueprint §11) |
| SQL tests | **New** | `supabase/tests/chat_*.test.sql` per data block (owner, member, viewer, outsider; `bun run db:test chat`), like `comments.test.sql` |
| End-to-end and perf | **New** | `tests/chat-*.spec.ts` (two contexts, waiting for "Subscribed to PostgreSQL"); `tests/perf/chat-10k.spec.ts` + `scripts/perf/seed-chat-10k.ts` (§6 #22) |
| `specs/chat.md` | **Keep, with a banner** | "Superseded by `specs/chat-v2.md`" (REPLAN §9 step 6) |
| `docs/testing/chat.md` | Retire | The v2 checklist per block |

---

## 2. The database change list

### 2.1 The five chat tables kept, and their new columns

Every column below has its reason as a call or a §6 decision. Nothing is renamed: a rename would break every function body and the deployed connector for no gain anyone sees (**my choice**; rejected: renaming `parent_id` → `chain_root_id` and `starred` → `pinned`).

**`chat_channels`**

| Column | Type | Why |
| --- | --- | --- |
| `updated_at` (exists) | now stamped by a trigger with `clock_timestamp()` (the `zz_stamp_updated_at` pattern) | §6 #2: delta reads; gotchas §Supabase: a client clock never orders rows |
| `is_default` | `boolean not null default false`, one per workspace | §6 #9, CH37: General is found by a flag, since names are now as typed (CH3a) and can be renamed |
| `linked_type`, `linked_id` | `text` (closed: `bucket`, `company`, `contact`, `team`), `uuid`; both set or both null | CH2, CH11, CH56, CH57: a channel links to at most one thing |
| `deleted_at`, `deleted_by` | `timestamptz`, `uuid` | CH62: Recently deleted for 30 days |
| `name` | unchanged column; names are stored as typed (trimmed, 1–80 characters); the unique index ignores deleted channels | CH3a, CH62 |
| `is_private` | unchanged column; may now go `false → true`, never back | CH59 |

Unchanged: `kind`, `topic` (≤ 250), `dm_key`, `created_by`, `archived_at`, `last_message_at`, `managers_only` (the announcement switch, CH23a).

**`chat_members`**

| Column | Type | Why |
| --- | --- | --- |
| `last_read_id` | `uuid` | §6 #17: the read mark is the last message seen, compared as `(created_at, id)`, so equal timestamps can't fall either side of it. `last_read_at` stays as its time |
| `left_at`, `removed_by` | `timestamptz`, `uuid` | §6 #9 (leaving General is remembered on the server), CH61 (removal), CH36. Leaving or being removed stamps the row instead of deleting it |
| `updated_at` | `timestamptz` + the stamp trigger | §6 #2, and so a removal reaches the removed person live as an update of their own row |

Unchanged: `notify_level` (`all` · `mentions` · `none`, shown as Every message · Mentions and replies · Nothing, CH7), `starred` (shown as "Pin to sidebar", CH3), `joined_at`.

**`chat_messages`**

| Column | Type | Why |
| --- | --- | --- |
| `updated_at` | `timestamptz not null` + the stamp trigger; every edit, delete, reaction, pin, reply count, decision, wrap-up and move moves it | §6 #2: one delta read sees every change |
| `body` | unchanged column; the stored form becomes the Markdown subset with `moduo://` references (§2.6). Limit stays 8,000 characters of stored text, references included (**my choice**; rejected: a second "visible length" limit) | §6 #3, CH15 |
| `format_version` | `smallint not null default 2`; v1 rows are `1` until converted | §6 #3, #26: the conversion is idempotent by it |
| `body_text` | `text`: the body with syntax and URIs stripped, kept by the stamp trigger | §6 #7 (search), §6 #3 (excerpts built on the server) |
| `search_tsv` | `tsvector`, generated and stored: `to_tsvector('simple', chat__unaccent(body_text))` | §6 #7 |
| `parent_id` | unchanged column; now means **the chain's root**. Replies are ordinary messages in the stream | CH30a, CH30d |
| `reply_to_id` | `uuid`, the message a reply quotes (the root or a reply in its chain) | CH30d: "a normal message with a one-line quote" |
| `v1_thread_reply` | `boolean not null default false` | §6 #26: a converted v1 reply counts as read for whoever had read its root |
| `kind`, `event` | `text not null default 'message'` (closed: `message`, `event`), `jsonb` | CH30c: the quiet "moved" line lives in the stream, in order, synced like any row (§2.19) |
| `mentioned_team_ids`, `mentions_everyone` | `uuid[]`, `boolean` | CH7: `@Team` and `@channel`. Like `mentioned_user_ids`, read from the stored text **on the server**, never taken from the client |
| `api_key_id` | `uuid` | §6 #12, #25: an agent's post is its creator's, made through this key |
| `decision_at`, `decision_by` | `timestamptz`, `uuid` | CH13, CH52, CH53 |
| `wrapped_at`, `wrapped_by`, `settled_id`, `reopened_at`, `reopened_by` | on a chain's root | CH30d, CH53, CH54 |
| `moved_at`, `moved_by`, `moved_from_channel_id` | | CH30c, CH55 |
| `reactions` | unchanged shape (`{key: [user ids]}`); keys widen to any emoji or a custom one (§2.8) | CH16a, CH16b |
| `client_id` | kept for v1 rows; v2 sends mint the **message id** itself | §6 #2 (blueprint §3.5) |

An agent's post (§6 #12): `author_id` is the key's creator, `author_kind = 'api_key'`, `author_label` = the key's name, `api_key_id` set. v1's agent rows keep a null author: v1 stored no key id, so they read as "<key name> (app)".

**`chat_channel_managers`**: unchanged; gains ops to add and remove managers (§2.3). **`workspace_chat_caps`**: gains `add_emoji boolean` (on for admins and members, off for viewers; CH16b's role switch). `start_calls` stays as a column and leaves the screens until Meet ships (§6 #11).

### 2.2 New tables

| Table | One row per | Columns (main) | Read by (RLS) | Live | Why |
| --- | --- | --- | --- | --- | --- |
| `chat_catchup` | person × thing addressed to them | `workspace_id, user_id, channel_id, message_id?, chain_root_id?, reason, actor_id?, activity_id?` (its bell twin), `created_at, held_at` (set when the gate dropped the device notice: never emailed, CH74), `done_at, done_how, later_until, later_notified_at, emailed_at, updated_at` | its person only | published, filtered by person | CH8, CH38, CH51, CH61, §6 #26 (the level-reset line) |
| `chat_chain_mutes` | person × chain | `user_id, root_id, workspace_id, created_at` | its person only | no | "Stop following" a chain (gap audit, smaller gaps; CH30d) |
| `chat_custom_emoji` | workspace × emoji | `id, workspace_id, name, storage_path, poster_path, mime, width, height, bytes, animated, created_by, created_at, updated_at, deleted_at` | members of the workspace (plan not required, CH4a) | published, filtered by workspace | CH16b, §6 #20 |
| `user_statuses` | person | `user_id, emoji, text, dnd, clear_at, preset, set_at, updated_at` | anyone who shares a workspace with the person | published | CH28c, CH28d, CH45 (one status for every workspace) |
| `user_saved_statuses` | person × saved status | `id, user_id, emoji, text, dnd, clear_after, position, created_at` | its person only | no | CH28d |
| `user_clients` | person × device (app or browser) | `id` (client-minted install id), `user_id, surface` (`desktop` · `web`), `last_seen_at, last_active_at, user_agent` | its person only | no | One device rings; the email after an hour (CH43, §6 #6) |

`chat_catchup.reason` is closed: `dm`, `mention`, `team_mention`, `everyone`, `reply`, `announcement`, `every_message`, `reminder`, `added`, `removed`, `level_reset`. `done_how`: `done` (Catch up's Done), `read` (read in the conversation), `bell` (dismissed in the bell), `closed` (the channel was archived, deleted or made private without you). Every new table: writes only through ops, RLS on, grants re-stated (`REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT SELECT … TO authenticated`), covered by account erasure (§2.25 h).

**Other modules' tables this list extends**

| Table | Change | Why |
| --- | --- | --- |
| `comment_reactions` (TV-U13) | the six-word CHECK widens to the shared reaction key; the six words become their emoji | CH16a, CH49 (§2.8) |
| `user_preferences` (TV-D14's store) | `quiet_hours_on`, `quiet_from`, `quiet_to`; `reaction_row text[]`; `show_online`; `show_focus_task`; `notice_show_text`; `email_when_away`. All op-only, like Time & region | CH41, CH16a, CH9, CH47, CH33, CH43 |
| `notice_deliveries` (TV-D12) | `kind` widens to chat's kinds; adds `channel_id, message_id, tag, push_after, acked_at, held_for_focus` | CH6, CH7, CH39, §6 #6 (§2.14) |
| `workspace_members` | `notices_paused_at timestamptz` | CH46 |
| `attachments` (AT-1) | accepts `entity_type = 'chat_message'` (access follows the message's conversation); `deleted_reason` gains `chat_message` | CH17 |
| `entity_links` | `relation_kind` gains `conversation-of` | §6 #5, CH2, CH11 |
| `email_outbox` (TX-3) | `kind` gains `chat_waiting` | CH43 |
| `workspace_api_keys` (KEYS-1) | `include_private_chat boolean` ("Include private channels I'm in") | CH18 (§2.25 f) |

### 2.3 Ops: changed, added, retired

Every op is `SECURITY DEFINER`, pinned `search_path`, grants re-stated by name (`REVOKE … FROM PUBLIC, anon`; supabase/AGENTS.md), and redefined from its **live body**. Every op writes one attributed activity row except a plain send (§2.25 c). The **Who** column refers to the roles in §2.4: *Admin* = the workspace owner or a role with "Manage any channel"; *Manager* = the channel's managers; *Poster* = anyone who can post in that conversation; *Reader* = anyone who can read it (viewers included).

**Changed: the 18 v1 ops**

| Op | What changes | Who | Calls |
| --- | --- | --- | --- |
| `chat_op_bootstrap(ws)` | Makes General (`is_default`) if missing and joins every current member who hasn't left it. Called once per workspace by the store when it holds no General, never on every open | Any member with chat | §6 #9, CH37 |
| `chat_op_create_channel(ws, name, topic, is_private, member_ids, announcement, link_type, link_id)` | Names as typed; the creator joins at Mentions and replies (no forced Every message); optional announcement switch and link; registers the channel for ⌘K | Holders of "Create public / private channels" | CH3a, CH23a, CH56, §6 #15, #26 |
| `chat_op_open_dm(ws, user_ids)` | As v1 (≤ 9 people, one per set of people); registers it; the opener must be able to post | Posters | G26 (viewers receive, don't start) |
| `chat_op_update_channel(channel, name, topic)` | Rename: managers and admins. Topic: anyone who can post there. Names as typed; the registry label follows | Rename: Manager, Admin · Topic: Poster | CH3a, §6 #11 |
| `chat_op_archive_channel(channel, archived)` | Managers and admins; open Catch up items of that channel close (`done_how = closed`) | Manager, Admin | §6 #11, G26 |
| `chat_op_join(channel)` | Public channels; clears `left_at`; viewers may join to follow a channel | Reader | §6 #9 |
| `chat_op_leave(channel)` | Stamps `left_at` (leaving General sticks). A last manager leaving hands it to the workspace owner if they can read the channel, else its earliest remaining member (the erasure's rule) | Member of it | §6 #9, #27 |
| `chat_op_add_members(channel, user_ids)` | Public: any poster. Private: managers and admins. Writes a quiet `added` Catch up line (**my choice**, mirrors CH61) | Public: Poster · Private: Manager, Admin | CH58 |
| `chat_op_remove_member(channel, user)` | Stamps `left_at` + `removed_by`; a quiet `removed` Catch up line, no ping | Manager, Admin | CH61 |
| `chat_op_send(id, channel, body, reply_to_id)` | Client-minted `id` (a retry with the same id returns the stored row); v2 stored form; mentions, teams and `@channel` read from the text on the server; excerpts built on the server; a reply joins the root's chain and reopens it if wrapped; the fan-out of §2.14; "Mentioned in" links (§2.21); the sender's read mark moves to it | Poster (managers only in an announcement channel) | §6 #2, #3, #5, CH6, CH30d, CH54 |
| `chat_op_edit(message, body)` | v2 form; mentions re-read; a person named for the first time hears it once, nobody else (**my choice**, as `comments_op_edit` does; ❓ for Maciej in the final report) | Author | §6 #23, D28 |
| `chat_op_delete(message)` | Hides at once; a minute job blanks the text, mentions, reactions and pin once the 8 s Undo has passed; files go to the trash clock | Author · others': "Delete others' messages" | §6 #10, D7 |
| `chat_op_react(message, key, on)` | Explicit on/off (idempotent, like `comments_op_react`) instead of a toggle; widened keys; ≤ 20 kinds; never notifies | Reader (viewers too) | CH16a, CH60 |
| `chat_op_pin(message, pinned)` | Messages only, not event lines; ≤ 100 per conversation | Poster | CH3 |
| `chat_op_mark_read(channel, message_id)` | Takes the last message seen and moves the mark forward to it, never by clock; closes Catch up items up to it and their bell twins | Member of it | §6 #17, CH38 |
| `chat_op_mark_unread(channel, message_id)` | Moves the mark to just before that message; Catch up untouched | Member of it | D29 |
| `chat_op_set_prefs(channel, level, pinned)` | Levels as v1; `starred` is "Pin to sidebar" | Member of it | CH3, CH7 |
| `chat_op_agent_post(ws, channel, body, reply_to_id)` | Authored by the key's creator "via <key>"; private channels only with the key's "Include private channels I'm in" and the creator a member; never DMs; capped by the creator's switches; 30 posts a minute per key; same fan-out | Service role, for a key with Chat: Edit | CH18, §6 #12, #25 |

Changed reads and helpers: `chat_unread_counts(ws)` (counts replies, reads the mark as a message, returns the "addressed to you" number per conversation, CH5), `chat_workspace_enabled(ws)` (the grant, CH25), `chat_can_read_channel` (no plan needed to read, CH4a; people who left and deleted channels drop out), `chat_realtime_topic_allowed` (§2.7), `chat_caps_get(ws)` (redefined from its live body), the guard trigger `share_chat_message_guard` (§1.4).

**Added: 20 writes**

| Op | What it does | Who | Calls |
| --- | --- | --- | --- |
| `chat_op_restore(message)` | Undo a delete inside the window | As delete | §6 #10 |
| `chat_op_set_announcement(channel, on)` | The announcement switch after creation; channels only, never DMs. Replaces `share_op_announce` | Manager, Admin | CH23a, §6 #11 |
| `chat_op_set_manager(channel, user, on)` | Add or remove a manager; the person must be in the channel; the last manager can't be removed | Manager, Admin | §6 #11 |
| `chat_op_make_private(channel)` | Public → private, one way; keeps the current members | Manager, Admin | CH59 |
| `chat_op_delete_channel(channel)` | Into Recently deleted for 30 days; General can't be deleted (**my choice**); DMs use leave | Manager, Admin | CH62 |
| `chat_op_restore_channel(channel)` | Back from Recently deleted | Manager, Admin | CH62 |
| `chat_op_link_channel(channel, type, id \| null)` | Link or unlink; the caller must see the item; one link per channel | Poster (**my choice**, G14) | CH2, CH11 |
| `chat_op_mark_decision(message, on)` | Mark or unmark a decision | Poster (**my choice**, G15) | CH13, CH52 |
| `chat_op_wrap_up(root, settled_id, mark_decision)` | Wrap up a chain with the reply that settled it; optionally mark that reply as a decision | Root's author, Manager, Admin; in a DM either person | CH30d, CH53 |
| `chat_op_reopen(root)` | "Reopen" in the chain (a new reply also reopens, through send) | As wrap up | CH54 |
| `chat_op_attach_to_chain(message, reply_to_id)` | "Reply to…": attach a stray message to a chain in the same conversation | Own messages: Author · others': Manager, Admin | CH30, CH30c |
| `chat_op_move_messages(ids, target_channel, confirm)` | Move to another conversation under CH55's audience rule; without `confirm` it only answers how many people would newly see them | Own: Author · others': Manager, Admin, same or narrower audience only | CH30c, CH55 (§2.19) |
| `chat_op_catchup_done(item_ids)` | Done; dismisses the bell twins | Its person | CH8, CH38 |
| `chat_op_catchup_reopen(item_ids)` | Undo of Done | Its person | DF-5 |
| `chat_op_remind(message_id \| channel_id, at)` | Later and Remind me (one mechanism); `null` clears | Its person (a reader of the conversation) | CH8, CH51 |
| `chat_op_follow_chain(root, following)` | "Stop following" / follow again | Reader | CH30d |
| `chat_op_typing(channel, stopped)` | Sends the typing event, sender from the session (§2.7) | Member of it | §6 #19 |
| `chat_op_register_message(message)` | A label-less registry row, so a task's "From:" link (CH10) or a reference card can point at a message | Reader | CH10, §6 #4 |
| `chat_op_custom_emoji_add(ws, name, path, poster_path, mime, width, height, bytes, animated)` | Adds a custom emoji after the upload (§2.9) | Holders of the new custom emoji switch | CH16b |
| `chat_op_custom_emoji_remove(id)` | Soft-deletes it | Its adder, Admin | CH16b |

**Added: 10 reads**

| Read | Answers | Calls |
| --- | --- | --- |
| `chat_search(ws, query, channel?, before?, limit)` | Messages you can read, newest first, with a highlighted snippet (§2.5) | §6 #7 |
| `chat_sync_ids(ws)` | The ids of conversations you can read and of your memberships: the store's access check | §6 #2, D11a-6 |
| `chat_people(ws)` | Names and avatars of everyone who wrote in or belongs to a conversation you can read; former members flagged | CH36 |
| `chat_now(ws)` | Per member: status, "Focusing", "until", the task only with the opt-in and only if you can see it, quiet hours now and "back at" | CH28b, CH42, CH47, CH70 (§2.13) |
| `chat_message_refs(ids)` | A message's chip and card (author, conversation, time, first words) for messages you can read; nothing for the rest ("Private item") | §6 #4 |
| `chat_conversations_for_item(type, id)` | The linked conversation and the "Mentioned in" lines you can read, with your unread count | CH11 |
| `chat_decisions_for_item(type, id)` | Decisions from conversations you can read that are linked to or mention the item | CH13, CH52 |
| `chat_recently_deleted(ws)` | Deleted channels you may restore | CH62 |
| `chat_files(channel, before, limit)` | The Files view | CH17 |
| `chat_key_readers(channel)` | Whether an app of someone in this private channel can read it ("An app of Alex's can read this") | CH18 |

**Added: 8 person-level ops** (not chat-prefixed; they serve every module): `user_op_set_chat_prefs(patch)` with the read `user_chat_prefs()` (quick reaction row, show me as online, show what I'm focusing on, show message text, email when away), `user_op_set_status`, `user_op_clear_status`, `user_op_save_status`, `user_op_forget_status` (§2.11), `workspace_op_pause_notices(ws, paused)` (§2.12), `user_op_client_seen(client_id, surface, active)` and `notice_op_ack(ids)` (§2.14).

**Other modules' functions redefined from their live bodies:** `perm_can_see_entity` and `spine__visible_to` (chat branches) and the `entity_links` read policy (§2.25 a), `user_op_set_time_region` + `user_time_region` + `user_preferences__time_region_guard` (quiet hours, §2.10), `comments_op_react` (§2.8), `notifications_op_dismiss` / `_undismiss` (§2.15), `notice_deliveries__claim` (§2.14), `attachments_op_begin` / `_finalize` / `_delete` / `_restore` and the attachments policies (§2.25), `account_erase_workspace_data` (§2.25 h).

**Server-only functions and jobs:** the stamp triggers; `chat__v1_to_v2(text)` (the conversion), `chat__body_text(text)`, `chat__unaccent(text)`; `notice__gate(user, ws, kind, at)` (§2.14 f); jobs `chat-blank-deleted` (every minute), `chat-later` (every minute, Remind me), `chat-waiting-emails` (every 5 minutes), `user-statuses-expire` (every 5 minutes), `chat-purge-deleted` (daily, beside AT-1's `purge-deleted`); a trigger on `notice_deliveries` (push at once) and one on `focus_runs` (Focus ended); a trigger on `workspace_members` insert (join General).

**Retired**

| What | When | Instead |
| --- | --- | --- |
| `share_op_announce(channel, on)` | Unused from CV-11; dropped one release later | `chat_op_set_announcement` |
| `chat_normalize_channel_name(text)` | Unused from CV-1; dropped one release later | A trim-and-length check (CH3a) |
| The v1 signatures of `chat_op_send` (7 args) and `chat_op_edit` (3 args) | Kept for **one release** as thin wrappers: they convert v1 markup with `chat__v1_to_v2` and call the v2 op, so a desktop build from before `min_build` existed can still send; dropped once `min_build` is past them | The v2 signatures (**my choice**; rejected: dropping them at once, which turns every not-yet-updated desktop's send into "function not found") |
| `client_id` as the idempotency key | New sends stop writing it; the column stays for v1 rows | The client-minted message id |

### 2.4 Who may do what (the permissions table, §6 #27)

*Admin* = the workspace owner, or a role with "Manage any channel" (admins by default). "Delete others' messages" and "Mention everyone" are their own switches (PERM-7). *Member* = a role that can post. *Viewer* = a read-only role.

| Action | Admin | Manager | Author | Member | Viewer | From |
| --- | --- | --- | --- | --- | --- | --- |
| Read a public channel; join it | ✓ | ✓ | — | ✓ | ✓ | v1 |
| Post, reply | ✓ ¹ | ✓ | — | ✓ ¹ | — | PERM-7, D3 |
| React | ✓ | ✓ | — | ✓ | ✓ | CH60 |
| Start a direct message | ✓ | — | — | ✓ | — (receives) | G26 |
| Edit a message | — | — | own | — | — | v1 |
| Delete a message | anyone's ² | own | own | own | — | D7, §6 #10 |
| Pin, unpin | ✓ | ✓ | — | ✓ | — | my choice |
| Mark, unmark a decision | ✓ | ✓ | — | ✓ | — | my choice (G15) |
| Wrap up, reopen a chain | ✓ | ✓ | root's author | in a DM: anyone in it who can post | — | CH30d |
| Reply to… / move own messages | ✓ | ✓ | own | own | — | CH30c, CH55 |
| Reply to… / move others' messages (same or narrower audience) | ✓ | ✓ | — | — | — | CH30c, CH55 |
| Link, unlink the channel | ✓ | ✓ | — | ✓ | — | my choice (G14) |
| Rename | ✓ | ✓ | — | — | — | §6 #11 |
| Topic | ✓ | ✓ | — | ✓ | — | my choice |
| Archive, unarchive | ✓ | ✓ | — | — | — | G26 |
| Delete, restore a channel | ✓ | ✓ | — | — | — | CH62 |
| Make private | ✓ | ✓ | — | — | — | CH59 |
| Announcement switch | ✓ | ✓ | — | — | — | CH23a |
| Add people to a public channel | ✓ | ✓ | — | ✓ | — | D4 |
| Add people to a private channel | ✓ | ✓ | — | — | — | CH58 |
| Remove people | ✓ | ✓ | — | leave only | leave only | D4, CH61 |
| Add, remove managers | ✓ | ✓ | — | — | — | §6 #11 |
| `@channel` | with "Mention everyone" (admins and members by default) | | | | — | CH7 |
| Create a channel | with "Create public / private channels" | | | | — | PERM-7 |
| Add a custom emoji | with the new switch (admins and members by default) | | | | — | CH16b |
| Remove a custom emoji | ✓ | — | own | — | — | CH16b |

¹ Not in an announcement channel unless they're one of its managers (an admin can make themselves one). ² With "Delete others' messages". **Agents** act as their creator and never get more (KEYS-1), and never see direct messages (CH18). **The last manager** can't remove themselves as manager; if they leave the channel, it passes on as in `chat_op_leave`.

### 2.5 Indexes, and full-text search

| Table | Index | For | Replaces |
| --- | --- | --- | --- |
| `chat_messages` | `(channel_id, created_at, id)` | The stream's keyset pages in both directions; replies and event lines included | `chat_messages_channel_idx` (top-level only) |
| `chat_messages` | `(parent_id, created_at, id) where parent_id is not null` | A chain on the right | kept (`chat_messages_thread_idx`) |
| `chat_messages` | `(workspace_id, updated_at, id)` | Delta reads (§6 #2) | — |
| `chat_messages` | GIN `(search_tsv) where deleted_at is null` | `chat_search` | — |
| `chat_messages` | `(channel_id, pinned_at desc) where pinned_at is not null and deleted_at is null` | Pinned, in Details | — |
| `chat_messages` | `(channel_id, decision_at desc) where decision_at is not null and deleted_at is null` | Decisions, in Details and on items | — |
| `chat_messages` | `(channel_id, last_reply_at desc) where reply_count > 0 and deleted_at is null` | The "Reply chains" view | — |
| `chat_messages` | `(deleted_at) where deleted_at is not null and body <> ''` | The minute job that blanks deleted messages | — |
| `chat_channels` | unique `(workspace_id, lower(name)) where kind = 'channel' and deleted_at is null` | Names unique ignoring case, among live channels | `chat_channels_name_uq` |
| `chat_channels` | unique `(workspace_id) where is_default` | One General | — |
| `chat_channels` | `(workspace_id, updated_at, id)` | Delta reads | — |
| `chat_channels` | `(linked_type, linked_id) where linked_id is not null` | An item's conversation (CH11) | — |
| `chat_channels` | `(deleted_at) where deleted_at is not null` | The 30-day purge | — |
| `chat_members` | `(user_id, workspace_id, updated_at)` | Delta reads of your memberships | — |
| `chat_catchup` | `(user_id, workspace_id, created_at desc) where done_at is null` | Catch up and every count | — |
| `chat_catchup` | `(user_id, channel_id, created_at) where done_at is null` | Closing items when you read a conversation | — |
| `chat_catchup` | `(later_until) where done_at is null and later_notified_at is null` | Remind me / Later coming back | — |
| `chat_catchup` | unique `(user_id, message_id, reason) where message_id is not null` | One item per message and reason, whatever retries | — |
| `user_statuses` | `(clear_at) where clear_at is not null` | Expiring statuses | — |
| `notice_deliveries` | `(push_after) where pushed_at is null and acked_at is null` | Push after the hold (§2.14) | — |

`develop` (Mike's `20261009180000_index_foreign_keys`, not on this branch yet) adds four plain chat foreign-key indexes (`chat_members_workspace_id_idx`, `chat_messages_workspace_id_idx`, `chat_channels_created_by_idx`, `chat_messages_pinned_by_idx`). Chat's migrations use other names and `if not exists`, so the two merge cleanly; once both are in, the delta index covers `chat_messages.workspace_id` and the plain one can go in a later cleanup.

**Full-text search (§6 #7, blueprint §7):**
- `unaccent` **isn't installed** on the local stack, but it is available there (1.1, catalog checked 2026-10-13) as on hosted projects. The foundation migration runs `create extension if not exists unaccent with schema extensions`.
- `chat__unaccent(text)` is an `IMMUTABLE` SQL wrapper that names the dictionary schema-qualified (`extensions.unaccent('extensions.unaccent'::regdictionary, $1)`): a generated column needs an immutable function, and `unaccent` alone isn't. "zolw" finds "żółw".
- `search_tsv = to_tsvector('simple', chat__unaccent(coalesce(body_text, '')))`, stored, with the GIN index above. A reference adds no words (its title isn't stored, RF-1-2): ⌘K finds the item itself.
- `chat_search` (`SECURITY DEFINER`): `websearch_to_tsquery('simple', …)` with each word made a prefix; the index first, then `chat_can_read_channel` per match, as the key's creator for an agent, until the limit (the `tasks_search` pattern, D11B-5); newest first; `ts_headline` over `body_text`; at most 50 rows. ⌘K, a conversation's Search and the MCP tool all call it.
- People are found through the member list and `chat_people`, never through message text.

### 2.6 Converting v1's live data (§6 #26)

**What converts, and how.** One migration, `…_chat_v2_convert_v1`, in SQL, idempotent step by step.

| v1 data | Becomes | How | Idempotent by |
| --- | --- | --- | --- |
| Bodies in v1 markup | The v2 stored form | `chat__v1_to_v2(body)`, an `IMMUTABLE` function that rewrites v1's tokens: `<@id>` → the person URI, `<!channel>` → the `@channel` token, `<moduo:TYPE:ID\|Label>` → `moduo://TYPE/ID` (the label goes), `_italic_` → `*italic*`; bold, strike, code, quotes and links are already Markdown. Then `body_text` is filled and `search_tsv` follows | `format_version = 1 → 2` |
| v1 thread replies | Chain replies at their own times, in the stream | `parent_id` already names the root; `v1_thread_reply = true`; `reply_to_id` stays null (they quote the root). A converted reply counts as unread for a person only if its root does: the one extra rule in `chat_unread_counts` and the "New" line | the flag |
| Notes-to-self conversations (a DM with one person) | A private note per person and workspace, "Notes to self (from Chat)", the messages in order with their dates | Written straight into Notes' tables as its owner (a migration has no session), with the live table's columns (into the person's Notes Inbox if NR-1's `in_inbox` has landed, §4), registered in `entities`; the DM is then marked deleted and purged after 30 days (nobody needs to restore it: the note holds its text) | the DM's `deleted_at`: a converted self-DM is deleted, so a re-run skips it |
| Channel names (slugs) | Kept until someone renames them | nothing | — |
| Notification levels | Channels: everyone at Mentions and replies; DMs keep notifying | `update … set notify_level = 'mentions'` on channels; one `level_reset` Catch up line for each person who had a channel on Every message | unique Catch up line per person |
| General | `is_default = true` on each workspace's first channel named `general`; nobody is added | — (only people who join after the migration are added) | the unique index |
| Memberships | `left_at` null for all; `last_read_id` = the newest message at or before `last_read_at` | — | — |
| v1 agent posts (null author) | Kept as "<key name> (app)" | nothing (no key id was stored) | — |
| The registry | Every channel registered (label = name; DMs without a label) | `entities_op_ensure`, as the owner | the registry's own uniqueness |
| `updated_at`, `body_text` | Backfilled | `updated_at = greatest(created_at, edited_at, deleted_at, last_reply_at, pinned_at)` | — |
| Old bell rows (`chat.mention` / `chat.reply` excerpts) | The same tokens rewritten, so the bell draws them like new ones | the same function over `payload->>'excerpt'` | the excerpt no longer contains `<@` |

**Rejected:** a TypeScript one-off over a service connection (it can't run inside the migration's transaction or on a release train); keeping a v1 parser in the client for ever (§6 #3). Lines that read as Markdown structure in v2 but were plain in v1 (a line starting "- ", a `[text](url)` pair) are accepted as better formatting; spike 4 counts them on real data.

**The round trip on the local stack** (local build mode: the local stack is prod):
1. The research workspace ("Chat replan research", 3,032 messages) is the v1 fixture. Before the conversion block, dump its chat rows to a scratch fixture (data only), because a `local:reset` would wipe them; add a hand-made set with every v1 token kind, a self-DM, a thread, an agent post and a channel on Every message.
2. Record per person: unread and mention counts per conversation, the bell rows, membership count.
3. Apply `…_convert_v1` with `psql -v ON_ERROR_STOP=1 -f` (never `supabase migration up`, gotchas §Supabase).
4. Check: message count unchanged; no body contains `<@`, `<!channel>` or `<moduo:`; every v1 reply flagged; counts equal to before except replies whose root was unread; one `level_reset` line per affected person; one note per self-DM; every converted body parses with the client parser and redraws identically (spike 4's parity check).
5. Apply the same file again: zero rows change.
6. Only then the next migration.

### 2.7 Realtime (§6 #19)

| What | Transport | Who receives | Notes |
| --- | --- | --- | --- |
| Messages, channels | Postgres Changes on `chat_messages` + `chat_channels`, filtered `workspace_id=eq.<ws>` | Whoever RLS lets read the row | Applied from the event itself: **zero requests per incoming message** (v1 made 10). Every rejoin fills gaps by delta (§6 #17) |
| Your memberships | Postgres Changes on `chat_members`, filtered to you | You | A removal or a deleted channel reaches you as an update of your own row |
| Your Catch up | Postgres Changes on `chat_catchup`, filtered to you | You | Its own client channel (a newly published table gets its own, D11B-8) |
| Statuses | Postgres Changes on `user_statuses` | People who share a workspace with the person | Its own client channel |
| Custom emoji | Postgres Changes on `chat_custom_emoji`, filtered by workspace | Members | Its own client channel |
| Notices from every workspace | Postgres Changes on `notice_deliveries`, filtered to you (TV-D12's) | You | One channel whatever the number of workspaces (CH6) |
| **Typing** | Broadcast on a private topic **per conversation**, `chat:typing:<conversation id>` | Only that conversation's members | See below |
| **Online** | Presence on the workspace's private topic `chat:<ws>` | Members of the workspace with chat | See below |

**Typing reaches only the conversation's members, and the sender comes from the session.**
- The topic family `chat:typing:<id>` has a **read** policy on `realtime.messages`: the caller is a member of that conversation (not left) in a workspace they belong to.
- It has **no write policy**: clients can't broadcast on it. The only writer is `chat_op_typing(channel, stopped)`, which checks membership and calls `realtime.send(…, 'typing', topic, true)` with `auth.uid()` in the payload. Private-channel policies are checked once at join and cached, so a payload a client sends could never carry a trusted sender; an op can (**my choice**; rejected: client Broadcast with a sender field, and Presence keys, which the client chooses).
- A client joins only the **open** conversation's topic (and the open chain's, which is the same conversation) and leaves it on switch, which keeps far under 100 channels per connection and 100 joins a second (Free plan, blueprint §4).
- At most one event every 3 s per person and conversation (client throttle), a `stopped` event on send or blur, expiry after ~6 s on the receiving side. Never stored beyond `realtime.messages`' own 3-day partitions. Spike 3 measures the cost of one database call per typing burst.

**Online:** Presence on `chat:<ws>` (read and presence-write for members of the workspace with chat; Broadcast no longer used there). A client tracks itself only while "Show me as online" is on (CH9). Presence keys are chosen by the client, so Presence is **display only**: nothing on the server reads it. Decisions that must be right (which device rings, whether to email) read `user_clients`, which the server stamps from the session (§2.14). A refused join shows as an error state, not as "nobody online".

**Losing access sends no event** (a row RLS stops returning is never delivered): the store's access check (`chat_sync_ids`) runs on rejoin, on focus, every 10 minutes and whenever one of your membership rows changes, and drops conversations you can no longer read from memory and the device copy. Cases: removed (your row changes), channel deleted (the op touches every member's row so it reaches them), made private (non-members: the periodic check), messages moved away (the `moved_out` event line in the source names the ids). Spike 2 proves each.

**Publication:** every migration that publishes a chat table re-asserts `supabase_realtime` membership idempotently (the local snapshot carries none; gotchas §Supabase/migrations). **Scale path** (not built now): ids-only pokes on `chat:u:<person>` from a trigger, when spike 3 or production shows p95 delivery over 1 s or Realtime messages near the plan's cap.

### 2.8 Reactions, widened for chat and for task comments (CH16, CH16a, CH49, CH60)

- **One key format for both tables**, in `@contracts` (`REACTION_KEY`, plus `DEFAULT_QUICK_REACTIONS`, the six in order) and mirrored by one SQL check, `reactions__key_ok(text)`: a standard emoji as Emojibase writes it (1–32 characters, no letters, digits, spaces or control characters), or `:name:` naming a live custom emoji of that workspace when you react. **My choice**; rejected: Emojibase shortcodes as keys (a second key language; v1 already stores the emoji itself, and agents write emoji).
- **`chat_messages.reactions`**: same jsonb shape, wider keys, ≤ 20 kinds per message; `chat_op_react` takes on/off.
- **`comment_reactions`**: the CHECK `comment_reactions_reaction_check` (six words) becomes `reactions__key_ok(reaction)`; the six stored words become their emoji (`thumbs_up` → 👍, `check` → ✅, `eyes` → 👀, `pray` → 🙏, `heart` → ❤️, `smile` → 😄) in the same migration; `COMMENT_REACTIONS` gives way to the shared key; `comments_op_react` (from its live body) accepts any key, ≤ 20 kinds per comment, custom names checked against the comment's workspace. It stays a child table with hard deletes: that's safe because it isn't published (its changes ride the comment's `updated_at`, TV-U13), so the Realtime delete rule doesn't apply. Who may react on a comment is unchanged (whoever can comment).
- **Your quick row** (CH16a): `user_preferences.reaction_row text[]` (≤ 6 keys; null = Moduo's six), through `user_op_set_chat_prefs`. One row per person for every workspace; a custom key that doesn't exist in the current workspace is skipped and the next default fills in (**my choice**). The hover shows the first three (CH29b).
- **Never notifies** (CH16, Tasks 88). In chat, viewers react (CH60).

### 2.9 Custom emoji (CH16b, §6 #20)

- **Table** `chat_custom_emoji` (§2.2); `name` matches `^[a-z0-9_-]{1,32}$`, unique per workspace among live rows; soft deletes, so the delta and Realtime see a removal.
- **Storage:** a private bucket `chat-emoji` (allowed types PNG, GIF, WebP; 256 KB; **no SVG**), paths `<workspace>/<sha256>.<ext>` and `<workspace>/<sha256>.poster.png` (the still frame for "plays on hover only"). Storage policies: insert only into your own workspace's folder with the custom emoji switch; read by members of that workspace (paused chat still reads).
- **Upload:** the browser decodes, scales a still image to 128 px, refuses an animated one over 128 px or 256 KB, makes the poster, uploads both; then `chat_op_custom_emoji_add` checks name, type, size, that both objects exist, and the workspace limit (500, **my choice**).
- **In text and reactions:** `:name:`, resolved when drawn; a deleted emoji reads as its text.
- **Export:** the image files (CH16b). **Account deletion:** the emoji stay with the workspace; `created_by` goes to null.

### 2.10 Quiet hours, in the Time & region store (CH7, CH41, §7)

- **Columns** on `user_preferences`: `quiet_hours_on boolean not null default false` (off by default, CH7), `quiet_from time`, `quiet_to time` (both set when on; the range may cross midnight).
- **One op:** `user_op_set_time_region` gains the key `quiet_hours` (`{on, from, to}`) and `user_time_region` returns it; both redefined from their live bodies (TV-D14). The guard trigger `user_preferences__time_region_guard` keeps the three columns op-only, like the zone.
- **One helper:** `time_region__quiet_now(user, at) → (quiet, back_at)`, read in the person's `time_zone` (UTC when no zone is known).
- **Read by** the notice gate (§2.14 f: nothing pings; everything waits in Catch up; announcements don't break through, CH41) and by `chat_now` ("Sofia's quiet hours · back 9:00", CH7). Per §7 it serves **every module's** notices, so it holds Tasks' reminder pushes too; the reminder still lands in the bell.

### 2.11 Statuses for every workspace, and saved statuses (CH28c, CH28d, CH45)

- **`user_statuses`** (§2.2): one status per person for all workspaces (CH45). `emoji` ≤ 16 characters, `text` ≤ 100, `dnd`, `clear_at` (null = never), `preset` (closed: `meeting`, `sick`, `vacation`, `commuting`; null for your own). Do not disturb by hand (1 hour, today, until…) is a status with `dnd = true` and no text (CH28c b).
- **`user_saved_statuses`**: your own saved ones, ≤ 20; `clear_after` closed: `30m`, `1h`, `today`, `this_week`, `date` (asks for the date each time), `never`. Moduo's four presets live in `@contracts`, not in rows.
- **Ops:** `user_op_set_status(patch)`, `user_op_clear_status()`, `user_op_save_status(patch, id?)`, `user_op_forget_status(id)`.
- **Read:** RLS lets anyone who shares a workspace with the person read the row; `chat_now` folds it in. A job every 5 minutes clears statuses past `clear_at`, so the change travels live.
- **Where it acts:** a status with `dnd` holds pings like quiet hours (§2.14 f). The line above the composer ("Jana is on vacation until Oct 20. She won't be notified…") and the assign picker (a proposal to Tasks) read the same row.
- **Erasure and export:** both tables go with the account (foreign keys cascade from `profiles`, and the erasure preview counts them); your export carries your own saved statuses (**my choice**).

### 2.12 Pausing one workspace's notifications (CH46)

- `workspace_members.notices_paused_at timestamptz`, written only by `workspace_op_pause_notices(ws, paused)` on the caller's own row.
- While paused, that workspace sends no OS, browser or email notice (the gate, §2.14 f). Its bell, Catch up and counts keep filling, quietly. The switcher reads the column from your own membership row.

### 2.13 "Focusing now", narrowly (CH9, CH42, CH47)

`chat_now(ws)` is the one read teammates get; it never exposes the run itself.

| Field | Rule | Call |
| --- | --- | --- |
| `focusing` | A running Focus run of that person seen in the last 3 minutes, **in any workspace** (Focus is the person's state; the run's workspace is only where it's stored). **My choice**; rejected: per workspace, where someone focusing elsewhere reads as Active and gets pinged | CH9 |
| `focus_until` | The Pomodoro phase's end, or an estimate's end when the run counts one down; otherwise null, and the line reads just "Focusing" | CH42 |
| `focus_task_id` | Only when the person turned on "Show what I'm focusing on" (`user_preferences.show_focus_task`, off by default) **and** the task is in this workspace **and** the caller can see it (`tasks__visible`) | CH47 |
| `status`, `dnd` | From `user_statuses`, if not expired | CH28d |
| `quiet_now`, `back_at` | From quiet hours | CH7 |

"Away" comes from Presence and never carries a time (CH48). The caller must be a member of the workspace; former members aren't listed. Tasks' own `focus_claims` ("is on this", TV-F6) is untouched. Holding pings during Focus is the gate's job (§2.14 f), not this read's.

### 2.14 Notifications: Chat's rows in TV-D12's pipeline (CH6, CH7, CH33, CH39–CH44, CH46, §6 #6, #23)

Chat adds rows to the app's one pipeline; it never builds its own sender (§6 #6).

**(a) The fan-out.** `chat_op_send` (and `chat_op_agent_post`, and `chat_op_edit` for people named for the first time) works out, in the same transaction, who the message is addressed to (rules in (c)), only among people who can read the conversation, and writes per recipient: a Catch up item, a bell row where the table says so, and a device notice through the gate (f). Nothing is decided in the client.

**(b) The vocabularies.**
- Bell ops (`module_activity`): `chat.mention` (payload `reason`: `person` · `team` · `everyone`), `chat.reply`, `chat.announcement`. Each maps to a Chat switch in the client's `OP_TO_NOTIFICATION_TYPE`. The three join `module_activity_gate_recipients`' list as a second guard, and `spine__visible_to` gains the conversation branch it needs.
- Device notices (`notice_deliveries.kind`, `NOTICE_DELIVERY_KINDS` + CHECK + `noticeCopy`): `chat_message` (a DM or an Every-message burst), `chat_mention`, `chat_reply`, `chat_announcement`, `chat_reminder`, `chat_focus_summary`. Title and text are built on the server: "Sofia Ortiz · Acme" plus the workspace's name; the text only when the person keeps "Show message text" on (CH33), with references drawn as names that person can see, else "Private item"; the link is `/chat?c=<conversation>&m=<message>`, so a click lands on the message.
- Catch up reasons: §2.2.

**(c) Chat's rows in the notification table** (superseded 2026-10-14 by the spec's §11, which adds the When column, the five switches and pause on announcements; kept here for the reasons and op names; §6 #23). "Count" is the number on the conversation and the Chat tab (CH5).

| Event | Who hears | OS / browser | Bell | Catch up | Count | Email after 1 h | Turned off by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A direct message | The other people in it | Yes, one per conversation per burst | No | Yes (`dm`) | Yes | Yes | The DM's level Nothing · pause · quiet hours, do not disturb · Focus holds it · "Email when away" |
| `@you` in a channel | You, if you can read it | Yes | Yes | Yes (`mention`) | Yes | Yes | Level Nothing → Catch up only, silent, no count (CH40) · pause · quiet hours, do not disturb · Focus holds it |
| `@Team` | Each team member who can read it, once | As `@you` | Yes | Yes (`team_mention`) | Yes | Yes | As `@you`, plus the team's mute ("Your teams", TV-D13) |
| `@channel` | Every member not on Nothing, once | Yes | Yes | Yes (`everyone`) | Yes | No | Level Nothing · pause · quiet hours, do not disturb · Focus |
| A reply in a chain you're in (you wrote its first message, replied, or were mentioned in it), or a reply to your own message | Those people | Yes, grouped per chain | Yes | Yes, one item per chain (`reply`) | Yes | No | "Stop following" · level Nothing · pause · quiet hours · Focus |
| A post in an announcement channel | Every member | Yes, once | Yes | Yes (`announcement`) | Yes | No | Level Nothing only (CH23a); never breaks through quiet hours, do not disturb or Focus (CH41) |
| A message in a conversation set to Every message | Members on Every message | Yes, one per burst (CH39) | No | Yes (`every_message`, one line per conversation: CH73 ✅) | Yes | No | The level · pause · quiet hours · Focus |
| Any other message | — | No | No | No | No (bold name only) | No | — |
| An agent's mention | Like a person's | | | | | | §6 #12 |
| A reply to a post made through your key | You, only through that key's notification switch, unless you're mentioned | | | | | | §6 #25 |
| A mention added by an edit | Only people named for the first time | Yes | Yes | Yes | Yes | No | CH75 ✅ |
| Remind me / Later comes due | You | Once (`chat_reminder`) | No | The item returns to the top | Yes | No | Clearing the reminder |
| Focus ends with held pings | You | One summary: "3 messages while you focused" | No | — | — | No | — |
| Added to a channel | You | No | No | A quiet line (`added`) | No | No | — (**my choice**, mirrors CH61) |
| Removed from a channel | You | No | No | A quiet line (`removed`) | No | No | — (CH61) |
| The conversion reset your levels | Who had Every message | No | No | One quiet line (`level_reset`) | No | No | — (§6 #26) |
| Reactions; edits without a new mention; deletes; pins; decisions; wrap-ups; reopens; moves; renames; topics; archiving; made private; the announcement switch; a new custom emoji | Nobody | No | No | No | No | No | — (quiet bar; shown in Details' history) |

❓ = my reading of the decided calls, flagged in the final report: CH8 lists in Catch up what would ping you, and CH39 makes Every message ping, so those messages land in Catch up (grouped per conversation).

**(d) Push at once, not on the minute.** An `AFTER INSERT` statement trigger on `notice_deliveries` calls TV-D12's `notice_deliveries__kick()` when a chat kind arrived. The kick stays Vault-gated (no URL and secret, no call: a local stack never calls another's function). `push-send` drains: `notice_deliveries__claim` (redefined from its live body) claims only rows past their `push_after`, not acknowledged and not held for Focus; if rows remain inside their hold, the function waits until the earliest is due (≤ 10 s, `EdgeRuntime.waitUntil`) and claims again, so one kick drains a burst. TV-D12's minute job stays as the sweeper. **My choice**; rejected: a pg_cron job every 5 s (17,280 mostly empty runs a day) and pushing with no hold (both devices ring).

**(e) One device rings.**
- Every running app or tab stamps `user_clients` through `user_op_client_seen` (sender from the session): seen every 60 s while open, `active` when focused and not idle.
- The **desktop app** hears its own notice rows live (published) and shows an OS notification only when Moduo isn't in front of the person (or they're in another module, CH6) and it's their most recently active client; then it calls `notice_op_ack(ids)`. A client that has the person's attention acknowledges without ringing (it shows the message in place).
- **Browsers** never ring from the page. Web Push (the service worker) rings only for a row nobody acknowledged by its `push_after` (created + 8 s).
- **Bursts:** each row carries `tag = 'chat:<conversation>'` (a chain's own tag for replies); a web notification with the same tag replaces the last ("Sofia · 3 messages"); the desktop throttles per tag for about a minute (blueprint §8).

**(f) Holds: one gate.** `notice__gate(user, ws, kind, at)` answers *send*, *hold* or *drop*:

| Situation | Every kind (reminders too, per §7) | Chat kinds |
| --- | --- | --- |
| The workspace is paused (CH46) | drop | drop |
| Quiet hours now (CH41) | drop | drop |
| A status with do not disturb: by hand, sick, vacation (CH41) | drop | drop |
| A Focus run going, in any workspace (CH7) | — (Tasks hasn't decided reminders during Focus) | hold: written with `held_for_focus`, never pushed |
| Otherwise | send | send |

"Drop" only skips the device notice: the bell row and the Catch up item are written as usual, so everything waits in Catch up (CH41). The gate keeps a short list of kinds that break through for modules that decide so (Calendar may decide its own reminders do, proposals.md); chat's list is empty. Chat's fan-out asks the gate before inserting; a `BEFORE INSERT` trigger on `notice_deliveries` applies the drop rows to every kind, so TV-D12's reminder sender needs no change. When a Focus run ends (a trigger on `focus_runs` leaving `running`), that person's held rows are closed and one `chat_focus_summary` row is written, through the gate.

**(g) The email after an hour (CH43).** A job every 5 minutes, `chat__queue_waiting_emails()`, takes Catch up items with reason `dm`, `mention` or `team_mention` that are over an hour old, still open and not yet emailed, for people who keep "Email when away" on (default on), have no `user_clients.last_seen_at` in the last hour, and aren't paused, in quiet hours or on do not disturb at that moment. It queues **at most one email per person, conversation and hour** with TX-3's `email_enqueue('chat_waiting', …)` (dedupe key `chat_waiting:<person>:<conversation>:<hour>`), with the workspace, the conversation (for a DM, the sender's name), the count, the text only when "Show message text" is on (CH33), and the link; it stamps the items `emailed_at`. Needs: `EMAIL_KINDS` + the `email_outbox` CHECK re-stated from its live list (TX-5 extended it too) + the drift-gate test's file pointer, and a `chat_waiting` template in `email-worker`, **deployed before** the migration that queues the new kind (TX-3 rule). An item written while the gate answered *drop* is stamped `held_at` and never emails (CH74 ✅, which replaced the first draft's "waits until they end"). **Rejected:** queueing at send with `send_after = +1 h` and cancelling on read (the cancel races the worker, and the worker would need chat's rules).

**(h) Counts and badges.** Per conversation from `chat_unread_counts` (zero queries per incoming message: the store moves counts as rows arrive). The Chat tab counts the open workspace; the switcher counts each workspace and the dock or taskbar badge shows the sum, all from your open Catch up items (one query across workspaces, RLS: your rows). Desktop: Tauri's `setBadgeCount` (macOS, Linux) and an overlay icon on Windows; web: the tab title and a favicon dot (blueprint §8).

### 2.15 Catch up and the bell: one state (CH8, CH38)

- Every chat bell row has a Catch up twin (`chat_catchup.activity_id`). Direct messages have no bell row (CH6), only the item.
- **Done in Catch up** (`chat_op_catchup_done`) dismisses the twin (`notification_state.dismissed_at`). **Dismiss in the bell** (`notifications_op_dismiss`, redefined from its live body) closes the item (`done_how = bell`); **undismiss** reopens it. **Reading it in the conversation** (`chat_op_mark_read`) closes the item (`done_how = read`) and dismisses the twin. **Later** hides both until it comes back.
- The bell's own read dot stays the bell's: opening the bell doesn't empty Catch up.
- **Rejected:** deriving Catch up from the bell's rows and state (direct messages aren't bell rows, and Later and Remind me need a per-person row of their own).

### 2.16 Remind me, and Later (CH8, CH51)

- One mechanism: `chat_op_remind(message_id | channel_id, at)` snoozes the person's open Catch up item for that message, or creates one with reason `reminder` (any message, addressed to you or not). `at = null` clears it.
- A job every minute, `chat__fire_later()` (`FOR UPDATE SKIP LOCKED`), brings items whose time came back to the top of Catch up, sends one `chat_reminder` notice through the gate, and undismisses a bell twin.
- `/remind` in the composer is a reminder for you about this conversation (`channel_id`, no message): it returns the conversation's newest message at that time.
- The horizon is one year (**my choice**, G28's limit).

### 2.17 Decisions (CH13, CH52, CH53)

- **Data:** `decision_at`, `decision_by` on the message row, so marking one is a single update that Realtime carries like any other. **Rejected:** a decisions table (a second stream to sync for one flag).
- **Ops:** `chat_op_mark_decision(message, on)` (posters; messages only, never event lines); `chat_op_wrap_up(…, mark_decision)` marks the settling reply when "Also mark as decision" is ticked (CH53; the app ticks it by default in linked channels).
- **On items** (CH52, also from direct messages): `chat_decisions_for_item(type, id)` finds the conversations linked to the item (§2.21) or with a "Mentioned in" link to it, keeps those the caller can read, and returns their decision messages that are in a linked conversation or carry the item's URI in their text. The partial decisions index keeps it cheap. **Rejected:** a per-message references table (a write on every send, for a read only decisions need).
- **Where it shows:** Details' Decisions section; TV-U16's slot on the project overview and the client's hub (BUILD_ORDER 🟠 box); MCP "mark a decision".
- **Quiet:** an activity row, no notice.

### 2.18 Reply chains, Wrap up and reopening (CH30a, CH30d, CH53, CH54)

- **Shape:** one level. `parent_id` is the root; `reply_to_id` is what the reply quotes (the root, or a reply in the same chain). A reply to a reply joins the root's chain. The root keeps v1's rollups (`reply_count`, `last_reply_at`, `reply_user_ids` for "Alex, Mike ›"), now kept by send, delete, move and "Reply to…".
- **Wrap up:** `wrapped_at`, `wrapped_by`, `settled_id` on the root; `settled_id` must be a reply of that chain. "The replies leave the main stream" is a **drawing rule** keyed on the root, not a data move: replies stay rows of the conversation, so unread, Catch up, search and export are untouched (G16). Unread replies a wrap-up hides stay in Catch up as one chain item.
- **Reopen:** a new reply (through `chat_op_send`) or "Reopen" clears `wrapped_at` and stamps `reopened_at` / `reopened_by` ("Reopened by Mike", CH54); the replies come back in place.
- **Who hears a reply:** the root's author, everyone who replied, everyone mentioned in the chain, minus anyone in `chat_chain_mutes` for it (§2.14 c).
- **Who may wrap up:** §2.4.
- v1 threads become chains in the conversion (§2.6).

### 2.19 Moving messages (CH30c, CH55)

`chat_op_move_messages(ids, target_channel, confirm)`:
1. **Who and where:** the caller can post in the target. Their own messages: anywhere. Other people's: only managers of the source and admins (CH30c), and only into a conversation whose readers could all read the source already.
2. **Audience (CH55):** if everyone who can read the target could read the source, it moves in one step. Otherwise (own messages only) the op first answers with the number of people who would newly see them ("2 people who aren't in Founders will see this") and moves only when called again with `confirm`.
3. **What moves:** the messages; a root brings its whole chain; a reply moved alone leaves its chain (**my choice**). Reactions and decisions ride the row; files follow (they belong to the message id); pins are dropped, since a pin belongs to a conversation (**my choice**).
4. **What's written:** on each message `channel_id`, `moved_at`, `moved_by`, `moved_from_channel_id`; an event line in the source (`moved_out`: who, how many, which ids, where to) and one in the target (`moved_in`, naming the source as a `moduo://` reference, so readers who can't see the source read "Private item"). Catch up items follow; "Mentioned in" links are written for the target. **Nothing pings again** (CH30c).
5. **Undo** (8 s): the same op back; the two event lines are soft-deleted.
6. **Live updates:** readers of the target get the moved rows as updates; readers of the source who can't read the target get the `moved_out` line and drop those ids; the store's access check covers anything missed (spike 2).

"Move to a task's comments" and "Make a note" are proposals to Tasks and Notes (CH30d). When accepted, Chat writes through their ops and keeps a "Moved from Acme · Oct 12" line on the comment (BUILD_ORDER 🟠 box); that needs a small column on `comments`, owned by that proposal.

### 2.20 Channel lifecycle (CH58–CH62, G26)

| What | Server behaviour | Call |
| --- | --- | --- |
| **Public → private** | `chat_op_make_private`: current members stay; people who read it without joining lose it (the access check; their Catch up items for it close); agents lose it unless their key includes private channels and their creator is a member; one way only | CH59 |
| **Managers add people to private channels** | `chat_op_add_members` checks managers and admins for private channels | CH58 |
| **Recently deleted, 30 days** | `chat_op_delete_channel` stamps `deleted_at`; nobody reads a deleted channel (`chat_can_read_channel`); `chat_recently_deleted` lists it for its managers and admins; `chat_op_restore_channel` brings it back. The op touches every member's membership row, so the change reaches them live. The daily purge hard-deletes it after 30 days (messages, Catch up items and links cascade; files go with AT-1's trash clock; the registry row becomes a tombstone). A delete event carries only primary keys, and clients ignore ids they don't hold. General can't be deleted | CH62 |
| **Removal notice** | Removal stamps the membership row and writes a quiet `removed` line for the removed person, naming who removed them; no ping; the channel leaves their sidebar | CH61 |
| **Viewers react** | `chat_op_react` lets readers react; posting still needs the post switch | CH60 |
| **Archive** | Managers and admins; read-only; still found by search, labelled "Archived"; its open Catch up items close; the "Conversation:" line on a linked item stays, marked archived | G26 |

### 2.21 Linked channels, and "Start a conversation for X" (CH2, CH11, CH56, CH57)

- **The link:** `chat_channels.linked_type` / `linked_id` hold it (one per channel, CH2), plus a mirrored `entity_links` row (source the conversation, target the item, relation `conversation-of`, origin `manual`) written and removed by `chat_op_link_channel`, so the item's Linked, the project overview and the client's hub find it through the spine. A team has no registry entry, so a team link is the column only. **Rejected:** `entity_links` alone (no "at most one" rule, and every sidebar read would join the spine).
- **`conversation-of`** joins `RELATION_KINDS` and the `entity_links` CHECK (re-stated in the same migration).
- **"Start a conversation for X" (CH56):** `chat_op_create_channel` with `link_type` / `link_id`. The name is X's name, with " 2", " 3"… on a clash (**my choice**). If every workspace member who can use chat can see X, the channel is public with the creator in it; otherwise it's private, with exactly the members who can see X (`spine__visible_to`).
- **Linking a team (CH57):** the app offers "Add the team's 4 people?" once and calls `chat_op_add_members` with them; nothing is kept in sync.
- **"Mentioned in" (CH11, §6 #5):** send, edit and move write one `entity_links` row per conversation and referenced item (source the conversation, relation `mentions`, origin `ref`; the pair key keeps it one). Edits and deletes don't remove it: it reads as history (**my choice**; rejected: recounting on every edit and delete). Like every chat link row, it's readable only by people who can read the conversation (§2.25 a).
- **Read:** `chat_conversations_for_item(type, id)` for the overview's "Conversation: Acme · 3 new" and the item's Linked lines.
- **When the item goes** (archived, deleted): the channel stays and its header chip turns into RF-1's tombstone. Capture from a linked channel (CH10) defaults to the linked project when the caller can edit it, else the Inbox (G14).

### 2.22 Drafts

Kept **on the device**, in the chat store's `meta` record, per account, workspace, conversation and open chain: the typed text and ids only, never a linked item's or person's name (TV-U14's U14-9); restored on open; wiped on sign-out and account deletion. **My choice**; rejected: a server table so drafts follow you across devices (a new per-person table holding unsent text, for erasure and export to cover). Revisit if people ask.

### 2.23 Former members (CH36)

- Chat rows outlive workspace membership (gotchas §Supabase). `chat_people(ws)` returns the name and avatar of everyone who wrote in or belongs to a conversation the caller can read, flagged `former` when they're no longer a member. A deleted account has no profile left, so it reads "Former member" without a name (PRIV-2a).
- A direct message with a former member stays readable; the app shows "Jana left the workspace" in the composer's place. The erasure's "nobody else is in this conversation" now counts only current members who haven't left.

### 2.24 Announcement channels, and "Reply privately" (CH23a, CH50)

- `managers_only` stays the switch; `chat_op_set_announcement` turns it on or off later (managers and admins).
- A post pings every member once, even on Mentions and replies; only Nothing silences it; it never breaks through quiet hours, do not disturb or Focus (§2.14).
- Members can't post there, replies included, so nothing lands in the stream but managers' posts (CH50).
- **"Reply privately"** is `chat_op_open_dm` with the post's author, then a send whose text carries the post as `moduo://chat_message/<id>` (a card). No new server object.

### 2.25 Everything else the decided calls need from the server

**(a) Every chat row outside the chat tables follows the conversation's read rule.** Registry rows (`entities`), activity rows (`module_activity`) and link rows (`entity_links`) about a conversation or a message are readable only by people who can read that conversation. Concretely: `perm_can_see_entity` gains `chat_channel` and `chat_message` branches that ask `chat_can_read_channel` (as the key's creator for an agent); `spine__visible_to` gains the same branch for "can this person see it"; the `entity_links` read rule gains a branch for rows whose source is a conversation. Activity payloads carry ids, never message text, except the bell's excerpt, which only its recipients and the conversation's readers can read. This lands in the foundation migration, before any new chat row is written.

**(b) General (§6 #9, CH37).** `is_default` marks it. A trigger on `workspace_members` insert joins the new member to General (unless they left it before: a `left_at` row stays). `chat_op_bootstrap` covers workspaces that predate the trigger. The one-line welcome is drawn by the app and disappears after the first message: no row.

**(c) An activity row for every op (§6 #15),** attributed, with ids only: `chat.message_edit`, `chat.message_delete`, `chat.message_restore`, `chat.react`, `chat.pin`, `chat.decision`, `chat.wrap_up`, `chat.reopen`, `chat.move`, `chat.channel_create`, `chat.channel_rename`, `chat.channel_topic`, `chat.channel_archive` / `_unarchive`, `chat.channel_private`, `chat.channel_delete` / `_restore`, `chat.channel_link`, `chat.announcement`, `chat.join`, `chat.leave`, `chat.member_add`, `chat.member_remove`, `chat.manager_add` / `_remove`, `chat.emoji_add` / `_remove`. A plain send writes none (the message is its own record, v1's rule). Details' quiet history reads them; none notifies.

**(d) The registry, ⌘K and References (§6 #4, #15).** Entity types `chat_channel` (every conversation, registered on create; label = the channel's name, none for a DM) and `chat_message` (registered only when something links to it, through `chat_op_register_message`, **without a label**). RF-1 gains the kinds *conversation* and *message*; URIs `moduo://chat_channel/<id>` and `moduo://chat_message/<id>`; the person URI's exact spelling is agreed with RF-1 in spike 4. ⌘K: "Conversations" from the registry, "Messages" from `chat_search`. That is how this file reads §6 #15's "messages register in the search registry": found through ⌘K, not stored as registry rows (a registry label would carry message text).

**(e) The plan gate, and the hackathon's grant (CH4a, CH25, CH67).** Reading never needs the plan (CH4a: history stays readable, search and widgets keep working while chat is paused); every write does, through `chat_op__guard`. `chat_workspace_enabled(ws)` = the owner's plan is Duo, Team or Founder **or** the workspace holds an active dated grant (TX-9b's `plan_grants`, owned by the hackathon plan), read through one function TX-9b defines. Until it exists, chat's function checks for it with `to_regprocedure` and falls back to the owner's plan, so the order of merging doesn't matter. `CHAT_PLAN_TIERS` / `planHasChat` follow (a Tier 2 path, G28).

**(f) Agents (CH18, §6 #12, #25).** The key's "Include private channels I'm in" is a column, `workspace_api_keys.include_private_chat boolean not null default false`, set in the key editor (the spec's call: KEYS-1's typed scopes map, its normalizer and its CHECK stay untouched; rejected: a `chat_private` key inside the scopes map, which the Zod contract would drop on every Settings save). Every MCP read runs as the key's creator through the same reads the app uses (`chat_search`, keyset pages), never as a hand-filtered service-role query. Rate limit 30 posts a minute per key; `@channel` and announcement channels only if the creator may.

**(g) Files (CH17).** `attachments_op_begin` accepts `chat_message` with the conversation's id: the client mints the message id, uploads first, sends after (blueprint §9). Until the message exists, only the uploader sees the pending row; `chat_op_send` adopts the uploader's pending files for that id. Afterwards a file's access follows its message's conversation (a branch in the attachments policies and ops, never in `can_access`: a conversation isn't a shared item with grants). Deleting the message sends its files to the trash clock (`deleted_reason = 'chat_message'`). Up to 10 files per message (**my choice**). Limits follow the owner's plan, or the grant's (CH67).

**(h) Account deletion.** `account_erase_workspace_data`, redefined from its live body: counts and deletes `chat_catchup`, `chat_chain_mutes`, `user_statuses`, `user_saved_statuses` and `user_clients` (they also cascade from `profiles`); a custom emoji's `created_by` goes to null; "a conversation nobody else is in" now counts current members who haven't left. Ids inside reactions, `reply_user_ids` and mention arrays stay as bare ids (PRIV-2a's rule for authorship ids).

**(i) Export (§6 #16).** The lossless export reads every conversation you can read through the keyset reads, with chains, reactions and files **as files** (attachments and custom emoji), and writes JSON plus one Markdown file per conversation, in the client. No server object beyond the reads.

**(j) Limits (G28)**, each a CHECK or an op rule: message 8,000 stored characters · 10 files per message · 20 reaction kinds per message or comment · 100 pins per conversation · 9 people per DM · 500 custom emoji per workspace, 256 KB, 128 px · status text 100, status emoji 16 · 20 saved statuses · Remind me up to one year ahead · agent posts 30 a minute per key · typing one event per 3 s.

**(k) Closed vocabularies** (AGENTS.md rule 4: `@contracts` + a matching CHECK, in the same migration): `CHAT_MESSAGE_KINDS` (`message`, `event`), `CHAT_EVENT_TYPES` (`moved_out`, `moved_in`), `CHAT_CATCHUP_REASONS`, `CHAT_CATCHUP_DONE_HOW`, `CHAT_LINK_TARGETS`, `CHAT_CAPABILITIES` (+ `add_emoji`), `REACTION_KEY` + `DEFAULT_QUICK_REACTIONS` (replacing `COMMENT_REACTIONS`), `STATUS_PRESETS`, `STATUS_CLEAR_AFTER`, `CLIENT_SURFACES`, `NOTICE_DELIVERY_KINDS` (+ chat's six), `EMAIL_KINDS` (+ `chat_waiting`), `RELATION_KINDS` (+ `conversation-of`), the Message capture type (client registry). Unchanged: `CHAT_CHANNEL_KINDS`, `CHAT_NOTIFY_LEVELS`.

**(l) Calls that need nothing new on the server:** ⌘7's Message capture (CH65: a normal send to a conversation you must pick); offline sends (CH64: the outbox, idempotent by the client-minted id; the ops' error codes tell "the server said no" (`42501`, `P0002`, `22023`) from a lost connection); a typed task handle becoming a chip (CH66: RF-1's handle autolink; the stored form is the URI); the Home widgets (CH35, CH70: Catch up reads `chat_catchup`, the Team widget's "now" line reads `chat_now`); "Show me as online" (CH9: a preference the client honours); sound (CH34: a client setting).

---

## 3. Migrations, per future block

**Names and stamps.** File names follow `YYYYMMDDHHMMSS_chat_v2_<what>.sql`. The stamps below start after the newest migration on the integration branch today (`20261013230000_templates_starter`) and keep the build order; **each block re-stamps its files on the day it applies them**, after every migration landed by then (Tasks v3 keeps adding), without changing the order between chat's files. Block names follow CH26a's order (the hackathon cut first, with the basics the gap audit's G7 added), then the teams-of-2–5 cut. They're provisional until the spec.

| Block | Migration | What it holds | Needs (already on the local stack unless marked) |
| --- | --- | --- | --- |
| **CV-0 · Five spikes** | none | Scratch schemas and harnesses only (§5); spikes 2, 4 and 5 draft CV-1's first file | — |
| **CV-1 · Store and data foundation** (L) | `20261014100000_chat_v2_foundation.sql` | `unaccent` + `chat__unaccent` + `chat__body_text`; the new columns that the read rule and the store need (messages: `updated_at`, `format_version`, `body_text`, `search_tsv`, `reply_to_id`, `v1_thread_reply`, `kind`, `event`, the mention columns, `api_key_id`; channels: `is_default`, `deleted_at/by`; members: `last_read_id`, `left_at`, `removed_by`, `updated_at`); stamp triggers; `chat_catchup` and `chat_chain_mutes` (empty until CV-3); indexes; the read rule without the plan (CH4a); the chat branches of `perm_can_see_entity`, `spine__visible_to` and the `entity_links` read rule (§2.25 a); the two Realtime topic families and their policies; `chat_caps_get` redefined; CHECKs for the new vocabularies; publication and grants re-stated | `20261006210000_perm_sharing` (`perm_can_see_entity`'s live body), `20261013110000_notifications_v3` (`spine__visible_to`), `20260625120000_spine_entity_links` (the links read rule), TV-D11b `20261011120000` (the delta-read pattern) |
| | `20261014100100_chat_v2_convert_v1.sql` | The one-time conversion and backfills (§2.6) | the foundation; Notes' tables (`20260703120000` and later), `entities_op_ensure` |
| | `20261014100200_chat_v2_core_ops.sql` | The 18 ops redefined (v2 form, mentions and `@Team` read on the server, client-minted ids, keyset reads, manager rules); the v1 signature wrappers; `chat_op_restore`, `chat_op_typing`; `chat_unread_counts`, `chat_sync_ids`, `chat_people`; the General-join trigger; the `chat-blank-deleted` job; activity rows; `account_erase_workspace_data` from its live body | the teams migrations (`20261010182000`, `20261013150000` → `…210000`) for `@Team`; the latest erasure body (TV-D13's `…180000` or whatever redefined it last) |
| **CV-2 · Chat in handed-out Team workspaces** (S) | `20261014110000_chat_v2_plan_source.sql` | `chat_workspace_enabled` reads the workspace's effective plan, falling back to the owner's while TX-9b's function doesn't exist | **TX-9b (not built)**, owned by the hackathon plan; works without it |
| **CV-3 · Pings that leave the app** (L) | `20261014120000_chat_v2_catchup.sql` | The fan-out in `chat_op_send` / `_edit` / `_agent_post`; bell twins; `notifications_op_dismiss` / `_undismiss` from their live bodies; `chat_op_mark_read` closing items; `chat_op_catchup_done` / `_reopen`, `chat_op_follow_chain` | CV-1; `20260713120000_notification_dismiss` (live bodies) |
| | `20261014120100_chat_v2_device_notices.sql` | `notice_deliveries` kinds and columns; `notice_deliveries__claim` from its live body; the kick-on-insert trigger; `user_clients`, `user_op_client_seen`, `notice_op_ack`; `notice__gate` (sends everything until CV-12 gives it rules); `user_op_set_chat_prefs` (show message text, email when away); `chat_waiting` in `EMAIL_KINDS` and the `email_outbox` CHECK; the `chat-waiting-emails` job | `20261013110000_notifications_v3` and `20261013140000_reminders_repeats_fixes` (the claim's and the URL check's live bodies); TX-3's `20261008233000` (`email_enqueue`); **on prod: `email-worker` with the template deployed first** |
| **CV-4 · Stream, composer and the new look** (L, mostly client) | `20261014130000_chat_v2_reactions.sql` | The reaction key and its check; `chat_op_react`; `comment_reactions`' CHECK and data; `comments_op_react` from its live body; the quick row in `user_op_set_chat_prefs` | TV-U13's `20261013100000_comment_reactions_edits` |
| **CV-5 · Files** (M) | `20261014140000_chat_v2_files.sql` | The `chat_message` branches of the attachments ops and policies (rows and storage objects); `chat_op_send` adopting pending files; `chat_files` | AT-1's `20261008210500` and `…210600` (AT-2 landed with no migration) |
| **CV-6 · Links in messages and "make a task"** (M) | `20261014150000_chat_v2_references.sql` | `chat_op_register_message`, `chat_message_refs`; "Mentioned in" links in send, edit (redefined); `chat_conversations_for_item` (the mentions half) | RF-1 and TV-U14 (no migrations); the registry |
| **CV-7 · Catch up, Later and Remind me** (M) | `20261014160000_chat_v2_later.sql` | `chat_op_remind`; the `chat-later` job; `chat_reminder` through the gate | CV-3 |
| **CV-8 · Replies and Wrap up** (M) | `20261014170000_chat_v2_chains.sql` | `wrapped_*`, `settled_id`, `reopened_*`; `chat_op_wrap_up`, `chat_op_reopen`, `chat_op_attach_to_chain`; send reopening; the open-chains index | CV-1, CV-3 |
| *— the hackathon line (CH26a); below, the teams-of-2–5 cut —* | | | |
| **CV-9 · Linked channels** (M) | `20261014180000_chat_v2_linked_channels.sql` | `linked_type/_id`; `conversation-of` in `RELATION_KINDS` and the `entity_links` CHECK; `chat_op_link_channel`; `chat_op_create_channel` with a link (CH56); `chat_conversations_for_item` (the link half) | projects and areas `20261010180000`; teams `20261010182000`; the overview slot is **TV-U16 (not built)** |
| **CV-10 · Decisions** (S) | `20261014190000_chat_v2_decisions.sql` | `decision_*`; `chat_op_mark_decision`; `chat_op_wrap_up` with "Also mark as decision"; `chat_decisions_for_item` | CV-8, CV-9 |
| **CV-11 · Channel lifecycle, permissions, moving** (L) | `20261014200000_chat_v2_channel_lifecycle.sql` | `chat_op_set_manager`, `chat_op_set_announcement`, `chat_op_make_private`, `chat_op_delete_channel` / `_restore_channel`, `chat_recently_deleted`, the `chat-purge-deleted` job; the role editor's chat rows | CV-3 (the removal and added lines); AT-1's `purge-deleted` schedule |
| | `20261014200100_chat_v2_move_messages.sql` | `moved_*`; `chat_op_move_messages`; the event lines | CV-6, CV-8 |
| **CV-12 · Quiet: statuses, presence, quiet hours, Focus** (L) | `20261014210000_chat_v2_statuses.sql` | `user_statuses`, `user_saved_statuses` and their ops; the expiry job; `chat_now`; the presence and focus preferences | TV-F6's `20261013130000_focus_runs_v3` |
| | `20261014210100_chat_v2_quiet_hours.sql` | Quiet hours on `user_preferences` with `user_op_set_time_region`, `user_time_region` and the guard from their live bodies; `notices_paused_at` + `workspace_op_pause_notices`; `notice__gate`'s rules + the `BEFORE INSERT` trigger on `notice_deliveries`; the Focus-ended trigger and summary | TV-D14's `20261013200000_user_preferences_time_region`; CV-3 |
| **CV-13 · Search in ⌘K** (S) | `20261014220000_chat_v2_search.sql` | `chat_search` (the columns and index came with CV-1) | CV-1 |
| **CV-14 · Custom emoji** (M) | `20261014230000_chat_v2_custom_emoji.sql` | `chat_custom_emoji`, the `chat-emoji` bucket and policies, its two ops, the `add_emoji` switch, custom names in the reaction check | CV-4 |
| **CV-15 · Agents and MCP tools** (M) | `20261015000000_chat_v2_agents.sql` | `chat_op_agent_post` from its live body (creator authorship, private opt-in, rate limit); the `include_private_chat` column; `chat_key_readers`; `chat_key_scope`; then the connector's redeploy | KEYS-1 (`20261008120000` → `…123000`); **TV-D16 (not built)**: ships on its "via <key>" surface if it has landed |
| **CV-16 · Home widgets and export** (M, client) | none | Reads `chat_catchup` and `chat_now`; the export reads | **TV-H1 (not built)** for the Team widget's slot |

**20 migrations in 15 data blocks.**

**The order on the local stack** (local build mode: the local stack is prod; one data block at a time, as the Tasks v3 runbook says):
1. **Only one chat block applies a migration at a time**, and never while a Tasks v3 block is applying one. A block's client work can start earlier; its migration waits its turn.
2. Before writing a redefinition, **read the live body** of every function it replaces (`select pg_get_functiondef('public.<fn>(<args>)'::regprocedure)`) and start from that, never from the repo's last file: several of them (`perm_can_see_entity`, `spine__visible_to`, `account_erase_workspace_data`, `notice_deliveries__claim`, `user_op_set_time_region`, `comments_op_react`) have been redefined by other blocks, and may be again.
3. Apply with `psql -v ON_ERROR_STOP=1 -f <file>` against the running stack. Never `supabase migration up` (the local stack has no migration history) and no `local:reset` mid-build (it reloads the prod snapshot and wipes local-only data, the research workspace included).
4. Re-assert the Realtime publication if the file publishes a table (`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`).
5. Run `bun run db:test chat` (new `supabase/tests/chat_*.test.sql`: owner, member, viewer, outsider, and an API key, for every op the block adds) and the block's round-trip checks (§2.6 for the conversion).
6. Then the block's app work, `bun run verify`, the perf gate when it touches the stream or the store, and the validator.
7. Before the release: one `local:reset` rehearsal of the whole chain (Tasks v3 + chat) on a fresh stack; then prod on the release train, in the same order, `email-worker` first (CV-3).

---

## 4. In-flight work

Checked 2026-10-13: `gh pr list --state open` (9 PRs) with each PR's changed files, and every remote branch whose name or diff touches chat, notifications, reactions, statuses or presence.

**Open pull requests.** None of the nine changes a chat file.

| PR | What | Touches chat? | Verdict for Chat | Effort |
| --- | --- | --- | --- | --- |
| #354 `[NR-1]` Notes: stored Inbox, per-user Favorites, full width (Mike) | `20261013120000_notes_refresh_organize` adds `notes.in_inbox`, required and without a default once applied | No, but the self-DM conversion writes notes | **Keep.** CV-1's conversion inserts notes with the live table's columns: if NR-1 has landed, it sets `in_inbox = true`, which also matches Notes' answer for "Make a note" (the person's Notes Inbox, private until filed, proposals.md) | S |
| #349 `[TX-5]` Booking emails | Its one migration (`…_tx5_booking_bell`) adds booking notices to the bell; the booking email kinds were already in TX-3's list | No | **Keep.** No effect on CV-3: CV-3 re-states the `email_outbox` CHECK from its live list plus `chat_waiting` | — |
| #327 `[AT-2]` Upload pipeline + panel + viewer | Attachments client | No | **Keep** (open until the release, as BUILD_ORDER says). CV-5 builds on what AT-2 landed on the integration branch | — |
| #323 `[TV-F2]` Queue run | Focus runs | No | **Superseded by TV-F6** (Tasks' call, already recorded). `chat_now` reads TV-F6's runs | — |
| #345 Workflow diet (Mike) | Process: PR-derived block state, generated decisions index | No | Keep. Chat's blocks follow whatever block-state rule it lands | — |
| #344 CI e2e smoke (Mike) | Playwright on PRs into develop | No | Keep. Chat's end-to-end specs run there once the release reaches develop | — |
| #319 `[TX-2]` Privacy policy lines | Policy text | No | Keep. **Follow-up for whoever owns the policy:** Chat v2 adds three uses of personal data worth a line: an email when a direct message waits an hour (CH43), statuses shown to everyone in your workspaces (CH45), and a per-device "last seen" row used to pick which device rings (§2.14 e) | S |
| #314 Tick PRIV-2d · #244 PRIV-3 analytics wording | Docs | No | No effect | — |

**Branches.**

| Branch | State | Verdict | Effort |
| --- | --- | --- | --- |
| `origin/t/maciej/docs-chat-decision` | Merged (#181, #187); nothing ahead of this branch | **Delete** | S |
| `origin/t/maciej/df-9-notification-generation`, `origin/t/maciej/df-19f-notif-toggles` | Merged in July; nothing ahead | Delete (not chat's; listed because their names match) | S |
| `claude/fervent-chatelet-0d9e21` (local) | An old refactor branch; "chat" is only in its generated name; nothing ahead | Not chat's | — |
| `t/mike/chat` | Merged as #204, #206 (v1 and its render-loop fix); gone from origin | Done | — |
| `origin/develop` / `origin/mike` | 26 commits not on this branch. `20261009180000_index_foreign_keys` adds four chat foreign-key indexes; `20261009200000_pin_function_search_path` touches no chat function | **Keep.** They merge at the release; chat's index names differ (§2.5) | — |
| `t/maciej/notes-replan` | Answered Chat's proposals (N19: reactions, past dates, quiet hours adopted; "Mentioned in" and decisions as quiet lines in Linked; "Make a note" into the Notes Inbox) | Keep; the server pieces for Notes' side are Notes' blocks | — |
| `t/maciej/hackathon-plan` (local) | No spec yet; owns TX-9b's grant | Keep; CV-2 degrades gracefully until the grant exists | — |
| `t/maciej/calendar-replan` | Paused | Keep; Calendar decides whether its own reminders break through quiet hours (proposals.md) | — |

**Not in flight, but Chat waits on it** (REPLAN §7): TV-D16 (the agents' surface; CV-15), TV-H1 (the Team widget's slot; CV-16), TV-U16 (the overview's slots; CV-9 and CV-10's client side), TX-9b (CV-2).

---

## 5. Risks, and the five spikes

**The five spikes** (REPLAN §6 #22, blueprint §C) run first, as CV-0, before CV-1's migration is final: spikes 2, 4 and 5 each shape it. Each has to prove the points below before its block may start.

| Spike | Days | Must prove before… | Pass when |
| --- | --- | --- | --- |
| **1. The list in the real webviews** | 2–3 | CV-4 (the stream) | TanStack Virtual (runner-up: Legend List 3) in the Tauri app on macOS (WKWebView) and Windows (WebView2), Chrome and Safari, on a 10,000-message fixture: the anchor row moves ≤ 1 px on every prepend, edit above the viewport, **Wrap up hiding replies mid-screen** and density switch; no pull while reading history; follows at the end; a jump to row 5,000 lands within 1 px; no frame over 50 ms in a 2 s fling; ≤ 3,000 elements; only the stream file opts out of the React Compiler |
| **2. The store and the device copy** | 2 | CV-1 (the store, and the `updated_at` + keyset design) | A cold open paints the newest 50 of 10,000 from IndexedDB in ≤ 100 ms; 500 messages written in one transaction cost ≤ 8 ms of main thread; after 1,000 missed changes a delta read equals a full read; keyset pages over 200 messages sharing one timestamp return each once; heap ≤ +50 MB. **Added here:** losing access is caught without any event, for each case of §2.7 (removed, channel deleted, made private, messages moved to a conversation you can't read): the conversation leaves memory and the device copy within one access check |
| **3. Realtime delivery and the plan's quotas** | 1 | CV-1 (the live merge) and CV-3 (pings); the CH31 decision | Two browser contexts plus 100 supabase-js clients on the local stack (publication checked first): p95 receive-to-visible ≤ 500 ms; zero requests per incoming message; a 60 s disconnect fills every gap. **Added here:** the cost of typing through `chat_op_typing` + `realtime.send` (one database call and one `realtime.messages` row per burst) at 20 typists; joining and leaving one typing topic per conversation switch stays under the joins-per-second cap. **Reports:** sockets per person (desktop + tab) and messages a second against Free (200, 100) and Pro (500, 500), for CH31 |
| **4. The stored form, round trip** | 1–2 | CV-1 (the conversion) and CV-4 (composer and renderer) | One list of supported constructs; Lexical export → stored text → parser → rows, and back into Lexical for edits; a 200+ case corpus (nested lists, code with backticks, references, the person URI's spelling agreed with RF-1, the `@channel` token, date chips, `:custom:`, Polish diacritics, URLs with brackets, HTML pasted from Slack and Google Docs): 100% parity; 30 rows parsed and drawn in ≤ 5 ms; ⏎ never sends during IME composition. **Added here:** the SQL converter `chat__v1_to_v2` run over the research workspace's 3,032 messages, each result parsed by the client parser with no v1 token or label left, and the count of v1 lines that change meaning as Markdown |
| **5. Search** | 1 | CV-1 (the columns) and CV-13 (`chat_search`) | `create extension unaccent` on the local stack, the immutable wrapper, the generated column over 100,000 messages: p95 ≤ 150 ms for 1–3 words; "zolw" finds "żółw", "zadan" finds "zadania" and "zadaniem"; a private channel's message never reaches a non-member (a SQL test as an outsider and as a plain member); ≤ 1 ms added per insert; the backfill of 3,032 rows ≤ 1 s |

**Risks**

| # | Risk | What it would cost | What's done about it |
| --- | --- | --- | --- |
| 1 | **Supabase Free's 200 Realtime connections** at the hackathon (~100 people × desktop + tab) | Chat stops updating live for some people at the event | Spike 3 measures; CH31 (b): move to Pro before the event if the peak passes ~150 |
| 2 | **Redefining shared functions** (`perm_can_see_entity`, `spine__visible_to`, `account_erase_workspace_data`, `notice_deliveries__claim`, `user_op_set_time_region`, `comments_op_react`) while Tasks v3 blocks redefine them too | One block silently undoes another's change | Read each live body before writing (§3 step 2); one migration at a time; these files are Tier 2 (`/code-review ultra` + `/claude-security` before the release) |
| 3 | **Builds from before `min_build`** keep calling v1 op signatures after the release | Their chat sends fail | The v1 signatures of send and edit stay one release as converting wrappers; raise `min_build` at the release; drop the wrappers after |
| 4 | **The conversion on prod data** (v1 has been live since 2026-10-06) | A message reads differently, or a person's unread jumps | SQL conversion, idempotent per step, round-tripped on the local stack (§2.6) and parity-checked (spike 4); the release train applies it once |
| 5 | **Rewriting `chat_messages`** for the generated search column | A lock while the table rewrites | Small tables today (local research data: 3,032 rows); `lock_timeout` set; run at the release train's quiet hour |
| 6 | **Email-worker before the kind** | Queued `chat_waiting` rows fail to send | Deploy `email-worker` with the template before CV-3's migration reaches prod (TX-3 rule) |
| 7 | **Two devices ringing**, or none | Noise, or a missed DM | The ack + hold design (§2.14 e), tested with two real clients (desktop + browser) before the release; signed desktop builds for OS notification identity |
| 8 | **A held or dropped ping is a missed ping** | Someone in quiet hours misses an urgent DM | That's the decided behaviour (CH7, CH41); everything waits in Catch up, and the person's status tells the sender ("She won't be notified") |
| 9 | **The deployed MCP connector on converted data** before CV-15 | An agent looks a channel up by a name with capitals and finds nothing | Ids keep working; CV-15 redeploys; until then, only new names typed with capitals are affected |
| 10 | **`unaccent` on prod** | The foundation migration fails if the extension can't be created | Spike 5 creates it locally; prod's extension list is checked on the release train before CV-1 applies |
| 11 | **Message-level registry rows and link rows** reach more readers than the conversation | A private conversation's existence shows through the spine | §2.25 a lands in the foundation, before any such row is written; the SQL tests read as an outsider, a plain member and a key |
| 12 | **Typing through a database call** costs more than client Broadcast | Database load at scale | Spike 3 measures it; the client throttles to one event per 3 s; the scale path (ids-only pokes) is ready if needed |
| 13 | **Gaps in the hackathon cut** if the date comes before TV-D12's push in prod or CV-5 | No pings outside the app, no files | CH68's stop-gap: notices from an open desktop app or tab only; files as task attachments or links |
