# Chat v2 — the re-plan

> **Status (2026-10-13): orienting. Six research lanes are running; round 1 has not been sent.**
>
> - **Open calls:** none yet. Round 1 (the shape, plus the hackathon questions) goes out once the lanes land.
> - **Research lanes** (each writes its own file in [`research/`](./research/)): current state (code + a live look in a seeded local workspace with three members), visual audit, early-decisions audit, competitor structure, role journeys, the hackathon.
> - **Research data in the shared local database:** the current-state lane seeds a workspace named "Chat replan research" and lists every row to remove in its file's last section.
> - **Prototypes:** none yet.
> - **Uncommitted:** nothing.
>
> **Numbering:** Chat calls are **CH1, CH2, …**, numbered once and never renumbered. Tasks v3 calls are cited as "Tasks 64", "Tasks default r"; Calendar's as "Calendar C7". The decisions audit's contradiction list uses its own "A1…"; here those are cited as "audit A1".
>
> Branch `t/maciej/chat-replan` (cut from `t/maciej/tasks-v3-build` @ b33922a6). Local build mode (BUILD_ORDER's 🟠 box): local Supabase is prod, no pushes to `maciej`/`develop`, no PRs until Maciej says "release"; backing up this branch to origin is fine. Process: [`docs/agents/module-replan.md`](../../docs/agents/module-replan.md) (on `t/maciej/tasks-v3-build`). North star: [`specs/tasks-v3.md`](../../specs/tasks-v3.md), [`.design/tasks-v3/REPLAN.md`](../tasks-v3/REPLAN.md).

## 0. How to read this

| § | What it covers |
| --- | --- |
| §1 | What's wrong, and why; what's strong; what Chat must adopt from Tasks v3; the boundaries with Notes, Calendar and Meet |
| §2 | The proposed shape of Chat |
| §3 | One product, every role (and the hackathon) |
| §4 | Each view, today and its target |
| §5 | The visual north star, applied to Chat |
| §6 | Technical decisions I'm taking, so the designer doesn't have to |
| §7 | What Chat waits on from the Tasks v3 build |
| §8 | The calls |
| §9 | What happens next |

**Goal (from Maciej, 2026-10-13):** make Chat complete and pleasant for **hackathon teams and organizers** (the first concrete use), and for **teams of 2–5 on the Duo/Team plans: founders, developers, PMs, and agencies working with clients**, so each can run a normal week without Slack, Discord, Teams chat or WhatsApp/Messenger groups used for work. Not 1-to-1 copies; earlier decisions can be overturned with evidence. The module is done only when it wires into the spine, ships its MCP tools and defines its dashboard widgets.

**Known inputs:**
- **The hackathon.** Moduo may help organize a hackathon soon: every team gets a prepared Moduo workspace (the organizers' info as notes, the milestones as tasks, a place to collaborate). Its date sets an explicit MVP cut inside this plan.
- **Chat v1 is built** (Mike, 2026-10-06, `t/mike/chat`, [`specs/chat.md`](../../specs/chat.md)) without a grilling round. Every product call in it was an agent's assumption. It's audited like Tasks: keep what's strong, reverse what's weak, record what changes so Mike can follow.
- **Notes is being re-planned in parallel** (`t/maciej/notes-replan`). The boundary is in §1.5.

**Constraints:** desktop and web only (mobile gets its own plan later); calls (Moduo Meet) are out of scope; chat stays inside PRODUCT_BRIEF §7's quiet-notification bar; the hackathon MVP cut is explicit in the spec's blocks; no new top-level routes or IA refactors without Maciej's ask; AI only through MCP.

---

## 1. Diagnosis

*Waiting on the research lanes.*

### 1.1 The root cause

### 1.2 What is genuinely strong (keep)

### 1.3 What's broken, in five kinds

### 1.4 What Chat adopts from Tasks v3 (binding unless Maciej agrees to change it)

| Piece | What it means here |
| --- | --- |
| The 3×3 layout (Tasks 48b) | Left = conversations (overview and navigation), centre = the open conversation, right = context (a thread, the conversation's details, a linked item); the bottom bar holds Chat's tools and each panel's toggle. No rails, strips or extra columns. |
| Visual rules 38–46a | Three readable text levels + one decorative; hover = fill; one selection tint, focus ring, drop target and drag preview; people's words never capitalised; one date/time grammar ("Today · 3:00 PM"); nothing truncates; two-initial avatars with a stable colour; density everywhere; one chip and one count language; the accent budget; no rotated text. |
| The north-star kit (DS-6) | NavRow for conversations, GroupHeader for sidebar groups, MetaCount for unread, Chip, Avatar, EmptyState, Feed (item, card, composer), Toolbar grammar, FilterBar/DisplayMenu, DateField. Chat-only pieces (the message row, the composer, reactions, the thread line, dividers) get their own north-star definition here. |
| The right panel (SH-1, Tasks 72a) | The title row is a dropdown of Chat's hand-picked views; a reference opened inside the panel shows as "← item". Chat isn't in the panel registry yet (`src/lib/panel-registry.ts`): adopting it is a block. |
| One capture (Tasks 90, 90b, 93) | ⌘⇧K opens as Task; ⌘7 inside the modal switches it to Message. "Create task from message" goes through Tasks' capture (TV-U14) with the message as its "From:" link. |
| References (RF-1) | Chat defines the message's and the conversation's link, chip, card and hover preview, plus "Private item" and "Deleted message". RF-1 already sets chat's default: a chip in the text plus collapsible preview cards. |
| The `@ # /` grammar and `/today` date chips | In messages: `@` mentions people first, then things; `#` tags; `/` runs commands. |
| The bottom-bar mode pattern (Tasks 82b) | A Chat mode (e.g. selecting messages, catching up) shows its few most-used actions with keys, then More. |
| The key map's conventions | Chat adds its own table, collision-checked against Tasks' keymap. |
| The notification table | Chat adds its rows in the same format (event · who hears · where · when · turned off by). |
| Time & region (Tasks 76) | Message times in each viewer's zone and 12/24h; "do not disturb" hours, if any, read the same zone. |
| Motion tokens | Fast ~100 ms, base ~180 ms, slow ~280 ms; four patterns; reduced motion = opacity only; no blur. |
| The agent-session status pattern (Tasks 52) | An agent posting in chat is a named delegate ("Alex · via Claude"), never an AI badge. |
| The state rules | Loading = skeleton; empty teaches one gesture; filtered to nothing says so; offline = read-only from the device copy (plus queued sends, if decided); read-only hides edit affordances; very large stays fast. |
| The shared store pattern (TV-D11a) | One device cache per workspace, delta sync, Realtime merge, echo skip, one-field rollback, an offline outbox. |
| The decision-entry format | Who · what · why · rejected, in `docs/decisions/chat.md` (new area file). |

### 1.5 Boundaries with other modules

- **Notes** (re-planned in parallel; the boundary Maciej set): a discussion *about an item* lives on the item (comments, plus reactions as Tasks' TV-U13 builds them); **chat owns conversations**; both link items through RF-1 references; "Create task from message" goes through Tasks v3's capture (TV-U14). Any cross-module rule beyond that is recorded here as a **proposal for Maciej**, never decided for Notes.
- **The hackathon readiness plan** (its own session, `t/maciej/hackathon-plan`, output `specs/hackathon.md`) owns the cross-module layer: web access, invites at scale, a template workspace copied into one workspace per team, organizer and judge access, plan gates (including chat's Duo gate) and what happens to the data after the event. Chat's calls decide how chat behaves inside that layer; where Chat needs something from it (e.g. announcements reaching every team), the need is recorded here as a proposal for that plan and for Maciej. For the hackathon, Notes and Chat are next; Email, Contacts and Calendar are out.
- **Calendar** (re-planned in parallel, `t/maciej/calendar-replan`, paused for the hackathon): Calendar provides the event preview (title · time · people) and its chip; chat links events like any item.
- **Moduo Meet** (calls) is a separate track ([`specs/moduo-meet.md`](../../specs/moduo-meet.md)); chat only keeps the door open (`startCall({ source: "chat" })` exists in that spec).

---

## 2. The proposed shape

*Round 1.*

## 3. One product, every role

From [research/role-journeys.md](./research/role-journeys.md) (a normal week per role, 26 capabilities, sources) and [research/hackathon.md](./research/hackathon.md) (how hackathons communicate today; what a Moduo hackathon needs).

| Role | Could they drop the old tool today? | What closes the gap |
| --- | --- | --- |
| **Hackathon team** (3–5, some strangers) | Inside the event, almost: the prepared workspace already beats a Discord group (tasks, notes, live chips) | Files (CH17), pings that leave the app (CH6), and event news reaching them (CH22) |
| **Hackathon organizer** | For the team side, yes; not for the open pre-event community, which forms on Discord before anyone has a Moduo account | The structure (CH22), a help desk (CH24), announcements that can't be missed (CH23), onboarding at scale (hackathon plan) |
| **Duo founders** | The at-desk work talk, yes; the phone layer, no | Pings outside the app (CH6), conversation ↔ contact and project (CH2), decisions (CH13); mobile is a later plan |
| **Developer team of 3–5** | Once catch-up, notifications, files and integrations exist | CH6, CH8, CH17; integrations and huddles later |
| **PM** | Inside the team; not toward a stakeholder who lives in Slack or Teams | CH2 (conversations on projects), CH8, CH13; guests later (CH19) |
| **Agency with clients** | Internal chat, yes; client chat, no (clients won't log in; guests don't exist) | Guests (CH19); until then, email in Moduo and Meet's guest join |
| **Solo founder + a contractor** | Chat isn't the tool at 1 + 1: comments, email and Meet cover it | Nothing to build; Chat stays out of one-person workspaces (CH4) |

**The two themes behind most gaps:**
1. **Chat doesn't reach you.** In v1 a direct message reaches you only if you're looking at the Chat tab: nothing leaves the app, and the bell only shows the workspace you're in. This is gap #1 for every role.
2. **Chat doesn't know the work.** A conversation about a project or a client can't be found from that project or client; a decision lives only as a pin. Linking the two is the spine applied to chat, and the one thing Slack can't copy.

**The risk no Chat call closes: no phone.** Every competitor treats the phone as the place people triage messages; duos and agencies' clients live on WhatsApp. Mobile has its own plan later (a constraint of this re-plan). Until then, CH6's OS and browser notifications and CH23's announcements are the mitigation, and the hackathon plan owns any phone fallback for announcements at the venue.

**The hackathon adds two of its own:** reaching every team at once (announcements across teams, a help desk), and getting dozens to hundreds of people in quickly. Both depend on the hackathon plan's structure choice (CH22).

**Outside the target roles (48a):** pings that leave the app, files, catch-up, reminders on messages and do-not-disturb hours are universal (households, clubs, classes would all want them). Announcements across workspaces and a claimable help desk are event-shaped, but agencies (a workspace per client), teachers and accelerators would want the same two pieces, so they're designed as general tools, not hackathon features.

## 4. The views — today and their target

*Rounds 2a/2b.*

## 5. The visual north star, applied to Chat

*From the visual audit.*

## 6. Technical decisions I'm taking

*Round 1 onward. Each with the alternative I rejected.*

## 7. What Chat waits on from the Tasks v3 build

## 8. The calls

**Round 1 (2026-10-13): the shape.** All 26 calls are open. ★ = load-bearing (CH1, CH2, CH6, CH8, CH20, CH22). Prototype: [`prototypes/round-1.html`](./prototypes/round-1.html) (keys 1–7 switch frames, V cycles variants).

**What each call does to v1** (so Mike can follow): **keeps** v1 · **changes** v1 · **new**. The decisions audit's item is named where it applies ("audit D9").

**How to answer:** numbers with ok / no / notes, as for Tasks.

### A · The bar and the shape

**★ CH1 · Chat's bar, and its one great moment**
- **The bar ("as good as, no further"):** Slack for a team of 2–5, in the parts a team uses every day: channels, direct messages, threads, mentions, reactions, files, search, pins, edit and delete, unread and catch-up, notification levels, announcement channels.
- **No further:** no workflow builder or app directory (agents come in through MCP), no canvases or lists inside chat (Notes and Tasks are those), no huddles here (Moduo Meet's track), no shared channels between companies, no custom emoji, no read receipts.
- **The one great moment — recommended: "the conversation knows the work."** Anything you mention shows live (a task's status ticks over in the message), a message becomes a task in one key with the link both ways, and a channel about a project or client is one click from that project or client, and back.
- **Rejected as the great moment:** "catch up and be done" (CH8). It's the quiet bar's expression and every chat tool claims calm; only Moduo can do the first.
- **48a:** people outside the targets (clubs, households, classes) want the bar; the great moment is ours alone.
- *Recommend: yes.* · changes v1 (adds the links)

❓ OK?

**★ CH2 · The shape: channels and direct messages, and a channel can be linked to the work** (frame 1; audit D9)
- **Options:**

  | | What it is | Gains | Costs |
  | --- | --- | --- | --- |
  | **A · Slack's shape (v1)** | Channels and DMs, unrelated to anything | Everyone knows it | A conversation about Acme can't be found from Acme; context lives in people's heads |
  | **B · Channels + DMs, linkable** | The same, plus one gesture: link a channel to a **project**, a **client** (company or contact) or a **team** | The project shows "Conversation: Acme" and opens it; the channel shows the project's live state in Details; capture from the channel files to that project (CH10) | One more idea to learn, kept optional |
  | **C · One conversation per project, automatic** (Basecamp's Campfire) | Every project gets a chat | No setup | 15–30 projects = 15–30 empty rooms to mute; at 2–5 people most projects never need one |
  | **D · Topics** (Zulip) | Every message belongs to a named topic | Tidy at 50+ people | Hard to learn; overkill at 2–5. Zulip itself relaxed it twice (topic-less channels in 11.0, Aug 2025) |
  | **E · Every item's conversation is its comments, shown as chat** (the competitor lane's pick) | Projects, clients and tasks each have one stream; chat is a view of it | One place per thing | Crosses the boundary you set (comments stay on the item; chat owns conversations) and the Notes re-plan's side of it |

- **Evidence** ([research/structure-competitors.md](./research/structure-competitors.md)): the big tools met in the middle in 2025 (Teams added chat-like threads to channels; Zulip allowed channels without topics); most standalone "new structure" products folded (Height shut in Sept 2025, Campsite is winding down); Basecamp, ClickUp and Missive thrive with chat *inside* a larger workspace, next to the work.
- **Recommended: B.** Linking is offered, never forced: "Start a conversation for Acme rebrand" in a project's ⋯ and on a client's hub; "Link to a project, client or team" in a channel's Details. A channel links to at most one thing.
- **The boundary holds:** a discussion about *one item* still lives on the item as comments (Notes boundary). A linked channel is a team's ongoing conversation around a project or client, not a comment thread.
- **48a:** anyone who runs work through projects or clients would want this; it costs nothing to people who don't link.
- *Recommend: B.* · changes v1

❓ B?

**CH3 · Names, and three small reversals** (audit D12, D23, D26)
- **Words:** the module is **Chat**; any channel or DM is a **conversation**; a named one for a group is a **channel**; one between people is a **direct message**, whether two people or up to nine (v1's "group DM" folds in).
- **Channel names stay as typed** ("Acme", "Launch v1"), not v1's forced `acme-launch` slugs (rule 40). A channel's icon says what it's about: the project's colour dot, the client's company icon, the team's mark, a lock for private, a plain bubble otherwise (frame 1). Fixed icons, never picked by people.
- **No `#` in front of channel names.** `#` means tags everywhere else in Moduo (CH14); `#design` the channel and `#design` the tag would look identical.
- **"Star" becomes "Pin to sidebar"** (Tasks 29b's word). A message pinned to a conversation keeps "Pin to conversation": the same idea (keep it at the top) at two places. *Alternative:* a different word for messages ("Keep at top"); I don't think the overlap confuses.
- **Notes to self (a DM with yourself) goes.** ⌘⇧K already captures into your Inbox, or a quick note with ⌘2; a third scratchpad splits what you meant to find later. Picking only yourself offers "Capture a note" instead.
- *Recommend: all five.* · changes v1

❓ OK? (any you'd keep as v1?)

**CH4 · Who sees Chat** (audit D2)
- **v1:** every workspace shows the Chat tab; below Duo it's an upgrade explainer.
- **Proposed:** Chat appears when a workspace has a **second member**. A one-person workspace never shows it (there's nobody to talk to). The upgrade lives where the need starts: inviting a second person, and Settings → Plans. A multi-person workspace below Duo (after a downgrade) keeps a locked tab with "Ask the owner".
- ⌘7 stays Chat's number (Tasks 90b uses it in the capture). When Chat is hidden, the numbers follow the visible tabs, as today.
- **48a:** solo people never wanted the tab; teams lose nothing.
- *Recommend: yes.* · changes v1

❓ OK?

**CH5 · The left panel** (frame 1)
- **Order:** **Catch up** (CH8) · hairline · **Pinned** (only if you pinned something) · **Channels** · **Direct messages** · "+ New conversation".
- **Group headers** are the kit's GroupHeader, sentence case, collapsible: the same recipe as Tasks' areas.
- **Unread is weight** (the name turns bold). **A number appears only for what's addressed to you:** a DM's unread, your mentions in a channel, or every message in a channel you set to "Every message". One count style (rule 45), never a coloured pill.
- **Sorting:** channels alphabetical (they don't jump around); direct messages by most recent.
- **48a:** a calm sidebar suits everyone; heavy users still see bold names.
- *Recommend: yes.* · changes v1 (v1 has coloured pills, two count meanings, a Starred group)

❓ OK?

### B · Quiet by design

**★ CH6 · What reaches you, and where** (audit D6, D31; Tasks 73, 80)
- **The rule: you're pinged only by what's addressed to you:** a direct message, an `@you`, a reply in a thread you're in, and an announcement (CH23). Nothing else ever leaves its conversation: other messages just make the name bold.
- **Where it reaches you:**

  | What | OS notification (desktop) / browser notification (web, opt-in) | Bell | Chat tab | Catch up |
  | --- | --- | --- | --- | --- |
  | Direct message | Yes, one per conversation per burst ("Sofia · 3 messages") | No: the bell is for work items | Number | Yes |
  | `@you` in a channel | Yes | Yes (like `@you` in a comment) | Number | Yes |
  | Reply in a thread you're in | Yes, grouped per thread | Yes | Number | Yes |
  | Announcement | Yes, once | Yes | Number | Yes |
  | Any other message | No | No | Bold name only (a dot on the tab for "Every message" channels) | No |
  | A reaction | No | No | No | No |

- **Only when Moduo isn't in front of you** (or you're in another module), and **in any workspace**, not just the one open, with the workspace's name on the notice.
- **v1 today:** nothing leaves the app; a DM shows only as a number on the Chat tab, so it reaches you only if you look.
- **48a:** this is the baseline of every chat tool; the burst rule and "addressed to you only" make it calmer than any of them.
- *Recommend: yes.* · changes v1

❓ OK?

**CH7 · Per-conversation levels, `@channel` and `@Team`, Focus and quiet hours** (frame 7; audit D32)
- **Three levels, in plain words:** **Every message** · **Mentions and replies** (default) · **Nothing** (it still turns bold; never pings or counts).
- **`@channel`** reaches everyone in a channel once; only people whose role may "Mention everyone" can use it (PERM-7's switch, already there). **`@Team`** works in chat as in Tasks 54: one notice each, muted with the team.
- **Focus holds chat's pings** until the session ends, then they arrive together; the top bar says "3 held until Focus ends" (frame 7, variant 2). Nothing breaks through, not even DMs.
- **Quiet hours** (Settings → Notifications, in your Time & region zone): **off by default**, one switch with a range (e.g. 19:00–9:00), Basecamp's "Work Can Wait". Teammates see "Sofia's quiet hours · back 9:00" when they message you.
- **48a:** Focus holding pings is something only Moduo can offer; quiet hours suit anyone with a life.
- *Recommend: yes.* · changes v1

❓ OK? Should a DM break through Focus? (recommend no)

**★ CH8 · Catch up: one place for what's addressed to you** (frame 2)
- **What it is:** the first row of the left panel. It lists only what CH6 would ping you for (DMs, `@you`, replies in your threads, announcements), grouped by conversation (variant: newest first).
- **It's a mode, like Tasks' Inbox triage** (Tasks 82b): the bottom bar shows **Reply `R` · Done `E` · Task `T` · Later `H` · Open `⏎` · More**, then "4 left · Esc". The selected item opens in context on the right.
  - **Done** clears it (reading it in its conversation clears it too).
  - **Task** opens the capture (CH10).
  - **Later** brings it back at a time you pick ("in 1 hour · this evening · tomorrow"), like Tasks' Snooze `H`. No separate "saved for later" list.
- **Empty:** "You're caught up." Channels with messages you weren't asked about stay bold in the sidebar; they keep.
- **Why one view:** Slack splits this across Activity, Unreads, Later and DMs. Its own design team found that thread replies, hidden from the channel, mark nothing unread, so they need a place to land: Catch up is that place from day one. One list you can finish is the calm version.
- **48a:** anyone who triages messages would want it (people who treat chat like email; people with ADHD).
- *Recommend: yes.* · new

❓ OK? Grouped by conversation or newest first?

**CH9 · Online dots** (audit D37)
- **v1:** you show as online whenever Moduo is open on any page, with a dot.
- **Proposed:** presence shows only inside Chat (sidebar avatars, members), with a personal switch "Show me as online", **on** by default. While you're in a Focus session you show as **Focusing** instead of online, so teammates know a DM will wait. Typing indicators stay (short-lived, one conversation).
- **Rejected:** no presence at all (Basecamp). At 2–5 people, knowing someone's around makes a DM feel safe.
- **48a:** people who dislike being visibly online get a switch.
- *Recommend: yes.* · changes v1

❓ OK?

### C · Chat knows the work

**CH10 · A message becomes a task through Tasks' capture** (frame 3, variant 2; audit D33; TV-U14, Tasks 93)
- **`T` on a message** (or ⋯ → Make a task) opens the app's capture as Task: the message's words as the title draft, a **"From: Sofia's message in Acme"** chip, and the destination set to the channel's linked project (Inbox otherwise).
- ⏎ creates it and links both ways: the message shows **"Became a task: ○ Get logo SVGs from Anna · Today"**, live; the task's Linked shows the message.
- `/task` in the composer does the same from a line you're typing (CH14).
- **v1:** a silent one-click Inbox task with no link back.
- **48a:** everyone; this is the connection the brief sells.
- *Recommend: yes.* · changes v1

❓ OK?

**CH11 · The work shows its conversations** (a proposal that touches Tasks and Notes; audit D18)
- **A linked channel shows on its project or client:** the project's overview and the client's hub get a line "Conversation: Acme · 3 new" that opens it beside the work.
- **A message that mentions an item** leaves a quiet line in the item's Linked: "Mentioned in Acme · Oct 12" (one line per conversation, not per message). Only people who can read that conversation see the line; nobody else learns it exists.
- **No "Discuss in chat" button on items:** discussing one item happens in its comments (the boundary).
- **For Maciej, because it touches other modules:** Tasks' project overview and Notes' Linked would show these lines. Recorded as a proposal; the Notes re-plan decides its side.
- **48a:** anyone using the spine; it's the moat applied to chat.
- *Recommend: yes, as a proposal.* · new

❓ OK to propose?

**CH12 · Threads stay, and open on the right** (frame 3; audit D17)
- **One level of threads**, as in v1: "3 replies · Last reply 11:02 AM" under the message.
- **A thread opens in the right panel as an item** with a back arrow (Tasks 72a), not as a separate panel mode. Esc steps back.
- **"Also send to Acme"** under the reply box posts the reply in the channel too.
- **Who hears a reply** (CH6): the message's author, earlier repliers, anyone mentioned, plus a "Stop following" on the thread.
- **Why chat keeps threads while task comments have none:** a task *is* the thread its comments hang on; a channel holds many topics at once.
- **48a:** busy channels (a hackathon help desk, an agency's client channel) need them; small DMs never show them.
- *Recommend: yes.* · keeps v1, moves where it opens

❓ OK?

**CH13 · Decisions** *(new topic; opening call)*
- **The problem:** "Slack buries decisions" is the most-repeated complaint from founders and PMs in the research; v1 only has pins.
- **Proposed:** "Mark as decision" on a message (⋯, or `D`). It gets a quiet "Decision" label, is listed in the conversation's Details, and, in a linked channel, shows on the project's overview or the client's hub ("Decided in Acme · Oct 12: price at $20").
- **Not:** a decision log, an approval workflow, or a new kind of item.
- **48a:** duos, PMs, agencies and dev teams all lose decisions in chat.
- *Recommend: yes, in the teams-of-2–5 cut (not the hackathon MVP).* · new

❓ OK? Round 2 then designs it.

### D · One app, one grammar

**CH14 · The grammar in chat** (frame 4; audit D10, D12)
- **`@`** finds people first, then things: teams, projects, tasks, notes, contacts, events, emails and other conversations.
- **`#`** tags (reverses v1, where `#` linked items). Slack habit says `#channel`; Moduo's `#` already means tags in tasks, notes and search, so a channel is reached with `@` like any other thing.
- **`/`** runs commands: `/task`, `/note`, `/event` (create it, linked here), `/today`, `/tomorrow`, `/date` (a date chip), `/remind` (CH8's Later, for the conversation).
- **`:`** for emoji stays (it's not part of the grammar).
- **48a:** Slack users relearn one key; everyone gets one grammar across the app.
- *Recommend: yes.* · changes v1

❓ OK?

**CH15 · One editor: what you type is what you'll see**
- **v1:** a plain text box with `**bold**`-style markup; a picked item reads as raw words until sent.
- **Proposed:** the composer is the app's shared editor (the one capture and notes use): references appear as chips while you type, formatting shows as you type, and markdown shortcuts still work (`**`, `` ` ``, `>`). ⏎ sends, ⇧⏎ makes a new line. Pasting stays clean text.
- **Why it's a call:** you'd feel it every message. The rest (storage, the one grammar) is technical and in §6.
- *Recommend: yes.* · changes v1

❓ OK?

**CH16 · Reactions** (frame 4, variant 3; audit D13, D14; Tasks 88)
- **The six fixed reactions** every comment has (👍 ✅ 👀 🙏 ❤️ 😄) are the one-click row on hover; **any emoji** sits behind ☺. Comments keep only the six (88 unchanged).
- **Reactions never notify** (as today, and as in Tasks).
- **Alternative:** the six only, for strict sameness. I'd keep the full picker: chat is where people are social, and a hackathon team will want 🎉 and 🚀.
- *Recommend: six + any emoji behind ☺.* · changes v1 slightly

❓ Six + any, or six only?

**CH17 · Files in chat** (audit D38)
- Paste, drop or attach: images and PDFs preview inline; everything else is a file chip. Through the app's attachments pipeline (50 MB per file today). Files are listed in the conversation's Details.
- **Every role's week needs it** (screenshots, logos, decks); without it, teams keep WhatsApp or Discord open beside Moduo.
- *Recommend: yes, in the hackathon MVP.* · new

❓ OK, and in the MVP?

**CH18 · Agents in chat** (frame 6; audit D15, D16; Tasks 52, brand 40)
- **Shown as the person who runs them:** "Alex Rivera · via Claude", Alex's own avatar. No bot glyph, no "App" badge, no colour.
- **What keys can read:** public channels, as in v1. **New:** a per-key switch "Include private channels I'm in", off by default; the channel's Details then say "An app of Alex's can read this". **Direct messages stay invisible to every key**: the other person never agreed.
- **48a:** delegates that name their person read honestly to everyone.
- *Recommend: yes.* · changes v1

❓ OK?

**CH19 · Guests: later, and one model for the whole app** *(opening call)*
- **The need:** agencies talk to clients, PMs to stakeholders, hackathons to judges and sponsors. A guest would see one conversation (and later one project or note) and nothing else, without taking a seat.
- **Why later:** permissions v1 left guests out; a chat-only guest would have to be rebuilt when Notes and Tasks want the same.
- **Proposed:** not in this plan's MVP. Planned with the permissions model as one guest for every module, after the hackathon.
- *Recommend: later, one model.* · new (later)

❓ OK?

### E · The hackathon

The hackathon readiness plan (`t/maciej/hackathon-plan`) owns workspaces, invites, organizer access, the plan gate and after-event data (§1.5). These calls are Chat's questions; CH22 and CH25 are shared with that plan, and whichever wins there binds here.

**★ CH20 · The facts** — they set the MVP cut.
1. **When** is it? (Everything else is cut to fit.)
2. **How many teams, and how many people per team?** 20 teams and 100 change which structure works.
3. **On site, online, or both?** Online makes calls a must (out of scope here); on site makes phones matter (announcements on the move).
4. **Who organizes, and what is Moduo's role** (tool partner, sponsor, co-organizer)?
5. **Polish, English or both?** The app is English only today.
6. **Are there prizes** (so teams compete and need privacy from each other)?
7. **Are teams formed before the event or on the day?**

❓ What do you know so far?

**CH21 · Do participants already live in the organizers' Discord?**
- If **yes**, the realistic first step is structure D (CH22): Discord keeps the event's announcements and help desk, and Moduo is each team's workspace and chat. The smallest MVP, and the least of a Moduo moment.
- If **no**, Moduo can hold the whole event (structure C).
- ❓ Yes, no, or unknown?

**★ CH22 · Where team chat and the organizers' announcements live** (frame 5; [research/hackathon.md](./research/hackathon.md) §2.2)

| | What it is | For participants | For organizers | Costs |
| --- | --- | --- | --- | --- |
| **A · One workspace** | Everyone in one; each team a Team with a private channel, project and notes | One place | Lowest effort for chat | 80+ people in a product tuned for 2–5; teams' ideas one wrong default from leaking to competitors; teams must move their work out afterwards |
| **B · A workspace per team, organizers in each** | Announcements posted into every team workspace | Cleanest | Heavy: post N times, answer in N places, N seats | Needs "post to all" and one inbox across workspaces |
| **C · An event workspace + a workspace per team** | Event: announcements, help desk, team-finding. Team: its chat, tasks, notes | Two workspaces; event news still reaches them anywhere (CH6) | One place to post and answer | Chat must ping across workspaces (CH6 already proposes it) |
| **D · Discord for the event, Moduo per team** | Organizers keep Discord | Two tools again | Nothing to move | No Moduo moment for announcements or help |

- **Recommended: C.** Teams own their workspace (it survives the event, so they can keep using Moduo), privacy between teams is the workspace wall, and organizers run one place. Later, if it proves useful, C grows into "an event channel shown read-only inside every team workspace" (Discord's followed channels), which agencies and teachers would also want (48a).
- **D if** CH21 is yes or the date is close.
- *Recommend: C (D as the fallback).* Shared with the hackathon plan.

❓ C?

**CH23 · Announcements that can't be missed**
- **An announcement channel** (v1's "Only managers can post", kept) pings everyone once per post, **even on "Mentions and replies"**; only "Nothing" silences it. It reaches people in any workspace (CH6, CH22 C).
- **Organizers see a quiet "Seen by 38 of 41"** under their own post; nobody else sees counts, and there are no per-person read receipts.
- **Scheduled posts** ("Submissions close in 1 hour" written the night before): should-have for the event.
- *Recommend: yes; scheduled posts if the date allows.* · changes v1

❓ OK?

**CH24 · A help desk** (new; [research/hackathon.md](./research/hackathon.md) §1.5, §2.1)
- **The pattern that works at hackathons:** mentors pick from a queue instead of being pinged ("pull, don't push").
- **Proposed, built on what Tasks already has:** a "Help desk" channel where each question is a thread with a state: **Open → Someone's on it → Answered**. A mentor takes one (Tasks' claim); the asker sees who's on it; organizers see every open question in one list. "Add to FAQ" copies the answer into a pinned FAQ note, so the next team gets it as a card in one click.
- Questions are public by default (others learn); "Only organizers" keeps a team's code question private.
- **48a:** agencies (client requests), a dev team's support rotation and teachers' office hours would all want claimable questions; that's why it's built on Teams and claims, not as a hackathon-only ticket system.
- *Recommend: yes, in the hackathon MVP if structure C or A; not needed under D.* · new

❓ OK?

**CH25 · Chat in event workspaces, whoever owns them** (audit D35; shared with the hackathon plan)
- **v1:** chat works only when the workspace owner is on Duo, Team or Founder. Hackathon workspaces' owners won't be.
- **Proposed:** keep the owner's-plan rule, and add a second way in: a workspace can carry its own chat entitlement **with an end date**, set by Moduo staff (an event or a comp). After it ends, history stays readable, posting stops, and the owner sees "Keep chatting on Duo or Team".
- **Rejected:** ungating chat in "event" workspaces with no end (a loophole), and spending each team owner's one trial on the event.
- *Recommend: yes.* · changes v1

❓ OK?

**CH26 · How the MVP is cut** (the exact cut waits for CH20's date)
- **Hackathon MVP** (in order): CH6 pings that leave the app · CH17 files · CH23 announcements · CH25 chat in event workspaces · CH24 help desk · CH14/CH15 one grammar and one editor · CH10 make a task · CH5 the left panel · CH8 Catch up · moderation basics (remove a message or a person; pinned code of conduct).
- **Then teams of 2–5:** CH2 linking and CH11 · CH13 decisions · CH7 Focus and quiet hours · CH9 presence · CH12 threads in the panel · CH18 agents · search in ⌘K · the Home widgets · the MCP tools.
- **Later:** guests (CH19), link previews for outside sites, polls, scheduled sends beyond announcements, integrations, calls.
- *Recommend: this order.*

❓ OK?

## 9. What happens next
