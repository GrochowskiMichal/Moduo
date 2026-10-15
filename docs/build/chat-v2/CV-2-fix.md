# CV-2-fix — Rules CV-2a and CV-2b share (server)

> Branch `t/maciej/cv-2-fix-rules` · head: the commit carrying this line · status: built, not landed
> Migration: `supabase/migrations/20261015140000_chat_v2_rules_fix.sql` · applied to the local stack: **yes** (as `supabase_admin`, `-1`, on its turn, after CV-2b's `20261014160000`). Before that every `supabase/tests/` file (48) passed with it inside one rolled-back transaction; it runs again cleanly over itself. Stamp provisional: it must stay after `20261014160000`.

## Delivered against the row

- **One manager rule.** A manager is someone with a manager row who is in the channel and whose role posts (`chat__is_manager`); an admin is the owner or "Manage any channel" (`chat__can_manage`). Every check reads those helpers:
  - **Posting in an announcement channel:** `chat_op_send` checks it before posting brings the sender back into the channel (a manager who left doesn't post their way back in as a manager); the row trigger `share_chat_message_guard` holds the same rule for every writer, an app's key included (it posts as its creator).
  - **Pinning:** `chat_op_pin` = "Manage any channel" or `chat__can_post` (which already reads `chat__is_manager` in an announcement channel).
  - **Announcement-only:** `share_op_announce` = `chat__can_manage`.
  - **The account erasure:** a channel the person managed is handed on unless someone else still manages it, counted through `chat__can_manage`, the way `chat__hand_over` counts them (anchored replace on the live body, like `20261014155205`). Its choice of the next manager is unchanged.
  - `chat__hand_over` already counted remaining managers through `chat__can_manage`; unchanged.
- **A removal is its own stamp.** `chat_members.removed_at` marks "a manager removed this person"; `removed_by` only says who (it goes with that person's account). `chat__was_removed` reads `removed_at`, so every check that keys on a removal (send, edit, pin, topic, join, add back, `chat__can_post`) does. `chat_op_remove_member` stamps both; `chat__enter` (join, a manager adding them back) and `chat_op_leave` clear both. A CHECK (`chat_members_removal_check`) keeps it whole: a removal is a way of leaving (`left_at` set with it), and a remover is recorded only on a removal. Backfilled: every row with `removed_by` and `left_at` got `removed_at = left_at`.
- **Channel names clash only with channels the creator can see** (rule below). `chat_channels_public_name_uq` (live public channels, ignoring case) replaces `chat_channels_live_name_uq` and v1's `chat_channels_name_uq`; `chat__name_taken(ws, name, except, user)` (4 arguments; the 3-argument one is dropped) checks live channels the person can see; `chat__lock_name(ws, name)` takes one create or rename per name at a time (no index holds private names). `chat_op_create_channel`, `chat_op_update_channel` (rename) and `chat_op_bootstrap` (General, public names only) read it. A deleted channel's name is free.
- **Grants** re-stated by name and asserted (helpers server-only; ops signed-in people and the service role, never anon; the trigger and the erasure server-only). The sending limits (`chat_send_limit`, `chat_op_typing`) are untouched, asserted in place.
- **Tests:** `supabase/tests/chat_rules.test.sql` (new, 64 checks); `chat_ops.test.sql` (removal rows written with `removed_at`, the stamp asserted, the helper's new signature) and `chat_foundation.test.sql` (the index's name) updated for the new truth.

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| Manager rule: send | `chat_rules.test.sql` · "announcement: a manager who left can't post (and isn't brought back by trying)", "… a manager whose role is read-only can't post", "trigger: a manager who left can't post a row", "key: the app of a manager who left can't post" (+ controls: the manager in it posts, A's app posts) |
| Manager rule: pin | `chat_rules.test.sql` · "pin: a manager who left can't pin in an announcement channel", "pin: nor a read-only manager" (+ the manager in it pins, an admin outside unpins) |
| Manager rule: announcement-only | `chat_rules.test.sql` · "announce: a manager who left can't switch it", "announce: nor a read-only manager" (+ the manager in it switches it off and on) |
| Manager rule: erasure | `chat_rules.test.sql` · "erasure preview: H is handed on (its other manager row is a viewer's)", "erasure: H gets the workspace owner as its manager"; `chat_erasure.test.sql` holds |
| Removal outlives the remover | `chat_rules.test.sql` · R removes Z from a public and a private channel, R's data is erased and R's account deleted: "who removed Z is gone, the removal stays", "Z still can't join the public channel again", "nor post in it", "Z can't join the private one", "nor read it", "a member who doesn't manage it can't add Z back"; the managers the erasure handed the channels to add Z back; leaving on your own is no removal |
| Backfill | migration's assert block ("A removal without its stamp is left"); `chat_rules.test.sql` · "every removal on the stack carries its stamp" |
| Names, both directions | `chat_rules.test.sql` · a private channel someone isn't in never refuses their name (private and public create, rename of a private and of a public channel); a channel they can see does (their own private one, one they're in, any public one; renames too); the index holds public names only; a deleted name is free; General is "General" beside a private "general" |

With the migration applied: `bun run db:test` → all 48 SQL files pass; `bun run verify` green (once, through `quiet.sh`).

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **A channel's name clashes with every live channel its creator (or renamer) can see**: every public channel, and the private ones they're in; public channels are unique among themselves, ignoring case (the index) · agent, refines CH3a ("unique in the workspace ignoring case among live channels") · a refusal can only ever be about a channel the person can see, and public channels are everyone's to see, so their uniqueness costs nothing · rejected: workspace-wide uniqueness with a neutral message (the refusal is itself the tell); public names unique and private names never checked (two private channels the same person is in could share a name); suffixing a clashing name ("Name 2"), which tells the same thing and surprises. Consequence: a public and a private channel (or two private ones with no one in both) can share a name; someone in both sees two.
- **General counts public names only** · agent · it is made on the workspace's behalf, by whoever opens chat first, so a private channel's name must not move it to "General 2" · rejected: counting what the opener can see (General's name would depend on who opened chat first).
- **The erasure counts remaining managers through `chat__can_manage`**, as `chat__hand_over` does (an admin's manager row counts) · agent · one rule for "someone still manages it" · rejected: `chat__is_manager` there only (it would differ from leave and remove). Its choice of the next manager stays as it was (CV-15).
- **A send checks the announcement rule before it brings the sender back into the channel** · agent · posting never makes anyone a manager in effect again · rejected: the row trigger alone.
- **A CHECK keeps the removal whole** (`removed_at` only with `left_at`; `removed_by` only with `removed_at`) · agent · un-removing someone is then only possible through the paths that clear the stamp (`chat__enter`) · rejected: convention only.
- **Renames and creates take a per-name lock** · agent · no index holds private names, so two creates of one private name by people who see each other's channels would both pass the check · rejected: the check alone (it races).

## Gotchas (area: supabase · chat)

- **(chat)** Check a membership rule ("in the channel") in the op, before any membership upsert the op makes; the row trigger is the backstop for other writers.
- **(chat)** A test that writes a removal directly must set `removed_at` with `removed_by` (CHECK `chat_members_removal_check`); "was removed" is `removed_at`, never `removed_by`.

## For later blocks

- **CV-3:** a membership row with `left_at` is not a membership; `removed_at` set means a manager removed you (`removed_by`, who, may be null when their account is gone). Read `removed_at`, never `removed_by`.
- **CV-15:** `chat_channels_name_uq` is already gone (delete needn't drop it); any private → public switch must check public names (`chat_channels_public_name_uq` refuses a clash; a public channel is everyone's to see); `chat_op_set_manager` and the add/remove-manager paths should read `chat__is_manager` / `chat__can_manage`; the erasure's choice of the next manager still uses its own rule (a public channel's fallback can pick a workspace member not in it, and the member pick doesn't skip read-only roles): align it with `chat__hand_over`.
- **Everyone creating or renaming channels:** `chat__name_taken(ws, name, except, user)` (no user: public names only) after `chat__lock_name(ws, name)`.
- **Orchestrator:** this file must stay after `20261014160000`; it redefines `chat_op_send` (4-argument), `chat_op_pin`, `share_op_announce`, `share_chat_message_guard`, `chat_op_leave`, `chat_op_remove_member`, `chat_op_create_channel`, `chat_op_update_channel`, `chat_op_bootstrap`, `chat__enter`, `chat__was_removed` from their 2026-10-15 live bodies, so a later block redefining any of them starts from these.

## Manual checklist (step → expect → surface)

- [ ] Apply the migration, then `bun run db:test chat` → 11 files pass → terminal
- [ ] v1 Chat, as a channel's creator: remove someone, then `select removed_at, removed_by from chat_members …` → both set → Chat + psql
- [ ] Make a private channel "Skunkworks"; as someone not in it, create a public "skunkworks" → it's made; as someone in it, the same name → "already exists" → Chat (two browsers)
- [ ] An announcement channel: a member posts → refused; its manager posts and pins → fine → Chat

## Verify before release

- Before applying on prod: `select count(*) from chat_members where removed_by is not null` (v1 deleted rows on removal, so expect 0; each such row gets `removed_at = left_at`), and that no two live public channels share a name ignoring case (the new index is a subset of the old one, so it builds).
- Release order: after CV-2b's file; it replaces `chat__name_taken(uuid, text, uuid)`, so nothing deployed may call the 3-argument one (only the ops did).
