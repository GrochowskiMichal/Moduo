# Chat v1: audit of the early decisions

> Raw research report from the Chat re-plan, 2026-10-13. Nothing here is decided.

**What this is.** Chat v1 was built by Mike on 2026-10-06 from one ask ("end to end … production ready … world-class UI/UX"), with no grilling round ([`specs/chat.md:5`](../../../specs/chat.md)). Every product call in it was an agent's assumption. Since then, Tasks v3 decided rules for the whole app that every rebuilt module adopts ([`docs/agents/module-replan.md:33-48`](../../../docs/agents/module-replan.md)). This file checks each early Chat decision against users, competitors and those rules, and says keep, adjust or reverse.

**How each item reads.**
- **v1:** what was built, with `path:line`.
- **Evidence:** for and against.
- **Verdict:** Keep · Adjust · Reverse.
- **Binds:** the Tasks v3 (or other ratified) decision that already settles it, if any.
- **Who:** *Designer* (a product call for Maciej) or *Technical* (the agent decides and records the rejected alternative).

Items are numbered **D1…** (decisions). Contradictions are numbered **A1…** at the end; the REPLAN cites them as "audit A1".

**Sources read:** `specs/chat.md`, `docs/decisions/billing.md:7`, `docs/decisions/product.md:17`, `docs/PRODUCT_BRIEF.md` §7 and §9, `docs/ROADMAP.md:90-95, 243`, `specs/permissions.md` §1a, §7, §8 and the 2026-10-06 answers, `specs/BUILD_LOG.md:180-182`, `docs/gotchas/supabase.md` (chat entries), `specs/tasks-v3.md` §9–13, §18–19, `.design/tasks-v3/REPLAN.md` (groups F–K), `docs/decisions/tasks.md` (TV-U14, RF-1, SH-1), `.design/tasks-v3/research/keymap.md`, `.design/tasks-v3/research/capture-references-teams.md` §2, §6–8, `.design/brand/DECISIONS.md:58-69`, the chat code (`src/features/chat/**`, `src/routes/pages/chat-page.tsx`) and the chat migrations.

## Verdict summary

| Verdict | Count | Items |
| --- | --- | --- |
| Keep | 8 | D1, D5, D14, D25, D28, D29, D34, D39 |
| Adjust | 24 | D2, D4, D6, D7, D9, D12, D13, D16, D17, D18, D19, D20, D21, D22, D23, D24, D27, D30, D31, D32, D35, D36, D37, D38 |
| Reverse | 7 | D3 (already reversed in the database), D8, D10, D11, D15, D26, D33 |

| Who | Count | Items |
| --- | --- | --- |
| Designer (product call) | 18 | D2, D4, D5, D6, D9, D12, D13, D16, D17, D18, D21, D23, D26, D31, D32, D35, D37, D38 |
| Technical (decide + record the rejected alternative) | 19 | D7, D8, D10, D11, D14, D15, D19, D20, D22, D24, D25, D27, D28, D29, D30, D33, D34, D36, D39 |
| Already decided (record only) | 2 | D1 (Tasks 90b), D3 (permissions answer 5, 2026-10-06) |

---

## Part 1 · The eight listed assumptions (`specs/chat.md:44-53`)


### D1 · Chat is the 7th tab, ⌘7 (assumption 1)

