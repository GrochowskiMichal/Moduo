# CV-5 — Addressed to you: Catch up rows and the bell (server)

> Branch `t/maciej/cv-5-catchup-server` · head: the commit carrying this line · status: built, not landed
> Migration: `supabase/migrations/20261015170000_chat_v2_catchup.sql` · applied to the local stack: **no** (waiting for its turn, after CV-2-fix). Every `supabase/tests/` file ran with it inside one rolled-back transaction (`BEGIN` → the migration → `_setup` → the test → `ROLLBACK`); it applies twice over itself cleanly. Stamp provisional: it must stay after `20261015140000_chat_v2_rules_fix.sql` (CV-2-fix), whose `chat_op_send` it redefines (cut from CV-2-fix's body: the managers-in-effect check before the rejoin, a removal kept on rejoin).

## Delivered against the row

- **The fan-out** (`chat__fan_out(message, channel, actor, before)`), called inside `chat_op_send`, `chat_op_edit` and the live `chat_op_agent_post`, in the same transaction. Among people who can read the conversation (`chat__can_read_channel_as`), never the sender, **one reason per person per message**, the first that applies:

  | Reason | Who | Bell row (twin) |
  | --- | --- | --- |
  | `dm` | the other people in a direct message, not on Nothing | none |
  | `mention` | named in person (members or not) | `chat.mention`, `reason: person` |
  | `team_mention` | members of a named team, unless "Your teams" is off | `chat.mention`, `reason: team`, `team_ids` |
  | `everyone` | `@channel`: members not on Nothing | `chat.mention`, `reason: everyone` |
  | `announcement` | a top-level post in an announcement channel: members not on Nothing | `chat.announcement` |
  | `reply` | the chain's people (root's author, every replier, everyone named in the chain, the quoted message's author), minus "Stop following", not on Nothing | `chat.reply` |
  | `every_message` | members on Every message, for anything else | none |

  On Nothing, `mention` and `team_mention` are written as items with no bell row (CH40); everything else is nothing. A direct message that names someone on Nothing is a silent `mention`. **Grouped items:** one open `reply` item per person and chain, one open `every_message` line per person and conversation (two new partial unique indexes; the insert upserts and moves the item to the newest message). One bell row per message and reason, shared by its recipients (`notify_user_ids`); each item's `activity_id` is its own twin. Payloads: ids, `channel_name`/`channel_kind` (as before), the server-built excerpt (`chat__excerpt`, stored form, `format_version: 2`). `held_at` stays null (CV-18); no device notice (CV-6a).
- **Edit (CH75):** only people, teams and `@channel` that the previous version didn't name, and never someone who already has a `dm`/`mention`/`team_mention`/`everyone` item for that message (so taking a name out and putting it back tells nobody twice). Replies, announcements and Every message never fire on an edit.
- **The bell's recipient guard** (`module_activity_gate_recipients`) now covers `chat.mention`, `chat.reply`, `chat.announcement` (anchored replace on the live trigger, guarded so it re-runs).
- **One state with the bell (§2.15):** `chat_op_catchup_done(ids)` closes your items (`done`) and dismisses their twins; `chat_op_catchup_reopen(ids)` (Undo) reopens them and undismisses the twins; `notifications_op_dismiss` / `_undismiss` (from the live bodies; Tasks' lines unchanged) close (`bell`) / reopen the twin's item; `chat_op_mark_read` closes your items up to that message (`read`) and dismisses their twins (also for a reader who isn't a member); **sending** does the same up to your own message (your mark moves there already); `chat_op_mark_unread` reopens what reading closed from that message on (Done and the bell's dismissals stay). The bell's read dot stays the bell's.
- **`chat_op_follow_chain(message, following)`**: any message of the chain names it; `false` writes `chat_chain_mutes` and closes the chain's open item (`done`, twin dismissed); `true` removes the mute.
- **Counts:** `chat_unread_counts.catchup` now counts the conversation's open items that are showing (not put off with Later), none on Nothing, no quiet lines (`added`, `removed`, `level_reset`), none for a deleted message, none of a muted chain, no team mention while "Your teams" is off. `mentions` and `addressed` leave out team mentions while "Your teams" is off (CV-2b's note).
- **Races:** a grouped item only ever moves forward (an older message's fan-out committing after a newer one leaves it, and its bell row is dismissed for whoever stayed on the newer one); reading closes an item only if it is still on a message up to the one read (re-checked under the row lock).
- **The ops** need no plan (#25), log no activity (#15), refuse keys (`42501 Sign in first.` for Done/Undo; the reader check for follow), take at most 1,000 ids.
- **Client:** `src/features/spine/activity.ts` reads the three ops by why they reached you ("mentioned you / your team / everyone in #plans", "replied in #plans", "posted in #plans"; v1's "replied in a thread" gone) and names the excerpt's references per reader (CV-1's ❓: the bell no longer prints `moduo://person/<id>`).
- **Tests:** `supabase/tests/chat_catchup.test.sql` (new, 64 checks); `chat_counts.test.sql` (its `test.put` now fans out like a send; +5 checks for Every message). Adjusted for the new truth: `chat_ops` (N's post rings the bell; an edit naming A tells A), `chat_wrappers` (the person row of a message that also has `@channel`), `chat_foundation` (own-rows check counts the rows it wrote, not the setup sends' items), `chat_privacy` (a direct message rings no bell, so A's edit writes the row about D); `src/features/spine/activity.test.ts` (+1).

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC7.1 (items and bell) | `chat_catchup.test.sql` · §1 "addressed to you, row by row": direct message (and on Nothing), @you (member and non-member reader), @Team, @Team + named, team mute, @channel, reply chain (root's author, named in it, repliers; on Nothing), Stop following / follow again, announcement, Every message (and a late older message), edit, private channel, an app's post; no device notice, `held_at` empty. **Open against the Count column:** an @you to a reader who isn't a member writes the item and the bell row, but no `chat_unread_counts` row counts it (see CV-3 / CV-11). The "reply to your own message" rule can't be isolated: a quoted message's author is always the root's author or a replier |
| AC7.2 | `chat_catchup.test.sql` · §2 "one state with the bell": Done ↔ twin dismissed, Undo, bell dismiss ↔ item closed, undismiss, the bell's read dot, read closes both up to the message, mark unread reopens what reading closed (not Done; an Every-message line too), a non-member reader, sending, a chain's twin, Undo of two items of one chain, Undo while the chain has an open item |
| AC7.3 | `chat_catchup.test.sql` · "Every message: three messages are one line…"; `chat_counts.test.sql` · the Every message block (one line at the newest; reading part keeps it; reading to the newest closes it; the next message opens a new line) |
| AC7.4 | `chat_catchup.test.sql` · "Nothing: an @you is in Catch up only…" and the @Team / edit checks on Nothing |
| AC7.10 | `chat_catchup.test.sql` · the five "edit:" checks |
| AC1.7 | `chat_counts.test.sql` (all of CV-2b's checks now on real items) + "an Every message conversation is one Catch up item in the tab's count" |

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **One reason per person per message, by precedence** (mention → team → @channel → announcement → reply → Every message) · one item and one count per message, as CV-2b's counts already read it · rejected: an item per matching reason (one message counted twice).
- **A direct message is always `dm`, never a bell row** (even when it names you) · the table's bell column is for channels ("the bell is for work items") · rejected: a `mention` + bell row for a name inside a DM.
- **The bell keeps one row per chain and person:** when a new reply moves your chain item, the bell row it pointed at is dismissed for you · Done, read and the bell's dismiss then act on exactly one row · rejected: every reply's row staying live (Done on the chain would leave older rows in the bell, breaking "one state").
- **An @you reaches a reader who isn't a member of the public channel** (item + bell), as v1 rang the bell · §11 "You, if you can read it" · rejected: members only. Their item isn't in any `chat_unread_counts` row (no membership), see CV-3/CV-11 below.
- **Mark unread reopens items that reading closed** (not Done, not the bell's) · the conversation's number and the tab's count move together, and CV-2b's counts (derived from the mark) stay true · rejected: leaving them closed (a marked-unread DM would show a number while the tab shows 0).
- **Sending closes your own items up to your message** · your read mark already moves there (CV-2a) · rejected: leaving them open (Catch up would list what the conversation calls read).
- **Reading closes snoozed items too** · "reading it in its conversation clears it" · rejected: keeping Later's items open after reading. Quiet lines and reminders never close by reading.
- **The team mute is applied when writing** (no item, no bell row) **and when counting** (`addressed` and `catchup` skip team mentions while it's on) · rejected: write-time only (an old team item kept counting while muted). Turning it off doesn't bring back mentions sent while it was on.
- **Switching a conversation to Every message adds no line for what came before** · items are written as messages arrive · rejected: backfilling at the switch.
- **Stop following closes the chain's open item** (`done`) · the chain leaves Catch up at once · rejected: hiding it only from the count. A message you can't read answers "That message no longer exists." (as one that isn't there).
- **A grouped item keeps its `created_at` and its Later** when a newer message moves it · Later means later, and the line's age is when it opened · rejected: a new reply bringing a snoozed chain back (CV-11 may revisit).
- **An edit can add a mention item next to an item of another reason** (`reply`, `announcement`, `every_message`) for the same message · CH75: being named is new news · rejected: blocking it.
- **An app's post (`chat_op_agent_post`) fans out with no sender to skip** (its author is null until CV-21) · rejected: excluding the key's creator now (CV-21's rule).

## Gotchas (area: supabase)

- A check that shares a statement with the send it looks at sees the rows as they were when the statement started: a plain subquery next to `test.send(...)` in one `test.ok(...)` reads nothing new (VOLATILE helper functions do). Send first, check in the next statement.
- Partial unique indexes as `ON CONFLICT` arbiters need the index's predicate in the clause (`ON CONFLICT (user_id, chain_root_id) WHERE reason = 'reply' AND done_at IS NULL`); every path that reopens an item must reopen at most one per chain / line, and only while none is open (`chat__reopen`).
- `module_activity_log` returns nothing; the bell twin's id needs the row inserted directly (`chat__activity` mirrors its attribution: the person, or the key with its person's name). A change to one must go to the other.
- Two migrations redefining one function: the later stamp must be cut from the earlier one's body (CV-5's `chat_op_send` from CV-2-fix's), or a replay in stamp order silently drops a rule.

## For later blocks

- **CV-6a:** the fan-out (`chat__fan_out`) is where the device notice and the gate go: per reason, the recipient list is built once (`v_who`); `held_at` is the item's column; the email job reads `dm`/`mention`/`team_mention` items. Map `chat.mention` (`reason`), `chat.reply`, `chat.announcement` to notice kinds there.
- **CV-6b:** map `chat.mention` (by `payload.reason`: person/everyone → Mentions and replies, team → also "Your teams"), `chat.reply` and `chat.announcement` in `OP_TO_NOTIFICATION_TYPE` (`src/lib/preferences.ts`). The reasons `person` / `team` / `everyone` are literals today (`activity.ts`); a shared constant belongs with that mapping.
- **CV-3 / CV-11:** `chat_unread_counts.catchup` is real items now. An item in a public conversation you're not in (you were @named there) has no counts row: count the tab from `chat_catchup` (own rows, published) if it must include those. Catch up's view should hide items the count hides (Later, Nothing, muted chains, team mentions while muted, deleted messages). A grouped item's `message_id` is its newest message; `created_at` is when the line opened. A new message bumps a snoozed line without unsnoozing it. Remind me (`reminder` items) is untouched by reading and by mark unread.
- **CV-11:** `chat_op_catchup_done` / `_reopen` take item ids (≤ 1,000) and return how many changed; "Done all in this conversation" passes that conversation's open item ids.
- **CV-15:** archive / delete / removal should close the affected items (`closed`); `chat__close(user, ids, 'closed')` dismisses the twins too. `chat__reopen` never reopens `closed` items.
- **CV-18:** set `held_at` in the fan-out's item inserts.
- **CV-21:** `chat_op_agent_post`'s author becomes the key's creator; the fan-out then skips them (it skips `p_actor`); pass the creator as the actor.

## Manual checklist (step → expect → surface)

- [ ] A sends B a direct message → B's Chat tab count +1; no bell row → Chat, bell
- [ ] A writes `@B` in a channel → B's bell shows "A mentioned you in #channel: “…”" with names, not URIs; Catch up has it → bell, Chat
- [ ] B dismisses it in the bell → the Chat tab count drops by one → bell, Chat
- [ ] B opens the channel and reads it → the bell row is dismissed → Chat, bell
- [ ] C sets the channel to Nothing; A writes `@C` → no bell row, no count; the item exists → Chat
- [ ] Three replies in a chain B started → one bell row (the newest) and one Catch up item → bell, Chat
- [ ] B on Every message in a channel, three plain messages → the conversation shows 3, the tab 1 → Chat

## Verify before release

- The local stack had `chat_foundation`'s index check (`chat_channels_live_name_uq`) and `chat_ops` (line ~451, `chat_members_removal_check`) failing without this migration (CV-2-fix in flight); re-run both after it lands.
- `@channel` in a 100-person channel writes 100 items (100 Realtime changes on `chat_catchup`, one per owner) plus one bell row; Every message members get an update per message. Spike 3's delivery budget (CH31) should count these.
