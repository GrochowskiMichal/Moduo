> Raw research report from the Chat re-plan, 2026-10-13 (branch t/maciej/chat-replan). Nothing here is decided.

# Chat v1: the honest current state

Chat v1 was built on 2026-10-06 by Mike (`specs/chat.md`), straight from the ask, without a planning round. Every product call in it was the agent's assumption.

This report reads the code first (`src/features/chat/**`, `src/routes/pages/chat-page.tsx`, `src/lib/runtime.chat.web.ts`, the chat migrations, the MCP chat module). Then it checks the code against the local stack with three people: the owner (dev), a member (Tess Mate) and a viewer (Third Member), in a new workspace "Chat replan research" seeded through the real chat ops. Lines marked **Live:** were seen in the running app or the local database. Everything else comes from reading code.

## 0. Shape in one paragraph

Chat is three tables: `chat_channels`, `chat_members` (per-person read mark, notify level, star) and `chat_messages` (top-level messages and thread replies in one table). Reactions and thread rollups are stored on the message row (`supabase/migrations/20261006150000_chat_module.sql:103-124`), so every live change is one row update. The app only reads tables directly. Every write is a `chat_op_*` database function (`src/lib/runtime.chat.web.ts:154-294`). The page keeps everything in React state in one 990-line hook (`src/features/chat/hooks/use-chat-module.ts`). Live updates come from a shared Supabase Realtime link per workspace (`src/features/chat/realtime.ts`). There is no local cache, no offline queue and no use of the Tasks v3 shared store. Later migrations added per-role chat abilities (`workspace_chat_caps`), channel managers and an announcement switch (`20261006210000_perm_sharing.sql:415-465, 918-998, 1196-1213`), but the app barely knows about them (see §1, Members).

(Section 1, the feature table, is near the end because it leans on the live walk-through. Sections 2–7 come first.)

## 2. Module-contract checklist

The contract (`docs/moduo-module-contract.md`, "A module isn't done until") against Chat:

| Contract item | Chat v1 | Evidence |
| --- | --- | --- |
| Every write is a named op | **Yes**, with one oddity | Clients have SELECT only (`20261006150000_chat_module.sql:153-155`). All writes are `chat_op_*`. The announcement switch is `share_op_announce`, outside the chat namespace (`20261006210000_perm_sharing.sql:1196`). |
| Ops check role rules | **Through triggers** | The ops themselves check workspace membership and the plan (`chat_op__guard`, `20261006150000_chat_module.sql:171-181`). Role abilities are enforced by table triggers (`perm_enforce_write('chat')` and `share_chat_message_guard`) on message inserts and deletes and on channel creation. |
| Every op writes an attributed `module_activity` row | **No** | Only `chat.channel_create`, `chat.channel_archive/_unarchive`, `chat.mention`, `chat.reply` write rows (`20261006150000_chat_module.sql:264, 365, 521`). Edit, delete, react, pin, rename, topic, join, leave, add/remove member and the announcement switch write nothing. Plain messages are deliberately not logged (the message is its own record). Moderation leaves no trail: an admin deleting someone's message or removing a person is invisible afterwards. |
| The activity trail renders in the module | **No** | There is no channel history or "about" trail. The lifecycle rows only reach the bell (`src/features/spine/activity.ts:151-166`). |
| Manifest entry in the registry | **Yes** | `src/features/chat/ops-manifest.ts`, listed in `src/lib/module-registry.ts:21`. One agent op (`chat.agent_post`) and three read resources. |
| Search registry (`entities`) | **No** | No chat migration calls `entities_op_*`. Channels and messages are invisible to ⌘K search, `@` pickers and References. |
| Spine links (`entity_links`) from messages | **No** | A `#` link lives only in the message text (`<moduo:task:ID|Label>`, `src/features/chat/markup.ts:6`). The task never learns it was discussed. `specs/chat.md` §Next lists this as optional. |
| Erasure on account deletion | **Yes** | `20261008013000_account_erase_workspace_data.sql:300-360, 453-459`: DMs and private channels with nobody else left are deleted, sole managers are replaced, messages stay without a name (author set to null by the auth cascade). The DM's member list (`dm_key`) keeps the deleted person's id; the app shows "Former member". |
| Lossless export | **No** | The workspace export covers tasks, notes, contacts, calendar, habits and attachments only (`src/features/settings/advanced.ts:15-21`). Chat is not exported. |
| Attachments | **None in v1** | Out of scope in `specs/chat.md`. No upload path, no paste of images. |
| Agents (MCP) | **Yes, narrow** | `supabase/functions/moduo-mcp/modules/chat.ts`: list channels, read, search (public channels only), post as an "App". Own key scope `chat`, none by default. **Not live-tested**: the local edge runtime is stopped. |

