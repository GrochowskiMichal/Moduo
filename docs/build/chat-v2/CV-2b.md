# CV-2b — Conversation ops v2 (server)

> Branch `t/maciej/cv-2b-conversation-ops` · head: the commit carrying this line · status: built, not landed
> Migration: `supabase/migrations/20261014160000_chat_v2_conversation_ops.sql` · applied to the local stack: **yes** (as `supabase_admin`, `-1`, on its turn, after CV-1's two files, `20261014155205_chat_send_limits.sql`, CV-2a and CV-4). Before that every `supabase/tests/` file (chat and the 37 others) passed with it inside one rolled-back transaction. It runs again cleanly over itself. Stamp provisional: it must stay after `20261014150000` (CV-2a) and `20261014155205`.

## Delivered against the row

- **Names as typed** (`chat__channel_name`): trimmed, one line, 1–80 characters; unique ignoring case among live channels, refused with `23505 A channel named "…" already exists.` (also when two creates race on the index). Topics trimmed, ≤ 250 (`22023`, with the count, as v2 send does).
- **`chat_op_create_channel(ws, name, topic, is_private, member_ids, announcement)`**: one signature (v1's 5-argument one dropped; v1's named call resolves to it). Needs "Create public / private channels" (checked in the op; `share_chat_channel_guard` stays the backstop). The creator manages it and, like everyone added, is on Mentions and replies (never forced onto Every message). The announcement switch at creation (`managers_only`). Registered in `entities` under its name. CV-13 adds the link arguments.
- **`chat_op_open_dm(ws, user_ids)`**: 2–9 people with the opener, one live conversation per set; the opener's role must post (viewers receive, never start one); everyone must be in the workspace; never only yourself (notes to self don't exist). A deleted DM is never reused: `chat_channels_dm_uq` became `chat_channels_live_dm_uq` (`deleted_at IS NULL`). Registered without a label. Someone who left a DM comes back by opening it; the others who left stay out.
- **Who manages:** *Admin* = the owner or "Manage any channel"; *Manager* = a manager row of someone still in the channel whose role posts (`chat__is_manager`; a leftover row or a read-only role manages nothing).
- **`chat_op_update_channel(channel, name, topic)`**: rename is the managers' and admins'; the topic is any role that posts and wasn't removed (in an announcement channel only its managers), or a manager/admin; the registry label follows the name. Archived channels refuse both.
- **`chat_op_archive_channel(channel, archived)`**: managers and admins; General can't be archived; a repeat changes and logs nothing.
- **`chat_op_join`**: public, open channels; viewers too; someone a manager removed is refused (`42501 You were removed from this channel. A manager can add you back.`).
- **`chat_op_leave`**: stamps `left_at` (never deletes); works while chat is paused; leaving twice is fine; leaving General sticks; a last manager who leaves hands the channel on (`chat__hand_over`: the workspace owner if they can read it, else its earliest remaining member whose role posts; nobody if none, admins still manage it). Leave and remove lock the channel row, so two managers leaving at once can't both skip the hand-over.
- **`chat_op_add_members`**: public: any role that posts (and wasn't removed); private: managers and admins. Someone a manager removed comes back only through a manager or admin. Returns how many joined.
- **`chat_op_remove_member`**: managers and admins; stamps `left_at` + `removed_by` on the person's own row (its `updated_at` moves, so it reaches them live); a removed last manager hands the channel on; removing yourself is leaving. This is what CV-2a's send rule ("You were removed from this conversation.") waited for.
- **`chat_op_set_prefs(channel, notify_level, starred)`**: same signature (`starred` is "Pin to sidebar"); members who haven't left; no plan needed.
- **The read mark is a message:** `chat_op_mark_read(channel, message_id)` moves `last_read_id` forward only (never by the clock), `chat_op_mark_unread(channel, message_id)` to just before that message (`NULL` + a time just before it when it's the first). `last_read_at` is kept in step for v1's screens. v1's `(channel, timestamptz)` signatures stay as wrappers (the newest message at or before the time / the first at or after it).
- **`chat_op_bootstrap(ws)`** returns General: flags an older workspace's live public "general" that v1's bootstrap made (the owner's or nobody's, never a member's own channel of that name), or makes "General" in the owner's name (whoever opens chat first, a viewer too; " 2" when the name is taken), then puts everyone in the workspace who has no row in it into it (a `left_at` row keeps someone out). A trigger on `workspace_members` insert (`chat_join_general`) joins new members. Neither ever puts anyone into a private conversation. `share_chat_channel_guard` keys General's exemption on `is_default`.
- **`chat_unread_counts(ws)`** → `channel_id, unread, mentions, addressed, catchup` per conversation you're in (live, not archived), no plan needed: `unread` counts messages from others after your mark, replies included (bold); `mentions` the ones naming you, a team of yours, or `@channel`; `addressed` the number §2 shows (a DM's unread, everything on Every message; on Mentions and replies: your mentions, announcement posts, replies in chains you're in or to your own messages; 0 on Nothing); `catchup` its share of Catch up's count (one item per such message, one per chain for replies, one for the rest of an Every message conversation). A converted v1 reply is unread only if its root is.
- **`chat_sync_ids(ws, since)`** (spike 2's draft on the live read rule): `conversation`, `member`, `moved_away` rows plus one `checked` row that always carries `checked_at`.
- **`chat_people(ws)`**: name and avatar of everyone in, or who wrote in, a conversation you can read; `former` when they're no longer in the workspace.
- **Activity (#15, ids only):** `chat.channel_create` (`is_private`), `channel_rename`, `channel_topic`, `channel_archive` / `_unarchive`, `join`, `leave` (`manager_id` on a hand-over), `member_add` (`user_ids`), `member_remove` (`user_id`, `manager_id`), each only when something changed. Opening a DM, bootstrap, read marks and preferences log none.
- **The erasure** needed no change: CV-1's body already counts only current members who haven't left (`chat_erasure.test.sql` holds).
- **v1's screens keep working** (client, two small changes): `mapMember` reads a stamped row as no membership, and the realtime link turns a stamped row into `membership-removed` (v1 deleted the row; without this a channel you left came back to the sidebar at once).
- **Tests:** `supabase/tests/chat_ops.test.sql` (conversations half: 259 checks in all), `supabase/tests/chat_counts.test.sql` (45, new), `src/features/chat/realtime.test.ts` (+1). Updated for the new truth: `chat_privacy`, `chat_plan`, `chat_send_limits` (General looked up by `is_default`; P registered by its create; leaving logged) and `tests/chat-plan.spec.ts` (General by `is_default`); `privacy-rules.test.ts` probes this migration.

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC10.1 | `chat_ops.test.sql` · every conversation op as owner, admin, manager, member, custom role, viewer, outsider and a key: §12's rows (rename, topic, archive, add to public/private, remove, join, leave, start a DM, create) |
| AC10.2 | `chat_ops.test.sql` · "names": "Launch v1" stored as typed, "launch v1" refused, a name of spaces, 81 characters and a line break refused, 80 fine, trimmed; rename to another channel's name refused, a change of case allowed |
| AC10.7 | `chat_ops.test.sql` · "last manager": public → the owner; private the owner isn't in → its earliest remaining member; removed by an admin → the same; not the last → nobody added. (The un-manage half is CV-15's `chat_op_set_manager`.) |
| AC1.12 (partly) | `chat_ops.test.sql` · the announcement switch at creation (only its manager posts); "Manage any channel" is what makes an admin (D renames, archives, removes; with the switch off D can't). Adding managers and flipping the switch later are CV-15's; hiding "Start calls" is the client's |
| AC1.7 | `chat_counts.test.sql` · replies count; the creator lands on Mentions and replies; mentions, team mentions, `@channel`, chain replies, replies to you, announcement posts; Every message is one Catch up item; Nothing and muted DMs count nothing; deleted rows and event lines never count |
| AC1.2 | `chat_counts.test.sql` · 200 unread, the screen showed 50: only those are read and the mark is the 50th; never back; Mark unread counts the whole conversation (200, then 80) |
| AC6.5 | `chat_ops.test.sql` · "former member": E (a contractor) leaves the workspace: `chat_people` keeps E's name with `former`; A still reads their DM and has it in `chat_sync_ids` |
| AC12.1 (conversations) | `chat_ops.test.sql` · one attributed row per logged op, ids only, none on a repeat; none for DMs, bootstrap, marks and preferences; the plan check skipped by leave and preferences only (and the reads) |

With the migration applied: `bun run db:test chat` → 10 files pass, and all 47 SQL files; `bun run verify` green (once, through `quiet.sh`); `scripts/agent/e2e.sh tests/chat-plan.spec.ts` → 2 passed. Research workspace: `chat_unread_counts` 16 ms, `chat_sync_ids` 2.4 ms, `chat_people` 2.5 ms.

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **A new workspace's General is named "General"** · agent · names are as typed and §1 calls it "General"; older workspaces keep their "general" (flagged, not renamed) · rejected: keeping v1's "general".
- **Bootstrap puts everyone without a row in General each time it runs**, not only when it makes General · orchestrator ("every reader of General a member so they can type there") · v1-era leavers (v1 deleted the row) come back once; a `left_at` row keeps someone out from now on · rejected: a migration backfill (the conversion chose "nobody added").
- **Everyone in the workspace is put in General, chat access or not** · agent · being in it reads nothing without "chat.view"; when their role gains chat they're already in · rejected: filtering by chat access (they'd miss General until the next bootstrap).
- **Joining or being added starts you at the newest message** (the history isn't addressed to you), also on a rejoin · agent · rejected: keeping an old mark (hundreds unread after a rejoin).
- **Someone a manager removed can't join again or be added back by a member**; a manager or admin can add them · agent (CV-2a's open question) · otherwise removing someone from a public channel means nothing.
- **An archived channel takes no joins, adds, renames or topics; leaving and removing still work** · agent · taking access away is always allowed.
- **General can't be archived** · agent · new members land in it (round-3 made it undeletable; archiving is the same harm).
- **Removing yourself is leaving** (no `removed_by`), as v1's op allowed · agent.
- **Adding people to a public channel needs a role that posts** (§12's "Member"), even in an announcement channel · agent · the table's column is the role · rejected: "poster in this conversation" (round-3's wording).
- **The topic needs a role that posts and wasn't removed (only managers in an announcement channel), or a manager/admin**; being in a public channel isn't required, as for posting · agent (§12 "agent's choice").
- **An admin can't manage a private channel they aren't in** (they don't see it); a member of it adds them · agent · private channels are invisible to everyone not in them.
- **The hand-over never adds the owner as a member** of a public channel (they manage it from outside, as an admin can) · agent · matches the erasure's rule.
- **The hand-over skips read-only roles**: the earliest remaining member whose role posts, else nobody (admins still manage it) · agent (validator) · §12 gives viewers no management · rejected: the spec's literal "earliest remaining member" (a viewer could rename, archive and remove); the erasure still uses the literal rule (CV-15 may align it).
- **A manager is a manager in effect only while in the channel and in a role that posts** · agent · a v1 leaver's leftover row or a role turned read-only manages nothing · rejected: the manager row alone.
- **Bootstrap flags only the "general" v1's bootstrap made** (created by the owner or nobody) · agent · a member's own "general" never becomes General · rejected: any live public "general".
- **Duplicate names answer `23505`**, other bad input `22023` · agent · the client can put it on the name field; a race on the index answers the same.
- **A topic over 250 is refused**, not cut · agent · v1 cut it silently.
- **A DM's people who left stay out when someone else opens it**; the opener is back in · agent · leaving a group DM must stick.
- **Counts:** a chain is "yours" from the reply or mention that put you in it on (earlier replies don't count); `@channel` counts on Mentions and replies; an announcement post counts once; team mentions count for teams you're in (the team's mute is CV-5's); archived conversations have no row · agent (§11's Count column).
- **`catchup`** is derived from the mark until CV-5's items exist · agent · the Chat tab's count needs it now; CV-5 replaces it.
- **`chat_sync_ids` always returns a `checked` row** · agent · the store gets `checked_at` even when it can read nothing.
- **`chat_people` lists members and authors**, not people only mentioned · agent (round-3's definition); a deleted account has no row (the client reads it as "Former member").
- **The reads (`chat_unread_counts`, `chat_sync_ids`, `chat_people`) are signed-in people's only**, not the service role's · agent · they answer for `auth.uid()`; keys read no chat through these.
- **Marking read in a public channel you only read is a no-op**, not an error · agent · the client may call it while browsing.
- **v1's client gets two small changes** (`mappers.ts`, `realtime.ts`) so a stamped row isn't a membership · agent · "keep v1's screens working until CV-3"; without them a channel you left reappeared at once.

## Gotchas (area: supabase · chat)

- **(supabase)** `chat_ops.test.sql` already makes people F and H (CV-2a's limits); `test.person` twice is a `users_pkey` error. Pick a new letter.
- **(chat)** Every op in one test transaction stamps the same `now()`, so messages sent through ops tie on `created_at` and order by id. To test read marks and counts, insert rows at fixed `created_at` (as `chat_counts.test.sql` does with `test.put`).
- **(supabase)** Changing a function's return type (bootstrap `void` → row, `chat_unread_counts`' new columns) needs `DROP` + `CREATE`; re-state its grants.
- **(chat)** A manager row isn't enough to manage: use `chat__can_manage` / `chat__is_manager` (in the channel, a role that posts), not `EXISTS (… chat_channel_managers …)`.
- **(chat)** `chat_channels_name_uq` (all channels, deleted ones too) still exists beside `chat_channels_live_name_uq`: a deleted channel's name blocks a new channel until CV-15 drops it.

## For later blocks

- **CV-3:** `chat_op_mark_read(p_channel_id, p_message_id)` / `chat_op_mark_unread(p_channel_id, p_message_id)` (named params; v1's `p_at` / `p_before` are the wrappers). `chat_op_bootstrap` returns General; call it when the store holds no General. `chat_unread_counts` → `unread` (bold), `addressed` (the number), `catchup` (the Chat tab's count); `chat_sync_ids(ws, since)` rows `conversation` / `member` / `moved_away` / `checked`; `chat_people(ws)` with `former`. A membership row with `left_at` is not a membership (`removed_by` set: a manager removed you). Drop the v1 lines in `mappers.ts` / `realtime.ts` with v1's screens.
- **CV-5:** replace the `catchup` column with the real items; close items in `mark_read`; add the team's mute to `addressed`.
- **CV-15:** `chat_op_set_manager` must refuse the last manager un-managing themselves and can reuse `chat__hand_over` (lock the channel row first, as leave and remove do); `share_op_announce` and its replacement should use `chat__can_manage`; the quiet `added` / `removed` lines go into `chat_op_add_members` / `chat_op_remove_member`; archive closes Catch up items; delete must drop `chat_channels_name_uq` and refuse General (`is_default`); `chat__can_manage` / `chat__can_post` are the shared rules.
- **CV-13:** add the link arguments to `chat_op_create_channel` (DROP the 6-argument one, re-grant).
- **CV-14:** `chat_sync_ids` reads a `moved_out` line's `event.ids`.
- **CV-23:** drop `chat_op_mark_read(uuid, timestamptz)`, `chat_op_mark_unread(uuid, timestamptz)` and `chat_normalize_channel_name`.
- **Orchestrator:** when the stamp is re-cut, update `MIGRATION` in `src/features/chat/privacy-rules.test.ts`. `tests/chat-plan.spec.ts` now finds General by `is_default`.

## Manual checklist (step → expect → surface)

- [ ] Apply the migration, then `bun run db:test chat` → 10 files pass → terminal
- [ ] v1 Chat: leave a public channel → it leaves the sidebar and stays gone after a reload; `select left_at from chat_members …` is set → Chat + psql
- [ ] v1 Chat, as a channel's creator: remove someone → it leaves their sidebar live; Browse → Join answers "You were removed from this channel. A manager can add you back." → Chat (two browsers)
- [ ] A new workspace with two people: open Chat → "General" exists, both are in it → Chat
- [ ] Create "Launch v1", then "launch v1" → the second is refused as a duplicate → Chat
- [ ] Mention someone in a channel → their number goes up; a plain message only turns the name bold → Chat (two browsers)

## Verify before release

- `chat_people` reads every author of the conversations you can read: time it on a workspace with 100k messages (the research workspace takes 2.5 ms).
- `chat_unread_counts` with many unread replies (each checks its chain) and `chat_sync_ids` at a few hundred channels.
- Old desktop builds call `chat_op_create_channel` with v1's five named arguments: they resolve to the new one (`p_announcement` defaults to false); they call `chat_op_mark_read(p_channel_id, p_at)` through the wrapper.
- Old desktop builds without this block's `mapMember` change read a stamped row as a membership: a channel left or removed from stays in their sidebar (and Leave seems to do nothing) until they update. Weigh it for `min_build` at the release.
- Release order: this file after CV-2a's and the v1 limits'; `chat_join_general` fires for every workspace member insert from then on.
