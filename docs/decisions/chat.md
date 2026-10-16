# Decisions: Chat

Full entries for this area, newest first. The one-line index of every area is [docs/decisions.md](../decisions.md). Add new entries at the top here **and** a one-line pointer in the index. Earlier chat lines (v1 ships as the 7th tab, 2026-10-06; chat + calls become a planned module, 2026-10-02) stay under Billing and Product in the index.

## 2026-10-16 · CV-21 (agents and MCP tools) — the agent's choices; five are open calls for Maciej

Migration `20261017123000_chat_v2_agents.sql`; see [the record](../build/chat-v2/CV-21.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16. CV21-1…CV21-5 are open calls for Maciej. The record holds the rest.

- **CV21-1 · ❓ A key's reply switch lives in the person's preferences (Settings → Preferences → Chat), on by default** → ❓ Maciej
  - Who: agent's choice, deferred — confirmed for building, revisitable (open call for Maciej).
  - Decision: one switch per key of yours that reads chat, "Replies to posts by <key>", stored as `chatKeyReplies.<key id>`; off means a reply doesn't reach the creator at all (no Catch up item, bell or notice) unless it mentions them; on makes it an ordinary reply.
  - Why: it's the creator's own notification, and a column on the key would let any key manager change it; held items would still pile up CI chatter.
  - Rejected: a column on `workspace_api_keys`; a held Catch up item.
- **CV21-2 · ❓ Only the key's creator turns "Include private channels I'm in" on; any key manager turns it off** → ❓ Maciej
  - Who: agent's choice, deferred — confirmed for building, revisitable (open call for Maciej).
  - Decision: `workspace_api_keys_set_private_chat(key, on)` enforces it; a key reads a private channel only with the switch on while its creator is a member, and never a direct message; Details' People section names the apps that can read a private channel.
  - Why: the switch opens the creator's own channels.
  - Rejected: any manager turning it on.
- **CV21-3 · ❓ An announcement channel refuses a key's post unless its creator manages the channel** → ❓ Maciej
  - Who: agent's choice, deferred — confirmed for building, revisitable (open call for Maciej).
  - Decision: an agent's `@channel` from a creator who may not use it is sent as plain text, but a post in an announcement channel can't be turned into plain text, so it is refused.
  - Why: the key posts with the creator's rights and no more.
  - Rejected: letting a key post where its creator can't.
- **CV21-4 · ❓ A key creates a private channel only with its private switch on** → ❓ Maciej
  - Who: agent's choice, deferred — confirmed for building, revisitable (open call for Maciej).
  - Decision: a key without the switch checks name clashes against public channels only.
  - Why: otherwise it couldn't read what it made.
  - Rejected: creating channels the key then can't read.
- **CV21-5 · ❓ The creator gets no reply item for their own agent's replies** → ❓ Maciej
  - Who: orchestrator's call, revisitable (open call for Maciej).
  - Decision: a reply posted through the creator's own key gives them no Catch up "reply" item, bell row or notice, and doesn't count as addressed to them; it still counts as unread. Someone else's reply in that chain reaches them as usual.
  - Why: the creator shouldn't be told of their own agent's work.
  - Rejected: treating the agent's replies as ordinary replies.
- **CV21-6 · The post keeps its v1 signature and runs as the creator** → CV-21
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `chat_op_agent_post` keeps `p_parent_id` (the answered message); the author is the key's creator with `author_kind 'api_key'`; it joins the answered message's chain like `chat_op_send`; 30 posts a minute per key.
  - Why: the deployed connector calls it by name between the migration and the redeploy.
  - Rejected: `p_reply_to_id` with DROP + CREATE.
- **CV21-7 · A key's post is the creator's for edit, delete and wrap-up on the server; the app offers Edit, ↑-edit and "Reply privately" only on what a person wrote** → CV-21
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the post is theirs, via a delegate; a key's post counts as new to its creator.
  - Why: the existing `author_id = you` rules already say it.
  - Rejected: special-casing `author_kind` in four ops.
- **CV21-8 · The writes take the acting person and every manifest op is workspace-scoped** → CV-21
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `chat__react_as`, `chat__mark_decision_as`, `chat__wrap_up_as` and `chat__create_channel_as` hold one body each; the app's ops pass `auth.uid()` and the agent ops pass the key's creator after the key's rules; the agent ops take the workspace id and refuse another workspace's; trails read "<person> · via <key>".
  - Why: one body each.
  - Rejected: parallel copies of the bodies.

## 2026-10-16 · CV-20 (custom emoji) — the agent's choices (deferred to by Maciej)

Migration `20261017122000_chat_v2_custom_emoji.sql`; see [the record](../build/chat-v2/CV-20.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16. The record holds the rest.

- **CV20-1 · A name is 2–32 characters of a–z 0–9 - _ with a letter, no `+`; never a standard shortcode** → CV-20
  - Who: agent's choice, deferred — confirmed for building, revisitable.
  - Decision: the intersection of the brief's `[a-z0-9_-]{1,32}` and the text grammar, so every name also draws in a message; unique per workspace among live emoji.
  - Why: a one-character name would never draw as `:x:`.
  - Rejected: 1-character names.
- **CV20-2 · Images live under an upload slot the server mints, not under a content hash; the add op takes the slot, not paths** → CV-20
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `chat_op_custom_emoji_begin` mints a slot for one person in one workspace (an hour, at most 20 open); the image and its poster frame upload under it; `chat_op_custom_emoji_add(slot, …)` names the paths and consumes the slot. Identical images are not shared.
  - Why: nobody can take or prepare another person's path, and the server can't check a hash.
  - Rejected: `<sha256>` paths with dedupe, and the brief's `(ws, name, path, poster_path, …)` signature.
- **CV20-3 · A JPEG is accepted and stored as the PNG it becomes; an APNG counts as animated** → CV-20
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: still images are redrawn at 128 px as PNG; animated ones over 128 px or 256 KB are refused and stored as they are otherwise, with a still frame; SVG never.
  - Why: stored types stay PNG, GIF and WebP as the spec says; browsers animate an APNG, so it needs its still frame.
  - Rejected: storing JPEG.
- **CV20-4 · "Add emoji…" in the picker opens Settings → Chat** → CV-20
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: one place to add; the picker shows the workspace's section first and the `:` menu puts custom emoji first.
  - Why: one upload surface.
  - Rejected: a second upload dialog in the composer.
- **CV20-5 · The export carries only the emoji you added, outside the chat file budget; erasure unattributes the rest** → CV-22
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the account export holds your own emoji (at most 500 × 256 KB) as `chat/files/emoji/<name>.<ext>`; erasure sets `created_by` to null in other workspaces and removes the owned workspaces' images.
  - Why: the export is your data; the workspace's emoji stay for the people who use them.
  - Rejected: exporting every live emoji of the workspace.
- **CV20-6 · Removed emoji's images stay in storage until a purge job exists** → polish
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: removal is a soft delete; abandoned or failed upload slots also leave objects behind; the purge (objects no live row names, older than the slot hour) is deferred.
  - Why: soft delete keeps a removal undoable and the purge needs its own job.
  - Rejected: deleting storage objects in the remove op (Storage refuses a direct delete in SQL).
- **CV20-7 · An animated emoji draws its still frame until hover, and never plays with reduced motion** → CV-20
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: one glyph component (an `<img>`) in the picker, bodies, reaction chips and comments; a removed or unknown name reads `:name:`.
  - Why: motion is opt-in and a removed emoji must stay readable.
  - Rejected: always-playing GIFs.

## 2026-10-16 · CV-14 (decisions) — the agent's choices (deferred to by Maciej)

Migration `20261017121000_chat_v2_decisions.sql`; see [the record](../build/chat-v2/CV-14.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16. The record holds the rest.

- **CV14-1 · Marking a decision needs post rights in the conversation, nothing more; any poster may unmark anyone's** → CV-14
  - Who: agent's choice, deferred — confirmed for building, revisitable.
  - Decision: `chat__can_post` decides (an admin outside an announcement channel can't mark there); the verb belongs to members, not authors; a workspace member may mark in a public channel they haven't joined.
  - Why: a decision is a statement about the conversation, and §12 gives the verb to members.
  - Rejected: pin's extra "Manage any channel" path; only the marker unmarking.
- **CV14-2 · Wrap up with "Also mark as decision" is refused as a whole when the wrapper can't post** → CV-14
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the app shows the tick only to people who can post; the tick is on by default in a linked channel and follows the conversation's link while the dialog is open until you change it.
  - Why: the ops decide and the menu doesn't offer what they refuse.
  - Rejected: silently skipping the mark; reading the link once on open.
- **CV14-3 · Undo of a wrap-up also takes back the decision that wrap-up made, in the same op** → CV-14
  - Who: orchestrator's call after review, deferred to by Maciej, 2026-10-16.
  - Decision: `chat_op_reopen` takes back a decision stamped with the wrap-up's own time within the 10 s window, never one marked before or by someone else, and writes no "took back" line.
  - Why: Undo should leave things as they were, and a failure can't leave half of it.
  - Rejected: a second call from the toast.
- **CV14-4 · A decision on a deleted message stays stored but hidden; a decision follows a moved message** → CV-14
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: restoring brings the decision back; a deleted message can't be unmarked; a move (CV-16) leaves `decision_at/by` on the row and re-links its mentions.
  - Why: delete and move both have an Undo.
  - Rejected: clearing the decision on delete.
- **CV14-5 · On an item: every decision of a linked channel; from a mentioning conversation only decisions whose own text refers to the item** → CV-14
  - Who: agent's choice (the brief's rule), deferred to by Maciej, 2026-10-16.
  - Decision: `chat_decisions_for_item` returns only conversations the caller reads and only for an item the caller can open; 50 newest.
  - Why: a mention in passing shouldn't promote every decision of that conversation.
  - Rejected: every decision of any mentioning conversation.
- **CV14-6 · "Decided with Ana, Mike and 2 others" for a direct message, "Decided in acme" for a channel; the label is a quiet line under the message** → CV-14
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the label reads like "Became a task" (flag + "Decision"), not a chip in the name row, so it survives grouped rows.
  - Why: the frames don't draw it.
  - Rejected: a chip in the name row.
- **CV14-7 · ⇧D works only in the stream; the chain panel unmarks through "Unmark" beside the label; no pace limit; no "Decided" line in Catch up or the bell** → CV-14
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the chain panel has no message menu yet; marking writes no event line and each change is one attributed history row like pin; the spec says quiet, no notice.
  - Why: nothing in marking needs a counter.
  - Rejected: a PT429 counter.

## 2026-10-16 · CV-22 (Home widgets, export and the shortcut sheet) — the agent's choices (deferred to by Maciej)

Migration `20261017120000_chat_v2_home_export.sql`; see [the record](../build/chat-v2/CV-22.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16. The record holds the rest.

- **CV22-1 · `user_statuses` and `chat_members` are keyed by their own id** → CV-22
  - Who: agent's choice, accepted by the orchestrator; deferred to by Maciej, 2026-10-16.
  - Decision: a removed row (erasure, an account's cascade, a deleted conversation's cascade) reaches Realtime listeners as an opaque id; the person columns stay unique (`user_statuses_user_id_key`, `chat_members_channel_user_key`); the migration asserts no published table is keyed by a person.
  - Why: a removed row's key is all a listener receives, so the key should say nothing about a person.
  - Rejected: soft-removing in erasure (the cascade still removes the rows), leaving these tables out of the publication.
- **CV22-2 · Your own removal stays live through `left_at` updates; a deleted conversation arrives on `chat_channels`** → CV-22
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `realtime.ts` reports `member-left` from your own membership row's update and ignores a bare-key removal; `chat_sync_ids` stays the truth on every rejoin.
  - Why: one source of truth for the same fact.
  - Rejected: mapping membership row ids in the store.
- **CV22-3 · The widget keeps type id `chat` and is now "Catch up" (S and M); every row opens Catch up** → CV-22
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: saved dashboards keep their widget with no data migration; a saved L instance fits to M (`fitAllowedSizes`); the count sits on a "Waiting for you" label line; words follow frame 8 ("sent you a message", "replied in your chain").
  - Why: no data migration, no change to the shared `WidgetFrame`.
  - Rejected: a new `catchup` type plus a migration of saved layouts.
- **CV22-4 · The Team widget's now line reads `chat_now` and presence through the store the Chat tab already holds** → CV-22
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: Active · Away · Focusing (until …) · the status; nothing for someone with nothing to say; Home joins no new topic.
  - Why: no new tracking.
  - Rejected: a second presence subscription on Home.
- **CV22-5 · The export pages until an empty page, writes Chat's files, caps file bytes at 256 MB and keeps stored text as written** → CV-22
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `chat.json` plus one Markdown file per conversation, files as bytes under `chat/files/attachments/`; files past the cap stay listed with "Over the export's size limit."; references stay as their links; a conversation the server refuses is listed in `incomplete`.
  - Why: lossless, and the zip is built in memory.
  - Rejected: a 1 GB cap (tabs crash), a streamed zip (a rewrite of the shared export), rendering references to names.
- **CV22-6 · `devices.json` exports your own `user_clients` and the workspaces whose notices you paused** → CV-22
  - Who: the orchestrator's rule, reversing CV-6a's choice; deferred to by Maciej, 2026-10-16.
  - Decision: per-person notice settings sit next to your devices; `user_status_changes` (a rate counter) is erased, not exported.
  - Why: no new module key in the manifest.
  - Rejected: a `notices` module.
- **CV22-7 · The shortcut sheet lists bound keys only and scrolls** → CV-23
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: ⇧D (not bound) is off it, M is on; `max-h-[85vh]` fits the 1024×700 window; CV-23 adds the §16 rows it verifies bound.
  - Why: a sheet that lists unbound keys lies.
  - Rejected: listing every §16 row.
- **CV22-8 · Erasure is re-cut in place from its live body** → CV-22
  - Who: agent's choice (code review), deferred to by Maciej, 2026-10-16.
  - Decision: `pg_temp.recut` keeps any other change to `account_erase_workspace_data` and stops the migration if the body moved on.
  - Why: a replaced whole body would drop other blocks' changes.
  - Rejected: replacing the whole body.

## 2026-10-16 · CV-18 (quiet hours, pausing and holds) — the agent's choices beyond the pause table (deferred to by Maciej)

Migration `20261017119000_chat_v2_quiet_hours.sql`; see [the record](../build/chat-v2/CV-18.md). The pause table is CV18-0 below. Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16. The record holds the rest.

- **CV18-1 · Do not disturb drops pings instead of holding them** → CV-18
  - Who: agent's choice (the brief binds drop), deferred — confirmed for building, revisitable.
  - Decision: CV-17's `hold` becomes `drop`; the rows CV-17 held for do not disturb close quietly when the migration runs, so the sweep never rings them as "N messages while you focused".
  - Why: a held row is only released by a Focus end.
  - Rejected: keeping CV-17's hold.
- **CV18-2 · Pausing Focus counts as ending it; new messages ring during Pomodoro breaks and a break releases what the work phase held** → CV-18
  - Who: agent's choice (after code review), deferred to by Maciej, 2026-10-16.
  - Decision: the run leaving `running` writes the summary (tag `chat:focus:<run>`, so a device shows the latest); the hold reads the work phase only, and a device unseen for 3 minutes doesn't hold.
  - Why: holding older pings while newer ones ring would deliver them out of order.
  - Rejected: any running run holds; keeping the work phase's holds until the run ends.
- **CV18-3 · A Focus that never ended is released after 10 minutes unseen** → CV-18
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: a job every 5 minutes (`focus-release-stale-holds`) releases with a summary tagged `chat:focus:<run>:stale`; starting the next Focus also ends a run still running, and its summary rings.
  - Why: a closed app must not keep rows held; 10 minutes rides out a sleeping laptop.
  - Rejected: release only at the next Focus start; releasing silently without the summary.
- **CV18-4 · One summary per release, in the workspace of the latest released message that isn't paused (else the run's); the summary itself goes through the gate** → CV-18
  - Who: orchestrator's call after validator round 2, deferred to by Maciej, 2026-10-16.
  - Decision: a summary the gate drops (quiet hours, do not disturb, or a paused workspace at release) writes nothing, the holds close and the items wait in Catch up.
  - Why: the click lands on the Catch up that holds them, and a paused workspace never silences another's messages.
  - Rejected: one summary per workspace; always the run's workspace; letting the summary skip the quiet rules.
- **CV18-5 · The email job stamps what quiet hours, a pause or a switch kept quiet, so it never emails later** → CV-18
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `held_at` is stamped on those Catch up items; a switch turned back on later doesn't email the backlog.
  - Why: "nothing pings at 9:00" includes email.
  - Rejected: emailing a backlog when quiet hours end; reading the switch only when the email goes.
- **CV18-6 · Quiet hours are in Settings → Preferences (Notifications); pause is a bell button on each switcher row; "N held until Focus ends" sits above Catch up's list** → CV-18
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: times follow the Time & region zone, named in the group's line; the pause button has the tooltip "Pause notifications from this workspace" and a filled `bell-off` while paused; an owner without a member row can pause.
  - Why: spec §15 puts quiet hours under Notifications; no frame draws the pause and the row already has icon buttons.
  - Rejected: a second copy in Time & region; a per-row menu; the Focus timer for the held count.
- **CV18-7 · Status changes are limited to 30 in 10 minutes** → CV-18
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `user_status_changes` counts sets and clears; past it, `PT429`.
  - Why: each change reaches every teammate live.
  - Rejected: a per-minute limit (presets clicked in a row).
- **CV18-8 · ❓ "Back 9:00" is shown on the reader's clock; do not disturb's line wins over quiet hours'** → ❓ Maciej
  - Who: agent's choice, deferred — confirmed for building, revisitable (open call for Maciej).
  - Decision: "Sofia's quiet hours · back 9:00" reads on the reader's own clock.
  - Why: spec §15 draws the line with a time; the reader needs it in their own clock.
  - Rejected: none yet; open question for Maciej: keep, coarsen (e.g. "back in the morning") or hide the time.

## 2026-10-16 · CV-16 (moving messages and multi-select) — the agent's choices (deferred to by Maciej)

Migration `20261017118000_chat_v2_move_messages.sql`; see [the record](../build/chat-v2/CV-16.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16. The record holds the rest.

- **CV16-1 · "Mentioned in" follows the moved message, written as its author** → CV-10-fix
  - Who: orchestrator (brief §4.4), deferred to by Maciej — confirmed for building, revisitable.
  - Decision: `chat__move_relink` calls `chat__link_mentions(msg, author)` for each moved message; a source line nothing left there refers to is retired; Undo does the same back.
  - Why: a move never adds a line the author's mention couldn't.
  - Rejected: lines in the mover's name; direct inserts.
- **CV16-2 · Someone else's messages (a chain's replies too) move only by the source's managers and admins, and only when nobody new would read them** → CV-21
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: refused with no confirm path otherwise; your own messages into a wider audience answer `{status: "confirm", newly}` and move only with `confirm`; a key moves nothing.
  - Why: their words never reach new readers on someone else's confirm.
  - Rejected: letting the root's author confirm others' replies into a wider audience.
- **CV16-3 · Undo is the same op called back (the moved ids, the source as the target, the mover, within 10 s)** → CV-16
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: it finds the move by its `moved_in` line, puts every row back, restores chains, quotes and pins (kept on the `moved_out` line), soft-deletes both lines and asks no audience question; it touches only rows back in that conversation and drops a chain or quote a moved message took up where it went; it isn't held to 100 ids (the move took up to 500).
  - Why: Undo should leave things as they were.
  - Rejected: a separate undo op; a reverse move that writes two more lines; restoring by id alone; carrying a chain across conversations back.
- **CV16-4 · An id you can't read answers like one that doesn't exist; a destination in another workspace answers like a missing conversation** → CV-16
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: readability is checked on every picked id, not on one of the picked conversations.
  - Why: "two conversations" would confirm that a message you can't read exists.
  - Rejected: checking one conversation only.
- **CV16-5 · A reply moved alone leaves its chain and drops its quote; a quote of a message that stays behind is dropped too; both come back on Undo** → CV-16
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: a root brings its chain; a chain a move settled reopens ("Reopened by …"); pins drop.
  - Why: a quote pointing into another conversation would read as a broken line.
  - Rejected: keeping cross-conversation quotes.
- **CV16-6 · Five moves per person per 10 s (PT429); nothing pings; event lines in the mover's name** → CV-16
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: counted by the `moved_out` lines you wrote (Undo isn't counted); `moved_out` and `moved_in` lines carry the other conversation as a reference chip; a non-manager can't move out of an announcement channel.
  - Why: event rows skip fan-out and the sending limit, so the op keeps its own pace.
  - Rejected: no pace.
- **CV16-7 · Catch up items about moved messages follow them for people who can read the target; everyone else's open ones close as `closed`** → CV-16
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: an every-message, level, added or removed line stays where it is.
  - Why: people who can't follow a message shouldn't keep an item for it.
  - Rejected: leaving items that point at a conversation the person can't read.
- **CV16-8 · Multi-select: the mode row shows from the first picked message; Delete is offered only when every picked message is yours; T makes one task** → CV-16
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: bare ⌫ deletes only with two or more picked, ⌘⌫ any number; T joins the picked words with " · " (cut at 200), From the first; picked rows stay picked when the stream loses focus.
  - Why: ⌘-click gets visible feedback; only your own messages delete.
  - Rejected: showing the row only from two; deleting the own ones silently; a task per message.
- **CV16-9 · Make a note stays hidden until Notes' op exists** → N19
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `tests/chat-tidy.spec.ts` "Make a note" is a documented skip; the bar's More appears past six actions.
  - Why: Notes' op and its call N19 aren't on this branch.
  - Rejected: an empty More.

## 2026-10-16 · Notice pauses live in an owner-only table (CV-18) — supersedes the spec's C2-27 column

- **CV18-0 · A person's pause on notices is a row in `user_notice_pauses`, readable and writable only by its owner, not a column on `workspace_members`** → CV-18
  - Who: orchestrator (Chat v2 build), deferred to by Maciej: confirmed for building, revisitable, 2026-10-16.
  - Decision: a person's pause on notices is stored in `user_notice_pauses`, which only that person reads and writes. The spec's column on `workspace_members` (C2-27) is superseded.
  - Why: a pause is a personal setting; membership rows are read by the other members of the workspace, so a personal table keeps it with its owner as a rule.
  - Rejected: the column on `workspace_members` (C2-27).

## 2026-10-16 · CV-19 (search in ⌘K and Chat's Search) — the agent's choices (deferred to by Maciej)

Migration `20261017117000_chat_v2_search.sql`; see [the record](../build/chat-v2/CV-19.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16. The record holds the rest.

- **CV19-1 · The toolbar's Search opens the find bar; the bar's "See all" opens Chat's Search** → ❓ Maciej
  - Who: agent's choice, deferred — confirmed for building, revisitable (open call for Maciej).
  - Decision: the toolbar's Search is round 5 frame 2's "find" bar under the toolbar (n of m, ↑/↓, Esc), and its "See all" opens Chat's Search scoped to the conversation. The brief lists the toolbar among Chat's Search openers.
  - Why: the frame draws the bar, and both entry points exist this way.
  - Rejected: the toolbar opening Chat's Search directly (the bar would have no entry).
- **CV19-2 · Search reads one rule: the live `chat__readable_channel_ids(ws, person)`, for people only** → CV-21
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `chat_search` and `chat_find_conversations` return only conversations the caller can read right now, newest first, at most 50, granted to signed-in people and not to the service role. An app's key gets nothing until CV-21 gives the key path its own rule.
  - Why: one read rule, not a parallel one; reading as the key's creator would include their direct messages.
  - Rejected: the spike's one-argument overload; the draft's creator fallback.
- **CV19-3 · Words match word-starts, accents are ignored, input is bounded** → CV-20
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: websearch syntax over unaccented text, each word of 3+ letters a prefix ("zolw" finds "żółw"); at most 256 characters, 32 words, 50 rows; a query with no word it needs (negated words only) finds nothing; conversation names match anywhere in the name.
  - Why: Polish text without diacritics, and a bounded cost per call.
  - Rejected: a promised timeout alone (it binds only through the API).
- **CV19-4 · ⌘K's Conversations come from a chat function, not the registry** → CV-22
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `chat_find_conversations` reads names unaccented and shows a direct message by its people's names, archived last.
  - Why: the registry's label search has no unaccent and direct messages have no label.
  - Rejected: unaccenting the shared `searchEntities` (every module's search would change).
- **CV19-5 · The bottom bar's Search opens Chat's Search while Chat is open, ⌘K elsewhere; it remembers words and filters per workspace for the tab's life** → CV-22
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: a module claims the press through `components/app/search-events.ts`; ⌘K itself is unchanged; ⌘J is bound to nothing.
  - Why: the spec names the bottom bar as an opener; a reload starts clean like ⌘K.
  - Rejected: changing ⌘K inside Chat.
- **CV19-6 · Not built from frame 2: the palette's filter chips and painted matches inside the stream** → polish
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the FilterBar (from · in · has a file · date, one value each) lives in Chat's Search, one hop from "See all"; the find bar lights the landed message, not the matches in bodies.
  - Why: painting needs the stream's renderer to take a query.
  - Rejected: building both here.

## 2026-10-16 · CV-13 (linked channels) — the agent's choices (deferred to by Maciej)

Migration `20261017116000_chat_v2_linked_channels.sql`; see [the record](../build/chat-v2/CV-13.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16, unless marked.

- **CV13-1 · Linking needs being in the conversation, able to post in it and edit rights on the item; unlinking needs only being a poster** → CV-14
  - Who: orchestrator's rule over the brief's "see", deferred to by Maciej, 2026-10-16.
  - Decision: a link writes onto the item's page, so linking asks for edit rights on it (a team: being in it, its creator, the owner or an admin); removing the conversation's own setting asks only for posting there.
  - Why: a link changes another module's page; unlinking must work when the item is gone.
  - Rejected: any reader may link; edit rights on the old item to unlink.
- **CV13-2 · The column is the truth; the `conversation-of` row mirrors it** → CV-14
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `chat_channels.linked_type/_id/_at` decide; a trigger keeps the mirror row in step and refuses a row that doesn't match; the row is changed only from the conversation; relinking to an earlier item brings its row back with no second history line.
  - Why: a team has no registry row and item deletes soft-delete links.
  - Rejected: a session flag.
- **CV13-3 · A public conversation may link to an item only some people can see** → CV-14
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: people who can't open the item see "Private item" on the chip and card, get no "Conversation:" line on it, and capture never files into it for them.
  - Why: the common agency case (a client record only its owner sees, the client's channel open to the team).
  - Rejected: refusing the link and asking for a private conversation.
- **CV13-4 · An archived project reads "Website · archived" in RF-1's tombstone look, app-wide** → ❓ Maciej (a spine decision to keep app-wide)
  - Who: agent's choice, deferred — confirmed for building, revisitable (open call for Maciej).
  - Decision: whoever could open the project keeps its name; a deleted one stays "Deleted project". Because it is RF-1's shared resolver, every project reference (notes, comments, task text, chat) reads this way, matching Tasks hiding archived projects; an archived project can't be linked.
  - Why: a chip that opens an archived project would mislead.
  - Rejected: "Archived project" with no name.
- **CV13-5 · "Start a conversation for X" is its own op; capture's destination comes from the server** → CV-14
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `chat_op_start_conversation` (project's ⋯, company and contact hubs; not for teams) calls create with the link; a " 2" suffix counts channels the creator can see plus every public one; Make a task files into the linked project only when `chat_link_files_here` says so, else the Inbox.
  - Why: the dialog's explicit fields and the ⋯'s derived ones are different contracts; the client has no edit level per project.
  - Rejected: a "no name means derive" mode inside create.
- **CV13-6 · The team offer appears once, right after linking a team, for someone who may add people** → polish
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: "Add the team's N people?" with Add / Not now; linking a team adds nobody by itself. Frame 7's "new linked channel" start block isn't built.
  - Why: "offers once".
  - Rejected: adding the people at link time.

## 2026-10-16 · CV-9 (files) — the agent's choices (deferred to by Maciej)

Migration `20261017115000_chat_v2_files.sql`; see [the record](../build/chat-v2/CV-9.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16, unless marked.

- **CV9-1 · A PDF is a document card, not a rendered page** → ❓ Maciej (deviates from the drawn frame)
  - Who: agent's choice, deferred — confirmed for building, revisitable (open call for Maciej).
  - Decision: a PDF draws as a card the size of the media box and opens in the app's viewer.
  - Why: bytes of an uploaded file are not drawn inside a frame in the app, and browsers won't draw a PDF in a locked-down frame.
  - Rejected: an embedded PDF frame. A first-page picture made at upload would give a real preview later.
- **CV9-2 · Chat files don't show in Settings → Storage's largest files** → ❓ Maciej
  - Who: agent's choice, deferred — confirmed for building, revisitable (open call for Maciej).
  - Decision: chat files count in the owner's pool but `attachments_largest` lists task files only.
  - Why: there is no way from that list to open their conversation.
  - Rejected: listing them without a way to open them.
- **CV9-3 · Upload first, send after; only PNG, JPEG, GIF and WebP draw inline** → CV-20
  - Who: agent's choice, deferred to by Maciej, 2026-10-16 (upload-first is round 3 §2.25 g).
  - Decision: files upload under the next message's id and the send waits for them; up to 10 files a message; only those four types, and only when the name agrees with the type, draw inline (360 × 240); anything else is a chip that downloads. A message with an upload still moving waits alone; a stopped upload makes it "Not sent" with Retry.
  - Why: safety rests on drawing only four picture types, and a big file shouldn't hold the conversation.
  - Rejected: anything `image/*`; strict order.
- **CV9-4 · A file in a sent message leaves with its message, on the trash clock** → CV-23
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: access ends at once when the message is deleted; bytes and names go with the daily purge (04:23 UTC) after the 10 s Undo, as do files whose message never came (a day later). × takes a file out only before sending.
  - Why: one clock for chat and tasks; no frame draws a per-file delete on messages.
  - Rejected: per-file delete on sent messages.
- **CV9-5 · Chat file links live shorter than task links** → none
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: previews 10 minutes, originals 3 (`CHAT_FILE_LINK_TTL_SECONDS`); the stream re-signs its previews two minutes before they die.
  - Why: access to a conversation's files should end soon after it ends.
  - Rejected: tasks' 1 h previews.
- **CV9-6 · Files only in the main composer; Details has no Files section** → CV-12
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the reply-chain composer and edit take no files yet; the Files view (⌥3) is the one place for them.
  - Why: keep this block's surface small.
  - Rejected: an empty duplicate section in Details.

## 2026-10-16 · CV-17 (statuses, presence and Focus) — the agent's choices (deferred to by Maciej)

Migration `20261017114000_chat_v2_statuses.sql`; see [the record](../build/chat-v2/CV-17.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16. Two designer calls stay open: Focusing and do not disturb still show while "Show me as online" is off, and "until" from a counted estimate (AC11.3) isn't built.

- **CV17-1 · One status for every workspace; "no status" is an empty row** → CV-18
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `user_statuses` is read by the person and anyone who shares a live workspace; clearing and expiry update the row to empty instead of deleting, so every change reaches a listener through the read rule. Written only through the ops (an API key is refused); the app turns "clear after" into a time, the server checks it is ahead and within a year.
  - Why: only the app knows your midnight and week start; deletes carry no read rule.
  - Rejected: deleting on clear; a server-side "clear after".
- **CV17-2 · Shape precedence: do not disturb › in a call › Focusing › reachable / away › offline** → CV-18
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: do not disturb and Focusing show even when the person is offline; a Pomodoro break or a paused run isn't "Focusing"; "until" comes only from the run itself, never from a task's estimate.
  - Why: they are server facts about whether a message pings, and a task's numbers must not reach people who can't see it.
  - Rejected: hiding them when offline; the Now task's estimate as an end time.
- **CV17-3 · Do not disturb holds pings now; Out sick and On vacation hold by default** → CV-18
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `notice__gate` answers `hold` while your status has dnd on, in every workspace; the message waits in the person's Catch up and the sender sees "<name> is on vacation until Oct 20. They won't be notified…". Pause, quiet hours and Focus are CV-18's.
  - Why: AC6.6.
  - Rejected: a separate gate for statuses.
- **CV17-4 · Presence needs membership of a live workspace, not the plan; "Show me as online" off means the tab never tracks itself** → CV-22
  - Who: agent's choice, deferred to by Maciej, 2026-10-16 (CV-8a's deferral).
  - Decision: presence keeps working on a paused plan; away after 10 minutes without input; a person is away only when every tab is; the switch from another device reaches a tab within a minute.
  - Why: spec §1; `user_preferences` isn't published.
  - Rejected: publishing preferences for one switch; pausing while hidden.
- **CV17-5 · `chat_now` returns only people with something to say; the avatar opens the status menu** → CV-22
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: members only (others, keys and signed-out callers get nothing), never the run; Settings moved into the avatar's menu; DM rows show the shape only; "In a call" is drawn ready for Calls; a new token `--presence-reachable` keeps green at 3:1 on light.
  - Why: smaller reads; spec §15 puts status and Do not disturb on the avatar.
  - Rejected: every member with nulls; a second avatar control.

## 2026-10-16 · CV-11 (Catch up, Later and Remind me) — the agent's choices (deferred to by Maciej)

Migration `20261017113000_chat_v2_later.sql`; see [the record](../build/chat-v2/CV-11.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16.

- **CV11-1 · Catch up's list is a server read (`chat_catchup_open`), and Nothing still lists** → CV-23
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: items show only for conversations the person can still read, wherever the message is now; a conversation set to Nothing keeps @you in Catch up silently (listed, not counted); "X removed you from Q" lists even for a private channel you can no longer read, by the stored name.
  - Why: AC7.4 wins over hiding what the count hides; own-row rules can't say "still readable".
  - Rejected: client reads of `chat_catchup` plus messages; hiding Nothing items.
- **CV11-2 · Later and Remind me share one op; times are refused when past or beyond a year** → CV-18
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `chat_op_remind` takes exactly one of a message, a conversation or Catch up items by id; Later puts items off until the time, and they come back on top with one notice; a reminder rings even on a conversation set to Nothing and isn't counted there; clearing a reminder marks it Done.
  - Why: AC3.4, AC5.4; you asked for the reminder.
  - Rejected: firing a past time at the next minute; a separate "Returned" section.
- **CV11-3 · Later's times: In 1 hour · This evening (before 18:00 only) · Tomorrow (9:00) · Pick a time** → none
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: computed in the person's saved time zone (Time & region); the same dialog serves H in Catch up, the message ⋯ "Remind me…" and `/remind`.
  - Why: one meaning per option.
  - Rejected: tomorrow evening in place of "This evening" (a fourth meaning).
- **CV11-4 · The mode row has six actions; ⏎ opens the message in context; R replies in the message's chain** → CV-22
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: Reply · Done · Task · Later · Open · Go to conversation, with "Done all in this conversation" under More ▾ (also in the group's ⋯); Space and Done all show an Undo toast; Display order is kept per browser.
  - Why: the bar's cap is six; frame 1 draws five then More.
  - Rejected: five actions and an empty sixth; a server pref for the order.
- **CV11-5 · Catch up's counts and list rules are kept together** → CV-23
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `chat_catchup_open` repeats `chat_unread_counts`' rules (minus Nothing and quiet lines); the header count counts every listed row.
  - Why: they must change together.
  - Rejected: a shared function now (a re-cut of the count belongs to CV-23).

## 2026-10-16 · CV-10-fix ("Mentioned in" rows are Chat's) — the agent's choices (deferred to by Maciej)

Migration `20261017112000_chat_v2_mention_rows.sql`; see [the record](../build/chat-v2/CV-10-fix.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16. One call is open.

- **CV10fix-1 · Only Chat's send and edit write a "Mentioned in" row; the rows are history** → CV-13
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: link creation, contact and email linking refuse relation `mentions` or origin `ref` when either end is a conversation or message; delete, unlink and set-kind refuse to change them; "Mark as duplicate" leaves Chat's rows on the duplicate. The rule also covers `links_op_set_kind`, `contacts_op_link`, `contacts_op_unlink` and `email_op_link`, since the pair key ignores direction. One shared helper (`isChatEnd` / `isChatOwnedLink`, `src/lib/entity-links.ts`) decides it in the app.
  - Why: the line itself is the signal and must only ever come from a chat send.
  - Rejected: guarding `links_op_*` only; a table trigger (Chat's own server paths, like CV-13's "conversation of" link, must still write).
- **CV10fix-2 · A conversation picked with `@` in a note or task stays a chip with no link** → ❓ Maciej
  - Who: agent's choice, deferred — confirmed for building, revisitable (open call for Maciej).
  - Decision: the server refuses the mention, so the picker leaves a chip and writes nothing. Open: should `@conversation` write a plain reference link instead?
  - Why: the choice is a product call.
  - Rejected: quietly writing a plain reference.
- **CV10fix-3 · Older rows of the wrong shape become plain references, not deleted** → none
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: a live mention row with a chat end in any other shape becomes a plain `references` / `manual` link (closed when the pair already has a reference); other live chat-end rows lose origin `ref`; no activity row for this one-time step; registry labels: messages carry none, conversations their channel's name.
  - Why: they were links people made on purpose.
  - Rejected: soft-deleting them all.

## 2026-10-16 · CV-15 (channel lifecycle and permissions) — the agent's choices (deferred to by Maciej)

Migration `20261017111000_chat_v2_channel_lifecycle.sql`, Tier 2; see [the record](../build/chat-v2/CV-15.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16.

- **CV15-1 · A removal from a public channel sticks** → CV-23
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: they can't join or post again until a manager or admin adds them back; the removal is recorded whether they were in it, had left, or had only read it, and their open items close with a quiet "removed" line.
  - Why: one rule for public and private; a removal a click on Join undoes would mean nothing.
  - Rejected: a public removal that only ends the current membership.
- **CV15-2 · The purge erases content but keeps tombstones** → CV-9
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: deleted channels are restorable for 30 days; then messages, Catch up items, managers, notices, history and links go, the channel row stays with no name or topic, and membership rows stay stamped as left. The hourly job takes 25 at a time; General and direct messages are never deleted or purged.
  - Why: membership rows are only ever stamped, never deleted, so each person hears only about their own row.
  - Rejected: a hard delete of the channel row; a daily run of 500.
- **CV15-3 · Manager actions live on a ⋯ on a person's row in Details; the last manager can't step down** → none
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: Make manager / Remove as manager / Stop managing / Remove from channel, shown to managers and admins; only someone in a role that posts can be made a manager; a manager row that manages nothing can be removed. Archive moved into Channel settings beside Delete.
  - Why: frame 4 draws the labels but no control for them; the row is where the person already is.
  - Rejected: the person card (its actions are the person's, not the channel's).
- **CV15-4 · Reply privately puts the post's link in the direct message's draft** → CV-10
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the line answers the newest top-level post in view by someone else, as a draft to its author; with none in view, a direct message to one of the managers. The announcement line follows the channel's managers, not "Manage any channel".
  - Why: the reply is theirs to write, and a sent link with nothing after it would ping the author for nothing.
  - Rejected: open-then-send; CV-8a's group message with every manager.
- **CV15-5 · Recently deleted lists only what the person may restore; a restored name that was taken returns as "<name> (restored)"** → none
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: admins see only channels they could have read; restoring never fails on a name; deleted channels are hidden from the connector.
  - Why: "Manage any channel" never reveals a private channel.
  - Rejected: every deleted channel; refusing until another is renamed.
- **CV15-6 · The role editor's chat rows save one at a time, on the three built-in roles** → CV-20
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: they follow `workspace_chat_caps` per built-in role and not the role's permission draft; "Add custom emoji" appears by itself once CV-20 adds the column.
  - Why: the switches are per built-in role.
  - Rejected: a draft shared with the permission matrix.

## 2026-10-16 · CV-10 (links in messages and "make a task") — the agent's choices (deferred to by Maciej)

Migration `20261017110000_chat_v2_references.sql`; see [the record](../build/chat-v2/CV-10.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16.

- **CV10-1 · "Mentioned in" counts only items in the registry the sender can open** → CV-13
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: a send or edit leaves one `mentions` row (origin `ref`) per conversation and item; people, teams, days, tags, conversations and messages leave none; references inside code don't count; the line's date is the first mention; mention rows write no activity row and stay out of link cards and Recently linked.
  - Why: a line must never point at something the sender couldn't see; the line is the signal.
  - Rejected: registering unknown ids; `links_op_create` (needs links edit, logs activity).
- **CV10-2 · "Became a task" reads `spawned-from` links; a just-made item shows at once** → CV-16
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: read for the messages on screen (and the open conversation's loaded chains), again 1.5 s and 6.5 s after a capture made here and on focus; others see it on load or focus. A local item goes after 6 s if the server never shows the link. Only tasks are added locally.
  - Why: no realtime on `entity_links` (publishing it is workspace-wide).
  - Rejected: publishing `entity_links`.
- **CV10-3 · A message chip reads "author · first words"; a deleted message reads "Deleted message"; one you can't read "Private item"** → CV-19
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `chat_message_refs` returns chip and card facts only for readable messages; a DM's name in a card reads "Direct message".
  - Why: nothing for a reader who can't read it reaches the DOM.
  - Rejected: a member list read per card.
- **CV10-4 · Message capture (⌘7) sends to DMs and channels you're in; Undo keeps the "Mentioned in" line** → CV-16
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: no default destination, the picker focused; people already in a 1:1 DM appear as that DM; the page's "From:" item is appended alone on a line; "Sent to … · Open · Undo" for 8 s.
  - Why: public channels you never joined aren't destinations; the line is history like any delete.
  - Rejected: deleting links on Undo.
- **CV10-5 · Esc undoes a typed handle chip only if nothing changed since** → none
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `MOD-142` plus a boundary makes a live task chip; Esc right after puts the text back (⌘Z too).
  - Why: it must never discard later typing.
  - Rejected: Esc always replacing the chip.

## 2026-10-16 · CV-12 (replies and Wrap up) — the agent's choices (deferred to by Maciej)

Migration `20261017109000_chat_v2_chains.sql`; see [the record](../build/chat-v2/CV-12.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16.

- **CV12-1 · Reply shows "Replying to Name · excerpt" above the main box until sent or Esc; "N replies ›" opens the chain** → none
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the reply posts at the bottom with one muted quote line; nothing folds automatically; replies of a wrapped root leave the stream.
  - Why: rounds 2–3 drew it and §16's Esc order names "reply quote".
  - Rejected: Reply opening the chain.
- **CV12-2 · Unread replies a wrap-up hides stay in Catch up until the chain is read** → CV-11
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: a new `chat_op_chain_read` closes them when the chain opens on the right; the read mark passes hidden replies at the end of the stream, but their Catch up items stay open.
  - Why: the read mark is what was on screen (§6 #17), and the edge case says they stay.
  - Rejected: letting the stream's read mark close them (they'd vanish unseen).
- **CV12-3 · Who may wrap up or reopen: the root's author (who can post), managers, admins, anyone who can post in a direct message; never a viewer or in an archived channel** → CV-14
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: a reply arriving at a wrapped chain reopens it ("Reopened by …"); the toast's Undo leaves no "Reopened by" line; the menu mirrors the server's rule so it never offers what the op refuses.
  - Why: CH54; the ops decide.
  - Rejected: "Reopened by you" after every Undo.
- **CV12-4 · Reply to… lists only earlier messages; a message with replies can't join another chain; joining a wrapped chain reopens it** → CV-16
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: moving a settling reply out reopens the chain it left; a new quote inside the same chain doesn't.
  - Why: one level (#23); the settling reply always belongs to its chain.
  - Rejected: re-parenting whole chains (that's Move to…, CV-16); refusing.
- **CV12-5 · A deleted root with replies may be wrapped; a deleted settling reply keeps the wrap-up** → none
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the wrap-up then reads "Deleted message".
  - Why: delete has an Undo and shouldn't silently reopen a chain.
  - Rejected: reopening on delete.
- **CV12-6 · No "Also mark as decision" box yet** → CV-14
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `p_mark_decision` is accepted and logged; CV-14 stores the decision and adds the tick.
  - Why: a box that does nothing is worse than none.
  - Rejected: a dead checkbox.

## 2026-10-16 · CV-8b (the panel and the dialogs) — the agent's choices (deferred to by Maciej)

Client-only; see [the record](../build/chat-v2/CV-8b.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16.

- **CV8b-1 · Browse channels is a centre surface at `/chat?view=browse`, not a dialog** → CV-19
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: frame 3 draws it in the centre with its own toolbar; `view=browse` keeps the open conversation so Details stays on the right.
  - Why: a list of channels with Join reads better as a page, and the frame wins.
  - Rejected: a dialog.
- **CV8b-2 · Details' History lists changes, not reactions or bell rows; six lines, then "Show all N"** → none
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: create, rename, topic, archive, join, leave, member add / remove, pin, message edit / delete / restore.
  - Why: "a quiet history of every change"; a mirror, never a wall.
  - Rejected: every logged op; the full 50.
- **CV8b-3 · A person's name in the stream opens their card; hover previews it** → CV-17
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: Message on the card starts the DM (hidden for a viewer, on a paused plan, for yourself and a former member); the preview sits on authors' names only, to keep the 10k-message budget.
  - Why: the brief's "Person card (item, also on hover anywhere)".
  - Rejected: the instant DM.
- **CV8b-4 · Viewers keep Notify me, Pin to sidebar and Leave; they get no New conversation, Archive or Message** → CV-15
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: those are the viewer's own settings, not the conversation's (§12).
  - Why: viewers receive and may leave.
  - Rejected: hiding them all.
- **CV8b-5 · Linked to and Files show nothing built yet** → CV-13, CV-9
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: Linked to shows its empty line (no disabled "Link to…"); Details has no Files section (Files is its own view); presence reads "Online" or nothing.
  - Why: a control that does nothing is worse than none.
  - Rejected: disabled controls.
- **CV8b-6 · New conversation: Private is locked when the role may make only one kind; a DM with only yourself offers "Capture a note"** → CV-15
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the tabs follow `create_public` / `create_private`; the announcement switch says "You're its manager"; Capture a note opens the app's capture as a note.
  - Why: the server's checks; §1 has no notes-to-self conversations.
  - Rejected: a note-to-self conversation.

## 2026-10-16 · CV-8a (sidebar, toolbar and states; v1's screens retired) — the agent's choices (deferred to by Maciej)

Client-only; see [the record](../build/chat-v2/CV-8a.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-16.

- **CV8a-1 · A paused plan keeps the store running** → CV-17
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the store no longer stops at "locked": it loads the sidebar, counts, windows and live rows and sets `snapshot.paused`; readers of a live conversation keep react, mark unread, copy link, make a task and reply; only posting, edit, delete, pinning and typing need the right to post. An archived conversation draws no tools.
  - Why: the spec's paused state reads every conversation.
  - Rejected: a separate read-only loader for paused workspaces.
- **CV8a-2 · Rights come from `chat_caps_get` and `chat_channel_managers`, only to choose a line over a box** → CV-15
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: the server still decides every write; the viewer line is chosen on the client from the role and chat's level (the UI errs strict).
  - Why: the same rows `chat_has_cap` reads; v1's guess about managers was wrong.
  - Rejected: a new RPC (a migration for UI hints).
- **CV8a-3 · "Reply privately" opens a DM with the channel's managers; "You're not in this channel · Join" sits in the composer's place** → CV-15
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: up to eight managers; an announcement channel's composer area stays empty until its managers load.
  - Why: the line has to lead somewhere; the server refuses a post from a non-member.
  - Rejected: a DM with the last poster; posting to join implicitly.
- **CV8a-4 · The welcome copy is the spec's line** → none
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: "Reply to keep answers together · @ links anything in Moduo", not frame 7's longer sentence.
  - Why: the spec quote is binding.
  - Rejected: frame 7's sentence.
- **CV8a-5 · Archived channels live in the hairline ⋯ as a submenu; ⌘J and Esc-closes-panel are gone** → CV-15
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: ⌥↑/⌥↓ and ⌥⇧↑/⌥⇧↓ step through the open sections; the toolbar's Search opens ⌘K until CV-19; a chain link keeps `t=` until CV-12.
  - Why: "never as permanent rows"; v1's dialogs and panels are retired.
  - Rejected: a dialog for archived channels.
- **CV8a-6 · v1's screens, hooks, parity harness and the Settings › Access "Chat" entry are deleted** → CV-15
  - Who: agent's choice, deferred to by Maciej, 2026-10-16.
  - Decision: `src/features/chat/ui/*`, the v1 hooks, `emoji.ts`, `markup.ts` (with its v1 parity harness) and the chat-caps panel are gone; CV-15 builds the role editor's chat rows.
  - Why: the brief deletes `markup.ts`; the conversion ran and its SQL tests stay.
  - Rejected: keeping v1's dialogs alive; copying the v1 parser in.

## 2026-10-15 · CV-7b (the composer) — the agent's choices (deferred to by Maciej)

Client-only; see [the record](../build/chat-v2/CV-7b.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-15. The record holds the rest (`@channel` offered to everyone and decided by the server, the UTF-16 limit, tool buttons, emoji up to version 15).

- **CV7b-1 · A prefilled capture starts fresh in its own draft, kept per open in the shell** → CV-10
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: T and `/task` open the capture with the message's words; the open never reads, writes or clears the person's kept draft, lasts as long as the open (type switches included) and dies with the shell. A refused prefilled capture stays kept in its own slot until it is made by any create path.
  - Why: "T then ⏎" must not create a task with stale fields, and an unfinished capture must survive it.
  - Rejected: merging the words into the kept draft; an `untouched` ref plus a module-level open id; a device slot per open.
- **CV7b-2 · T prefills only the title; `+` shows "Create, linked" now** → CV-10
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: the message text (whitespace collapsed, 200 characters) fills the title; the item's chip in the message is the link. The "From:" chip and the Message capture type are CV-10's.
  - Why: AC9.7 (`/task` `/note` `/event`) is this block's and `+` → Create is the same path.
  - Rejected: hiding `+` → Create until CV-10; a second link write from the composer.
- **CV7b-3 · No `@Team`, no drag-from-panel, no typed handle chip yet** → CV-10, the right-panel block
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: chat has no team list on the client and no app-wide drag context; the handle chip is CV-10's.
  - Why: each needs something another block builds.
  - Rejected: building them here.
- **CV7b-4 · The parity test stays in `markup-v2/`** → CV-7a's folder choice
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: the brief's `markup/` folder name isn't used.
  - Why: a `markup/` folder beside v1's `markup.ts` makes `./markup` ambiguous.
  - Rejected: the brief's folder name.

## 2026-10-15 · CV-7c (reactions widened) — the agent's choices (deferred to by Maciej)

One migration (`20261017108000_chat_v2_reactions.sql`), Tier 2; see [the record](../build/chat-v2/CV-7c.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-15, unless marked.

- **CV7c-1 · A reaction key is a closed set of emoji code points, one spelling each, as Emojibase writes it** → CV-20
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: a key is exactly one standard emoji (a flag, a keycap, or one pictograph with optional variation selector, skin tone and tag sequence, joined only by U+200D; 1–32 code points). The ops store the fully-qualified form (U+FE0F only after a text-default pictograph or a keycap base), and the migration respells stored keys. The client checks a key numerically so V8 and JavaScriptCore agree. `REACTION_KEY`, `isReactionKey` and the shared corpus hold server and client equal.
  - Why: "no letters, digits, spaces or control characters" alone let through invisible marks and two emoji side by side; ❤ and ❤️ were two chips.
  - Rejected: a deny-list of character classes (Postgres and JS classify differently); storing what was sent; adding U+FE0F to every low pictograph (it split Moduo's own ✅); one astral character-class regex.
- **CV7c-2 · A message you can't read answers as one that doesn't exist** → CV-15
  - Who: orchestrator (Chat v2 build), deferred to by Maciej, 2026-10-15.
  - Decision: "That message no longer exists." for a member of another conversation, an outsider, a key and a deleted conversation alike; the two-argument toggle reads a message only after the same reader check.
  - Why: reacting must not reveal that a message exists.
  - Rejected: "You're not a member of this conversation." for hidden messages.
- **CV7c-3 · Old apps' comment words still work** → release
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: `comments_op_react` maps the six old words to emoji; the migration rewrites stored words to emoji losslessly and idempotently (a kept server-only function), without bumping `comments.updated_at`.
  - Why: the desktop bundles its UI, so old apps keep sending `thumbs_up` after the migration.
  - Rejected: refusing the words; an inline UPDATE (untestable afterwards); touching every reacted comment.
- **CV7c-4 · Keycaps and letter-like emoji (ℹ️) are keys** → CV-20
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: 0️⃣–9️⃣, #️⃣, *️⃣ and ℹ️ are allowed.
  - Why: they are standard emoji people vote with.
  - Rejected: refusing every key with a digit or "letters".
- **CV7c-5 · Settings → Chat slots take typed or pasted emoji; "Customize…" sits in the ⋯ menu's row** → CV-7b's picker
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: six slots, one emoji each, move left or right, "Use Moduo's six"; prefs live on `ChatRuntime` (`myPrefs` / `setMyPrefs`, all five fields). Groups order by first use (comments) and server order (messages).
  - Why: the full picker was CV-7b's; the toolbar has three slots and verbs.
  - Rejected: waiting for the picker; a fourth toolbar button; quick-row order for groups (they would reorder as you change your row).

## 2026-10-15 · CV-6b (one device rings) — the agent's choices (deferred to by Maciej)

Client-only; see [the record](../build/chat-v2/CV-6b.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-15. Two are marked as awaiting the orchestrator (CV6b-5, CV6b-6).

- **CV6b-1 · Each client asks the server as the notice arrives, and rings only on `latest`; unknown never rings** → CV-18
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: the desktop rings an OS notification, a browser tab never rings itself (its push does, after 8 s, if nobody acknowledged); an answer more than 8 s after the row's `created_at` is acknowledged quietly.
  - Why: a 60 s-old heartbeat lets two devices ring or none; two ringing is worse than a delayed browser notice.
  - Rejected: trusting the last heartbeat; ringing when unsure; ringing late on a second device.
- **CV6b-2 · Chat of that workspace in front means shown in place; another module or workspace counts as not in front** → CV-8a
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: in front = focused, visible, touched in the last 5 minutes, on `/chat`, that workspace selected; otherwise the desktop rings an OS notification, not an in-app toast.
  - Why: the brief says so.
  - Rejected: an in-app toast.
- **CV6b-3 · A burst rings once per tag a minute; the desktop's click is Moduo coming to the front within 10 s, only if it rang from the background** → CV-18
  - Who: agent's choice, deferred to by Maciej (the click rule also deferred to the orchestrator), 2026-10-15.
  - Decision: later rows are acknowledged quietly and counted, and the next ring says "N messages"; a ring while Moduo is in front arms nothing.
  - Why: the OS notification can't be replaced in place and the desktop plugin has no click event; a native handler needs Rust, out of this block.
  - Rejected: ringing every message; leaving throttled rows unacknowledged (their push would ring 8 s later); landing on any focus within 10 s.
- **CV6b-4 · The switches silence only on the client; the bell follows them; settings rows follow the brief** → CV-18, CV-21
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: a switched-off kind is acknowledged quietly by the latest open client; the server reads none yet. `chat.mention` (not `@Team`), `chat.reply` and `chat.announcement` map to the Chat switches in `OP_TO_NOTIFICATION_TYPE`. Settings → Preferences → Chat has the four switches, Show message text, Email when away and Sound (off by default).
  - Why: the server doesn't read the switches yet.
  - Rejected: no client-side check; one master switch (frame 9); leaving the bell unmapped.
- **CV6b-5 · Counts for at most 25 other workspaces** → orchestrator's OK (awaiting)
  - Who: agent's choice, awaiting the orchestrator's OK, 2026-10-15.
  - Decision: one `chat_unread_counts(ws)` read per other workspace (re-read 1.5 s after Catch up rows settle); the rest show no number and add nothing to the dock badge.
  - Why: bounds the reads per settle; exactly the Chat tab's rule with no new RPC.
  - Rejected: no cap; one own-rows read of `chat_catchup`; a new cross-workspace RPC.
- **CV6b-6 · The web asks for notifications once, as a toast; the Windows taskbar overlay isn't built** → CV-11
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: the first Chat open shows "Get a notice when someone messages you · Allow · Not now" (kept per browser); a refused state reads `NOTICES_OFF_LINE` for Catch up's view. No Windows overlay (macOS-first).
  - Why: no frame draws the ask; an overlay needs a drawn image per count.
  - Rejected: a banner inside v1's chat page; a half overlay.

## 2026-10-15 · CV-7a (the stream) — the agent's choices (deferred to by Maciej)

Client-only; see [the record](../build/chat-v2/CV-7a.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-15.

- **CV7a-1 · The stream goes into today's Chat page** → CV-8a
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: `MessageStream` replaces v1's list in `chat-page.tsx`; the renderer lives in `stream/message-body.tsx` while the pure tree stays in `markup-v2/`.
  - Why: the e2e rows need it on screen and v1's list can't show v2 rows honestly.
  - Rejected: a separate harness route (a new route needs the designer); waiting for CV-8a; a `markup/` folder beside v1's `markup.ts`.
- **CV7a-2 · Delete runs from the toast's own clock, and at once when you leave the page; a refused send also offers Delete** → CV-8a
  - Who: agent's choice, deferred to by Maciej, 2026-10-15 (the toast clock from the validator's review).
  - Decision: hidden at once, "Deleted" toast with Undo for 8 s, the server delete on the toast's `onAutoClose` / `onDismiss`.
  - Why: a delete never silently doesn't happen, and Undo is never offered after the server delete.
  - Rejected: a page timer; dropping the delete on leave; no way to clear a refused message.
- **CV7a-3 · Right-click opens the ⋯ menu anchored on the toolbar; "+" opens its reaction row; ⇧D and H do nothing yet** → CV-13, CV-14
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: one menu with the six reactions on top; verbs whose blocks don't exist are hidden.
  - Why: one set of items and a DOM budget.
  - Rejected: a second ContextMenu per row.
- **CV7a-4 · T / "Task" created the task at once (v1's behaviour)** → superseded by CV-7b
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: the record flagged it for Maciej because the AC says it opens the capture; CV-7b then made T open the capture with the message's words (CV7b-1), which closes the question.
  - Why: the capture's request type couldn't carry a title or the message as source.
  - Rejected: opening an empty capture.

## 2026-10-15 · CV-6a (device notices, server) — the agent's choices (deferred to by Maciej)

One migration (`20261017107000_chat_v2_device_notices.sql`); see [the record](../build/chat-v2/CV-6a.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-15.

- **CV6a-1 · The title is "Sender · #channel · Workspace" (a DM: "Sender · Workspace"); a burst reads "N messages: <newest text>"** → CV-6b
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: a row is skipped once a newer row on its tag is due or acknowledged, so a quiet burst rings once and a steady stream still rings about every 8 s; `push_claimed_at` makes a claimed row its run's for a minute.
  - Why: the spec's example plus the conversation it asks for; every chat insert kicks a run and overlapping runs must not send twice.
  - Rejected: "Sender in #channel (Workspace)"; replacing by any newer row; pushing every row; one run at a time.
- **CV6a-2 · Edits and deletes follow the message; references are drawn per reader** → CV-22
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: an edit redraws the words of its notices and of a queued `chat_waiting` payload, a delete drops unsent notices and blanks the rest; people and teams of the workspace by name, a task, note or conversation by title only while the reader can see it, else "Private item".
  - Why: the old text is never pushed or kept; there is no server title registry.
  - Rejected: blanking on edit; a per-type lookup table.
- **CV6a-3 · The email after an hour covers the whole conversation and needs a known client** → CV-6b, CV-18
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: one email per conversation per hour counts every open, unemailed, unheld dm / mention / team_mention item (up to 7 days old); only people with at least one `user_clients` row, none seen within the hour, get it; nothing older than a week is emailed.
  - Why: enforces "at most one per conversation per hour" across hour boundaries; old builds never trigger emails while people are active; a rollout must not email a backlog.
  - Rejected: a dedupe key alone; emailing anyone with no row; no age cap.
- **CV6a-4 · The desktop listener skips chat rows until CV-6b; `user_clients` is not exported; `reaction_row` is checked now** → CV-6b, CV-22, CV-7c
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: the old listener ignores chat rows; `user_clients` is device telemetry readable by its owner; `reaction_row` is at most 6 distinct keys of 1–32 characters (CV-7c's `reactions__key_ok` narrows it).
  - Why: the old listener would toast every message in front of you; spec #31 lists `user_clients` for erasure only.
  - Rejected: letting it ring; adding to an export that doesn't exist yet; waiting for CV-7c to add the column.

## 2026-10-15 · CV-3 (the chat store) — the agent's choices (deferred to by Maciej)

Client-only, no migration; see [the record](../build/chat-v2/CV-3.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-15.

- **CV3-1 · Device rows are keyed by person and workspace, and none are persisted for conversations the store doesn't hold** → CV-8a
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: `[<person>:<workspace>, conversation, at, id]`; only conversations the store opened (registered in meta before any row is written) keep rows.
  - Why: one browser never shows a person another's rows and a sign-in wipe is a key match; the access check then sees everything on the device.
  - Rejected: spike 2's `[workspaceId, …]`; registering every conversation a delta touches.
- **CV3-2 · History pages through PostgREST's spelling, not an RPC** → release
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: `lte(created_at) + or(created_at.lt."T", id.lt.X)` is the same keyset (12/12 in spike 2, 200 on one stamp in the probe); revisit if deep history is slow on prod.
  - Why: CV-1 shipped no `chat_messages_page` and this block has no migration.
  - Rejected: a migration for the RPC.
- **CV3-3 · v1's screens send v1 markup through the 7-argument wrapper** → CV-8a
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: `format: "v1"` keeps the client id as the row id and converts on the server with CV-1's converter, until CV-7b.
  - Why: v1's composer works unchanged meanwhile.
  - Rejected: converting on the client with spike 4's test helper.
- **CV3-4 · Any answer that isn't a network failure is a refusal ("Not sent · Retry")** → CV-7a
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: the send limit answers `PT429`, a length `22023`; only a request that never got an answer waits.
  - Why: waiting on unknown codes would retry a rate-limited message forever.
  - Rejected: waiting on unknown codes.
- **CV3-5 · Four client channels behind one adapter; Catch up events subscribed but ignored** → CV-11
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: joins are debounced into one gap fill; a Catch up row arrives per message addressed to you, so CV-11 builds Catch up and recounting each would be a request per incoming message.
  - Why: one channel's error would otherwise drop all four bindings.
  - Rejected: one channel with four bindings; recounting on each.
- **CV3-6 · v1's read mark is the newest message in the window while the tab is visible; the Home widget reads the store** → CV-7a
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: CV-7a calls `markSeen` with the last row it drew; the Home chat widget stops holding its own live link.
  - Why: marking "now" is against #17; the widget recounted with three requests per message.
  - Rejected: marking "now"; a second Postgres Changes subscription per workspace.
- **CV3-7 · `runtime.chat.supabase.ts` is split from `runtime.chat.web.ts`** → CV-8a
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: the probe runs the app's transport on a test client.
  - Why: it avoids loading `runtime.web.ts`.
  - Rejected: testing the PostgREST spelling only in mocks.

## 2026-10-15 · CV-5 (Catch up rows and the bell) — the agent's choices (deferred to by Maciej)

One migration (`20261017106000_chat_v2_catchup.sql`), Tier 2 (`/code-review high` ran, the security scan found nothing at its threshold); see [the record](../build/chat-v2/CV-5.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-15.

- **CV5-1 · One reason per person per message, by precedence** → CV-6a, CV-11
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: mention → team → @channel → announcement → reply → Every message; a direct message is always `dm` and never a bell row; one open `reply` item per person and chain and one open `every_message` line per person and conversation, moved to the newest message.
  - Why: one item and one count per message, as CV-2b's counts already read it; the bell is for work items.
  - Rejected: an item per matching reason (one message counted twice); a bell row for a name inside a DM.
- **CV5-2 · The bell keeps one row per chain and person; Done, read and the bell's dismiss act on exactly one row** → CV-11
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: when a new reply moves your chain item, the bell row it pointed at is dismissed for you; a grouped item keeps its `created_at` and its Later.
  - Why: otherwise Done on the chain would leave older rows in the bell, breaking "one state with the bell"; Later means later.
  - Rejected: every reply's row staying live; a new reply bringing a snoozed chain back (CV-11 may revisit).
- **CV5-3 · An `@you` reaches a reader who isn't a member of a public channel** → CV-3, CV-11
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: they get the item and the bell row, as v1 rang the bell; no `chat_unread_counts` row counts it (no membership).
  - Why: §11 "You, if you can read it".
  - Rejected: members only.
- **CV5-4 · Reading, sending and joining close items; marking unread reopens what reading closed; Stop following closes the chain's item** → CV-11, CV-15
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: reading closes items (snoozed ones too) up to the message and dismisses their twins; sending closes your own; joining closes what's behind the new mark; mark unread reopens only what reading closed (not Done, not the bell's); quiet lines and reminders never close by reading.
  - Why: the conversation's number and the tab's count move together; "reading it in its conversation clears it".
  - Rejected: leaving items open after sending or joining; keeping Later's items open after reading; hiding a stopped chain only from the count.
- **CV5-5 · The team mute is applied when writing and when counting; an edit that drops a name closes that mention** → CV-18
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: turning the mute off doesn't bring back mentions sent while it was on; an edit may add a mention item next to an item of another reason (CH75: being named is new news); taking a name out closes the item (`closed`, which Undo never reopens).
  - Why: an old team item kept counting while muted; Catch up must not count a message that no longer names you.
  - Rejected: write-time only; blocking the added item; keeping the dropped mention open.
- **CV5-6 · Switching to Every message adds no line for what came before; an app's post fans out with no sender to skip** → CV-21
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: items are written as messages arrive; `chat_op_agent_post`'s author is null until CV-21, which passes the key's creator as the actor.
  - Why: no backfill at the switch; the creator rule is CV-21's.
  - Rejected: backfilling; excluding the key's creator now.

## 2026-10-15 · CV-2-fix (rules CV-2a and CV-2b share) — the agent's choices (deferred to by Maciej)

One migration (`20261017105000_chat_v2_rules_fix.sql`), `chat_rules.test.sql` (69 checks); see [the record](../build/chat-v2/CV-2-fix.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-15.

- **CV2fix-1 · A channel's name clashes with every live channel its creator or renamer can see** → CV-15
  - Who: agent's choice (refines CH3a), deferred to by Maciej, 2026-10-15.
  - Decision: public channels are unique among themselves ignoring case (`chat_channels_public_name_uq`); the check also covers the private ones the person is in; a per-name lock takes one create or rename at a time; General counts public names only; a deleted channel's name is free. A public and a private channel (or two private ones) can share a name.
  - Why: a refusal can only be about a channel the person can see, and public channels are everyone's to see; General is made on the workspace's behalf, so a private name must not move it to "General 2".
  - Rejected: workspace-wide uniqueness with a neutral message; public names unique and private never checked; suffixing a clashing name; counting what the opener can see for General.
- **CV2fix-2 · A removal is its own stamp, and a removed person's rows are refused by the row trigger for every writer** → CV-3, CV-15
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: `chat_members.removed_at` marks a removal, `removed_by` only says who; a CHECK keeps it whole; the message trigger refuses a removed person's rows, an app's key included; event lines (written by ops) are exempt.
  - Why: a removal must outlive the remover's account; "removed" is one rule for every writer.
  - Rejected: keying on `removed_by`; checking in each op that inserts messages; convention instead of a CHECK.
- **CV2fix-3 · The erasure counts remaining managers through `chat__can_manage` and hands a channel only to someone whose role posts; a send checks the announcement rule before the rejoin** → CV-15
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: one rule for "someone still manages it"; posting never makes anyone a manager in effect again; the erasure's order of choice is unchanged for CV-15 to align with `chat__hand_over`.
  - Why: no manager row that manages nothing.
  - Rejected: `chat__is_manager` there only; the row trigger alone.

## 2026-10-15 · CV-2b (conversation ops v2) — the agent's choices (deferred to by Maciej)

One migration (`20261017104000_chat_v2_conversation_ops.sql`), `chat_ops.test.sql` (262 checks) and `chat_counts.test.sql` (45); see [the record](../build/chat-v2/CV-2b.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, 2026-10-15, unless marked. The record lists the rest (about 25).

- **CV2b-1 · General is named "General" in new workspaces; bootstrap puts everyone without a row into it, chat access or not** → CV-4, CV-15
  - Who: agent's choice (the second part the orchestrator's), deferred to by Maciej, 2026-10-15.
  - Decision: older workspaces keep their "general" (flagged by `is_default`, not renamed); a `left_at` row keeps someone out from now on; General can't be archived; being in it reads nothing without `chat.view`.
  - Why: names are as typed and §1 calls it "General"; every reader of General should be a member so they can type there; round-3 made it undeletable.
  - Rejected: keeping v1's "general"; a backfill migration; filtering by chat access; archiving General.
- **CV2b-2 · A manager removed from a channel can't rejoin or be added back by a member; joining starts you at the newest message** → CV-15
  - Who: agent's choice (CV-2a's open question), deferred to by Maciej, 2026-10-15.
  - Decision: only a manager or admin can add them back; a rejoin keeps no old mark.
  - Why: otherwise removing someone from a public channel means nothing; the history isn't addressed to them.
  - Rejected: an old mark kept (hundreds unread after a rejoin).
- **CV2b-3 · A manager is a manager in effect only while in the channel with a role that posts; the hand-over skips read-only roles and never adds the owner as a member** → CV-15
  - Who: agent's choice (the hand-over rule from the validator), deferred to by Maciej, 2026-10-15.
  - Decision: a leftover row or a read-only role manages nothing; an admin can't manage a private channel they aren't in.
  - Why: §12 gives viewers no management; private channels are invisible to everyone not in them.
  - Rejected: the manager row alone; the spec's literal "earliest remaining member" (it would give a viewer management, against §12).
- **CV2b-4 · Opening a DM that exists needs no "post"; a deleted DM is never reused; v1's "only yourself" DM is refused** → CV-8a
  - Who: agent's choice (the first from code review), deferred to by Maciej, 2026-10-15.
  - Decision: one live conversation per set (`chat_channels_live_dm_uq`); people who left stay out when someone else opens it.
  - Why: a viewer clicking the person who wrote to them must land in it; notes to self don't exist in v2.
  - Rejected: requiring "post" to reopen; reusing a deleted DM; keeping self-DMs alive for v1's screens.
- **CV2b-5 · Counts: `unread` bolds, `addressed` is the number, `catchup` derives from the mark until CV-5; reads are for signed-in people only** → CV-5, CV-3
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: a chain is "yours" from the reply or mention that put you in it on; `@channel` counts on Mentions and replies; an announcement post counts once; archived conversations have no row; `chat_sync_ids` always returns a `checked` row; `chat_people` lists members and authors; marking read in a public channel you only read is a no-op.
  - Why: §11's Count column; the Chat tab's count needs it now; keys read no chat through these.
  - Rejected: not stated in the record.
- **CV2b-6 · Duplicate names answer `23505`, other bad input `22023`; a topic over 250 is refused; v1's client gets two small changes** → CV-3, CV-8a
  - Who: agent's choice, deferred to by Maciej, 2026-10-15.
  - Decision: the client can put the duplicate on the name field; `mappers.ts` and `realtime.ts` read a stamped row as no membership.
  - Why: v1 cut a topic silently; without the change a channel you left reappeared at once.
  - Rejected: cutting the topic; leaving v1's client alone.

## 2026-10-14 · Chat v2 build — the orchestrator's later choices, and one call from Maciej

Written into the briefs and the runbook after checkpoint 1 (BR-1…BR-4 are further down). BR-5 and BR-6 are the orchestrator's choices, deferred to by Maciej: confirmed for building, revisitable. BR-7 is Maciej's own call.

- **BR-5 · The bell draws chat excerpts in the stored form, in CV-11, and that completes AC13.7** → CV-11 (`briefs/CV-11.md`)
  - Who: orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: CV-1's conversion rewrites old bell excerpts to the stored form and marks every chat excerpt `payload.format_version = 2`. CV-11 draws a marked excerpt through the stored-form parser, so a converted `moduo://person/<id>` shows the person's name. Until then the bell prints the raw text, so AC13.7 is complete only when CV-11 lands.
  - Why: no other block draws the bell's chat text with that parser.
  - Rejected: leaving it to CV-23's cleanup (old excerpts would show raw links until then).
- **BR-6 · An op that writes event lines in a person's name keeps its own pace** → CV-14, CV-16 (`briefs/CV-14.md`, `briefs/CV-16.md`)
  - Who: orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14 (from CV-2a's review).
  - Decision: the sending limit doesn't count event lines (CV2a-4), so each op that writes them (moving messages, marking a decision) refuses more than a few per 10 seconds per person with `PT429`, the limit's own code, and has a test for it.
  - Why: event lines are left out of the limit so that moving many messages doesn't lock the mover out; the ops therefore hold their own pace.
  - Rejected: counting event lines in the sending limit.
- **BR-7 · The research workspace was converted to v2 on the local stack** → the runbook (`docs/agents/chat-v2-build.md`)
  - Who: Maciej's call, 2026-10-14.
  - Decision: CV-1's conversion migration was applied once to the local stack, so "Chat replan research" (3,032 messages) holds v2 data now. The v1 dump is in the git-ignored `docs/local/chat-v1-fixture/`. The conversion refuses to run again once v2 data exists (CV1-1).
  - Why: the round trip over this workspace had come out clean, and the blocks after CV-1 build against v2 messages.
  - Rejected: keeping it as v1 rows, with the conversion proven only by the rolled-back round trip and `chat_convert.test.sql`.

## 2026-10-14 · CV-4 (chat in handed-out Team workspaces) — the agent's choices (deferred to by Maciej)

One migration (`20261017102000_chat_v2_plan_source.sql`), a drift gate and an API-level spec; see [the record](../build/chat-v2/CV-4.md). Proven in rolled-back transactions, then applied to the local stack. Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable. BR-2 above fixed the lookup's name; these are the rest.

- **CV4-1 · The owner's plan is asked first, and the grant only when the plan doesn't include chat** → CV-4, TX-9b
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_workspace_enabled(ws)` is true when the owner's plan ranks Duo or above (v1's rule). Otherwise it asks `plan_grant_effective_tier(ws)`, if that function exists, and is true when the tier ranks Duo or above. With no such function the owner's plan decides, as in v1.
  - Why: every paying workspace keeps v1's answer and cost, and a broken or slow grant function can't take chat away from one (the test proves a failing stub is never called for a Duo owner).
  - Rejected: `greatest(owner rank, grant rank)` in one expression, which always calls the grant function.
- **CV4-2 · A grant function that fails reads as "no grant", with a log warning** → CV-4, TX-9b
  - Who: agent's choice (code review), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the error is caught around the call only, and the warning carries just the error code.
  - Why: the realtime topic rules, v1's unread counts and `isEnabled` ask this function too. An error would break presence and counts in every Free-owner workspace; now only a granted workspace pauses.
  - Rejected: letting the error through (the first version).
- **CV4-3 · The grant function is called by name, guarded by `to_regprocedure`** → CV-4, TX-9b
  - Who: agent's choice (code review), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the call is written plainly inside plpgsql, so the body never needs the function to exist, and it gets a cached plan that is re-planned when the function is replaced (proven in the test).
  - Why: it works in either merge order with TX-9b.
  - Rejected: `EXECUTE` (planned on every call); a placeholder function this migration creates for TX-9b to replace (it would break TX-9b's plain `CREATE FUNCTION` and fix its return type).
- **CV4-4 · The grant's tier is read as text and ranked by `plan_tier_rank`; the grant stays on the server** → CV-4, TX-9b
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a text or an enum tier both work, and an unknown tier ranks 0 (off). `CHAT_PLAN_TIERS` and `planHasChat` keep their behaviour; the client never learns the grant, and the workspace's answer is `ChatRuntime.isEnabled`. A new drift gate ties the tier list to the newest `plan_tier_rank` body and the lookup to the signature `plan_grant_effective_tier(<one uuid>)`, so a changed signature in TX-9b fails a test instead of switching grants off silently.
  - Why: a grant isn't a tier of its own, and TX-9b may return either type.
  - Rejected: fixing the return type here; a client helper `workspaceHasChat(ownerTier, grantTier)` that nothing would call.
- **CV4-5 · AC10.8 is finished by CV-21 and CV-22, not here** → CV-21, CV-22
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: CV-4 proves that reading and search keep working on a paused plan. v1's Conversations widget and v1's connector still refuse when the plan is off; CV-22 (widgets) and CV-21 (MCP tools) finish AC10.8.
  - Why: those surfaces belong to those blocks.
  - Rejected: changing the widget and the connector here.

## 2026-10-14 · CV-2a (message ops v2) — the agent's choices (deferred to by Maciej)

One migration (`20261017103000_chat_v2_core_ops.sql`), proven by `chat_ops.test.sql` (143 checks) and `chat_wrappers.test.sql` (23), and by a parity run of the mentions reader against the client's parser on 23,367 bodies (0 differences); see [the record](../build/chat-v2/CV-2a.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, unless marked.

- **CV2a-1 · Mentions are read on the server by a SQL twin of the client's parser** → CV-5, CV-7a, CV-10
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat__mentions` walks blocks the way `chat__body_text` does and reads inline text the way the client's `parseInline` does (code spans, escapes, titled references, link targets, emphasis pairing, a reference ending a word). People, teams and `@channel` come from the text, never from a list the client sends.
  - Why: one reading of a message on both sides. The 23,367 bodies were the 3,032 converted research messages, spike 4's cases, 45 hand cases and 20,000 fuzzed strings.
  - Rejected: a regex over the raw text (it counts code and escaped text); trusting the client's list.
- **CV2a-2 · `@channel` without "Mention everyone" is stored as typed, with the flag off and no error** → CV-7a, CV-7b
  - Who: agent's choice (the brief said "stored as plain text"), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the message posts, nobody is pinged, and the composer says why.
  - Why: the brief said to store it as plain text, and the composer tells the sender.
  - Rejected: refusing the send (v1 did); rewriting the text.
- **CV2a-3 · A client-minted id is the idempotency key, and a resent id answers only its author** → CV-3
  - Who: agent's choice (validator round 1 on the `client_id` part), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a resent id returns the stored row to its author, in its conversation, while they can read it; two sends of one id at once collapse to one. Any other use of an existing id is `22023 That message id is already used.` and returns nothing. While the v1 wrappers live, every send also writes `client_id = id`, and the v1 send wrapper uses v1's client id as the message id.
  - Why: v1 screens and old builds match their optimistic row by `client_id`; without it each v1 send showed twice.
  - Rejected: stopping `client_id` at once (CV-23 does it); answering anyone who knows an id.
- **CV2a-4 · Event lines don't count toward the sending limit, and an API key has its own budget** → CV-14, CV-16, CV-21 (and BR-6 above)
  - Who: event lines are the agent's choice (the orchestrator's question); the per-key budget is the orchestrator's choice. Both deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the numbers and `PT429` stay as they were. Event lines are neither limited nor counted. A row with `api_key_id` counts against that key's own budget (new partial index), not its person's. An app row without a key id keeps the workspace's shared apps budget until CV-21 writes `api_key_id`.
  - Why: event lines come from ops (a move's "moved here"), not from a person typing, and a move of many messages must not lock its mover out. One busy app can't silence its person or the workspace's other apps.
  - Rejected: counting every row.
- **CV2a-5 · The v1 signatures stay as wrappers for one release** → CV-23
  - Who: agent's choice (validator and code review on the edit part), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_op_send` (7 arguments), `chat_op_edit` (3, its default dropped) and `chat_op_react` (2, a toggle) convert v1 markup with `chat__v1_to_v2` and call the v2 ops; `chat_op_agent_post` converts and writes v2. The edit wrapper reads the stored row's format: a v1 row's text is converted whole, and a v2 row's text is kept, with only the tokens v1's pickers add turned into references. A v1 message that would grow past 8,000 characters when converted is refused with the count. The 3-argument edit lost its default because a 2-argument call is otherwise ambiguous in SQL and in PostgREST.
  - Why: v1's screens and old desktop builds keep working until `min_build` passes them.
  - Rejected: dropping the 2-argument react wrapper (reactions would fail on old builds); converting an edit's text every time (v1's composer opens an edit with the stored text, so it would be escaped); guessing the format from the text. A v1 emphasis typed during such an edit (`_x_`) stays literal: a loss on v1 screens only.
- **CV2a-6 · Who may delete, undo a delete, pin and edit** → CV-7a, CV-8a
  - Who: agent's choice (spec §12 plus the builder), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: delete is the author while their role can post, or anyone with "Delete others' messages". Undo is whoever deleted it (while they still may) or anyone with that permission, so an author can't undo an admin's delete (new column `deleted_by`). Pin is whoever can post there (managers only in an announcement channel) and holders of "Manage any channel", up to 100 live pins; a pinned message restored after its conversation filled its pins comes back unpinned. Edit is the author while their role still posts.
  - Why: a viewer can't delete even an old message of theirs; reading "who deleted may undo" literally would let an author put back what an admin took down.
  - Rejected: letting the author undo any delete.
- **CV2a-7 · Delete hides at once; Undo lasts 8 seconds in the app and 10 on the server** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: delete sets `deleted_at` and `deleted_by` and keeps the text for Undo. The server takes a restore up to 10 seconds after, and a job that runs every minute (`chat-blank-deleted`) blanks the text, mentions, reactions and pin once that passes. The bell's excerpt of the deleted message is blanked with it, since it is the only text a bell row carries.
  - Why: the extra 2 seconds covers the request in flight.
  - Rejected: none recorded.
- **CV2a-8 · An archived conversation is read-only, and a removed person can't post** → CV-2b, CV-15
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: in an archived conversation there is no sending, editing, reacting or pinning; deleting (and its Undo) still works. A person a manager removed from a public channel can't post, edit or pin there any more (`42501 You were removed from this conversation.`), though they still read it and may react; a person who left on their own posts and is back in. The removed rule starts to apply once CV-2b's `chat_op_remove_member` stamps `removed_by`, and CV-2b's join decides whether a removed person may rejoin.
  - Why: an archived conversation is closed to change; v1 deleted a removed member's row, so a stamp is the only way to tell a removal from leaving.
  - Rejected: v1's edits, reactions and pins in archived channels.
- **CV2a-9 · Replies and chains at the edges** → CV-12
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a reply joins its root's chain (`parent_id` is the root, `reply_to_id` what it quotes). A reply to a deleted message is refused (`P0002`); a reply to a live reply inside a deleted root's chain is taken. Event lines can't be replied to, pinned or reacted to. A reply moves the conversation's `last_message_at`. The chain's counters are recounted on delete and restore, so "N replies" counts live replies. Posting in a public channel joins it, or back (clears `left_at`), as v1 did.
  - Why: replies are stream messages now; the counters can't drift if they are recounted.
  - Rejected: v1's decrement-only counters, which had no restore.
- **CV2a-10 · The bell rings as v1 rang it until CV-5** → CV-5
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: mentioned people, the conversation on `@channel`, the chain's people and the quoted message's author on a reply; only people who can read the conversation, never the sender; teams aren't expanded. The excerpt is the stored form's first 140 characters without half a reference.
  - Why: CV-5 owns the fan-out and replaces this block.
  - Rejected: expanding teams here.
- **CV2a-11 · Activity rows are written only when something changed, with ids only** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: edit, delete, restore, react and pin each write one attributed row (`chat.message_edit`, `chat.message_delete`, `chat.message_restore`, `chat.react`, `chat.pin`) with ids only; a resent react, pin, delete or restore writes none, and neither does a plain send or typing.
  - Why: the activity feed stays about changes (spec #15), and carries no message text.
  - Rejected: a row for every call.

## 2026-10-14 · CV-1 (foundation and conversion) — the agent's choices (deferred to by Maciej)

Two migrations (`20261017100000_chat_v2_foundation.sql`, `20261017101000_chat_v2_convert_v1.sql`) and the contracts; see [the record](../build/chat-v2/CV-1.md). The conversion was proven in a rolled-back round trip: 3,111 bodies in 0.49 s, a second pass that changed no row, and the research workspace's 3,032 messages drawn as v1 drew them (BR-7 says it was then applied). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, unless marked.

- **CV1-1 · The conversion runs once, before the v2 ops, and refuses rather than truncates** → CV-2a, the release train
  - Who: agent's choice (validator round 1), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: it refuses to run once v2 data exists (a v2 `format_version`, a `left_at`, an event line, a quote, a key id, a team mention, a Catch up item that isn't a `level_reset` line, or a chain mute). It also stops before changing anything if a v1 body holds U+0001 or U+0002 (the converter's markers) or would grow past 8,000 characters. Then it runs seven idempotent steps, and the migration file runs it twice and fails unless the second pass changes nothing.
  - Why: the settings steps can't tell a v1 setting from a v2 choice (a late run would reset someone's v2 "Every message"), and nothing may be lost silently.
  - Rejected: per-row v1 markers on memberships; widening the 8,000-character CHECK for converted rows.
- **CV1-2 · The converter and the stripper live in the foundation; the convert file only calls `chat__convert_v1()`** → CV-2a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat__v1_to_v2`, `chat__body_text` and friends are in the foundation file.
  - Why: `chat_convert.test.sql` must pass on a stack where the conversion isn't applied, and CV-2a's v1 wrappers need `chat__v1_to_v2`.
  - Rejected: the functions only in the convert file.
- **CV1-3 · `format_version` defaulted to 1 until CV-2a flipped it to 2** → CV-2a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: v1's live ops kept writing v1 text, so the column's default stayed 1 in this block. CV-2a writes 2 explicitly and flipped the default in its own migration, after which the conversion refuses.
  - Why: a default of 2 would have marked v1's rows as converted and the conversion would have skipped them.
  - Rejected: round-3's default of 2 in this block.
- **CV1-4 · One `level_reset` line per person and conversation, none for an archived channel** → CV-5, CV-11
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: people on "Every message" move to "Mentions and replies" and get one Catch up line for each live conversation.
  - Why: the copy names one conversation ("Acme now notifies you…") and its Change opens that conversation's setting; `channel_id` stays NOT NULL.
  - Rejected: one line per person (which conversation would it name?).
- **CV1-5 · How the oddities of v1 convert** → CV-2b, CV-15
  - Who: agent's choice (code review on the last two), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a notes-to-self conversation becomes one private note (each message under a bold `YYYY-MM-DD HH:MM` line in the person's time zone, else `UTC`; deleted messages left out; a person mention reads `@Name` and other references stay `moduo://` URIs; the workspace grant that `share_note_after` adds is removed, so only that person reads it), and the conversation is deleted. An empty one is closed without a note. A DM whose other people left isn't notes to self. `mentions_everyone` is set from `<!channel>` in the v1 text. General is flagged only on a public, unarchived channel named "general", because new members are joined to it.
  - Why: the note must be readable by its person only, and the General flag is what the new-member join keys on.
  - Rejected: leaving `moduo://person/<id>` in the note; flagging whatever is named general.
- **CV1-6 · Bell excerpts: only those holding a v1 token are rewritten, and every chat excerpt is marked `format_version = 2`** → CV-11 (BR-5)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the v1 client writes excerpts as plain text with names filled in, which the converter would only escape. A server-written raw body carries tokens, and only those are converted. The marker makes the step idempotent, since the converter isn't.
  - Why: converting a plain-text excerpt would escape `2*3` and `C:\x`.
  - Rejected: converting every excerpt.
- **CV1-7 · Typing is for the conversation's members only** → CV-8a, the release
  - Who: agent's choice (spec #17, round-3 §2.7), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a person who reads a public channel without being in it gets no typing line there, and neither does someone who left. `chat_privacy.test.sql` changed on purpose: its check "C reads the public channel Q's typing topic" now expects 0 and adds that Q's member A reads it. CV-2a's `chat_op_typing` asks for membership too. This changes behaviour on prod for every conversation, so it ships with the v2 client in the same release; the v2 client joins the typing topic only as a member.
  - Why: the typing topic is the conversation's members' (spec #17, round-3 §2.7).
  - Rejected: v1's "anyone who can read it".
- **CV1-8 · The read rule is written out in two functions, with no nested definer calls, and a parity test guards the copy** → CV-19
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_can_read_channel` and `chat__can_read_channel_as` carry the rule written out. It no longer asks the plan; people who left, deleted conversations and deleted workspaces drop out. A parity test compares both with `perm_user_has`.
  - Why: the read policies call it for every row: 3,032 rows read in 406 ms with nested calls and 23–26 ms written out.
  - Rejected: one function calling the other (and `perm_user_has`): the logic stays in one place but costs about 100 µs a row.
- **CV1-9 · A link with a conversation or a message at either end is hidden from people who can't read it** → CV-10
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the links read rule checks both ends.
  - Why: a link from a task to a private message must not reveal that message.
  - Rejected: checking the source only (round-3's wording).
- **CV1-10 · Catch up rows are the person's own and aren't gated on the conversation's read rule** → CV-5, CV-11
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_catchup` is own-rows only. Items carry ids only, and CV-11 closes items when access goes.
  - Why: a "removed" line has to reach the person who can no longer read the conversation.
  - Rejected: gating items on the read rule, which would hide that line.
- **CV1-11 · The name check is added `NOT VALID`** → CV-23
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_channels_name_trimmed` checks new and changed names, and existing v1 names aren't re-scanned at release. CV-23 validates it once prod has no untrimmed name.
  - Why: one untrimmed name on prod would roll the whole foundation back.
  - Rejected: validating at once.
- **CV1-12 · The body parser's look-aheads are bounded** → CV-2a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat__inline_text` shares a budget of 2 × the length + 1,000 characters across its look-aheads, and pairs emphasis markers in two linear passes. Past the budget an unclosed backtick run or a `](` reads as text.
  - Why: it runs on every message write, and a plpgsql character loop is about 100 times slower than the same loop in JavaScript: an 8,000-character body now takes up to about 70 ms (one took 4.4 s before).
  - Rejected: the client's unbounded scans, which are fast in JavaScript and slow in plpgsql. Only extreme text reads differently from the client now.

## 2026-10-14 · CV-0 spike 1 (the message list in the real webviews) — the agent's choices (deferred to by Maciej)

Measured with the harness in `scripts/spikes/chat/s1/` (nothing in `src/`), in Chromium 153 and in WebKit through a plain WKWebView host, React Compiler on; see [the spike's record](../build/chat-v2/CV-0-S1.md) for the table. **Verdict: TanStack Virtual stays (decision #16 holds).** Every bar the harness can measure passes in both engines. Not measured yet: the Tauri window itself and real trackpad momentum (both are in the checklist). Each choice is the spike builder's, deferred to by Maciej: confirmed for building, revisitable.

- **S1-1 · TanStack Virtual runs the stream, with four settings** → CV-7a (`scripts/spikes/chat/s1/harness/tanstack-stream.tsx`)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `@tanstack/react-virtual` 3.14 with `anchorTo: 'end'` and `followOnAppend`, plus `useFlushSync: true`, the size-change rule (S1-3), `contain: layout style` on each row and the density re-anchor (S1-5). Result: 0 px of drift over 10 × 10 prepends, folds, edits above the viewport, arrivals and density switches; jumps land within 0.03 px; no frame over 18 ms in a 2-second fling; at most 200 elements in the stream.
  - Why: it passes every bar in both engines, uses 7.5 times less DOM than Legend List, and is already in the bundle. Without `contain: layout style` WebKit lays out the whole stream on every frame (19 fps, 233 ms frames).
  - Rejected: Legend List 3.6.0 (it fails the prepend bar in WebKit by 3.38 px in 5 of 5 runs, keeps about 1,510 elements and brings its own scroller); a custom list.
- **S1-2 · `useFlushSync: true`** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: TanStack writes the scroll correction and the new row positions in the same frame.
  - Why: with `false` the correction paints a frame before the rows move: flashes of 221–262 px in Chromium and 124 ms frames in WebKit.
  - Rejected: VirtualStack's `false` (Tasks). React 19 warns about `flushSync` inside effects; none appeared in these runs.
- **S1-3 · Every size change that lies wholly above the viewport is compensated** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `shouldAdjustScrollPositionOnItemSizeChange` returns true when the item ends at or above the viewport's top.
  - Why: TanStack's default skips re-measures while scrolling backward, which is when edits, reactions and late images land above the reader (a 176 px jump).
  - Rejected: the default; pre-measuring rows off screen before inserting them (7–28 ms per 50 rows, and unneeded once `flushSync` is on).
- **S1-4 · Rows carry the message before the window, and keys are stable** → CV-3, CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: rows are built with the message just before the window (read, not drawn): it decides the top row's grouping and whether a day separator sits above it. Keys are the message id, `d:YYYY-MM-DD` for a day separator and `c:<root id>` for a folded chain. A prepend then never changes a row already drawn.
  - Why: otherwise the reader's row is re-keyed and no longer drawn in 5 of 10 prepends, and most others jump 28–668 px.
  - Rejected: the top row always starting a group under a separator.
- **S1-5 · Density, font loading and width changes use a synchronous re-anchor** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: take the first message row wholly in view and its offset, switch, remeasure every drawn row, set the scroll position and the virtualizer's offset, and flush a render, all in one task (`setDensityAnchored`).
  - Why: it holds the reader's row at 0–1 px; TanStack alone moves 4 px (40 px with `flushSync` off).
  - Rejected: TanStack alone; `measure()` alone (rows above fall back to estimates and the view jumps).
- **S1-6 · A jump loads a window and remounts the stream** → CV-3, CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the window is `[target − 100, target + 100]`, a new stream keyed by the window, with `scrollToIndex(i, { align: 'center' })` in a layout effect on mount. It lands in the first painted frame.
  - Why: the list holds about 200 rows, not the whole history.
  - Rejected: keeping all 10,000 rows (it also lands, within 0.03 px, but holds the whole history).
- **S1-7 · Image boxes are sized by CSS from the stored size** → CV-9
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the box takes `--w` and `--h` custom properties, capped at 360 × 240, with `object-fit: cover`.
  - Why: Tailwind's preflight sets `img { height: auto }`, so with attributes alone the decoded preview's own ratio takes over (a 0.5 px change per image).
  - Rejected: `width` and `height` attributes alone.
- **S1-8 · The stream file opts out of the React Compiler, and nothing else does** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `"use no memo"` in the stream file only (confirmed in the dev bundle); the rows stay compiled and take only their row object.
  - Why: the compiler caches `getVirtualItems()`, read from TanStack's mutable virtualizer (the TV-D11b trap in `docs/gotchas/ui.md`). Not re-measured here.
  - Rejected: compiling the stream file.
- **S1-9 · The sticky day header comes from `rangeExtractor`** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `rangeExtractor` keeps the active separator drawn, with `position: sticky; top: 0`. It is up to one stale frame at a crossing in Chromium and none in WebKit; if that shows, update the label imperatively in the scroll handler.
  - Why: it is VirtualStack's pattern, and it works in both engines.
  - Rejected for now: `directDomUpdates`, which writes a transform onto the stuck header.

## 2026-10-14 · CV-0 spike 2 (the chat store and its device copy) — the agent's choices (deferred to by Maciej)

Measured in [the spike's record](../build/chat-v2/CV-0-S2.md) on the local stack, with no migration: the harness is `scripts/spikes/chat/s2/`, the server half a draft in `docs/build/chat-v2/drafts/store.sql`. Every bar passed. Each choice is the spike builder's, deferred to by Maciej: confirmed for building, revisitable. Not measured yet: WebKit (Tauri's macOS webview).

- **S2-1 · The device copy is plain IndexedDB, no library** → CV-3 (`scripts/spikes/chat/s2/page/device-copy.ts`)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: about 250 lines of raw IndexedDB, the way `src/lib/sync/` already does it.
  - Why: it clears every bar with room to spare, and nothing needed more than ranges and range deletes.
  - Rejected: Dexie; Tasks' one-record-per-workspace `SyncCache` (reading 10,000 messages back took 51 ms against 1.4 ms for a range read, and every save rewrote the whole record, 18 ms of main thread at 10,000 rows).
- **S2-2 · Messages are keyed by workspace, conversation, time and id** → CV-3
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the key is `[workspaceId, channelId, at, id]` (`at` is `created_at` in microseconds), plus a unique index on the id. A conversation is one key range: the newest 50 are read by jumping a cursor back 49 and taking them in one call, 1.4 ms at any size. Dropping a conversation, or its oldest rows, is one range delete.
  - Why: the cost of opening a conversation doesn't depend on how big it is.
  - Rejected: the id as the key with a time index (the read took 2.9 ms and eviction walked row by row, 354 ms); walking a cursor 50 steps.
- **S2-3 · The device keeps 500 messages per conversation; memory holds up to 1,500 per open conversation** → CV-3
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: 500 per conversation on the device; past about 20,000 messages in a workspace the least recently opened conversation is evicted, in the same transaction as the write; at most 1,500 per open window in memory.
  - Why: reading doesn't get slower with size, so the cap is only about disk: about 1.3 KB a message, about 26 MB for a full workspace; 1,500 in memory costs +1.8 MB (the bar was +50 MB).
  - Rejected: no cap (one 10,000-message channel is about 13 MB); 1,500 on the device (older history comes from the server by keyset pages anyway).
- **S2-4 · Chat gets its own database, `moduo-chat`, and no worker** → CV-3
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: its own IndexedDB database, written on the main thread in transactions of at most 200 rows. Revisit if CV-3's perf fixture shows long tasks.
  - Why: a second database costs 0.2 ms to open next to an open one, and its own database means its own versions, upgrades and wipe; a 500-row write is 3 ms of main thread, and at a 4× slower processor a 200-row transaction is about 5.5 ms (derived, not measured).
  - Rejected: Tasks' `moduo-sync` (its opener would close chat's connection on an upgrade); a worker now (0.5 ms instead of 3, but the rows must reach the main thread to be drawn anyway).
- **S2-5 · `chat_sync_ids` answers three kinds: conversation, member and moved away** → CV-1, CV-3
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: besides the conversations and memberships you still have, it returns the ids moved to somewhere you can't read (read from the `moved_out` lines written since your last check), and `checked_at`. A second move overwrites the line's `moved_from_channel_id`; the line itself stays.
  - Why: one check, 1.5–2.4 ms for 8 conversations, finds every way of losing access with no event: removed, deleted, made private, moved away.
  - Rejected: comparing each held conversation's message ids (up to 500 ids times every conversation, every 10 minutes; estimated, not measured); a `moved_from_channel_id` lookup.
- **S2-6 · History pages are a function that compares `(created_at, id)` in SQL** → CV-1 (`chat_messages_page` in `drafts/store.sql`)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: keyset pages as a row comparison in a function. Deltas may stay on PostgREST if they keep the extra `updated_at >= since` bound.
  - Why: the row comparison is an index condition (0.04 ms mid-history); PostgREST's `or=` spelling uses the index only for the order and filters the rest (1.7 ms at depth 5,000, and growing with depth).
  - Rejected: `or=` for history.

## 2026-10-14 · CV-0 spike 3 (Realtime delivery, typing cost and the plan's quotas) — the agent's choices (deferred to by Maciej)

Measured in [the spike's record](../build/chat-v2/CV-0-S3.md) against the local stack, with no migration: the harness is `scripts/spikes/chat/realtime-load.ts`. Four of five bars passed; the latency bar missed by 20–85 ms. The Free-or-Pro call (CH31) stays Maciej and Mike's: the record's recommendation is Pro before the hackathon (peak 200 sockets, Free's cap). Each choice is the spike builder's, deferred to by Maciej: confirmed for building, revisitable.

- **S3-1 · The latency bar is recorded as a miss, with its cause, not tuned away** → CV-3, and BR-1 below
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: Postgres Changes delivered at p95 530 ms against the 500 ms bar. The cause is the server reading changes about every 0.5 s (the client adds about 12 ms); Broadcast from the database, with no such poll, delivered typing at p95 11–16 ms. Keep Postgres Changes as specced, write the live merge so the transport can change, and re-measure on the real project; if prod misses too, deliver message rows by Broadcast from the database.
  - Why: the local poll setting isn't prod's to change, and the commit-based numbers (527 ms) don't pass either.
  - Rejected: changing the local tenant's poll settings; claiming a pass from the commit-based numbers.
- **S3-2 · The hackathon load was modelled as v1 would behave** → the CH31 numbers
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: 25 workspaces of 4 people, each person with two sockets (desktop and a tab) that both join the open conversation's typing topic and Presence, as v1 does; one message per person at a random second of the minute, after three typing events. That gave 200 sockets, 79 Realtime messages a second on average and peaks of 240.
  - Why: it's the upper bound that the two suggested trims cut from (join the typing topic only from the focused window, and don't touch the channel row on every send).
  - Rejected: one socket per person (it under-counts what CH31 worries about).

## 2026-10-14 · CV-0 spike 4 (the stored form of a message) — the agent's choices (deferred to by Maciej)

Built as the pure module `src/features/chat/markup-v2/` (nothing wired into the app) and the SQL converter draft `docs/build/chat-v2/drafts/chat_v1_to_v2.sql`; see [the spike's record](../build/chat-v2/CV-0-S4.md) for the list of supported constructs and the canonical form. All four bars passed, and the converter turned the research workspace's 3,032 messages into text that draws exactly as v1 drew them. Each choice is the spike builder's, deferred to by Maciej: confirmed for building, revisitable.

- **S4-1 · People and teams are references like everything else** → CV-1, CV-7a, CV-7b
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a person mention is stored as `moduo://person/<profiles.id>` and a team as `moduo://team/<id>`.
  - Why: RF-1 has no person node (its `@` pick inserts plain text), and the reference grammar already reads any `moduo://<type>/<uuid>`.
  - Rejected: `user` or `profile` as the type word ("person" is the product word); a separate `<@id>` syntax.
- **S4-2 · Bold and italic are read by a small stack, not CommonMark's algorithm** → `markup-v2/parse.ts`
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: each run closes the innermost mark first and then opens; an opener that never closes goes back to plain text. Proven for every sequence of up to four pieces and fuzzed.
  - Why: CommonMark's pairing mis-reads runs the composer itself writes (208 of 4,368 three-piece sequences failed).
  - Rejected: CommonMark's delimiter process; `@lexical/markdown` (it doesn't escape literal syntax, and would be a second dialect).
- **S4-3 · `*` may open inside a word, and `_` means nothing** → `parse.ts`, the converter
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `un*believ*able` is italic and `snake_case` never needs escaping. The converter rewrites v1's `_italic_` and escapes v1's `2*3*4`, which was text in v1.
  - Why: formatting inside a word from the editor has to survive storage, and underscores in words are common.
  - Rejected: v1's word-boundary rule for `*`; `_` as a second italic.
- **S4-4 · Every new line is a line break, blocks are set apart by one blank line, and two paragraphs in a row become one** → `markup-v2/canonical.ts`
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: one paragraph with line breaks is the canonical shape of a message.
  - Why: the composer makes new lines with ⇧⏎, so that is what it holds.
  - Rejected: CommonMark paragraphs (a single new line is a soft break), which would turn two typed lines into one.
- **S4-5 · Formatting is stored flat on each piece of text, like Lexical's formats** → `markup-v2/plan.ts`, `serialize.ts`
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a piece of text carries its set of marks and the renderer wraps it.
  - Why: one shape per formatting, which is what the editor holds.
  - Rejected: nested bold and italic nodes, as v1's tree had (two shapes for one meaning).
- **S4-6 · A reference's look isn't stored; where it sits decides** → CV-7a, CV-7b
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: alone on its own line in a paragraph it's a card where the kind can show as a card, a tag is a link, anything else is a chip (RF-1's insert rule).
  - Why: the spec says a reference is `moduo://<type>/<id>` and nothing more.
  - Rejected: `?display=card` on the reference.
- **S4-7 · Bare links, `@channel` and `:name:` stay plain text in the composer; the reader finds them** → `markup-v2/tokens.ts`
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: what you type is what's stored; the parser turns these into a link, a pill and a custom emoji when it draws.
  - Why: no special nodes to keep in step with the text.
  - Rejected: Lexical's auto-link node in the stored round trip (a typed link the plugin didn't wrap would flip node types).
- **S4-8 · Clean paste keeps text, lines, links, lists, quotes and code blocks, and drops every style** → CV-7b (`markup-v2/paste.ts`, CH15)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: inline code goes too; Moduo's own chips in pasted HTML come back as the reference or the day, never their text, and a broken chip leaves nothing; tables become tab-separated lines; emoji images become their `:name:` or the character.
  - Why: CH15's "clean text"; it sidesteps Google Docs' all-bold wrapper; a chip's text can be an old stored title.
  - Rejected: Lexical's own HTML import (it imports the styles).
- **S4-9 · `@channel` must start a word, also across formatting** → `markup-v2/tokens.ts`
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `a**@channel**` is plain text, and so are `@channels` and `x@channel.com`; `@here` and `@everyone` mean nothing.
  - Why: a glued `@channel` must never ping everyone by accident.
  - Rejected: checking each piece of text on its own (the validator's finding).
- **S4-10 · Links are http(s) and mailto only, with no spaces** → `markup-v2/serialize.ts`
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: any other target becomes its label as plain text.
  - Why: a target with a space can't sit inside `[label](target)`, and a message should only link to places people can open.
  - Rejected: relative links and other schemes; encoding spaces silently.
- **S4-11 · The converter fixes two v1 drawing bugs and keeps everything else as v1 drew it** → CV-1 (`drafts/chat_v1_to_v2.sql`)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a one-line code fence keeps its word as code (v1 drew an empty block labelled with it), and a `<!channel>` glued to a word gets spaces so it still reaches everyone. Everything else is kept as v1 drew it, v1's own link cuts included.
  - Why: changing where a link points without anyone noticing is worse than keeping an old quirk.
  - Rejected: copying v1's fence bug; "fixing" v1's link cuts.

## 2026-10-14 · CV-0 spike 5 (message search at 100,000 messages) — the agent's choices (deferred to by Maciej)

Measured in [the spike's record](../build/chat-v2/CV-0-S5.md) in a scratch schema on the local stack (dropped), with drafts for CV-1 and CV-19 in `docs/build/chat-v2/drafts/search.sql`. Assumption #9 holds: p95 4.3 ms against a 150 ms bar, "zolw" finds "żółw", and a private conversation's message never reaches a non-member. Each choice is the spike builder's, deferred to by Maciej: confirmed for building, revisitable.

- **S5-1 · Words of three letters or more are prefixes; one- and two-letter words match whole words only** → CV-19
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: "zad" finds zadania and zadaniem; "za" finds only the word "za"; "ok", "UI" and "PR" stay findable. A negated word stays exact ("-test" doesn't exclude "testy"), and input that can't be turned into a query runs as a plain one, so no input raises an error. The client may still start ⌘K's Messages at two characters: the server takes any input.
  - Why: every variant passes the speed bar at 100,000 rows, but a two-letter prefix matched 20–38 % of all rows, so newest-first shows near-arbitrary messages, and its cost grows with the workspace (near 100 ms in one of a million messages).
  - Rejected: prefixes from two letters; dropping short words; only the last word being a prefix.
- **S5-2 · The read rule is applied once, as a set, inside the indexed query** → CV-1, CV-19
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_search` works out the caller's readable conversations in the workspace once and filters the index by them, so the 50 results are the newest 50 readable ones however many unreadable matches are newer: 2.2–3.0 ms with up to 20,000 unreadable newer matches.
  - Why: checking the rule per match costs about 83 µs a time (713 ms at 5,000 unreadable newer matches, 2.8 s at 20,000), and a cap on candidates returns nothing when the newest matches are unreadable.
  - Rejected: the per-match loop (the `tasks_search` pattern); the loop with a cap.
- **S5-3 · The readable set is built set-wise and guarded by a parity test** → CV-1, CV-19
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat__readable_channel_ids(ws)` runs the workspace check once and the per-conversation part as one query; a test asserts it equals `chat_can_read_channel` for every caller and conversation.
  - Why: calling the rule per conversation costs about 170 ms at 2,025 conversations (a 100-person hackathon workspace's direct messages); the set form took 0.7 ms.
  - Rejected: per-conversation calls (simplest, nothing duplicated, but they grow with direct messages); a semi-join on the set (it doubled the time).
- **S5-4 · The snippet uses its own display-only text search config** → CV-19 (`chat_headline`)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `simple` with `unaccent` applied per word, used only to highlight the snippet; the index keeps the specced wrapper. It adds an object to Assumption #9 without changing it.
  - Why: with plain `simple`, "zolw" can't highlight "żółw" and the snippet showed the message's first words with no mark; with the config 50 of 50 snippets highlight.
  - Rejected: a headline over unaccented text (it loses the Polish letters); the config for the index too (it depends on the database's character settings, the wrapper doesn't).
- **S5-5 · Snippet marks are two private characters, not HTML** → CV-19
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: U+E000 and U+E001 mark the start and end of a match; the client splits on them and draws text.
  - Why: the message text is what people typed, so `<b>` markers would make every drawing of a snippet an escaping problem.
  - Rejected: `<b>` or `<mark>`; offsets (`ts_headline` gives none).
- **S5-6 · Search pages continue from the last row's `(created_at, id)`** → CV-19
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the next page passes the last row's time and id; three pages of 50 equalled the first 150 rows of one ordered query.
  - Why: the spec's single `before` repeats or skips rows that share a timestamp at a page edge, which is the stream's own rule (AC1.4).
  - Rejected: offsets; a timestamp alone.

## 2026-10-14 · Chat v2 build — the orchestrator's choices on the block briefs (deferred to by Maciej)

Written into the block briefs ([docs/build/chat-v2/briefs/](../build/chat-v2/briefs/)) while the spikes ran. Each is the orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable.

- **BR-1 · CV-3 keeps Postgres Changes for message rows behind one adapter until delivery is measured on the real project** → CV-3 (`briefs/CV-3.md` §6)
  - Who: orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: Assumption #17 holds: message rows come by Postgres Changes, and the live merge takes its input from one adapter so Broadcast from the database can replace it without touching the merge. Delivery p95 is re-measured on the real project before release, and that number decides.
  - Why: spike 3 missed the 500 ms bar by 20–85 ms because the local Realtime reads changes about every 0.5 s, and prod's cadence is unknown.
  - Rejected: switching to Broadcast now (more triggers and topics than the measured miss justifies).
- **BR-2 · CV-4 looks up the dated grant through `public.plan_grant_effective_tier(uuid)`, and falls back to the owner's plan** → CV-4 (`briefs/CV-4.md`)
  - Who: orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_workspace_enabled` is true when the owner has Duo, Team or Founder, or when that function exists (found with `to_regprocedure`) and returns a tier for the workspace now (null when no grant is active). Without the function the owner's plan decides, so the order of merging never matters. TX-9b builds the function to this signature.
  - Why: TX-9b isn't built and its function's name isn't fixed.
  - Rejected: blocking CV-4 until TX-9b exists; mixing it up with transactional-email T24's per-email founder `plan_grants`.
- **BR-3 · CV-2b's migration is its own file, `<stamp>_chat_v2_conversation_ops.sql`** → CV-2b (`briefs/CV-2b.md` §5)
  - Who: orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the conversation ops go in a new migration, not in message ops' file.
  - Why: CV-2a's file is applied by then, and applied files are never edited.
  - Rejected: adding to CV-2a's file.
- **BR-4 · CV-20 owns the `add_emoji` capability and CV-15 only shows it** → CV-20, CV-15 (`briefs/CV-20.md`, `briefs/CV-15.md`)
  - Who: orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: CV-20 adds the switch (the column on `workspace_chat_caps`, the `CHAT_CAPABILITIES` value and `chat_caps_get`, from its live body; on for admins and members, off for viewers). CV-15 shows it in the role editor and adds nothing to its migration for it; if the column isn't there when CV-15 starts, it hands back "blocked on CV-20".
  - Why: custom emoji is built first after the hackathon line (CH16b), before the lifecycle block.
  - Rejected: CV-15 adding it (a column in a block whose feature isn't built).

## 2026-10-14 · Chat v2 — the re-plan's product calls (Maciej) and technical decisions (the agent)

Planned in [`.design/chat-v2/REPLAN.md`](../../.design/chat-v2/REPLAN.md) (calls CH1–CH75, §6 #1–#28) and written as [`specs/chat-v2.md`](../../specs/chat-v2.md) (blocks CV-0…CV-23). Each entry: who · decision · why · rejected. A call number points at REPLAN §8; "§6 #n" at REPLAN §6; "round-3 §n" at [`research/round-3-database.md`](../../.design/chat-v2/research/round-3-database.md).

**Product calls (Maciej, 2026-10-13/14, unless marked as the agent's choice deferred to by him)**

- **C2-1 · Chat's bar and its one great moment** → the spec's Scope (CH1)
  - Who: Maciej, 2026-10-13.
  - Decision: Slack for a team of 2–5 in the parts a team uses every day, and no further; the great moment is "the conversation knows the work" (live references, a message becomes a task with the link both ways, a channel one click from its project or client).
  - Why: the bar is what every chat tool has; the moment is the spine applied to chat, which Slack can't copy.
  - Rejected: "catch up and be done" as the moment (every tool claims calm).
- **C2-2 · Channels and direct messages, and a channel can be linked to one project, client or team** → CV-13 (CH2, CH56, CH57)
  - Who: Maciej, 2026-10-13.
  - Decision: v1's shape kept, plus one optional link per channel; "Start a conversation for X" names the channel after X and makes it private with X's people when X is private; linking a team offers its people once, never kept in sync.
  - Why: the big tools met in the middle in 2025; standalone "new structure" products folded; chat next to the work is what thrives.
  - Rejected: one conversation per project (empty rooms), Zulip topics (overkill at 2–5), comments shown as chat (crosses the Notes boundary).
- **C2-3 · Words and names: "conversation", "channel", "direct message"; names as typed; no `#` before a channel; "Pin to sidebar"; no notes-to-self; one glyph plus a lock** → CV-2, CV-8 (CH3, CH3a, CH32)
  - Who: Maciej, 2026-10-13.
  - Decision: spaces and capitals allowed (1–80 characters, unique ignoring case); `#` means tags; a self-DM becomes a capture; every channel shares one glyph and a private one you're in shows a lock.
  - Why: Slack's no-space rule exists only for a `#name` token Moduo doesn't have (channels are picked from the `@` menu); five icon kinds in one list read messy.
  - Rejected: Slack's slug rule; icons by link type.
- **C2-4 · Chat appears from the second member; a lapsed plan pauses posting and keeps everything readable** → CV-4, CV-8 (CH4, CH4a, CH25, CH67)
  - Who: Maciej, 2026-10-13.
  - Decision: no tab in a one-person workspace; when the owner's plan or a dated grant doesn't include chat, one line replaces the composer ("Chat is paused…"), no marketing page; a hackathon team gets a dated Team plan on its workspace.
  - Why: history that disappears is the most resented thing about Slack's free plan; selling to a member inside a work tool is the wrong person.
  - Rejected: v1's four-card upgrade page; hiding Chat; a chat-only grant (leaves a Free owner's seat and file limits).
- **C2-5 · You're pinged only by what's addressed to you; it reaches you outside the app, in any workspace; one device rings** → CV-5, CV-6 (CH6, CH7, CH39–CH46, CH73–CH75)
  - Who: Maciej, 2026-10-13/14.
  - Decision: a direct message, `@you`, `@Team`, a reply in a chain you're in or to your message, an announcement; "Every message" pings once per burst only when Moduo isn't in front and lists one line per conversation in Catch up; "Nothing" keeps a mention in Catch up silently; an edit notifies only the newly named; Focus, quiet hours, do not disturb, a vacation and a paused workspace hold everything and nothing pings when they end; an email after an hour away, on by default, once per conversation per hour, never for what arrived during a hold; the browser asks once; sound off by default; a notice shows the text with a switch to hide it.
  - Why: the quiet bar (PRODUCT_BRIEF §7) with chat as the real-time exception; the only phone channel until a mobile app is email.
  - Rejected: per-message pushes; a summary notice when quiet hours end; email off by default; ringing every device.
- **C2-6 · Catch up: one list of what's addressed to you, worked like the Inbox; the bell and Catch up are one state** → CV-11 (CH8, CH38, CH51)
  - Who: Maciej, 2026-10-13.
  - Decision: grouped by conversation (newest first as a Display option); Reply `R` · Done `Space` · Task `T` · Later `H` · Open `⏎`; clearing in the bell or Catch up clears both; "Remind me" on any message returns it with one notice.
  - Why: Slack splits this across four views and its own team found thread replies need a place to land.
  - Rejected: separate bell and Catch up states; a "saved for later" list of its own.
- **C2-7 · Replies, not threads: one Reply action in the stream, "N replies ›" on the right, Wrap up by hand, tidy up afterwards** → CV-12, CV-16 (CH30, CH30a, CH30c, CH30d, CH53–CH55)
  - Who: Maciej, 2026-10-13.
  - Decision: a reply posts at the bottom with a quote; a chain opens as a panel item; Wrap up asks which reply settled it and offers "Also mark as decision", hides the replies and is undone by Reopen or a new reply; Reply to… and Move to… fix mistakes (own messages anywhere, others' only by managers and admins to a same-or-narrower audience, a warning when new people would see them); the root's author, managers and admins wrap up; no automatic folding.
  - Why: nobody follows thread rules ("half in, half out"); the tools that cope remove the up-front choice and let anyone fix it afterwards; automatic folding was hard to predict.
  - Rejected: Slack threads (CH12); automatic folding when tangled (rounds 2–3); anyone moving anyone's messages.
- **C2-8 · The look: Slack-calm as the base on Tasks' kit** → CV-7 (CH27–CH29g, CH29c, CH29d)
  - Who: Maciej, 2026-10-13.
  - Decision: 15 px reading text at every density, names by weight, 24/20/16 px before a new person and 6 px within, one left edge, centred day separators, fades at both ends, a centred "New" pill with no row tint and a floating "N new" chip, a one-row composer that grows with `+` as the one way in for files, links and new items, the recent past in the date grammar, density from the app's one setting, three quick reactions on hover with Reply before Task.
  - Why: what makes Slack and Discord look good is reading-size text, hierarchy by weight and rhythm, none of which costs a colour; v1's look was a placeholder.
  - Rejected: the Moduo-hybrid and Discord-depth variants; a two-row composer; a permanent row of module buttons; Task before Reply (agent's choice, deferred).
- **C2-9 · Reactions: a personal quick row, any emoji, custom workspace emoji; comments follow** → CV-7, CV-20 (CH16, CH16a, CH16b, CH29b, CH49, CH60)
  - Who: Maciej, 2026-10-13.
  - Decision: each person sets their own row (six by default); the same row and picker on task and note comments; custom emoji right after the hackathon cut (PNG/GIF/WebP, 256 KB, 128 px, any member unless a role switch says otherwise); viewers react; reactions never notify.
  - Why: "those should be configurable; we also need custom workspace emoji, everyone is using that."
  - Rejected: six fixed everywhere (Tasks 88, amended); workspace-set rows.
- **C2-10 · Presence: green = reachable now; grey shapes for away, do not disturb and Focusing; statuses with presets and your own; shown where you'd message someone and on Home** → CV-17 (CH9, CH28a–CH28d, CH42, CH45, CH47, CH48, CH70)
  - Who: Maciej, 2026-10-13.
  - Decision: outline = away without a time, thick bar = do not disturb, target = focusing ("until" only with a Pomodoro phase or an estimate; the task title only with an opt-in and to people who can see it), nothing = offline; one status for all your workspaces; a "Show me as online" switch; one Team widget on Home with Chat's "now" line.
  - Why: "can I reach them now?" is the one question a dot answers; "green in chat, white elsewhere" leaned toward surveillance.
  - Rejected: grey or white for "here"; per-workspace statuses; "Away since"; two per-person widgets.
- **C2-11 · Chat knows the work: Make a task through the capture with "From:", "Mentioned in" lines, decisions on items, a typed handle becomes a chip, ⌘7 needs a destination** → CV-10, CV-14 (CH10, CH11, CH13, CH52, CH65, CH66)
  - Who: Maciej, 2026-10-13.
  - Decision: `T` opens the capture with the message as the From chip and the linked project as destination; one "Mentioned in Acme · Oct 12" line per conversation on an item, readers only; decisions show on linked or mentioned items to the conversation's readers, even from a direct message; `MOD-142` becomes a live chip as you type; the Message capture picks a destination, recent first, with "Sent to … · Open · Undo".
  - Why: the connection the brief sells; a last-conversation default would send a message to the wrong client.
  - Rejected: v1's silent Inbox task; a "Discuss in chat" button on items; handles only through `@`.
- **C2-12 · Channels: managers add to private channels; public → private once; delete into Recently deleted for 30 days; removal is a quiet line; announcement channels pass "Reply privately"; former members keep their name** → CV-15 (CH23a, CH36, CH50, CH58–CH62)
  - Who: Maciej, 2026-10-13.
  - Decision: as listed; a post in an announcement channel pings everyone once and never breaks through a hold.
  - Why: the states people hit in their first weeks each need one answer; a deleted channel must be recoverable.
  - Rejected: archive only; "Seen by N" and scheduled posts (for now); replies in an announcement stream.
- **C2-13 · Offline sends wait and send themselves; ⌘J retires** → CV-3, CV-19 (CH63, CH64)
  - Who: Maciej, 2026-10-13.
  - Decision: "Waiting to send", in order, with Retry only on a refusal; conversations are found in ⌘K.
  - Why: matches Tasks' queued captures; one search for the app.
  - Rejected: fail at once; a disabled composer; ⌘K filtered to conversations.
- **C2-14 · The hackathon: no event workspace; dated Team plans per team; event news outside Moduo; a stop-gap if the date comes first** → CV-4 and the hackathon plan (CH20–CH22, CH67–CH69, CH26a)
  - Who: Maciej, 2026-10-13.
  - Decision: each team in its own workspace on a dated Team plan handed out by organizers; organizer news by email and venue screens for the first event; if server push or uploads aren't on prod by the date, notices only from an open app or tab and files as task attachments or links; the build order is chat in handed-out workspaces → pings that leave the app → the new look → files → links and make a task → Catch up → replies.
  - Why: "no event workspace necessary, just team plans handed out to teams"; about 100 people, PL + EN, the app stays English.
  - Rejected: an event workspace (C), Discord for the event (D), a help desk (CH24, parked), a chat-only grant.
- **C2-15 · Agents post as their creator "via <key>"; keys may read private channels only with a per-key switch (a column on the key); direct messages never** → CV-21 (CH18)
  - Who: Maciej, 2026-10-13.
  - Decision: as stated; guests wait for one app-wide model after the hackathon (CH19).
  - Why: delegates that name their person read honestly; the other person in a DM never agreed to an app reading it.
  - Rejected: the "App" badge and null author; a chat-only guest.

**Technical decisions (the agent, 2026-10-13/14; REPLAN §6 and round 3; the rejected alternative on each)**

- **C2-16 · v1's data shape stays; nothing is renamed** → CV-1 (§6 #1; round-3 §2.1)
  - Decision: the five tables, every write a `chat_op_*`, reactions and chain rollups on the row, soft deletes; `parent_id` means the chain's root, `starred` is "Pin to sidebar".
  - Why: sound, and a rename breaks every function body and the deployed connector for nothing a person sees.
  - Rejected: rebuilding the tables; child tables for reactions; renaming columns.
- **C2-17 · A `ChatStore` on the shared store pattern, with a server-stamped `updated_at` and client-minted ids as the idempotency key** → CV-3 (§6 #2; blueprint §3)
  - Decision: device copy of the newest ~500 per conversation, keyset pages by `(created_at, id)`, delta reads, Realtime applied from the event, echo skip, one-write rollback, an outbox, an access check; the v1 send/edit signatures stay one release as wrappers.
  - Why: v1's per-page fetch lost messages at boundaries and after reconnects; every untouched desktop must keep sending through the release.
  - Rejected: a generic sync framework; SQLite WASM; dropping the wrappers at once.
- **C2-18 · Messages are stored as a Markdown subset with `moduo://` references and drawn by a pure parser; one shared editor; v1 bodies converted once** → CV-1, CV-7 (§6 #3, #26)
  - Decision: `format_version`, `body_text`, `search_tsv` by trigger; the tree cached per message; 8,000 stored characters, references included; the conversion idempotent in SQL and round-tripped on the local stack.
  - Why: a title stored in text goes stale; an editor per row can't scroll; a v1 parser kept forever is debt.
  - Rejected: Lexical JSON; server HTML; a TypeScript one-off conversion.
- **C2-19 · References: conversation and message kinds; a message registers only when linked, without a label; ⌘K's Messages come from search** → CV-10 (§6 #4, #15)
  - Why: a registry label would carry message text to readers of the registry.
  - Rejected: a registry row per message.
- **C2-20 · Spine links: one `conversation-of` row mirrors the channel's link column; one `mentions` row per conversation and item, kept as history; every chat row outside the chat tables follows the conversation's read rule** → CV-1, CV-10, CV-13 (§6 #5; round-3 §2.21, §2.25 a)
  - Why: "at most one link" needs a column; a link per message is noise; a private conversation's existence must never show through the spine.
  - Rejected: `entity_links` alone; recounting mentions on every edit.
- **C2-21 · Notifications through TV-D12's pipeline: the fan-out in the send op, a per-person Catch up table with bell twins, one gate (send · hold · drop), push at once by a kick trigger, `user_clients` decides which device rings, the email as a 5-minute job through TX-3's outbox** → CV-5, CV-6, CV-18 (§6 #6, #23; round-3 §2.14, §2.15)
  - Why: one sender for the app; a client can't decide holds; a 5-second cron would mostly run empty; cancelling a queued email on read races the worker.
  - Rejected: a chat-only notifier; polling; deriving Catch up from the bell; queueing the email at send.
- **C2-22 · Search: `simple` + an immutable `unaccent` wrapper, a stored `tsvector` with a GIN index, one `chat_search` for ⌘K, the conversation and MCP** → CV-1, CV-19 (§6 #7)
  - Why: Polish has no built-in configuration and v1 scanned the table.
  - Rejected: substring match; `pg_trgm` now; PGroonga; an external engine; on-device search.
- **C2-23 · Panel and capture registries: Details · Reply chains · Files (⌥1–3) and the items chain · person · message in context · reference; the Message capture type** → CV-8, CV-10 (§6 #8)
  - Why: SH-1's registry is the one panel mechanism; Catch up's "message in context" is an item like a task, so the back arrow works.
  - Rejected: chat-only panel modes; a Catch-up-only panel mode.
- **C2-24 · General on the server; leaving is a stamp; delete with Undo and a blanking job; PERM-7 made honest with new ops for managers, the announcement switch, make private, delete and restore** → CV-2, CV-15 (§6 #9–#11, #27)
  - Why: a per-device flag missed people who never opened Chat; Undo is the app's rule (DF-5); v1 promised managers and a switch the server never read.
  - Rejected: the per-device General flag; the confirm toast; two places deciding who may create a channel.
- **C2-25 · Realtime: Postgres Changes for rows with zero requests per message; typing on one private topic per conversation, written only by `chat_op_typing` with the sender from the session; presence display-only; losing access is caught by the store's access check** → CV-1, CV-2, CV-3 (§6 #19; round-3 §2.7)
  - Why: a row RLS stops returning is never delivered; a client-supplied sender could never be trusted.
  - Rejected: client Broadcast with a sender field; full rows over Broadcast; a channel per conversation.
- **C2-26 · The stream is TanStack Virtual (runner-up Legend List 3); Frimousse for emoji; one reaction key format for chat and comments; custom emoji in a private bucket with a poster frame; no end-to-end encryption** → CV-7, CV-20 (§6 #18, #20, #21; round-3 §2.8, §2.9)
  - Why: TanStack Virtual is already in the stack with chat anchoring; one key format keeps chat and comments one component; a poster frame makes "plays on hover only" possible; E2EE would break every server-side feature the calls rely on.
  - Rejected: FlashList (needs react-native-web); emoji-mart; shortcodes as keys; SVG emoji; E2EE (breaks "addressed to you", search, agents, export).
- **C2-27 · Statuses, quiet hours and pausing: `user_statuses` for every workspace, `user_saved_statuses`, quiet hours in the Time & region store, `notices_paused_at` on the membership row, `chat_now` as the one read teammates get (a run seen in the last 3 minutes in any workspace; the task only with the opt-in and visibility)** → CV-17, CV-18 (round-3 §2.10–§2.13)
  - Why: a status is the person's (CH45); the gate must read quiet hours and pauses on the server; teammates need "can I reach them", not the run.
  - Rejected: per-workspace statuses; exposing Focus runs; "Away since".
- **C2-28 · Chains, moving and decisions on the message row: `reply_to_id`, `wrapped_*` + `settled_id`, `reopened_*`, `moved_*`, `decision_*`; Wrap up is a drawing rule; moving writes event lines; a reply moved alone leaves its chain; pins don't move** → CV-12, CV-14, CV-16 (round-3 §2.17–§2.19)
  - Why: one row carries every change through Realtime; Wrap up as a drawing rule keeps unread, search and export untouched.
  - Rejected: a thread table; a decisions table; moving replies into a thread table.
- **C2-29 · Drafts stay on the device (ids only); files upload before the send and are adopted by it; the plan gate reads TX-9b's grant when it exists and falls back to the owner's plan; the conversion gives each self-DM a private note** → CV-3, CV-9, CV-4, CV-1 (round-3 §2.22, §2.25 e, g, §2.6)
  - Why: unsent text on the server is one more thing to erase and export; a conversation isn't a shared item with grants; people's notes must survive the conversion.
  - Rejected: a server drafts table; access to files through `can_access`; deleting notes-to-self.
- **C2-30 · The build: blocks CV-0…CV-23 with the hackathon line after CV-12; one chat migration at a time on the Chat integration branch; live bodies before every redefinition; re-stamped files; the five spikes first; limits, vocabularies, erasure/export, kit additions, copy and accessibility fixed in the spec** → the spec's §Assumptions #22, #29–#36
  - Why: a block must fit one session's context; shared functions are redefined by Tasks blocks too; the Definition-of-Ready fails without the list.
  - Rejected: leaving any of them to the build sessions; a single large data block (round-3's CV-1 was three sessions' worth).