## 3. Tasks v3 shared pieces: do they exist, and does Chat use them?

Bottom line: Chat uses only `EmptyState`, the raw `Avatar` primitive and a few old spine helpers. It is not registered in any of the v3 registries.

| Shared piece | Exists in code? | Chat uses it? |
| --- | --- | --- |
| Right-panel registry `src/lib/panel-registry.ts` | Yes. `PanelModule` is `"tasks" \| "calendar" \| "email" \| "notes" \| "contacts"` (`:34`). Each module supplies a `panel-views.ts`. | **No.** No chat entry and no `features/chat/panel-views.ts`. Chat has its own local `"details" \| "search"` panel state (`src/routes/pages/chat-page.tsx:49`). Threads live in the URL (`?t=`). |
| "← item" stack in `src/components/app/right-panel.tsx` | Yes. `usePanelStack()` (`:76`) gives `push/back/clear`; References open items in the panel through `ReferenceHost.openInPanel` (`src/features/spine/references/context.tsx:22`). | **No.** A linked task in a message opens the Tasks page instead (`src/features/chat/ui/message-body.tsx:95` dispatches `ENTITY_OPEN_EVENT`). |
| Capture registry `src/lib/capture-registry.ts` | Yes. `CaptureModule` includes `"chat"` (`:24`), but only task, notes, calendar and contacts capture types are registered. | **No.** "Create task from message" calls the older `createCapturedEntity` (`chat-page.tsx:311-329`). No capture shell, no link back to the message, and the toast's "Open" goes to `/tasks`, not the new task. |
| References (RF-1) `src/features/spine/references/*` | Yes: chip/card/hover kinds for task, email, contact, company, note, event, project, tag; "Private item" / "Deleted …" states; stored as `moduo://type/id` without a title. | **No.** Chat renders the old `EntityRefChip` (`message-body.tsx:8, 88`) and stores the title inside the token. |
| Grammar `src/features/spine/grammar.ts` | Yes. `@` = people and things, `#` = tags, `/` = commands (`:17-19`), task handles like `MOD-142` (`:231`). | **No, and it conflicts.** Chat's composer uses `#` for "any Moduo item" (`src/features/chat/ui/composer.tsx:5-7`). `docs/decisions/spine.md` (2026-10-08) says `@` covers people, items and channels, and `#` is tags. |
| DS-6 kit (`src/components/ui/`: Row, NavRow, GroupHeader, MetaCount, Chip, EmptyState, Feed, Avatar, ItemCard, PropertyRow, CollectionHeader) | Yes, all exist (`kit.ts`). | **Only `EmptyState` and the raw `Avatar`.** The rail is hand-built, not `NavRow`. `src/features/chat/ui/person-avatar.tsx` re-implements `PersonAvatar`/initials next to the kit's own. |
| Shared store (TV-D11a/b) `src/lib/sync/` (`store.ts`, `cache.ts`, `delta-cursor.ts`, `react.ts`) | Yes. IndexedDB copy, delta reads per table cursor, realtime merge, offline outbox. Generic in shape, but only Tasks tables are registered and the outbox only takes task captures and status changes. | **No.** Chat holds everything in React state, refetches on every open and resync, and has no outbox. |
| Lexical title editor (TV-U14) `src/features/tasks/capture/title-editor.tsx`, `token-node.tsx`; reusable `src/features/spine/editor/mention-menu-plugin.tsx` and `entity-text-editor.tsx` | Yes. `@ # /` typeahead with tokens. | **No.** Chat's composer is a plain `<textarea>` (`composer.tsx:466`) with its own `@`, `#` and `:` pickers. |
| Comments + six fixed reactions (TV-U13) | Comments exist (`src/features/spine/comments.ts`, `src/features/spine/ui/comments-panel.tsx`). The six reactions (👍 ✅ 👀 🙏 ❤️ 😄, never notifying) are plan only (`specs/tasks-v3.md:103`, TV-U13 unchecked). | **No.** Chat allows any emoji, up to 20 per message, stored on the row (`20261006150000_chat_module.sql:112, 609`). Quick row is 👍 ❤️ 😂 (`src/features/chat/emoji.ts:156`). |
| Bottom bar "mode" pattern | **Not built yet.** `src/components/app/global-bottom-bar.tsx:41` has three fixed buttons; the mode row is planned as TV-U12. | No. |