- **v1:** Chat sits after Contacts in the top bar ([`src/components/app/app-chrome-constants.ts:13-26`](../../../src/components/app/app-chrome-constants.ts)); ⌘1–7 go to the Nth *visible* tab ([`src/lib/shortcuts.ts:138-158`](../../../src/lib/shortcuts.ts)).
- **For:** nobody's ⌘1–6 moved. Tasks 90b then built on it: inside the capture, ⌘7 switches the type to **Message** ([`.design/tasks-v3/REPLAN.md:2546-2553`](../../tasks-v3/REPLAN.md), [`specs/tasks-v3.md:110`](../../../specs/tasks-v3.md)). The numbers follow the same filtered list in both places, so a person who can't see Notes has Chat on ⌘6 in both ([`app-chrome-constants.ts:28-42`](../../../src/components/app/app-chrome-constants.ts)).
- **Against:** "next to Email" (the spec's alternative) would move Contacts' number and break 90b's "⌘7 a message".
- **Gap to close:** Chat registers no capture type yet, so ⌘7 in the capture does nothing ([`src/lib/capture-registry.ts:3-10`](../../../src/lib/capture-registry.ts)). The Message type is a block of this plan.
- **Verdict: Keep.** **Binds:** Tasks 90b. **Who:** already decided; record it.

### D2 · The locked tab stays visible on Free and Pro (assumption 2)

- **v1:** every workspace whose role can view Chat sees the tab. Below Duo it opens an explainer with "Upgrade to Duo — $20/mo for two" or "ask the owner" ([`src/features/chat/ui/chat-locked.tsx:67-96`](../../../src/features/chat/ui/chat-locked.tsx)).
- **For:** it's the only place Duo is advertised inside the app. Pricing v2 depends on people discovering Duo.
- **Against:**
  - Free and Pro workspaces hold one seat ([`docs/decisions/billing.md:9`](../../../docs/decisions/billing.md), point d), so for them chat can never work. A permanent upgrade tab in the top bar breaks "quiet and minimal until the user decides otherwise" and "configurability is a liability to hide" ([`docs/PRODUCT_BRIEF.md:90-91`](../../../docs/PRODUCT_BRIEF.md), §5 pillar 3).
  - The explainer teaches the old `#` grammar ("Type # to drop a live task…", `chat-locked.tsx:24`); see D10.
  - Competitors (Notion, Linear) advertise paid features where the need appears (inviting, sharing), not as a dead top-level tab.
- **Recommendation:** hide the tab in a workspace that has only one member; show the upgrade where the need starts (inviting a second person, Settings → Plans). In a workspace with two or more members that's below Duo (a Pro owner who invited someone before a downgrade, say), keep the locked tab with "ask the owner".
- **Verdict: Adjust.** **Binds:** brief §7. **Who:** Designer (it's a pricing-surface call).

### D3 · Everyone in the workspace can chat, viewers included (assumption 3)

- **v1 spec:** "Everyone in the workspace can chat, including `viewer` role" ([`specs/chat.md:48`](../../../specs/chat.md)).
- **Already reversed:** on 2026-10-06 the designer answered "Viewers **cannot** post in chat by default" ([`specs/permissions.md:255`](../../../specs/permissions.md); grid at `:185`). PERM-7 seeded `workspace_chat_caps` with viewer `post = false` ([`supabase/migrations/20261006210000_perm_sharing.sql:415-445`](../../../supabase/migrations/20261006210000_perm_sharing.sql)), the message guard refuses it (`:979`), and `chat_caps_set` won't let anyone switch it on for viewers (`:1178-1181`). So it's not "off by default" but "never" for viewers, which is stricter than the grid's ☐.
- **Open edge (for the hackathon plan, not here):** a judge or organizer given the Viewer role could read but never post, not even in a Q&A channel. If they need to post, they need Member, or a custom role later.
- **Verdict: Reverse (done in the database; `specs/chat.md:48` is stale).** **Binds:** permissions answer 5. **Who:** already decided; record it and fix the wording.

### D4 · Any member adds people; only the creator, owner or admin renames, archives or removes (assumption 4)

- **v1:** `chat_op_add_members` lets anyone who can read the channel add workspace members ([`supabase/migrations/20261006150000_chat_module.sql:394-413`](../../../supabase/migrations/20261006150000_chat_module.sql)); rename, archive and remove check `created_by` or the owner/admin role (`:329`, `:357`, `:422-426`).
- **For:** Slack's default lets any member invite into channels; at 2–5 people, gatekeeping adds friction.
- **Against:**
  - PERM-7 introduced **channel managers** and a "Manage any channel" capability ([`specs/permissions.md:182-188`](../../../specs/permissions.md)), but these ops never read either: they still check the creator or the role ([`chat_module.sql:329, 357, 424`](../../../supabase/migrations/20261006150000_chat_module.sql)); no later migration redefines them. Two rules for one question.
  - For a private channel, "anyone inside can pull anyone in" is the riskier half; Slack lets admins restrict it.
- **Recommendation:** public channels: anyone adds (keep). Private channels: managers add (the creator by default, more can be named). Rename, archive and remove: channel managers plus whoever holds "Manage any channel". One rule, read in one place.
- **Verdict: Adjust.** **Binds:** PERM-7 (the managers concept). **Who:** Designer (the private-channel rule); the wiring is technical.

### D5 · A channel's privacy can't change after creation (assumption 5)

- **v1:** `chat_op_update_channel` changes only name and topic ([`chat_module.sql:315-347`](../../../supabase/migrations/20261006150000_chat_module.sql)).
- **For:** no accidental exposure of a private history; one fewer setting (brief §7, "decisions live with the designer").
- **Against:** a team that starts a public channel and later wants it closed has to make a new one. Slack allows public → private; the reverse is restricted (unverified for current Slack plans).
- **Recommendation:** keep for v2. If dogfooding asks, add public → private only (the safe direction).
- **Verdict: Keep.** **Binds:** none. **Who:** Designer, as a batch confirm (low stakes).

### D6 · DMs don't reach the bell; @mentions and thread replies do (assumption 6)

- **v1:** the bell gets `chat.mention` and `chat.reply` only ([`chat_module.sql:16-19, 505-523`](../../../supabase/migrations/20261006150000_chat_module.sql)); DMs show on the tab badge. No OS or browser notification exists for chat (no notification call anywhere in `src/features/chat/`).
- **For:** the quiet bar ([`docs/PRODUCT_BRIEF.md:94`](../../../docs/PRODUCT_BRIEF.md); the 2026-10-02 decision asks the chat spec to fit it, [`docs/decisions/product.md:17`](../../../docs/decisions/product.md) point c). The bell stays about work items.
- **Against:**
  - A DM is addressed to you, exactly like `@you`, which does reach the bell. Users of Slack, Teams and WhatsApp expect a DM to reach them; a DM that arrives while you're in Tasks shows only a number on a tab.
  - For the hackathon, an organizer's DM that nobody sees for an hour is a real failure.
  - Tasks 73 already gives reminders an OS/browser notification when Moduo isn't in front ([`REPLAN.md:2088`](../../tasks-v3/REPLAN.md)); chat has no row in a notification table at all.
- **Recommendation:** keep DMs out of the bell (it's the work-item list). Add Chat's rows to the Tasks 80 table, and give a DM and an `@you` one OS/browser notification when Moduo isn't focused, grouped per conversation, switchable in Settings → Notifications.
- **Verdict: Adjust.** **Binds:** Tasks 80 (the table format), Tasks 73 (the channels). **Who:** Designer.

### D7 · Deletes are permanent for everyone; admins can delete anyone's (assumption 7)

- **v1:** a toast asks "Delete this message? It's removed for everyone. This can't be undone." ([`src/routes/pages/chat-page.tsx:274-283`](../../../src/routes/pages/chat-page.tsx)); the op blanks the body at once ([`chat_module.sql:563-586`](../../../supabase/migrations/20261006150000_chat_module.sql)). The menu offers Delete only on your own messages ([`src/features/chat/ui/message-item.tsx:173-181`](../../../src/features/chat/ui/message-item.tsx)), so the admin half exists only in the database ([`chat_module.sql:573`](../../../supabase/migrations/20261006150000_chat_module.sql); PERM-7's `delete_others`, [`perm_sharing.sql:905-910`](../../../supabase/migrations/20261006210000_perm_sharing.sql)).
- **For:** permanent-for-everyone is the honest promise for a chat (people delete what they regret sending).
- **Against:** DF-5 set **one undo grammar app-wide** (8 s, deferred commit where the delete is hard; [`docs/decisions/product.md:49`](../../../docs/decisions/product.md)), and Tasks default a repeats it ([`REPLAN.md:2334`](../../tasks-v3/REPLAN.md)). A confirm-first toast is the pattern DF-5 retired for everyday deletes.
- **Recommendation:** delete at once with "Message deleted · Undo" for 8 s (deferred commit: the server blanks the body only when the toast closes). Keep "permanent for everyone" after that. Offer admins (holders of "Delete others' messages") Delete on others' messages in the menu, or drop the capability; don't keep a power the UI never shows.
- **Verdict: Adjust.** **Binds:** DF-5, Tasks default a. **Who:** Technical. Rejected: the confirm toast (v1).

### D8 · A plain-text-with-markup composer, not a rich editor (assumption 8)

- **v1:** a `<textarea>` with `**bold**`-style markup and three autocompletes ([`src/features/chat/ui/composer.tsx:1-9, 466`](../../../src/features/chat/ui/composer.tsx)); the stored body is a token grammar ([`src/features/chat/markup.ts:3-12`](../../../src/features/chat/markup.ts)).
- **For:** fast, pastes cleanly, what you see is what's stored. RF-1 also kept task comments a text box (RF-1-7, [`docs/decisions/tasks.md:479-483`](../../../docs/decisions/tasks.md)).
- **Against:**
  - RF-1's default for chat is "a chip in the text" ([`specs/tasks-v3.md:118`](../../../specs/tasks-v3.md)). A textarea can't show a chip while you type, so a picked item reads as raw words until sent.
  - TV-U14 already built the shared answer: a one-line Lexical editor with RF-1's three menus (`@ # /`), chips at text size and date words marked as you type (U14-2, [`docs/decisions/tasks.md:74-78`](../../../docs/decisions/tasks.md)). Notes is Lexical too. A third editor for chat is a second grammar implementation, which U14-2 rejected.
  - Email compose tried a lighter editor once and was moved back to Lexical at the designer's direction ([`docs/decisions/email.md:29`](../../../docs/decisions/email.md), EM-7).
- **Recommendation:** the composer is the shared Lexical editor (multi-line), with RF-1's menus and markdown shortcuts as input rules (`**`, `` ` ``, `>`), so markup typists lose nothing. Store references as `{type, id}` only (D11).
- **Verdict: Reverse.** **Binds:** RF-1, TV-U14 (U14-2). **Who:** Technical (visible to the designer as "chips while typing"). Rejected: the textarea (v1).

---

## Part 2 · Decisions v1 made without listing them

### D9 · Channel-first structure (the Slack shape) vs conversations anchored to the work

- **v1:** free-standing channels and DMs, grouped Starred · Channels · Direct messages ([`src/features/chat/ui/chat-sidebar.tsx:1-3, 209-231`](../../../src/features/chat/ui/chat-sidebar.tsx)). A channel knows nothing about a project or client; "Discussed in #channel" was left for later ([`specs/chat.md:72`](../../../specs/chat.md)).
- **For channels:** the shape every Slack, Discord and Teams user already knows; the hackathon (one workspace per team) needs only a few channels; the 2026-10-02 decision says chat should "compete with Slack on features" ([`docs/decisions/product.md:17`](../../../docs/decisions/product.md)).
- **For anchoring:** Moduo's moat is the spine ([`docs/PRODUCT_BRIEF.md:47-55`](../../../docs/PRODUCT_BRIEF.md)). Basecamp gives every project its own chat (Campfire), so the conversation sits next to the work; an agency's client channel that also shows on the client's hub is exactly the "only place these connect" pitch. Slack's own answer to scattered context is channel-per-project by convention, which nobody maintains.
- **Against anchoring every project:** a channel per project multiplies channels at 2–5 people (more unread rows, more muting), and the boundary Maciej set says a discussion *about an item* lives on the item, not in chat ([`.design/chat-v2/REPLAN.md:73`](../REPLAN.md)).
- **Recommendation:** keep channels and DMs as the structure. Add one gesture: a channel can be **linked** to a project, a client (company/contact) or an event; it then shows in that project's overview and the client's hub ("Conversation: #acme"), and new references posted in it suggest that link. No automatic channel per project.
- **Verdict: Adjust.** **Binds:** brief §4; the Notes boundary. **Who:** Designer (★ load-bearing for round 1).

### D10 · `#` inserts any Moduo item into a message

- **v1:** `@` lists people (plus @channel), `#` lists tasks, notes, contacts, events…, `:` lists emoji ([`src/features/chat/ui/composer.tsx:5-7, 159-217`](../../../src/features/chat/ui/composer.tsx)). The locked explainer teaches it ([`chat-locked.tsx:24`](../../../src/features/chat/ui/chat-locked.tsx)).
- **Against (binding):** the app-wide grammar is `@` people first, then things; `#` tags; `/` commands and date chips (Tasks 33, 33a, 55; [`specs/tasks-v3.md:112, 118`](../../../specs/tasks-v3.md); RF-1-8, [`docs/decisions/tasks.md:484-488`](../../../docs/decisions/tasks.md)). "Check the `@ # /` grammar before proposing any token" ([`docs/agents/module-replan.md:117`](../../../docs/agents/module-replan.md)). Under v1, `#launch` in chat means a task and in a task title means a tag.
- **What changes:** `@` opens people first, then things (tasks, projects, notes, contacts, events, emails, conversations); `#` applies or links a tag; `/today`, `/tomorrow`, `/next week`, `/date` insert a date chip (33a); `/` may also hold chat commands (D32's `@channel` alternative, a future `/remind`). `:` for emoji stays (it's not part of the grammar and doesn't collide).
- **Verdict: Reverse.** **Binds:** Tasks 33, 33a, 55, RF-1-8. **Who:** Technical. Rejected: keeping `#` for items in chat only.

### D11 · How a linked item shows inside a message

- **v1:** the stored token is `<moduo:TYPE:ID|Label>` ([`src/features/chat/markup.ts:6, 39`](../../../src/features/chat/markup.ts)), rendered as the old `EntityRefChip` with the label written at send time ([`src/features/chat/ui/message-body.tsx:86-91`](../../../src/features/chat/ui/message-body.tsx)). No preview cards.
- **Against (binding):** RF-1 replaced that chip with the **Reference**: live titles and statuses, one batched read per view, hover cards, the tombstone states (RF-1-1…RF-1-4, [`docs/decisions/tasks.md:449-468`](../../../docs/decisions/tasks.md)); comments store references as `moduo://type/id` (RF-1-7). Its chat default is "a chip in the text plus preview cards under the message (collapsible; the sender can remove them)" ([`.design/tasks-v3/REPLAN.md:1486`](../../tasks-v3/REPLAN.md)). v1's chips go stale when an item is renamed and never show a status.
- **What changes:** messages store references as `moduo://type/id` (RF-1-7's form), render RF-1's chip, and add up to N preview cards under the message (Slack-unfurl style, collapsible, removable by the sender). Chat defines two new Reference kinds: **message** (chip: author · first words; card: author · time · conversation · two lines) and **conversation**, plus "Deleted message" and "Private item". Old v1 bodies are converted once by a migration or read through a compatibility parser (a data-lane call).
- **Verdict: Reverse.** **Binds:** Tasks 55, RF-1. **Who:** Technical. Rejected: keeping a label inside the token.

### D12 · Channels are written `#name`

- **v1:** channel names are lower-case slugs ([`chat_module.sql:201-209`](../../../supabase/migrations/20261006150000_chat_module.sql)), shown with a `#` glyph ([`chat-sidebar.tsx:42`](../../../src/features/chat/ui/chat-sidebar.tsx)) and returned to agents as `#general` ([`supabase/functions/moduo-mcp/modules/chat.ts:128`](../../../supabase/functions/moduo-mcp/modules/chat.ts)).
- **For:** Slack's and Discord's convention; instantly readable as "a channel".
- **Against:** with `#` meaning tags app-wide (D10), `#design` the channel and `#design` the tag look identical in a message, in search and in a hover. Rule 40 ("never capitalise people's words") also argues against forcing names to lower-case slugs: people type "Acme launch", v1 stores `acme-launch`.
- **Options:** (a) keep the `#` glyph for channels and accept the overlap; (b) channels get their own icon (a speech bubble, or the lock for private), names stay as typed ("Acme launch"), and you reference a channel with `@` like any other thing.
- **Recommendation:** (b).
- **Verdict: Adjust.** **Binds:** Tasks 33/55 (the grammar), rule 40. **Who:** Designer.

### D13 · Free emoji reactions, up to 20 per message

- **v1:** any emoji (≤ 32 characters), up to 20 different ones per message ([`chat_module.sql:588-622`](../../../supabase/migrations/20261006150000_chat_module.sql), the cap at `:609`), with a full picker ([`src/features/chat/ui/emoji-picker.tsx`](../../../src/features/chat/ui/emoji-picker.tsx), [`src/features/chat/emoji.ts`](../../../src/features/chat/emoji.ts)).
- **Against:** Tasks 88 decided six fixed reactions on comments, 👍 ✅ 👀 🙏 ❤️ 😄, "Nobody picks or adds their own (the same rule as icons)" ([`.design/tasks-v3/REPLAN.md:2496-2505`](../../tasks-v3/REPLAN.md); [`specs/tasks-v3.md:103`](../../../specs/tasks-v3.md)). One interaction language (39) argues for one reaction component across comments and chat.
- **For keeping free emoji:** chat is not task comments. Slack and Discord users react with whatever fits; a hackathon team will miss 🎉 and 🚀. Six may read as Moduo being stingy in the one place that is social.
- **Recommendation:** one reaction component everywhere. In chat, the six are the one-click row; "More" opens the full picker. Comments keep only the six (88 unchanged). If the designer wants strict sameness, chat gets the six only.
- **Verdict: Adjust.** **Binds:** Tasks 88 (for comments; extending it to chat is the call). **Who:** Designer.

### D14 · Reactions never notify

- **v1:** `chat_op_react` writes no activity row ([`chat_module.sql:588-622`](../../../supabase/migrations/20261006150000_chat_module.sql)); nobody hears about a reaction.
- **Evidence:** Tasks 88 and the notification table say the same for comments: "A reaction · Nobody" ([`specs/tasks-v3.md:140`](../../../specs/tasks-v3.md)).
- **Verdict: Keep.** **Binds:** Tasks 88, 80. **Who:** Technical.

### D15 · An agent's post shows a bot glyph and an "App" badge, attributed to the key

- **v1:** an agent's message has no author; it stores `author_kind = 'api_key'` and the key's name ([`supabase/migrations/20261006160000_chat_agent_access.sql:6-10`](../../../supabase/migrations/20261006160000_chat_agent_access.sql)) and renders a bot avatar plus an "App" pill ([`message-item.tsx:203-204, 245-251, 270-274`](../../../src/features/chat/ui/message-item.tsx)).
- **Against (binding):**
  - Brand 40a: "No AI dot, no AI colour. Assistant actions are shown by name in the normal neutral style" ([`.design/brand/DECISIONS.md:59`](../../brand/DECISIONS.md)); brief §7 ([`docs/PRODUCT_BRIEF.md:95`](../../../docs/PRODUCT_BRIEF.md)).
  - Tasks 52: every agent write is attributed "Alex · via <key name>", the person first, the key as the channel; the plain key name was the rejected alternative ([`.design/tasks-v3/REPLAN.md:1324-1345`](../../tasks-v3/REPLAN.md); [`specs/tasks-v3.md:122`](../../../specs/tasks-v3.md)).
  - Keys already act as their creator for permission checks ([`specs/permissions.md:225`](../../../specs/permissions.md)); since 20261008124000 even chat's own post check uses the creator ([`supabase/migrations/20261008124000_chat_agent_post_checks_creator.sql:1-17`](../../../supabase/migrations/20261008124000_chat_agent_post_checks_creator.sql)). The author shown is the only part still "the app".
- **What changes:** the message's author is the key's creator, with "via <key name>" beside the name; the creator's normal avatar; no glyph, no pill. Mentions by an agent still notify like a person's.
- **Verdict: Reverse.** **Binds:** Tasks 52, brand 40a. **Who:** Technical. Rejected: "App" badge (v1), a neutral "Assistant" label.

### D16 · Agents see public channels only, through their own Chat scope

- **v1:** whatever a key's scope, it never sees DMs or private channels ([`chat_agent_access.sql:1-12, 69-72`](../../../supabase/migrations/20261006160000_chat_agent_access.sql); Settings copy "Public channels only, never DMs or private channels", [`src/features/settings/api-keys.ts:38`](../../../src/features/settings/api-keys.ts)). KEYS-1 later folded the scope into the None / View / Edit grid ([`specs/BUILD_LOG.md:182`](../../../specs/BUILD_LOG.md)); Chat defaults to None (`api-keys.ts:60`).
- **For:** the other people in a DM or private channel never agreed to an AI reading it; the safe default.
- **Against:** Tasks 52 treats agents as delegates acting as their creator, and KEYS-1's rule is "a key never gets more than its creator", not "less than". A hackathon team's build bot posting into the team's private channel, or "summarise what I missed in #launch-private", can't work.
- **Recommendation:** DMs stay invisible to every key. Private channels: opt-in per key ("Include private channels I'm in"), off by default, and the channel shows "An app of Alex's can read this" in its details so members know.
- **Verdict: Adjust.** **Binds:** KEYS-1, Tasks 52 (delegates). **Who:** Designer.

### D17 · Threads inside chat, while task comments have none

- **v1:** one-level threads: "Reply in thread", a facepile and "Last reply …" under the parent, the thread in the right panel ([`message-item.tsx:148-151, 374-400`](../../../src/features/chat/ui/message-item.tsx); [`src/features/chat/ui/side-panels.tsx:39-55`](../../../src/features/chat/ui/side-panels.tsx)); thread replies notify the parent's author and earlier repliers ([`chat_module.sql:510-516`](../../../supabase/migrations/20261006150000_chat_module.sql)).
- **For:** busy channels (hackathon Q&A, an agency's client channel) need a question and its answers kept together; Slack, Discord, Teams and Zulip (topics) all have a form of it.
- **Against:** Tasks decided "no threads" on comments ([`specs/tasks-v3.md:103`](../../../specs/tasks-v3.md)) because a task is already the thread. Slack threads are a known complaint (replies missed, "also send to channel" confusion); Basecamp's Campfire has none.
- **Recommendation:** keep one-level threads in chat. The comments rule doesn't carry over: a task is already the thread its comments hang on, while a channel holds many topics at once. The thread opens in the right panel as an item ("← Thread", SH-1's stack, D20), not as a panel mode. Who hears a reply stays as v1 (the parent's author, earlier repliers, anyone mentioned), plus "Stop following" on the thread.
- **Verdict: Adjust.** **Binds:** SH-1 (where it opens). **Who:** Designer (keep threads; who hears a reply).

### D18 · Where a discussion about an item lives (the boundary with comments and Notes)

- **v1:** nothing ties a conversation to the items it discusses. A message that references a task leaves no trace on the task; "Discussed in #channel" was a "Next" item ([`specs/chat.md:72`](../../../specs/chat.md)).
- **The boundary Maciej set:** a discussion *about an item* lives on the item (comments, with reactions); chat owns conversations; both link items through RF-1 references ([`.design/chat-v2/REPLAN.md:73`](../REPLAN.md)).
- **Evidence:** the References research already specifies the backlink: "Mentioned in Weekly sync — Oct 12" under Linked, only for viewers who can see the mentioning item ([`.design/tasks-v3/research/capture-references-teams.md:226`](../../tasks-v3/research/capture-references-teams.md)). Linear does the same for issue mentions; Slack's lack of it is why decisions get lost in channels.
- **Recommendation (a proposal for Maciej, touching Notes and Tasks):**
  - a message that references an item writes a `mentions` link, so the item's Linked shows "Mentioned in #launch · Oct 12" (one row per conversation, not per message);
  - no "Discuss in chat" button on items: discussing an item happens in its comments;
  - a message can be turned into a comment on the item it references ("Move to the task's comments") when a chat thread turns out to be about one item. Optional; for round 2.
- **Verdict: Adjust.** **Binds:** the Notes boundary; RF-1 (backlinks). **Who:** Designer (cross-module proposal).

### D19 · Search is a right-panel mode

- **v1:** a search icon in the conversation header opens a Search panel on the right ("Every conversation you can see"), a substring match over message bodies ([`src/features/chat/ui/side-panels.tsx:269-330`](../../../src/features/chat/ui/side-panels.tsx); [`src/features/chat/ui/conversation-header.tsx:179-180`](../../../src/features/chat/ui/conversation-header.tsx); [`src/lib/runtime.chat.web.ts:139`](../../../src/lib/runtime.chat.web.ts)).
- **Against (binding):**
  - The toolbar grammar every module copies is `title + count … Search · Filter · Display | view switch | one primary` ([`.design/tasks-v3/REPLAN.md:372`](../../tasks-v3/REPLAN.md)).
  - The app's search lives in the bottom bar's centre ("Search · Quick capture · New", [`specs/tasks-v3.md:166`](../../../specs/tasks-v3.md)).
  - The right panel is context about what's selected (48b), so results that you then open in the centre fight the layout.
- **Recommendation:** "Search" in the conversation's toolbar finds inside this conversation (results highlight in place, ↑↓ to step). Searching every conversation is the app's search, filtered to Messages, with results opening the conversation at the message (`/chat?c=…&m=…` already exists, [`src/features/chat/search.ts:6-13`](../../../src/features/chat/search.ts)). Filters (from, in, has a link, date) use the FilterBar.
- **Verdict: Adjust.** **Binds:** the toolbar grammar (§5 kit), 48b, Tasks §18 (bottom bar). **Who:** Technical. Rejected: a Search panel mode (v1).

### D20 · The right panel: Thread, Details or Search, each with a close button

- **v1:** one panel at a time, picked by header icons, each with its own title and an ✕ ([`side-panels.tsx:1-3, 19-36`](../../../src/features/chat/ui/side-panels.tsx); [`src/routes/pages/chat-page.tsx:49, 212-224, 588-670`](../../../src/routes/pages/chat-page.tsx)). Chat isn't in the panel registry ([`.design/chat-v2/REPLAN.md:57`](../REPLAN.md)).
- **Against (binding):** SH-1 and 72a: the panel's title row is a dropdown of the module's hand-picked views; references open as items with "← item"; ⌥1–9 pick a view; Esc steps back; collapse lives in the bottom bar, not in an ✕ ([`docs/decisions/tasks.md:756-777`](../../../docs/decisions/tasks.md); [`.design/tasks-v3/REPLAN.md:2062-2076`](../../tasks-v3/REPLAN.md); 48b at `:1242-1253`).
- **Recommendation:** register Chat's views: *about this* = **Details** (about, members, pinned, files later); *alongside* = for example **Linked** (every item referenced in this conversation) or a teammate's **My tasks**. A thread, a person, or an item clicked in a message opens as an item ("← Thread", "← Anna"). The view list itself is a round-2 call.
- **Verdict: Adjust.** **Binds:** SH-1, 72/72a, 48b. **Who:** Technical (the mechanism); the views are the designer's in round 2.

### D21 · ⌘J opens a conversation switcher, separate from ⌘K

- **v1:** ⌘J, bound only on the Chat page, opens "Jump to a conversation" ([`chat-page.tsx:229-236`](../../../src/routes/pages/chat-page.tsx); [`src/features/chat/ui/chat-dialogs.tsx:537-575`](../../../src/features/chat/ui/chat-dialogs.tsx)). ⌘J isn't in `SHORTCUTS` or the shortcut sheet ([`src/lib/shortcuts.ts`](../../../src/lib/shortcuts.ts)); the ⌘K palette, described as "Search & jump to anything", offers only "Open Chat", not conversations ([`src/components/app/global-shortcuts-dialog.tsx:26`](../../../src/components/app/global-shortcuts-dialog.tsx); [`src/components/app/global-command-palette.tsx:190`](../../../src/components/app/global-command-palette.tsx)).
- **For a switcher:** Slack users jump with a key all day (Slack's is ⌘K).
- **Against a second one:** two "jump" surfaces with different contents; ⌘J only works on one page; on the web build ⌘J is the browser's Downloads in Chrome. "One way per job" (90b).
- **Recommendation:** conversations (channels and people) join the ⌘K palette's results, ranked by recent and unread, from anywhere in the app. ⌘J retires, or stays as "⌘K filtered to conversations" if the designer wants a Slack-like muscle-memory key.
- **Verdict: Adjust.** **Binds:** the key map's conventions. **Who:** Designer (whether ⌘J survives).

### D22 · Page keys ⌥↑/↓ (conversations) and ⌥⇧↑/↓ (unread only)

- **v1:** [`chat-page.tsx:8-9, 237-248`](../../../src/routes/pages/chat-page.tsx); ↑ in an empty composer edits your last message ([`composer.tsx:8`](../../../src/features/chat/ui/composer.tsx)).
- **Against:** in the Tasks key map ⌥⇧↑↓ means "move in order" ([`.design/tasks-v3/research/keymap.md:38, 122`](../../tasks-v3/research/keymap.md)). Same keys, a different job per module, against "one interaction language" (39). Chat also needs the keymap's Esc order (rule 8, `keymap.md:144`) instead of its own.
- **Recommendation:** Chat gets its own key table, collision-checked against Tasks'. ⌥↑/↓ for previous/next conversation can stay: Tasks doesn't bind it. For next unread, keep Slack's ⌥⇧↑/↓ and list it as an accepted scope-separated collision, the way the key map already accepts `S` meaning Skip in Focus and sessions on rows ([`keymap.md:132`](../../tasks-v3/research/keymap.md)): Chat never reorders rows, and Slack users already know the key. Register ⌘J's fate (D21) and the composer keys in the same table.
- **Verdict: Adjust.** **Binds:** key map conventions, 39. **Who:** Technical.

### D23 · "Star" a conversation, "Pin" a message, nothing saved for later

- **v1:** Star puts a conversation in a Starred group at the top of the rail ([`conversation-header.tsx:193-195`](../../../src/features/chat/ui/conversation-header.tsx); [`src/features/chat/timeline.ts:172-190`](../../../src/features/chat/timeline.ts)); "Pin to conversation" marks a message for everyone, listed in Details ([`message-item.tsx:156-158`](../../../src/features/chat/ui/message-item.tsx); [`side-panels.tsx:214`](../../../src/features/chat/ui/side-panels.tsx)). No personal "save for later".
- **Against:** Tasks 29b uses **Pin** for "put it in the sidebar" ("Pin to sidebar" adds a Pinned group, [`.design/tasks-v3/REPLAN.md:947`](../../tasks-v3/REPLAN.md)). In Chat "Pin" means something else and the sidebar verb is "Star". One name per concept, app-wide ([`docs/agents/module-replan.md:117`](../../../docs/agents/module-replan.md)).
- **Options:**
  - sidebar: **Pin to sidebar** (Tasks' word), the group reads "Pinned";
  - a message kept for everyone: a different word ("Keep at top", or "Bookmark" as Slack's newer UI calls channel bookmarks), shown in Details;
  - saved for later: not a new list; "Remind me about this" makes a reminder through Tasks (a personal task with the message as its "From:"), so it lands where reminders already live.
- **Verdict: Adjust.** **Binds:** Tasks 29b (the word "Pin"); one name per concept. **Who:** Designer (the words, and whether a message-level "keep" exists at all).

### D24 · `#general` is created per workspace and joined on first visit

- **v1:** `chat_op_bootstrap` makes `general` ("Everyone in the workspace") only if the workspace has no channel yet ([`chat_module.sql:212-226`](../../../supabase/migrations/20261006150000_chat_module.sql)); the client joins it once per device, remembered in `localStorage` ([`src/features/chat/hooks/use-chat-module.ts:178-195`](../../../src/features/chat/hooks/use-chat-module.ts)).
- **For:** an empty chat is a dead chat; Slack, Discord and Teams all start with one shared channel. "Works the day you sign up" (brief §5).
- **Against the mechanism:** joining depends on the device: leave `general` on the laptop, open chat on the web, and you're back in. A new member is only joined when they first open Chat, so `@channel` in `general` misses everyone who hasn't visited yet.
- **Recommendation:** keep one shared channel; the server joins every member when they join the workspace (and on bootstrap); leaving is remembered on the server. The hackathon template can seed more channels (announcements, help); that's the hackathon plan's.
- **Verdict: Adjust.** **Binds:** none. **Who:** Technical. Rejected: the per-device flag.

### D25 · Group DMs hold up to 9 people, and nobody can be added later

- **v1:** [`chat_module.sql:282-283`](../../../supabase/migrations/20261006150000_chat_module.sql) (the cap), `:399-401` ("Start a new direct message to add people").
- **Evidence:** Slack's group DM limit is the same size (up to 9 people, unverified for 2026); Moduo's teams are 2–5. A DM is defined by its people (`dm_key`), so adding someone makes a new conversation — Slack does the same.
- **Verdict: Keep.** **Binds:** none. **Who:** Technical.

### D26 · A DM with yourself ("notes to self")

- **v1:** picking only yourself opens a DM titled "<name> (you)" ([`timeline.ts:140-152`](../../../src/features/chat/timeline.ts); [`chat-dialogs.tsx:376, 624`](../../../src/features/chat/ui/chat-dialogs.tsx)).
- **For:** a well-used Slack habit (a scratchpad that's always one click away).
- **Against:** Moduo already has two homes for that: ⌘⇧K capture into your personal Inbox ("capture is frictionless and destination-free", [`docs/PRODUCT_BRIEF.md:96`](../../../docs/PRODUCT_BRIEF.md)) and Notes' quick notes (the Note capture type, [`.design/tasks-v3/REPLAN.md:2539`](../../tasks-v3/REPLAN.md)). A third inbox splits what you meant to find later. "One way per job" (90b).
- **Recommendation:** remove it; if someone picks themselves, the picker offers "Capture a note" (⌘⇧K, ⌘2) instead. Would someone outside the target roles want it? Slack migrants would, briefly; the capture serves them better once learned (48a).
- **Verdict: Reverse.** **Binds:** 90b's one way per job; brief §7 capture. **Who:** Designer.

### D27 · "This message was deleted." stays in the conversation

- **v1:** a deleted message keeps its row and shows "This message was deleted." in italics ([`message-item.tsx:294-295`](../../../src/features/chat/ui/message-item.tsx)); its body, reactions and pin are wiped ([`chat_module.sql:577-579`](../../../supabase/migrations/20261006150000_chat_module.sql)).
- **For keeping a row:** a thread's replies need their parent.
- **Against:** RF-1's tombstone language is "Deleted task" in tertiary text, no title ([`.design/tasks-v3/research/capture-references-teams.md:219-222`](../../tasks-v3/research/capture-references-teams.md)); italics are a fourth text style. Slack hides a deleted message entirely unless it had replies.
- **Recommendation:** "Deleted message", tertiary text, shown only where it holds a thread; a deleted message without replies disappears once its Undo closes (D7). A reference to it reads "Deleted message" (D11).
- **Verdict: Adjust.** **Binds:** RF-1 tombstones, rule 38. **Who:** Technical.

### D28 · Edits: your own messages, any time, "(edited)", never notifying

- **v1:** only the author edits ([`chat_module.sql:544-546`](../../../supabase/migrations/20261006150000_chat_module.sql)); edits never notify, and edited mentions are scoped like sends ([`supabase/migrations/20261006151000_chat_edit_mention_scope.sql:1-3`](../../../supabase/migrations/20261006151000_chat_edit_mention_scope.sql)); ↑ edits the last one.
- **Evidence:** matches Slack and Discord; matches Tasks' comments ("comments editable and deletable", [`specs/tasks-v3.md:103`](../../../specs/tasks-v3.md)) and the quiet bar.
- **Small gap:** someone `@`-mentioned for the first time in an edit never hears about it (Slack behaves the same). Keep; note it in the notification table.
- **Verdict: Keep.** **Binds:** Tasks 80 (record the row). **Who:** Technical.

### D29 · Mark unread

- **v1:** "Mark unread" on someone else's message moves your read mark back ([`message-item.tsx:160-164`](../../../src/features/chat/ui/message-item.tsx); [`chat_module.sql:656-664`](../../../supabase/migrations/20261006150000_chat_module.sql)).
- **Evidence:** a standard, cheap Slack/Discord gesture; it serves people who triage chat like email, with or without ADHD (48a).
- **Verdict: Keep.** **Binds:** none. **Who:** Technical (add it to the key table, Slack's ⌥-click equivalent optional).

### D30 · Unread reads as weight; DMs show an unread pill, channels a mention pill

- **v1:** a solid filled pill (`bg-foreground`) with a number: in a DM it counts unread messages, in a channel it counts mentions; otherwise a dot; a collapsed section shows "Unread inside" ([`chat-sidebar.tsx:2-3, 72-110, 128-147`](../../../src/features/chat/ui/chat-sidebar.tsx)). The rail is Chat's own markup, not `NavRow`.
- **Against (binding):** rule 45 "one chip, one count language" ([`.design/tasks-v3/REPLAN.md:1214`](../../tasks-v3/REPLAN.md)); DS-3's `NavRow` is "the sidebar row for every module" and `MetaCount` the one quiet count ([`docs/decisions/design-system.md:13-19`](../../../docs/decisions/design-system.md); [`src/components/ui/meta-count.tsx:5-8`](../../../src/components/ui/meta-count.tsx)). The same pill meaning two different things (unread vs mentions) is a second count language inside one rail.
- **Recommendation:** the rail runs on `NavRow`; unread stays weight (the label in primary text); the count slot shows one thing everywhere: **what's addressed to you** (a DM's unread, a channel's mentions, or a "every message" channel's unread), in the kit's count style, and the ⋯ menu swaps into the same slot on hover (DS-3).
- **Verdict: Adjust.** **Binds:** rule 45, DS-3. **Who:** Technical.

### D31 · The Chat tab's badge: DM unread + channel mentions + unread in "every message" channels

- **v1:** the tab shows that sum as a number ([`src/features/chat/timeline.ts:199-210`](../../../src/features/chat/timeline.ts); [`src/components/app/app-chrome.tsx:518-524`](../../../src/components/app/app-chrome.tsx)); the hook's own comment says "the tab shows a dot" ([`src/features/chat/hooks/use-chat-badge.ts:1-5`](../../../src/features/chat/hooks/use-chat-badge.ts)). Muted and archived never count (good).
- **For a number:** Email's tab already shows its unread count, so it's consistent today.
- **Against:** brief §7's quiet bar; a number on a top-bar tab is the loudest place in the app, and choosing "every message" on a busy channel turns the tab into a running total. Tasks 80's table is where "who hears what, where" is decided; the tab badge has no row in it.
- **Recommendation:** the tab shows a number only for what's addressed to you (DMs and mentions); channels on "every message" make their row bold and add a dot to the tab, never to the number. Add the row to the notification table.
- **Verdict: Adjust.** **Binds:** brief §7, Tasks 80, rule 45. **Who:** Designer.

### D32 · Notification levels per conversation, and `@channel`

- **v1:**
  - per conversation: "Every new message · Mentions only · Mute", default Mentions ([`conversation-header.tsx:58-62`](../../../src/features/chat/ui/conversation-header.tsx); [`chat_module.sql:89`](../../../supabase/migrations/20261006150000_chat_module.sql));
  - `@channel` notifies every member who hasn't muted ([`chat_module.sql:510-512`](../../../supabase/migrations/20261006150000_chat_module.sql)), gated by PERM-7's "Mention everyone" ([`perm_sharing.sql:1750`](../../../supabase/migrations/20261006210000_perm_sharing.sql));
  - no `@Team` in chat, although Teams exist since 2026-10-10 (`supabase/migrations/20261010182000_teams.sql`).
- **For the levels:** the Slack-standard three; the default is the quiet one.
- **Against `@channel` as is:** Tasks 54 named it the thing to avoid: "Mentioning a team … sends its members a single digest notification, not a ping each. Otherwise `@Design` becomes Slack's @channel" ([`.design/tasks-v3/REPLAN.md:1466`](../../tasks-v3/REPLAN.md)). The message guard also scans the raw text for the words "@channel" and "@everyone" ([`supabase/migrations/20261008124000_chat_agent_post_checks_creator.sql:40`](../../../supabase/migrations/20261008124000_chat_agent_post_checks_creator.sql)), so someone without the capability who merely writes those words is refused; the real broadcast is a separate flag. Two checks for one rule.
- **Recommendation:**
  - keep three levels, named in plain words (designer's pick), default Mentions;
  - `@Team` works in chat with Tasks 54's rule (one notice each, the team's mute);
  - `@channel`: keep for announcement channels and holders of "Mention everyone"; one notice each, never repeated within the hour; the text scan goes (the token is what counts).
- **Verdict: Adjust.** **Binds:** Tasks 54, Tasks 80, brief §7. **Who:** Designer (the words, and whether `@channel` survives outside announcement channels).

### D33 · "Create task from message"

- **v1:** the menu item makes an Inbox task directly from the message's plain text (first 200 characters), with no capture window and no link back to the message; the toast's "Open" goes to `/tasks`, not to the task ([`chat-page.tsx:311-329`](../../../src/routes/pages/chat-page.tsx)).
- **Against (binding):**
  - TV-U14: one capture for every way in (U14-1) and the "From:" item linked as `spawned-from` (U14-5) ([`docs/decisions/tasks.md:69-73, 89-93`](../../../docs/decisions/tasks.md));
  - Tasks 93: explicit "Create task from this" actions link automatically ([`.design/tasks-v3/REPLAN.md:2577-2601`](../../tasks-v3/REPLAN.md));
  - the brief's moat is exactly this link (email → task, auto-linked, [`docs/PRODUCT_BRIEF.md:81`](../../../docs/PRODUCT_BRIEF.md)).
- **What changes:** the action opens the app's capture as Task with the message's text as the title draft and a "From: <message>" chip (the message Reference, D11); ⏎ creates and links; the message then shows "1 task" (its Linked count), and the task's Linked shows the message.
- **Verdict: Reverse.** **Binds:** TV-U14 (U14-1, U14-5), Tasks 93. **Who:** Technical. Rejected: silent one-click creation (v1).

### D34 · The Home "Conversations" widget

- **v1:** S/M/L sizes; what needs you first (DM unread, mentions, "every message" channels with unread), then the most recent; muted and archived never show ([`src/features/chat/widget.ts:1-4`](../../../src/features/chat/widget.ts)); below Duo it says "Chat comes with the Duo and Team plans." ([`src/features/dashboard/ui/widgets/chat-widget.tsx:136`](../../../src/features/dashboard/ui/widgets/chat-widget.tsx)).
- **For:** "what needs you first" is the right job for a Home widget and matches the Tasks widget's "Focus, or Open when empty" idea ([`specs/tasks-v3.md:165`](../../../specs/tasks-v3.md)). The module contract requires a widget.
- **Adjust only the surface:** rows use the kit's row and count language (D30); a workspace without chat doesn't offer the widget in the gallery instead of showing an upsell line (D2).
- **Verdict: Keep.** **Binds:** the module contract; Tasks §18 ("other widgets: their own round"). **Who:** Technical.

### D35 · The Duo gate is the workspace owner's plan (and the hackathon must have chat)

- **v1:** chat works when the owner's plan ranks ≥ Duo (Duo, Team, Founder); members inherit it; enforced in reads and every op ([`chat_module.sql:13-15, 25-33, 171-180`](../../../supabase/migrations/20261006150000_chat_module.sql); `CHAT_PLAN_TIERS`, [`supabase/functions/_shared/contracts/vocabularies.ts:852-855`](../../../supabase/functions/_shared/contracts/vocabularies.ts)). A Duo member in a Pro owner's workspace gets "ask the owner" ([`chat-locked.tsx:95`](../../../src/features/chat/ui/chat-locked.tsx)).
- **For:** ratified twice: chat is Duo/Team-only ([`docs/decisions/product.md:17`](../../../docs/decisions/product.md) point a; [`docs/decisions/billing.md:7`](../../../docs/decisions/billing.md)). The owner pays for the workspace, so the owner's plan is the clean rule.
- **Against, for the hackathon:** every team gets its own prepared workspace ([`.design/chat-v2/REPLAN.md:32`](../REPLAN.md)); those workspaces' owners won't be on Duo, so v1 locks chat exactly where it's needed. `planHasChat` reads only the owner's plan; there's no workspace-level grant.
- **Recommendation:** keep the owner's-plan rule. Add a second, explicit source: a workspace can carry its own chat entitlement with an end date (an event or a comp), set by Moduo staff, so hackathon workspaces have chat without anyone buying Duo. How those workspaces are made and what happens after the event belongs to the hackathon plan ([`.design/chat-v2/REPLAN.md:74`](../REPLAN.md)).
- **Verdict: Adjust.** **Binds:** the 2026-10-02 and 2026-10-06 gate decisions. **Who:** Designer, jointly with the hackathon plan.

### D36 · PERM-7: the role × capability grid, channel managers, "Only managers can post"

- **v1:** seven switches per role (create public, create private, manage any channel, delete others' messages, mention everyone, post, start calls) in Settings → Members and access ([`src/features/sharing/chat-caps-panel.tsx:11-19`](../../../src/features/sharing/chat-caps-panel.tsx); [`perm_sharing.sql:415-445, 1170-1191`](../../../supabase/migrations/20261006210000_perm_sharing.sql)); a channel's creator becomes its manager (`:447-463`, `:951-967`); "Only managers can post" can be set when creating a channel ([`chat-dialogs.tsx:166-173`](../../../src/features/chat/ui/chat-dialogs.tsx); [`use-chat-module.ts:810-815`](../../../src/features/chat/hooks/use-chat-module.ts)).
- **For:** the designer asked for "a board like Discord, but small" ([`specs/permissions.md:174-189`](../../../specs/permissions.md)). Announcement channels are what hackathon organizers need.
- **Against, in what was built:**
  - the dialog promises "You can still add managers later", but nothing adds a manager: no op, no screen (the only writes are the creator at creation and the hand-over when an account is erased);
  - the announcement switch exists only in the create dialog; no screen turns it on or off later;
  - "Manage any channel" is never read by rename, archive or remove (D4);
  - "Start calls" switches a feature that doesn't exist (Moduo Meet is planned, [`docs/decisions/meet.md:5`](../../../docs/decisions/meet.md));
  - chat is configured in two places: PERM-1's `chat.*` role keys ([`supabase/migrations/20261006200000_perm1_roles_overrides.sql:701, 845`](../../../supabase/migrations/20261006200000_perm1_roles_overrides.sql)) and PERM-7's grid, both deciding "can create a channel".
- **Recommendation:** keep the grid and announcement mode; make them honest: one place (chat's rows inside the role editor), "Add manager / Remove manager" and the announcement switch in the channel's Details, every switch read by the op it names, and "Start calls" hidden until Meet ships. Tasks' trust pass applies: "don't promise what the server doesn't do" (U14-4's reason, [`docs/decisions/tasks.md:84-88`](../../../docs/decisions/tasks.md)).
- **Verdict: Adjust.** **Binds:** PERM-7 (ratified), the trust-pass principle (49). **Who:** Technical.

### D37 · Presence and typing, app-wide

- **v1:** you show as online whenever Moduo is open on any page, with a dot on your avatar; typing shows to the conversation ([`use-chat-badge.ts:1-5`](../../../src/features/chat/hooks/use-chat-badge.ts); [`src/features/chat/realtime.ts:9, 128-131`](../../../src/features/chat/realtime.ts)). No setting hides it.
- **For:** the brief's "ambient glanceable shared state" ([`docs/PRODUCT_BRIEF.md:28`](../../../docs/PRODUCT_BRIEF.md); [`docs/ROADMAP.md:95`](../../../docs/ROADMAP.md)); knowing a teammate is around makes a DM feel safe to send.
- **Against:** a green dot creates pressure to answer at once, against the quiet principle and the ADHD lens (48a: does it serve everyone? Many people dislike being visibly "online"). Basecamp leaves presence out on purpose; Slack offers "Set yourself as away". Online means "Moduo is open", not "available".
- **Recommendation:** keep typing (it's local to a conversation and short-lived). Presence: show it only inside Chat (avatars in the rail and member list), with a personal "Show me as online" switch, on by default; and "Focus" (the Tasks run) could show as "Focusing" instead of online, which only Moduo can do. Designer call.
- **Verdict: Adjust.** **Binds:** brief §7, 48a. **Who:** Designer.

### D38 · No files in messages

- **v1:** attachments were left out ([`specs/chat.md:20, 70`](../../../specs/chat.md)).
- **Since then:** the attachment pipeline exists (AT-1 live 2026-10-08, [`specs/attachments.md:3`](../../../specs/attachments.md)).
- **Against leaving it out:** every role's week in chat includes a screenshot, a PDF or a logo; for a hackathon team it's daily. Without it, teams keep WhatsApp or Discord open next to Moduo, the weakest-leg trap ([`docs/PRODUCT_BRIEF.md:72`](../../../docs/PRODUCT_BRIEF.md)).
- **Recommendation:** files in messages (paste, drop, the + button) through AT-1's pipeline, images previewed inline; whether it's in the hackathon MVP is the designer's call.
- **Verdict: Adjust.** **Binds:** AT-1 (the pipeline), brief §6 (weakest leg). **Who:** Designer (scope and MVP cut).

### D39 · The data shape: ops-only writes, one row per message carrying reactions and thread counts, soft deletes, idempotent sends

- **v1:** clients only read; every write is a `chat_op_*`; reactions and thread rollups live on the message row and deletes are soft so every live change is one RLS-filtered UPDATE; `client_id` makes a retried send land once ([`chat_module.sql:4-21`](../../../supabase/migrations/20261006150000_chat_module.sql); [`docs/gotchas/supabase.md:105-106`](../../../docs/gotchas/supabase.md)).
- **For:** sound, and the same principle Tasks v3 made law ("every write a server op", [`docs/decisions.md:249`](../../../docs/decisions.md)). The Realtime DELETE gotcha is real.
- **Adjust only the client:** adopt the shared-store pattern (TV-D11a: device cache, delta sync, echo skip, offline outbox) so chat reads offline and sends queue, like captures ([`.design/chat-v2/REPLAN.md:68`](../REPLAN.md)). Two gaps to record in the gotchas, not here: chat rows outlive membership ([`docs/gotchas/supabase.md:60`](../../../docs/gotchas/supabase.md)) and the local stack has no Realtime publication (`:13`).
- **Verdict: Keep.** **Binds:** Tasks §6.1, TV-D11a. **Who:** Technical.

---

## Part 3 · Contradictions

Places where v1 contradicts a binding Tasks v3 (or other ratified) rule, or contradicts itself. Cited in the REPLAN as "audit A1" etc.

### Against a binding rule

| # | v1 | The rule it breaks | Item |
| --- | --- | --- | --- |
| A1 | `#` inserts tasks, notes, contacts and events ([`composer.tsx:5-7`](../../../src/features/chat/ui/composer.tsx)); the locked screen teaches it ([`chat-locked.tsx:24`](../../../src/features/chat/ui/chat-locked.tsx)) | `@` people then things · `#` tags · `/` commands (Tasks 33, 33a, 55; RF-1-8) | D10 |
| A2 | References are stored with a label and drawn as the old static chip, no preview cards ([`markup.ts:6`](../../../src/features/chat/markup.ts); [`message-body.tsx:86-91`](../../../src/features/chat/ui/message-body.tsx)) | RF-1: the shared Reference, live titles and statuses; in chat a chip plus collapsible preview cards (Tasks 55) | D11 |
| A3 | An agent's post shows a bot glyph, an "App" pill and the key's name as author ([`message-item.tsx:245-274`](../../../src/features/chat/ui/message-item.tsx)) | Tasks 52 "Alex · via <key name>"; brand 40a, no AI badge or mark | D15 |
| A4 | "Create task from message" makes an unlinked Inbox task with no capture window ([`chat-page.tsx:311-329`](../../../src/routes/pages/chat-page.tsx)) | TV-U14 U14-1 (one capture) and U14-5 ("From:" linked); Tasks 93 (explicit actions link) | D33 |
| A5 | "Delete this message? … This can't be undone." ([`chat-page.tsx:279-282`](../../../src/routes/pages/chat-page.tsx)) | DF-5's one undo grammar; Tasks default a (Undo for 8 s) | D7 |
| A6 | Right-panel modes chosen by header icons, each with its own ✕ ([`side-panels.tsx:19-36`](../../../src/features/chat/ui/side-panels.tsx)) | SH-1 / 72a: the title row is the view dropdown, references open as "← item", collapse lives in the bottom bar; 48b | D20 |
| A7 | Search is a right-panel mode ([`side-panels.tsx:269-330`](../../../src/features/chat/ui/side-panels.tsx)) | The toolbar grammar (`… Search · Filter · Display …`) and the bottom bar's app search (Tasks §18) | D19 |
| A8 | The rail is its own markup with a filled pill that means unread in DMs and mentions in channels ([`chat-sidebar.tsx:72-110`](../../../src/features/chat/ui/chat-sidebar.tsx)) | Rule 45 (one count language); DS-3 `NavRow` + `MetaCount` | D30 |
| A9 | "Star" puts a conversation in the sidebar; "Pin" marks a message ([`conversation-header.tsx:193-195`](../../../src/features/chat/ui/conversation-header.tsx); [`message-item.tsx:156-158`](../../../src/features/chat/ui/message-item.tsx)) | Tasks 29b: "Pin to sidebar"; one name per concept | D23 |
| A10 | Channel names forced into lower-case slugs ([`chat_module.sql:201-209`](../../../supabase/migrations/20261006150000_chat_module.sql)) | Rule 40: people's words appear as typed | D12 |
| A11 | `@channel` pings every member one by one ([`chat_module.sql:510-512`](../../../supabase/migrations/20261006150000_chat_module.sql)); no `@Team` | Tasks 54: a group mention is one notice each, never Slack's @channel; teams are mentionable | D32 |
| A12 | Chat has no rows in a notification table, and no notification reaches you outside the bell and the tab | Tasks 80 ("one table, all of it"), Tasks 73 (OS/browser channels) | D6 |
| A13 | ⌘7 in the capture does nothing: Chat registers no capture type ([`capture-registry.ts:3-10`](../../../src/lib/capture-registry.ts)) | Tasks 90b: "⌘7 a message" | D1 |
| A14 | Tombstone in italics; topic placeholder at `/60` opacity ([`message-item.tsx:295`](../../../src/features/chat/ui/message-item.tsx); [`conversation-header.tsx:150`](../../../src/features/chat/ui/conversation-header.tsx)); "Last reply 3 minutes ago" ([`message-item.tsx:395`](../../../src/features/chat/ui/message-item.tsx)) | Rule 38 (three readable levels, no one-off fades), rule 41 (one date grammar) | D27 (the visual audit owns the full list) |
| A15 | `#general` membership is remembered per device ([`use-chat-module.ts:178-195`](../../../src/features/chat/hooks/use-chat-module.ts)) | Supabase is the source of truth (AGENTS.md Stack; cloud-first) | D24 |

### Tensions (a binding rule exists, but extending it to chat is a call)

| # | v1 | The rule | Item |
| --- | --- | --- | --- |
| A16 | Free emoji reactions, up to 20 | Tasks 88: six fixed, "nobody picks or adds their own" (decided for comments) | D13 |
| A17 | ⌥⇧↑/↓ = next unread ([`chat-page.tsx:8-9`](../../../src/routes/pages/chat-page.tsx)) | Tasks key map: ⌥⇧↑↓ = move in order ([`keymap.md:38`](../../tasks-v3/research/keymap.md)); acceptable only as a listed scope-separated collision | D22 |
| A18 | Agents never see private channels | KEYS-1 / Tasks 52: a key is its creator's delegate, capped at (not below) what the creator sees | D16 |

### v1 against itself

| # | One part says | Another part does | Item |
| --- | --- | --- | --- |
| A19 | "Everyone in the workspace can chat, including viewer" ([`specs/chat.md:48`](../../../specs/chat.md)) | Viewers can never post: designer's answer 5 and the database ([`specs/permissions.md:255`](../../../specs/permissions.md); [`perm_sharing.sql:415-445, 979, 1178-1181`](../../../supabase/migrations/20261006210000_perm_sharing.sql)) | D3 |
| A20 | "Admins can delete anyone's" (assumption 7); PERM-7 "Delete others' messages" | The message menu offers Delete only on your own ([`message-item.tsx:173-181`](../../../src/features/chat/ui/message-item.tsx)) | D7 |
| A21 | PERM-7: channel managers and "Manage any channel" decide rename, archive, members | The ops check the creator or the owner/admin role and never read either ([`chat_module.sql:329, 357, 424`](../../../supabase/migrations/20261006150000_chat_module.sql)) | D4, D36 |
| A22 | "You can still add managers later" ([`chat-dialogs.tsx:168`](../../../src/features/chat/ui/chat-dialogs.tsx)) | No op or screen adds a manager; the announcement switch exists only in the create dialog | D36 |
| A23 | PERM-1's `chat.*` role keys decide who creates a channel ([`20261006200000_perm1_roles_overrides.sql:701`](../../../supabase/migrations/20261006200000_perm1_roles_overrides.sql)) | PERM-7's `create_public` / `create_private` decide it too ([`perm_sharing.sql:951-967`](../../../supabase/migrations/20261006210000_perm_sharing.sql)) | D36 |
| A24 | "Mention everyone" is checked on the `@channel` flag ([`perm_sharing.sql:1750`](../../../supabase/migrations/20261006210000_perm_sharing.sql)) | …and again by scanning the raw text for the words, which refuses a plain sentence that contains them ([`20261008124000_chat_agent_post_checks_creator.sql:40`](../../../supabase/migrations/20261008124000_chat_agent_post_checks_creator.sql)) | D32 |
| A25 | "the tab shows a dot" ([`use-chat-badge.ts:1-5`](../../../src/features/chat/hooks/use-chat-badge.ts)) | The tab shows a number ([`app-chrome.tsx:518-524`](../../../src/components/app/app-chrome.tsx)) | D31 |
| A26 | A "Start calls" capability per role ([`chat-caps-panel.tsx:18`](../../../src/features/sharing/chat-caps-panel.tsx)) | Calls don't exist (Moduo Meet is planned, [`docs/decisions/meet.md:5`](../../../docs/decisions/meet.md)) | D36 |
| A27 | Agent scope "No chat / Read public channels / Read + post" ([`specs/chat.md:57`](../../../specs/chat.md)) | KEYS-1's None / View / Edit grid ([`src/features/settings/api-keys.ts:38, 60`](../../../src/features/settings/api-keys.ts)) | D16 (stale doc) |
| A28 | 2026-10-02: "Spec later, no build now — `/s1` first; no ledger blocks until that spec passes the DoR gate" ([`docs/decisions/product.md:17`](../../../docs/decisions/product.md) point b); ROADMAP still says "planned, not yet specced" ([`docs/ROADMAP.md:90-91`](../../../docs/ROADMAP.md)) | v1 was built on 2026-10-06 without `/s1` ([`specs/chat.md:5`](../../../specs/chat.md)) and is live | process; this re-plan closes it |

---

## Part 4 · What needs the designer (product calls), with the recommendation

★ marks the load-bearing ones for round 1.

| Item | The question | Recommendation |
| --- | --- | --- |
| ★ D9 | Channels as free-standing (Slack) or anchored to the work? | Keep channels and DMs; let a channel be linked to a project, client or event, shown on that item's overview/hub. No automatic channel per project. |
| ★ D35 | How do hackathon workspaces get chat when the gate is the owner's plan? | Keep the owner's-plan rule; add a workspace-level chat entitlement with an end date, set by staff. The hackathon plan owns the rest. |
| ★ D6 | Should a DM reach you when you're not on the Chat tab? | Not the bell; one OS/browser notification for a DM or `@you` when Moduo isn't focused, grouped per conversation, with a switch. |
| ★ D18 | The chat ↔ item boundary (a proposal touching Notes and Tasks) | A message that references an item leaves "Mentioned in #launch · Oct 12" on it; no "Discuss in chat" on items. |
| ★ D13 | Reactions in chat: the six fixed, or free emoji? | One component; the six as the one-click row, the full picker behind More. Comments keep only the six. |
| ★ D38 | Files in messages, and are they in the hackathon MVP? | Yes, through AT-1's pipeline, images inline; MVP: yes. |
| D2 | Does the locked Chat tab stay in the top bar on Free/Pro? | Hide it in one-member workspaces; advertise Duo where inviting starts. |
| D4 | Who adds people to a private channel? | Its managers. Public channels: anyone. |
| D5 | Can privacy change later? | No for now (batch confirm). |
| D12 | Channels written `#name`, with names forced to slugs? | Own icon, names as typed, referenced with `@`. |
| D16 | Can a person's agent read private channels they're in? | Opt-in per key, off by default, visible in the channel's details; DMs never. |
| D17 | Keep threads in chat? | Yes, one level, opened in the panel as "← Thread", with "Stop following". |
| D21 | Does ⌘J survive next to ⌘K? | Conversations join ⌘K; ⌘J retires (or stays as ⌘K filtered). |
| D23 | Words for "in my sidebar", "kept for everyone", "save for later" | "Pin to sidebar"; a different word for a kept message; save-for-later = a reminder through Tasks. |
| D26 | A DM with yourself? | Remove it; the picker points to ⌘⇧K. |
| D31 | Number or dot on the Chat tab? | A number only for what's addressed to you; "every message" channels add a dot. |
| D32 | Notification words, and `@channel` outside announcement channels | Three plain levels; `@Team` like Tasks 54; `@channel` only in announcement channels or for holders of "Mention everyone", one notice each. |
| D37 | Presence: always on, in Chat only, or switchable? | In Chat only, with "Show me as online"; show "Focusing" during a Focus run. |

## Part 5 · Technical items: what to decide and record (with the rejected alternative)

| Item | Decision to record | Rejected |
| --- | --- | --- |
| D1 | ⌘7 stays Chat; Chat registers the Message capture type | Moving Chat next to Email (breaks 90b) |
| D3 | Viewers never post (as built); fix `specs/chat.md:48` | "Everyone can chat" (v1 wording) |
| D7 | Delete at once with 8 s Undo, deferred commit; admins get Delete on others' messages in the menu, or the capability goes | The confirm toast |
| D8 | Composer = the shared Lexical editor with RF-1's menus and markdown input rules | The textarea; a third editor |
| D10 | `@` things, `#` tags, `/` commands and date chips in messages | `#` for items in chat only |
| D11 | References stored `moduo://type/id`, RF-1 chip + preview cards; Message and Conversation kinds; v1 bodies converted | A label inside the token |
| D14 | Reactions stay silent | — |
| D15 | Author = the key's creator, "via <key name>", no glyph or pill | "App" badge; an "Assistant" label |
| D19 | Search in the toolbar (this conversation) and the app search (all), results open at the message | Search as a panel mode |
| D20 | Chat joins the panel registry: title dropdown, "← item" stack, bottom-bar collapse | Panel modes with ✕ |
| D22 | Chat's key table, ⌥⇧↑/↓ listed as an accepted scope-separated collision | Silent reuse of Tasks keys |
| D24 | The server joins every member to the shared channel; leaving is stored server-side | The per-device flag |
| D25 | Group DMs up to 9, fixed membership | — |
| D27 | "Deleted message" in tertiary text, only where it holds a thread | Italic tombstone for every delete |
| D28 | Edits as built; record "edits never notify" in the table | Notifying on edits |
| D29 | Mark unread as built; add it to the key table | — |
| D30 | The rail on `NavRow`, one count meaning ("addressed to you") | The filled pill with two meanings |
| D33 | Create task from message = the app capture with a "From:" message link | One-click unlinked creation |
| D34 | The widget's job as built; rows on the kit; no upsell line | — |
| D36 | Managers addable, announcement switch in Details, every switch read by its op, "Start calls" hidden, one place for chat permissions | Two permission layers; promises the server doesn't keep |
| D39 | Server shape as built; client on the shared store (TV-D11a) | Chat's own fetch-and-hold state |