Docs drift: `specs/BUILD_ORDER.md:302` still says chat is "Planned — not yet specced", and `specs/tasks-v3.md` never mentions chat.

## 4. Notifications and the badge: what actually happens

**The bell.** Only two kinds of chat activity reach the bell:

- `chat.mention`: someone wrote @you, or @channel in a conversation you're in (and haven't muted).
- `chat.reply`: a reply in a thread you started or replied to.

Both are written by `chat_op_send` (latest body in `20261006210000_perm_sharing.sql:1731-1830`). Agent posts do the same through `chat_op_agent_post`. Nothing else notifies: not DMs (spec assumption 6), not edits (a mention added in an edit never notifies), not reactions, not being added to or removed from a channel.

- **Live:** after seeding, dev's bell had two cards: "Tess Mate mentioned you in #design" and "Tess Mate replied in a thread in #design".
- **Live:** clicking the "replied in a thread" card opened `#design` at the bottom. The thread did not open and the message was not highlighted. The deep link carries only the channel (`src/lib/entity-open.ts:72-73`), although the activity row holds `message_id` and `parent_id`.
- **Live:** when a message is sent from outside the app's composer, the card shows the raw body, so a card showed a raw `<@00000000-…>` token instead of a name.

**The Chat tab badge.** A dot on the Chat tab. The number only lives in its accessible label. The formula (`src/features/chat/timeline.ts:199-210`):

- DMs and group DMs: every unread top-level message.
- Channels: only unread mentions, unless your level is "Every new message", then every unread message.
- Muted: never counts. Archived: never counts.
- Thread replies: never count anywhere. The server count is top-level only (`chat_unread_counts`, `20261006150000_chat_module.sql:693-711`) and the badge ignores reply events (`src/features/chat/hooks/use-chat-badge.ts:78`). A mention inside a thread reaches the bell and nothing else.

Who gets "Every new message" without choosing it: the person who creates a channel (`20261006150000_chat_module.sql:254-255`) and everyone in a DM (`:308-309`). Everyone else joins at "Mentions only".

- **Live:** right after seeding, dev's badge read "205 unread". 200 of those were in `#firehose`, a channel dev had created, so dev was on "Every new message" without ever picking it.
- **Live:** ⌘J's "Unread" list still showed muted `#random` with 2 unread. Mute only hides things from the badge, the rail weight and the widget.

**Home widget ("Conversations").** Same formula as the badge (`src/features/chat/widget.ts:23-60`), rendered by `src/features/dashboard/ui/widgets/chat-widget.tsx`. It is not on the default Home layout; you add it from the gallery.

- **Live:** with the widget added, it showed "Needs you 4" (group DM 1, DM 2, `#launch-private` 1), matching the badge at that moment.

**Outside the app.** No OS or browser notifications for chat (the only `Notification` use is the Focus timer, `src/features/focus/phase-alert.ts`). No email. No unread count in the window title. On desktop, nothing reaches the dock.

## 5. Performance and scale

**How the live timings were taken.** In the built-in browser pane, which was hidden, with page visibility forced to "visible" by script. Treat the timings as relative comparisons, not absolute numbers. Two people were signed in on two origins (`127.0.0.1` and `localhost`) of the same dev server.

**Live delivery between people.** A message dev typed in the app reached Tess's open tab (about 4 s, measured in a background tab, so throttled). Messages Tess sent reached dev's open channel in about 0.1 s.

**Opening Chat.** The page waits for five round trips in a row before the first message shows: workspace list → "is chat on for this plan" → `chat_op_bootstrap` (a write, on every open) → channels + my memberships + unread counts + workspace members → the newest 50 messages and the channel's members (`use-chat-module.ts:159-222, 405-410`). Nothing is cached between visits. The nav badge loads the same channel, membership and unread lists again at the same time (`use-chat-badge.ts:35-41`).

- **Live:** cold load of `/chat` on the local stack (no network latency): first message painted about 390 ms after navigation started, 55 requests to the database in total for the page.
- **Live:** from Home with ⌘7: first message in about 100 ms, 8 requests. On a real connection each of the 4–5 sequential steps adds one network round trip.
- First visit to a workspace loads everything twice (join `#general`, then reload, `use-chat-module.ts:178-201`).

**Paging.** 50 top-level messages per page, older pages when you scroll near the top (`message-list.tsx:159`). The cursor is the timestamp alone (`runtime.chat.web.ts:98`), see trust bug 4. A thread loads all its replies at once, capped silently at 1,000 (`runtime.chat.web.ts:111`). Pins are capped at 100.

**A very large channel (3,000 messages, Live).**

- Scrolling `#firehose` all the way up loaded 60 pages and ended with 2,999 message rows and about 119,000 page elements. There is no virtual list; every loaded message stays rendered.
- With that channel loaded, a new message took about 3 seconds to appear. In a 3-message channel the same send appeared in about 0.1 s.
- Loaded windows for every channel you opened stay in memory until reload.

**Live updates.** One Supabase Realtime subscription per workspace: changes to `chat_messages` and `chat_channels` for the whole workspace, plus your own `chat_members` rows (`realtime.ts:79-124`). The server checks each change against each listener's read rules. Every reaction or thread-count change is a full-row update sent to everyone who can read the channel.

- **Live:** one incoming message in the open channel caused 10 requests in the receiving app: three badge recounts (each re-reading all channels, memberships and unread counts) and one mark-read. Every connected person does this for every message, so the cost grows with people × messages.
- After a reconnect, the browser coming back online, or 60 s hidden, the app reloads the channel list and the newest 50 messages of the open conversation (`realtime.ts:117-124, 197-208`).

**Search.** A plain "contains" match on the raw stored text, newest first, 40 results, no index (`runtime.chat.web.ts:139-152`).

- **Live:** 410 ms for about 3,000 messages. The query plan reads every message in the workspace and runs the read-rule check on each row before matching. It grows in step with message count (100,000 messages would be on the order of 10+ seconds, extrapolated, not measured).
- Unread counts stay cheap: 2 ms with 3,000 messages (Live).

**Presence and typing.** They ride a private Realtime channel `chat:<workspace>` (`realtime.ts:127-165`).

- **Live:** on the local stack the join is refused ("Unauthorized: You do not have permissions to read from this Channel topic"), because the local database has no policies on `realtime.messages` (the chat migration's `chat_realtime_read/write`, `20261006150000_chat_module.sql:778-786`, are missing locally). So everyone showed "Away" and typing never appeared, with both people in the app.
- Not checked: whether production has those policies (production was off-limits for this research).
- The app never notices: the subscribe callback only handles success (`realtime.ts:157-164`), so a refused channel looks the same as "nobody is online".

## 6. States

| State | What the person sees today | Evidence |
| --- | --- | --- |
| Loading | A single spinner in the middle. No skeleton, no rail. | `chat-page.tsx:392-404` |
| Plan locked (Free/Pro owner) | An explainer with "Upgrade to Duo — $20/mo for two" for the owner; members get "ask the owner". The tab stays visible. | `src/features/chat/ui/chat-locked.tsx:67-95` |
| Empty conversation | "This is the start of #name" with the topic and a hint to type `#`. DMs: "This conversation is just between you…". Notes to self: "Your own space…". | `chat-page.tsx:453-496` |
| No conversation open | Empty state with New message / New channel and the ⌘J hint. | `chat-page.tsx:569-586` |
| Search with no hits | "No messages match “…”." **The same text shows when the search fails.** | `side-panels.tsx:303, 340-342`; **Live** for "Tess" |
| Offline | **Live (simulated by blocking requests):** the shell shows "Offline". Sending shows a raw "TypeError: Failed to fetch" toast, the message stays in the list looking sent, it is never retried, and it is gone after reload. Nothing is readable offline after a reload (no cache). | §7 bug 1 |
| Viewer (read-only role) | **Live:** full composer, "New channel" and "New message" buttons. Sending fails with "Your role can't add messages in this workspace." and the message looks sent. Opening a DM fails with the same words. | `share_chat_message_guard`, `perm_enforce_write` |
| Announcement channel (managers only) | **Live:** a member sees the normal composer and no hint. The server refuses: "Only managers can post in this channel." | `20261006210000_perm_sharing.sql:984-988` |
| Very large channel | See §5: everything rendered, slow updates once scrolled. | **Live** |
| Error | Whole page: "Chat couldn't load" + Try again. A failed message load shows a toast and then an **empty channel** (the window is set to empty, `use-chat-module.ts:305-313`). | `chat-page.tsx:415-433` |
| Archived channel | Read-only bar "This channel is archived. It's read only." + Unarchive for the creator/admins. It leaves the rail; Browse has an "Archived" toggle. | `chat-page.tsx:540-554`; `chat-dialogs.tsx:422-467` |
| Deleted message | "This message was deleted." in place; its thread stays. Delete is soft. Only your own messages offer Delete in the menu, though admins may delete anyone's on the server. | `message-item.tsx:171-180`; `20261006150000_chat_module.sql:563-586` |
| Deleted channel | There is no delete, only archive. | — |
| No access / removed | A link to a conversation you can't see: toast "That conversation isn't available." and a jump to the default. No "Private item" state. **Live:** when someone removed dev from `#engineering`, dev got no notice; the open channel just switched to "Join channel". | `chat-page.tsx:188-194` |
| People without a name | **Live:** dev has no display name, so dev shows as "Member" everywhere, including "Member (you)". People who left show "Former member". | `use-chat-module.ts:89`; `timeline.ts:153` |

## 7. Trust bugs, ranked

Ranked by how badly they lose or misshow messages and counts.

1. **Failed messages look sent, and are then lost.** `upsertMessage` always clears the failed flag (`timeline.ts:29`), so the "Not sent · Retry · Discard" row (`message-item.tsx:319-337`) can never show. There is no outbox. **Live:** a message sent while requests were blocked, and a message the viewer sent, both stayed in the list looking normal. Neither reached the database. Both vanished on reload. The only signal was a toast.
2. **Opening a channel marks everything read.** The read mark jumps to "now" 600 ms after you open a conversation, whatever you actually saw (`use-chat-module.ts:225-247, 405-410`). **Live:** `#firehose` had 200 unread; after opening it (only the newest 50 loaded), the database said all 200 were read.
3. **The "New" divider sits in the wrong place with more than 50 unread, then moves.** It is placed before the first loaded unread message (`timeline.ts:75-86`). **Live:** it first sat above #2950 (the oldest loaded), then jumped to #2800 after older pages loaded.
4. **Messages skipped at page boundaries.** Older pages are fetched "strictly before the oldest timestamp" (`runtime.chat.web.ts:98`), so a message sharing that timestamp is never fetched. **Live:** two messages were given the same timestamp at the 50-message boundary; #2949 never appeared, 2,999 of 3,000 shown after scrolling to the very top.
5. **Holes after a reconnect or long sleep.** Resync merges only the newest 50 into the old window and keeps the old "has more" (`use-chat-module.ts:288-299, 418-428`). If more than 50 arrived meanwhile, the middle is missing and scrolling up never fills it. Code only, not reproduced live.
6. **Links that don't land.** Thread notifications open the channel, not the thread (`entity-open.ts:72-73`, **Live**). A copied link, search hit or pinned item pointing at a message older than the newest 50 opens the channel at the bottom with no message and no note (`message-list.tsx:135-146`). **Live:** `?m=` for `#firehose` message #1000 landed at the bottom.
7. **Badge counts every message in channels you created.** See §4. **Live:** "205 unread".
8. **Thread replies are invisible to unread.** No badge, no rail weight, no mention pill, no "New" marker in the thread. A mention inside a thread only reaches the bell. Code (`chat_unread_counts`, `use-chat-badge.ts:78`).
9. **Composer shown where you can't post.** Viewers and non-managers in announcement channels get a working-looking composer; the send then fails and (via bug 1) looks sent. **Live.**
10. **Presence and typing fail silently.** **Live** on the local stack: everyone "Away", no typing, no error. See §5.
11. **Search misses people and hides errors.** Names are stored as `<@id>` tokens, so searching "Tess" finds nothing although two messages mention her (**Live**). An error shows "No messages match". App authors show as "someone" in results (`side-panels.tsx:362`).
12. **A failed message load looks like an empty channel** (`use-chat-module.ts:305-313`). Code only.
13. **"Mark unread" counts only what is loaded** (`use-chat-module.ts:756-760`), so the count is wrong when the message is older than the loaded window. Code only.
14. **Removal is silent.** **Live:** removed from a channel, dev saw no notice. For a public channel you can rejoin at once, so "remove" means nothing there.
15. **Opening Search leaves the cursor in the composer.** **Live:** typed search text went into the message box. Minor, but it risks sending a search term as a message.

## 1. Feature table

**Works** = built and behaves. **Missing** = not built. **Wrong** = built but misbehaves or misleads.

| Area | Works | Missing | Wrong |
| --- | --- | --- | --- |
| Public channels | Create, topic, rename (creator or admin), archive/unarchive, join, leave, Browse. Names normalised the same on client and server (`timeline.ts:130-138`, `chat_normalize_channel_name`). | Channel delete. Sections or folders in the rail. Channel descriptions beyond a 250-char topic. | Rename/archive/remove rights use "creator or workspace admin" (`chat-page.tsx:436-440`, `20261006150000_chat_module.sql:329, 357, 422-426`), not the newer channel-manager list or the `manage_any` role ability. |
| Private channels | Create with members; only members see them; "Add people" warns they'll see history. | Making a channel private/public later (spec assumption 5). | — |
| DMs and group DMs | One DM per set of people (up to 9 including you), reopened rather than duplicated (`chat_op_open_dm`). Title = the other names. | Adding someone to an existing DM (you start a new one). Naming a group DM. | — |
| Notes to self | A DM with only you, "Your own space…". **Live.** | — | — |
| `#general` | Created on first open by anyone, joined once on first visit. | — | The "already joined once" flag is per browser (`use-chat-module.ts:179-201`), so a new device re-joins `#general` after you left it. `chat_op_bootstrap` (a write) runs on every open. |
| Markup | Bold, italic, strike, inline code, code blocks, quotes, autolinks, mentions, @channel (`markup.ts`). **Live** rendering. | Lists, headings, link text, rich editor (spec assumption 8: plain text with markup). | `:name` opens an emoji picker while typing (two letters minimum), but a typed or pasted `:wave:` stays as text (**Live**: a seeded `:wave:` rendered literally). |
| Edit | Own messages, ↑ edits your last, "(edited)". | Edit history. | A mention added in an edit never notifies. |
| Delete | Own messages, soft ("This message was deleted."), confirm toast. | Undo. | Admins may delete anyone's on the server but the menu only offers Delete on your own (`message-item.tsx:171-180`). No trail of who deleted what. |
| Reactions | Any emoji, up to 20 kinds per message, quick row 👍 ❤️ 😂, picker. **Live.** | Who-reacted list beyond the pill tooltip. | Differs from the Tasks v3 plan of six fixed, never-notifying reactions. |
| Pins | Pin/unpin, Pinned list in Details (100 max). **Live.** | — | — |
| Threads | Replies, facepile, "N replies · last reply", thread panel with its own composer and draft. **Live.** | Thread list / "Threads you're in". Also-send-to-channel. | No unread or "New" anywhere for replies (§7 bug 8). 1,000-reply silent cap. The facepile keeps people whose replies were deleted. |
| Jumbo emoji | Emoji-only messages render large (`isEmojiOnly`, `markup.ts:168`). Code only. | — | — |
| Optimistic send, retry | Shows instantly; idempotent on resend (`client_id`, `20261006150000_chat_module.sql:462-465`). | Offline queue. | Failed sends look sent and are lost (§7 bug 1, **Live**). |
| `#` links to items | Picker lists registry items ("Link a Moduo item", **Live**), renders the spine chip, opens the item. | Spine link rows; "Discussed in #channel" on the item; References look; open in the right panel. | `#` means tags in the shared grammar (§3). The item's title is frozen into the message text. |
| Create task from message | Menu item creates a task from the message text (`chat-page.tsx:311-329`). Code only. | Link back to the message; the capture shell; opening the new task ("Open" goes to `/tasks`). | — |
| Unread, "New", Mark unread | Per-conversation read mark, DM counts in the rail, bold weight for channels, "New" divider, Mark unread on others' messages, "Mark as read" in the header. **Live.** | Unread count per channel in the rail (channels show weight only). "All unreads" view. | §7 bugs 2, 3, 5, 13. |
| Notify levels, badge | Every new message / Mentions only / Mute per conversation; badge follows the quiet bar. **Live.** | Workspace-wide default; quiet hours; per-thread follow/unfollow. | Creator and DM members start on "Every new message" (§4, **Live** "205 unread"). Mute doesn't reach ⌘J's Unread list. |
| Search | Contains-match across conversations you can read, highlights, opens channel or thread. **Live** ("message #1000" found). | Filters (person, channel, date), search by name, results in ⌘K. | §7 bug 11; slow at scale (§5). |
| Browse, archive | Browse with search and an "Archived" toggle, join from Browse. **Live.** | — | — |
| Members, managers, announcement mode | Member list (online first), add people, remove (creator/admin). Announcement mode can be switched on when creating a channel. | **Any UI for channel managers**: no list, no add/remove. Turning announcement mode on or off after creation. The dialog promises "You can still add managers later" (`chat-dialogs.tsx:168`) but there is no way. | The composer ignores announcement mode and the viewer role (§6, **Live**). |
| Typing, presence | Built: throttled typing line, online dots, "Away". | Status messages, do-not-disturb. | Fails silently when the private channel is refused (§5, **Live** on the local stack). |
| Plan gate, locked screen | Owner's plan ≥ Duo opens chat for everyone in the workspace; others get the explainer + upgrade. **Live:** chat needed dev's plan set to Team. | — | — |
| Agents (MCP) | List public channels, read, search, post as an "App" with a badge; DMs and private channels never visible. Code; the spec says it was verified on production on 2026-10-06. | Reacting, reading pins, DMs to an agent. | Not live-tested here (local edge runtime stopped). |
| Home widget | "Conversations", S/M/L, needs-you first, live. **Live** ("Needs you 4"). | On the default Home layout. | — |
| Keyboard | ⌘7 opens Chat (**Live**), ⌘J jump-to (**Live**), ⌥↑/↓ conversations, ⌥⇧↑/↓ unread only, ↑ edit last, Esc closes panels (`chat-page.tsx:228-259`). | A shortcut sheet in Chat; message-level keys (react, reply) on a selected message. | ⌥⇧↑/↓ counts muted conversations as unread. |
| Drafts | Per conversation and per thread, kept across reloads (`composer.tsx:48-70`). | Sync across devices. | — |

## Research data created (remove when done)

Everything lives on the **local** stack only (docker `supabase_db_moduo`). Nothing touched the cloud project.

**People**
- dev: `00000000-0000-4000-8000-000000000001` (existing, seed user).
- Tess Mate (teammate): `17c405d5-ca87-4156-9d77-6e81c04262f1` (existing; password not changed).
- **Third Member** (new): `c16bcbba-377c-4e21-8028-e9efe2baf874`, `third@moduo.local` (a local-only password, set the way `tests/support/local-stack.ts` sets the teammate's), `profiles.display_name = 'Third Member'`. Created through the auth admin API.

**Plan tier:** `profiles.plan_tier` for dev was `free`, set to `team` for the research, and **restored to `free`** at the end (verified).

**Workspace:** "Chat replan research", id `669be464-0b9a-4d84-8537-544ac04dba5f`, task key `CHR`, owner dev. Deleting the workspace row cascades everything below except the Third Member account.

| Table | Rows in this workspace | Notes |
| --- | --- | --- |
| `workspaces` | 1 | id above |
| `workspace_members` | 3 | dev owner, Tess member, Third viewer |
| `workspace_roles` | 3 | seeded by trigger |
| `workspace_chat_caps` | 3 | seeded by trigger |
| `chat_channels` | 10 | general `186d5746-9653-44d1-8720-4fa306432244`, design `2cc3c40d-f72c-4101-a6d1-4a6377e5e183`, engineering `37ddd893-01ab-4933-85fd-a759d71278d6`, random `eef9106f-19e9-4e19-ade5-13f567236d3c`, launch-private `c36db3fa-7477-4ff2-8f74-3666727f8623`, announcements (managers only) `d43769ba-a262-481d-b9ba-ab491a8e6c4f`, firehose `beffeb74-1e01-4012-887a-30c3b70b65d2`, DM dev–Tess `22ecb1de-a4ef-4f3a-bb72-bc06b2a9aa76`, group DM `26584095-5f35-442e-a8d7-9c917a367058`, notes-to-self `e76a5d07-1ae5-4aa5-82c6-af5e96942164` |
| `chat_members` | 21 | Tess left `#random`; dev was removed from `#engineering` during the live test |
| `chat_channel_managers` | 7 | trigger-created for each channel's creator |
| `chat_messages` | 3,032 | 28 through the ops, 3,000 bulk-inserted in `#firehose` (#2949 shares #2950's timestamp on purpose), 4 live probes |
| `module_activity` | 13 | `chat.channel_create`, `chat.mention`, `chat.reply`, `tasks.create` |
| `notification_state` | 1 | from opening the bell |
| `tasks` | 1 | "Ship the onboarding checklist" `d037b0b7-4125-415d-bef9-72662d6b58e6` (CHR-1) |
| `buckets` | 2 | two Inbox buckets (`d9620fef-b88b-45e5-89f3-de5989aa5239`, `80cb1439-ab61-433b-8630-f76ff8ca5ff6`) |
| `entities` | 1 | the task's search entry |

**Browser-only state (not in the database):** on `http://127.0.0.1:8096` and `http://localhost:8096`, local storage holds injected sessions for dev and Tess, the selected workspace, the `#general` auto-join flag and chat drafts. The Home layout for this workspace was edited to add the chat widget and then put back.

**Cleanup sketch (local stack only):** `delete from public.workspaces where id = '669be464-0b9a-4d84-8537-544ac04dba5f';` then delete the Third Member user through the auth admin API (or `delete from auth.users where id = 'c16bcbba-377c-4e21-8028-e9efe2baf874';`).
