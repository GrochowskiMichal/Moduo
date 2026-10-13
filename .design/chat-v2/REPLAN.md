# Chat v2 — the re-plan

> **Status (2026-10-13): round 1 answered; round 1b sent (re-asks), two research lanes running for round 2.**
>
> - **Decided:** CH1–CH11, CH13–CH19, CH22 (no event workspace: Team plans per team), CH25, CH27, CH28. CH12 (threads) not accepted → CH30. CH24 parked. Facts: CH20 (≤ ~100 people, Polish + English, app in English, date unknown), CH21.
> - **Open:** CH3a, CH4a, CH16a, CH16b, CH23a, CH26a, CH28a, CH28b; with round 2's prototype: ★ CH29 (the look, waiting on its research lane), ★ CH30 (replies, not threads: proposal written).
> - **Maciej on the look:** v1's interface is a placeholder; nothing carries over unconfirmed; he likes Slack's and Discord's looks.
> - **Research lanes** ([`research/`](./research/)): six landed and folded in (early-decisions audit, role journeys, competitor structure, hackathon, visual audit → §5, current state → §1.3 B and §6 #15–18). **Threads** landed (→ CH30). Running: **visual competitors** (→ CH29).
> - **Research data in the shared local database** (kept for round 2's live checks; remove when the plan is done): workspace **"Chat replan research"** `669be464-0b9a-4d84-8537-544ac04dba5f` (10 channels, 3,032 messages, one task) and a third local user `third@moduo.local`. Full ledger and a cleanup sketch: [current state](./research/current-state.md), last section. `dev@moduo.local`'s plan is back to `free` (checked).
> - **Prototype:** [`prototypes/round-1.html`](./prototypes/round-1.html) (keys 1–7 frames, V variants; serve the folder over http to see the Geist font).
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

### 1.1 The root cause

Chat v1 was built in one session on 2026-10-06 from one ask: "Slack/Discord-class messaging… end to end… production ready" ([`specs/chat.md`](../../specs/chat.md)). It came before Tasks v3 decided how the whole app works. So it is **a Slack built beside Moduo instead of inside it.**

Every reversal the [decisions audit](./research/early-decisions-audit.md) found has that one shape: **v1 rebuilt, Slack's way, a piece Moduo now has once for the whole app.**

| v1 built its own… | Moduo's one way (binding) | Audit |
| --- | --- | --- |
| `#` to link items (Slack's channel token) | `@` people then things, `#` tags, `/` commands (Tasks 33, RF-1) | D10, D12 |
| A text box with `**markup**` | The shared editor with chips as you type (TV-U14, Notes) | D8 |
| Chips with the title frozen at send time | References: live, "Private item", "Deleted …" (RF-1) | D11 |
| A bot glyph and an "App" badge | "Alex · via Claude", no AI styling (Tasks 52, brand 40) | D15 |
| Its own right-panel modes with ✕ | The title-row dropdown and "← item" (SH-1, 72a) | D20 |
| Search as a right-panel mode; a ⌘J switcher | The toolbar grammar, the app search, ⌘K | D19, D21 |
| "Create task" with no window and no link back | The app's capture with "From:" (TV-U14, Tasks 93) | D33 |
| Coloured pills meaning two different counts | One count language, NavRow (rule 45, DS-3) | D30 |
| Its own notification logic: a tab badge, nothing leaves the app | The notification table and its channels (Tasks 73, 80) | D6, D31 |
| "Star", a notes-to-self DM | "Pin to sidebar" (Tasks 29b), capture (90b: one way per job) | D23, D26 |
| A confirm toast before deleting | Undo for 8 seconds (DF-5) | D7 |
| Free emoji | Six fixed reactions on comments (Tasks 88) | D13 |

**A second shape: the island.** A channel knows nothing about a project or a client; a message that mentions a task leaves no trace on the task; conversations aren't in ⌘K; Chat isn't in the panel registry or the capture registry. Chat talks *about* the work but never *with* it, and that's the one place Moduo should beat Slack.

**A third, smaller one: promises the server doesn't keep** (audit D36, D4): the create dialog says "you can add managers later", but nothing adds one; the announcement switch exists only when creating a channel; "Manage any channel" is never read; "Start calls" switches a feature that doesn't exist.

**So the re-plan keeps v1's engine and rebuilds everything a person touches on Tasks v3's pieces**, then adds what makes chat reach you (CH6, CH8) and know the work (CH2, CH10, CH11).

### 1.2 What is genuinely strong (keep)

**Product:**
- **Quiet defaults**, already: "Mentions" is the default level; reactions and edits never notify; muted conversations never count; the bell gets only `@you`, `@channel` and thread replies.
- **Announcement channels, channel managers and a small role grid** (PERM-7): exactly what hackathon organizers need, once the screens catch up.
- **Threads, pins, Mark unread, the "New" divider, optimistic sends with retry**, resync after sleep: the everyday mechanics are right.
- **Agents see public channels only, through their own scope** (None by default): the safe default.
- **⌘7** is Chat's number, and Tasks 90b already uses it for the Message capture type.
- **The Home widget's job,** "what needs you first", is the right one.

**Platform** (audit D39): every write is a server op that re-checks membership and the plan; reactions and thread counts live on the message row and deletes are soft, so every live change is one Realtime update that respects row-level security; sends are idempotent; the pure logic is unit-tested.

**The engine is sound. What's wrong is that it was built as its own app.**

### 1.3 What's broken, in five kinds

*From the decisions audit, role journeys, competitors and hackathon lanes; the current-state lane (code + a live look) and the visual audit add their findings here as they land.*

**A · Structure: an island.** Channels and DMs unrelated to anything (CH2); a notes-to-self DM beside capture (CH3); `general` joined per device, so leaving it on one computer doesn't stick and `@channel` misses anyone who hasn't opened Chat yet (audit D24).

**B · Trust: things that make people stop believing it** (ranked; [current state](./research/current-state.md) §7, seen live on the local stack with three people unless marked):
1. **A message that fails to send looks sent, then vanishes on reload.** The "Not sent · Retry" row can never show, and there's no outbox. A viewer's sends, refused by the server, look sent the same way. Only a toast says otherwise.
2. **Opening a channel marks everything read**, whatever you saw: 200 unread were cleared while only the newest 50 had loaded.
3. **The "New" line starts in the wrong place** when more than 50 are unread, then jumps as older messages load.
4. **Messages go missing:** one that shares a timestamp with a page boundary is never fetched (2,999 of 3,000 shown); after a reconnect with more than 50 new messages, the middle is missing for good (code).
5. **A direct message reaches you only if you look at the Chat tab.** Nothing leaves the app; the bell shows only the open workspace.
6. **Links that don't land:** a thread notification opens the channel, not the thread; a link to an older message opens the channel's bottom with no note.
7. **Counts that lie:** whoever creates a channel is set to "every message" without asking (the badge read "205 unread"); thread replies never count as unread anywhere; "Mark unread" counts only what's loaded.
8. **A composer where you can't post** (viewers, announcement channels); the send fails and, through #1, looks sent.
9. **Presence and typing fail silently** (everyone "Away" on the local stack).
10. **Search can't find people by name** and shows an error as "No messages match"; a full scan that slows as messages grow (410 ms at 3,000).
11. **Linked items go stale:** a chip keeps the title it had when sent and never shows a status.
12. **Settings that do nothing:** add a manager, turn announcement mode on later, "Manage any channel", "Start calls" (audit D36).
13. **"Create task from message" makes an Inbox task silently** with no link back; "Open" goes to Tasks, not to the task (audit D33).
14. **Delete asks first, then can't be undone**, against the app's undo rule (audit D7).

**Scale, measured:** a 3,000-message channel renders every message (no virtual list, ~119,000 page elements); a new message took ~3 s to appear there against ~0.1 s in a small channel; one incoming message causes 10 requests per open app.

**The module contract** ([current state](./research/current-state.md) §2): writes are ops and there's a manifest, and erasure on account deletion works. But most ops log no activity, nothing renders a trail, channels and messages aren't in the search registry (so they're absent from ⌘K, `@` and References), messages leave no spine links, and **chat isn't in the lossless export**.

**C · Capability gaps for a normal week** ([gap map](./research/role-journeys.md) §2): nothing leaves the app (#1 for every role); no files; no catch-up across conversations; nothing ties a conversation to a project or client; decisions live only as pins; no reminders or "later"; no quiet hours; for the hackathon, nothing reaches across workspaces, no help desk, invites one email at a time.

**D · Visual seams:** the sidebar is Chat's own markup, not NavRow; coloured pills with two meanings; italics for deleted messages; `#` in front of channel names; the "App" badge (audit D27, D30). The visual audit's measurements go in §5.

**E · No way in.** Solo workspaces see a permanent upgrade tab (CH4); the automatic trial is Pro, which has no chat; hackathon workspaces' owners won't be on Duo (CH25); invites are one email at a time and sign-up is invite-only (the hackathon plan's).

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

```
Top bar (global):   modules · Focus timer · Help · bell · you
┌ Left: conversations ─┬ Centre: the conversation ─────────────────┬ Right: context ─────────────┐
│ Catch up         4   │ Toolbar: Acme  [● Acme rebrand · Active]   │ [Details ▾]                 │
│ ───────────────────  │   people 4 … Search · ⋯                    │  about this:                │
│ Pinned               │ Yesterday                                  │   Details (linked project   │
│  ● Acme          2   │  Alex: kickoff notes in [▢ Acme kickoff]   │   or client, people, pinned,│
│ Channels             │ Today                                      │   files, decisions, notify) │
│  ○ General           │  Sofia: [◐ Collect assets · Fri] is stuck  │  items (← back):            │
│  ● Launch v1         │    3 replies · last 11:02 AM               │   a thread, a person,       │
│  ▣ Acme client       │    Became a task: [○ Get logo SVGs · Today]│   a task, a note…           │
│  DS Design           │  Mike: [card: Draft homepage copy]         │                             │
│  🔒 Founders         │ ─── New ───                                │                             │
│ Direct messages      │  Sofia: call moved to [▢ Thu 4:00 PM]      │                             │
│  SO Sofia Ortiz  1   │ [composer: @ people/things · # tags · /]   │                             │
└──────────────────────┴────────────────────────────────────────────┴─────────────────────────────┘
Bottom bar (module tools): ◧ · Shortcuts · Search · Capture · New conversation · ◨
                           (Catch up swaps the centre for its mode row: Reply R · Done Space · Task T · Later H · Open ⏎ · More)
```

- **Conversations are channels and direct messages** (CH2, CH3). A channel can be **linked** to one project, client or team; then it shows that item's live state, capture files into it, and the item shows the conversation (CH11).
- **Catch up** is the one list of what's addressed to you, worked like Tasks' Inbox (CH8). It's also where everything that pinged you lands (CH6).
- **Everything a person touches is Tasks v3's piece:** the grammar and editor (CH14, CH15), References in messages, the capture for tasks (CH10), the panel dropdown, the kit, the notification table.
- **The hackathon needs no special tools** (CH22: each team in its own workspace); the help desk is parked (CH24).

## 3. One product, every role

From [research/role-journeys.md](./research/role-journeys.md) (a normal week per role, 26 capabilities, sources) and [research/hackathon.md](./research/hackathon.md) (how hackathons communicate today; what a Moduo hackathon needs).

| Role | Could they drop the old tool today? | What closes the gap |
| --- | --- | --- |
| **Hackathon team** (3–5, some strangers) | Inside the event, almost: the prepared workspace already beats a Discord group (tasks, notes, live chips) | Files (CH17), pings that leave the app (CH6), and event news reaching them (CH22) |
| **Hackathon organizer** | Not a Chat user in Moduo (CH22: no event workspace; each team gets its own workspace on a Team plan) | The hackathon plan: handing out workspaces and plans, onboarding at scale |
| **Duo founders** | The at-desk work talk, yes; the phone layer, no | Pings outside the app (CH6), conversation ↔ contact and project (CH2), decisions (CH13); mobile is a later plan |
| **Developer team of 3–5** | Once catch-up, notifications, files and integrations exist | CH6, CH8, CH17; integrations and huddles later |
| **PM** | Inside the team; not toward a stakeholder who lives in Slack or Teams | CH2 (conversations on projects), CH8, CH13; guests later (CH19) |
| **Agency with clients** | Internal chat, yes; client chat, no (clients won't log in; guests don't exist) | Guests (CH19); until then, email in Moduo and Meet's guest join |
| **Solo founder + a contractor** | Chat isn't the tool at 1 + 1: comments, email and Meet cover it | Nothing to build; Chat stays out of one-person workspaces (CH4) |

**The two themes behind most gaps:**
1. **Chat doesn't reach you.** In v1 a direct message reaches you only if you're looking at the Chat tab: nothing leaves the app, and the bell only shows the workspace you're in. This is gap #1 for every role.
2. **Chat doesn't know the work.** A conversation about a project or a client can't be found from that project or client; a decision lives only as a pin. Linking the two is the spine applied to chat, and the one thing Slack can't copy.

**The risk no Chat call closes: no phone.** Every competitor treats the phone as the place people triage messages; duos and agencies' clients live on WhatsApp. Mobile has its own plan later (a constraint of this re-plan). Until then, CH6's OS and browser notifications and CH23's announcements are the mitigation, and the hackathon plan owns any phone fallback for announcements at the venue.

**The hackathon** (CH20–CH22, answered): at most ~100 people, Polish and English (the app stays English), no event workspace — each team gets its own workspace on a Team plan. So Chat's hackathon job is simply to be the best team chat for a weekend; getting people in and handing out plans is the hackathon plan's.

**Outside the target roles (48a):** pings that leave the app, files, catch-up, reminders on messages and do-not-disturb hours are universal (households, clubs, classes would all want them). Announcements across workspaces and a claimable help desk are event-shaped, but agencies (a workspace per client), teachers and accelerators would want the same two pieces, so they're designed as general tools, not hackathon features.

## 4. The views — today and their target

*Rounds 2a/2b.*

## 5. The visual north star, applied to Chat

From the [visual audit](./research/visual-audit.md): 38 issues measured in the chat stories (dark, dense, light, blue accent) and a read-only look at the live app.

**The headline.** Chat v1 is calm and mostly token-clean: no blur, no raw hex, reveals that fade, the accent kept off the rail. But it predates DS-6 and the Tasks v3 rules, and in four places it would teach the wrong thing if another module copied it:
1. **Its right panel isn't the shared one:** switched by toggles in the centre header, closed with ×, not in the registry (→ §6 #8).
2. **The message column ignores density:** at dense the rail and buttons shrink, but every message, avatar, reaction and divider stays the same size (→ CH27).
3. **A second avatar system:** grey for everyone, its own initials rule, so a self-DM shows "M" for "Me" (rule 43; → the kit's avatar).
4. **Five date formats**, none from the shared grammar (rule 41).

Under those: four hover languages, three focus recipes (rail rows show the browser's own blue outline), two hand-built floating surfaces, a mention that stacks four accent marks and loses its hover (→ CH28), five count styles, small caps in the rail and panels, 18 inline size overrides, hit targets under 24 px, and the loading and locked screens showing the shell's placeholder text "Feature tools panel".

**Every fix-list item breaks a rule that already exists**, so it goes into the rebuild with no call. The audit's §3 maps each chat piece to the kit (NavRow, GroupHeader, PersonAvatar, Chip for reactions, Toolbar, FeedComposer, EmptyState, PropertyRow, the date grammar).

**Chat-only pieces that need their own north-star definition** (round 2b, like Tasks' Timeline and run surfaces): the message row, the composer, the reaction bar, the thread line, the "New" line, the day divider, the typing line, the presence dot, jumbo emoji.

**What would spread if copied** (the audit's §4): panels switched from the centre header; fixed-size content inside a density-aware shell; a module-local avatar helper; ad-hoc date formatters; status accents that stack; the inverted pill as a count; border hover on pills and cards; a search field in the rail; a message row that isn't a Row.

## 6. Technical decisions I'm taking

Per the module-replan rules these are mine to decide. Each lands in `docs/decisions/chat.md` (a new area file) with its rejected alternative. Listed so nothing surprises anyone, and so Mike can follow what changes in his code.

1. **Keep the data shape** (audit D39): every write a `chat_op_*`; reactions and thread counts on the message row; soft deletes; idempotent sends. *Rejected:* child tables for reactions (a Realtime delete carries no row-level security).
2. **Chat moves onto the shared store pattern** (TV-D11a): a device cache per workspace, newest messages first, delta sync by `updated_at`, the Realtime merge, echo skip, one-field rollback; offline it reads from the cache and queues sends in an outbox. *Rejected:* v1's per-page fetch plus resync.
3. **One editor and one stored form** (CH15; audit D8, D11): the composer is the shared Lexical editor with RF-1's menus; a message stores references as `moduo://type/id` (RF-1-7's form), never a title; notification excerpts are built on the server from the stored form. v1 bodies are converted once by a migration. *Rejected:* a compatibility parser kept forever.
4. **References for chat** (RF-1): two new kinds, **message** (chip: author · first words; card: author · time · conversation · two lines; "Deleted message") and **conversation** (chip: icon · name; card: name · linked item · people · last message); "Private item" for anything you can't read.
5. **Spine links:** a linked channel is an `entity_links` row (conversation → project / company / contact / team, kind "conversation of"); a message that references an item writes one "mentioned in" link per conversation and item, readable only by people who can read the conversation. *Rejected:* one link per message (noise on busy items).
6. **Notifications through the app's one table and channels** (Tasks 73, 80; TV-D12 builds them): chat adds rows, not its own sender; the OS/browser delivery and the cross-workspace bell come from that work. *Rejected:* a chat-only notifier.
7. **Search:** messages get a server-side full-text index and join ⌘K's results as "Messages" and "Conversations"; "Search" in a conversation's toolbar finds inside it (audit D19, D21). *Rejected:* v1's substring match in a panel.
8. **Panel and capture registries:** Chat registers its panel views (Details; items: thread, person) and a **Message** capture type for ⌘7 (its destination is a conversation picker; ⏎ sends). *Rejected:* chat-only panel modes.
9. **General joins on the server** when someone joins the workspace; leaving is stored on the server (audit D24). *Rejected:* the per-device flag.
10. **Delete with Undo** (8 s, the body is blanked when the toast closes); a deleted message without replies disappears, one with replies shows "Deleted message" (audit D7, D27). *Rejected:* the confirm toast.
11. **PERM-7 made honest** (audit D4, D36): the ops read channel managers and "Manage any channel"; Details gets "Add manager" and the announcement switch; "Start calls" hides until Meet ships; chat's switches live once, in the role editor. *Rejected:* keeping two places that decide "who can create a channel".
12. **Agent posts are authored by the key's creator** with `via` = the key's name, as Tasks 52; mentions by an agent notify like a person's (audit D15). *Rejected:* the null author and "App" badge.
13. **No history limit.** Everything stays searchable for as long as the workspace exists (Slack's free plan hides older than 90 days and deletes after a year).
14. **Chat gets its own key table**, collision-checked against Tasks' keymap (audit D22): ⌥↑↓ previous/next conversation, ⌥⇧↑↓ next unread (a listed scope-separated collision), ↑ edits your last message, `R` `Space` `T` `H` in Catch up, `T` on a selected message (`T` is Today on the Timeline: a separate scope, listed as accepted).
15. **Every chat op logs an attributed activity row** (edit, delete, react, pin, rename, topic, join, leave, members, managers), and conversations get a quiet history in Details; channels and messages register in the search registry (module contract). *Rejected:* logging only what notifies (v1).
16. **Chat joins the lossless export** (the brief's launch-day promise): every conversation you can read, with threads, reactions and file links, as JSON plus a readable Markdown per conversation. *Rejected:* leaving chat out (v1).
17. **Reading is what you saw:** the read mark moves to the last message that was on screen, not to "now"; pages fetch by (time, id) so equal timestamps can't fall between pages; after a reconnect the store fills every gap before showing the window; a failed send stays in the conversation as "Not sent · Retry" from the outbox. *Rejected:* v1's 600 ms "mark all read" and 50-message resync.
18. **Large conversations are virtualised** (the Tasks TV-D11b approach) with a perf fixture of 10,000 messages in one channel against the 200 ms budget. *Rejected:* rendering every loaded message.

## 7. What Chat waits on from the Tasks v3 build

| Chat needs | From | State (2026-10-13) |
| --- | --- | --- |
| The panel dropdown and "← item" stack; the capture shell with ⌘1–7 | SH-1 | Landed |
| The kit (NavRow, GroupHeader, MetaCount, Chip, EmptyState, Feed) | DS-6 | Landed |
| References, the grammar, the editor's menus | RF-1, TV-U14 | Landed |
| The shared store pattern | TV-D11a | Landed (Tasks' store; Chat builds its own on the pattern) |
| The six fixed reactions component | TV-U13 | Ready, not built |
| Notification channels (OS, browser, the menu-bar app), the table, reminders | TV-D12 | Ready, not built |
| `@Team` and claims (the help desk) | TV-D13 | Waits on TV-D12 |
| Time & region (quiet hours, message times) | TV-D14 | Ready, not built |
| One time engine (Focus holds pings; "Focusing") | TV-F6 | Ready, not built |
| Files: the upload pipeline and viewer | AT-2, AT-3 | AT-2 open (attachments session) |
| Agents' "via <key>" tool surface | TV-D16 | Waits on TV-D13 |

Chat's own blocks can start on what's landed (structure, editor, References, panel, store) while TV-D12, TV-D13 and AT-2 land; the spec orders them so.

## 8. The calls

**Round 1 (2026-10-13): the shape.** 28 calls (CH27–CH28 added after the visual audit).

**Round 1 answers (2026-10-13):** decided CH1, CH2, CH3, CH4, CH5, CH6, CH7, CH8, CH9, CH10, CH11, CH13, CH14, CH15, CH16, CH17, CH18, CH19, CH22 (no event workspace), CH25, CH27, CH28; facts recorded for CH20 and CH21; CH24 parked; CH12 not accepted (threads, to rethink).

| Status | Calls |
| --- | --- |
| ❓ Re-asked or follow-ups (group G below) | CH3a channel names, CH4a when the plan lacks chat, CH16a who configures reactions, CH16b custom emoji, CH23a announcement channels, CH26a the build order, CH28a presence colour, CH28b a shared "who's around" |
| ❓ New topics, next round with a prototype | CH29 the look (Slack/Discord-grade visuals on Tasks' kit), CH30 threads rethought |

**Also from Maciej (2026-10-13), on the look:** *"Also not sure if I like how the chat looks like right now, keep in mind that the current version was a placeholder and no stylistic decisions should carry over to the new version without reconsideration and confirmation that it's the best path forward — for me, the current chat module could be removed altogether and there's nothing worth saving it there. I like how discord and slack look, and this version currently simply looks bad for multiple reasons. I want you to go in-depth on the competition's visuals and present the best possible option, while still respecting the visual decisions made in the Tasks module and the shell of Moduo. If we can reuse any components that were decided in Tasks, we should."*
- **Recorded:** nothing from v1's interface carries over; every visual choice is re-made and confirmed (CH29). Research lane: [research/visual-competitors.md](./research/visual-competitors.md).
- **Agent's position on the rest of v1:** the screens go entirely. The database layer (tables, server ops, the one-row live updates) is sound and stays (§6 #1, a technical call; rejected: rebuilding the tables, which would cost weeks and fix nothing users see). Round 3 shrinks to "what in the database layer changes". ★ = load-bearing (CH1, CH2, CH6, CH8, CH20, CH22). Prototype: [`prototypes/round-1.html`](./prototypes/round-1.html) (keys 1–7 switch frames, V cycles variants).

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

✅ **Decided 2026-10-13:** yes.

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

✅ **Decided 2026-10-13:** B.

**CH3 · Names, and three small reversals** (audit D12, D23, D26)
- **Words:** the module is **Chat**; any channel or DM is a **conversation**; a named one for a group is a **channel**; one between people is a **direct message**, whether two people or up to nine (v1's "group DM" folds in).
- **Channel names stay as typed** ("Acme", "Launch v1"), not v1's forced `acme-launch` slugs (rule 40). A channel's icon says what it's about: the project's colour dot, the client's company icon, the team's mark, a lock for private, a plain bubble otherwise (frame 1). Fixed icons, never picked by people.
- **No `#` in front of channel names.** `#` means tags everywhere else in Moduo (CH14); `#design` the channel and `#design` the tag would look identical.
- **"Star" becomes "Pin to sidebar"** (Tasks 29b's word). A message pinned to a conversation keeps "Pin to conversation": the same idea (keep it at the top) at two places. *Alternative:* a different word for messages ("Keep at top"); I don't think the overlap confuses.
- **Notes to self (a DM with yourself) goes.** ⌘⇧K already captures into your Inbox, or a quick note with ⌘2; a third scratchpad splits what you meant to find later. Picking only yourself offers "Capture a note" instead.
- **48a:** names as typed and one meaning per symbol help everyone; Slack migrants lose `#channel` and the self-DM habit, and capture serves them better once learned.
- *Recommend: all five.* · changes v1

❓ OK? (any you'd keep as v1?)

✅ **Decided 2026-10-13:** yes, with a question: *"do we keep the no-spaces rule for the channel names that Discord and Slack use?"* → re-asked as **CH3a**.

**CH4 · Who sees Chat** (audit D2)
- **v1:** every workspace shows the Chat tab; below Duo it's an upgrade explainer.
- **Proposed:** Chat appears when a workspace has a **second member**. A one-person workspace never shows it (there's nobody to talk to). The upgrade lives where the need starts: inviting a second person, and Settings → Plans. A multi-person workspace below Duo (after a downgrade) keeps a locked tab: a plain empty state with one line and "Ask the owner", not v1's four-card marketing page.
- ⌘7 stays Chat's number (Tasks 90b uses it in the capture). When Chat is hidden, the numbers follow the visible tabs, as today.
- **48a:** solo people never wanted the tab; teams lose nothing.
- *Recommend: yes.* · changes v1

❓ OK?

✅ **Decided 2026-10-13:** yes. On the later addition (a plain screen instead of the four-card page): *"why? not sure if I understand, tell me more"* → re-asked as **CH4a**.

**CH5 · The left panel** (frame 1)
- **Order:** **Catch up** (CH8) · hairline · **Pinned** (only if you pinned something) · **Channels** · **Direct messages** · "+ New conversation".
- **Group headers** are the kit's GroupHeader, sentence case, collapsible: the same recipe as Tasks' areas.
- **Unread is weight** (the name turns bold). **A number appears only for what's addressed to you:** a DM's unread, your mentions in a channel, or every message in a channel you set to "Every message". One count style (rule 45), never a coloured pill.
- **Sorting:** channels alphabetical (they don't jump around); direct messages by most recent.
- **48a:** a calm sidebar suits everyone; heavy users still see bold names.
- *Recommend: yes.* · changes v1 (v1 has coloured pills, two count meanings, a Starred group)

❓ OK?

✅ **Decided 2026-10-13:** yes.

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

✅ **Decided 2026-10-13:** yes.

**CH7 · Per-conversation levels, `@channel` and `@Team`, Focus and quiet hours** (frame 7; audit D32)
- **Three levels, in plain words:** **Every message** · **Mentions and replies** (default) · **Nothing** (it still turns bold; never pings or counts).
- **`@channel`** reaches everyone in a channel once; only people whose role may "Mention everyone" can use it (PERM-7's switch, already there). **`@Team`** works in chat as in Tasks 54: one notice each, muted with the team.
- **Focus holds chat's pings** until the session ends, then they arrive together; the top bar says "3 held until Focus ends" (frame 7, variant 2). Nothing breaks through, not even DMs.
- **Quiet hours** (Settings → Notifications, in your Time & region zone): **off by default**, one switch with a range (e.g. 19:00–9:00), Basecamp's "Work Can Wait". Teammates see "Sofia's quiet hours · back 9:00" when they message you.
- **48a:** Focus holding pings is something only Moduo can offer; quiet hours suit anyone with a life.
- *Recommend: yes.* · changes v1

❓ OK? Should a DM break through Focus? (recommend no)

✅ **Decided 2026-10-13:** yes (a DM doesn't break through Focus).

**★ CH8 · Catch up: one place for what's addressed to you** (frame 2)
- **What it is:** the first row of the left panel. It lists only what CH6 would ping you for (DMs, `@you`, replies in your threads, announcements), grouped by conversation (variant: newest first).
- **It's a mode, like Tasks' Inbox triage** (Tasks 82b): the bottom bar shows **Reply `R` · Done `Space` · Task `T` · Later `H` · Open `⏎` · More**, then "4 left · Esc". The selected item opens in context on the right.
  - **Done (`Space`)** clears it (reading it in its conversation clears it too). `Space` because it's how Tasks completes a row; `E` already means "edit" in the key map.
  - **Task** opens the capture (CH10).
  - **Later** brings it back at a time you pick ("in 1 hour · this evening · tomorrow"), like Tasks' Snooze `H`. No separate "saved for later" list.
- **Empty:** "You're caught up." Channels with messages you weren't asked about stay bold in the sidebar; they keep.
- **Why one view:** Slack splits this across Activity, Unreads, Later and DMs. Its own design team found that thread replies, hidden from the channel, mark nothing unread, so they need a place to land: Catch up is that place from day one. One list you can finish is the calm version.
- **48a:** anyone who triages messages would want it (people who treat chat like email; people with ADHD).
- *Recommend: yes.* · new

❓ OK? Grouped by conversation or newest first?

✅ **Decided 2026-10-13:** yes (grouped by conversation, the recommendation; newest first stays a Display option).

**CH9 · Online dots** (audit D37)
- **v1:** you show as online whenever Moduo is open on any page, with a dot.
- **Proposed:** presence shows only inside Chat (sidebar avatars, members), with a personal switch "Show me as online", **on** by default. While you're in a Focus session you show as **Focusing** instead of online, so teammates know a DM will wait. Typing indicators stay (short-lived, one conversation).
- **Rejected:** no presence at all (Basecamp). At 2–5 people, knowing someone's around makes a DM feel safe.
- **48a:** people who dislike being visibly online get a switch.
- *Recommend: yes.* · changes v1

❓ OK?

✅ **Decided 2026-10-13:** yes.

### C · Chat knows the work

**CH10 · A message becomes a task through Tasks' capture** (frame 3, variant 2; audit D33; TV-U14, Tasks 93)
- **`T` on a message** (or ⋯ → Make a task) opens the app's capture as Task: the message's words as the title draft, a **"From: Sofia's message in Acme"** chip, and the destination set to the channel's linked project (Inbox otherwise).
- ⏎ creates it and links both ways: the message shows **"Became a task: ○ Get logo SVGs from Anna · Today"**, live; the task's Linked shows the message.
- `/task` in the composer does the same from a line you're typing (CH14).
- **v1:** a silent one-click Inbox task with no link back.
- **48a:** everyone; this is the connection the brief sells.
- *Recommend: yes.* · changes v1

❓ OK?

✅ **Decided 2026-10-13:** yes.

**CH11 · The work shows its conversations** (a proposal that touches Tasks and Notes; audit D18)
- **A linked channel shows on its project or client:** the project's overview and the client's hub get a line "Conversation: Acme · 3 new" that opens it beside the work.
- **A message that mentions an item** leaves a quiet line in the item's Linked: "Mentioned in Acme · Oct 12" (one line per conversation, not per message). Only people who can read that conversation see the line; nobody else learns it exists.
- **No "Discuss in chat" button on items:** discussing one item happens in its comments (the boundary).
- **For Maciej, because it touches other modules:** Tasks' project overview and Notes' Linked would show these lines. Recorded as a proposal; the Notes re-plan decides its side.
- **48a:** anyone using the spine; it's the moat applied to chat.
- *Recommend: yes, as a proposal.* · new

❓ OK to propose?

✅ **Decided 2026-10-13:** yes, propose it (to the Notes re-plan and for Tasks' project overview).

**CH12 · Threads stay, and open on the right** (frame 3; audit D17)
- **One level of threads**, as in v1: "3 replies · Last reply 11:02 AM" under the message.
- **A thread opens in the right panel as an item** with a back arrow (Tasks 72a), not as a separate panel mode. Esc steps back.
- **"Also send to Acme"** under the reply box posts the reply in the channel too.
- **Who hears a reply** (CH6): the message's author, earlier repliers, anyone mentioned, plus a "Stop following" on the thread.
- **Why chat keeps threads while task comments have none:** a task *is* the thread its comments hang on; a channel holds many topics at once.
- **48a:** busy channels (a hackathon help desk, an agency's client channel) need them; small DMs never show them.
- *Recommend: yes.* · keeps v1, moves where it opens

❓ OK?

✗ **Not accepted (2026-10-13), to rethink:** *"Threads is something that I don't necessarily like and want to rethink. I feel like: yes, a workspace needs threads to keep a conversation organized, but I've never been working with a company whose employees actually followed the rules required to keep it clean. It's always a mess, where half of the conversation is in a thread, and the other half is just messages under that thread. Discord had an attempt at solving it differently, making another section for threads and keeping them separate from messages — but that also doesn't really work for me — sometimes people don't know if their message is going to become a thread with multiple people involved. Any thoughts on that? How to solve that mess? Any ideas on how to keep the workspace chat organized? Any other workspace communicators that we could review to find ideas?"* → a research lane ([research/threads.md](./research/threads.md)) and **CH30** (round 2).

**CH13 · Decisions** *(new topic; opening call)*
- **The problem:** "Slack buries decisions" is the most-repeated complaint from founders and PMs in the research; v1 only has pins.
- **Proposed:** "Mark as decision" on a message (⋯, or `D`). It gets a quiet "Decision" label, is listed in the conversation's Details, and, in a linked channel, shows on the project's overview or the client's hub ("Decided in Acme · Oct 12: price at $20").
- **Not:** a decision log, an approval workflow, or a new kind of item.
- **48a:** duos, PMs, agencies and dev teams all lose decisions in chat.
- *Recommend: yes, in the teams-of-2–5 cut (not the hackathon MVP).* · new

❓ OK? Round 2 then designs it.

✅ **Decided 2026-10-13:** *"That's great."*

### D · One app, one grammar

**CH14 · The grammar in chat** (frame 4; audit D10, D12)
- **`@`** finds people first, then things: teams, projects, tasks, notes, contacts, events, emails and other conversations.
- **`#`** tags (reverses v1, where `#` linked items). Slack habit says `#channel`; Moduo's `#` already means tags in tasks, notes and search, so a channel is reached with `@` like any other thing.
- **`/`** runs commands: `/task`, `/note`, `/event` (create it, linked here), `/today`, `/tomorrow`, `/date` (a date chip), `/remind` (CH8's Later, for the conversation).
- **`:`** for emoji stays (it's not part of the grammar).
- **48a:** Slack users relearn one key; everyone gets one grammar across the app.
- *Recommend: yes.* · changes v1

❓ OK?

✅ **Decided 2026-10-13:** yes.

**CH15 · One editor: what you type is what you'll see**
- **v1:** a plain text box with `**bold**`-style markup; a picked item reads as raw words until sent.
- **Proposed:** the composer is the app's shared editor (the one capture and notes use): references appear as chips while you type, formatting shows as you type, and markdown shortcuts still work (`**`, `` ` ``, `>`). ⏎ sends, ⇧⏎ makes a new line. Pasting stays clean text.
- **Formatting buttons appear only when you select text** (⌘B, ⌘I, ⌘E as today); at rest the composer shows attach · `@` · emoji · send. v1 shows ten icons always, which fills the thread panel's whole width.
- **Why it's a call:** you'd feel it every message. The rest (storage, the one grammar) is technical and in §6.
- **48a:** people who never type markup get formatting they can see; people who do keep their shortcuts.
- *Recommend: yes.* · changes v1

❓ OK?

✅ **Decided 2026-10-13:** yes; the later addition (formatting buttons only when text is selected): *"ok, fair"*.

**CH16 · Reactions** (frame 4, variant 3; audit D13, D14; Tasks 88)
- **The six fixed reactions** every comment has (👍 ✅ 👀 🙏 ❤️ 😄) are the one-click row on hover; **any emoji** sits behind ☺. Comments keep only the six (88 unchanged).
- **Reactions never notify** (as today, and as in Tasks).
- **Alternative:** the six only, for strict sameness. I'd keep the full picker: chat is where people are social, and a hackathon team will want 🎉 and 🚀.
- **48a:** everyone reacts; the fixed row makes the common ones one click for people who never open a picker.
- *Recommend: six + any emoji behind ☺.* · changes v1 slightly

❓ Six + any, or six only?

✅ **Decided 2026-10-13:** six + any emoji, and more: *"ok, those should be configurable. We also need custom workspace emoji, everyone is using that."*
- **Reverses CH1's "no custom emoji".** → **CH16b** for the details.
- **"Configurable" amends Tasks 88** (six fixed, "nobody picks or adds their own") → **CH16a** asks who configures them and whether comments follow.

**CH17 · Files in chat** (audit D38)
- Paste, drop or attach: images and PDFs preview inline; everything else is a file chip. Through the app's attachments pipeline (50 MB per file today). Files are listed in the conversation's Details.
- **Every role's week needs it** (screenshots, logos, decks); without it, teams keep WhatsApp or Discord open beside Moduo.
- **48a:** universal; no group would skip it.
- *Recommend: yes, in the hackathon MVP.* · new

❓ OK, and in the MVP?

✅ **Decided 2026-10-13:** yes, in the MVP.

**CH18 · Agents in chat** (frame 6; audit D15, D16; Tasks 52, brand 40)
- **Shown as the person who runs them:** "Alex Rivera · via Claude", Alex's own avatar. No bot glyph, no "App" badge, no colour.
- **What keys can read:** public channels, as in v1. **New:** a per-key switch "Include private channels I'm in", off by default; the channel's Details then say "An app of Alex's can read this". **Direct messages stay invisible to every key**: the other person never agreed.
- **48a:** delegates that name their person read honestly to everyone.
- *Recommend: yes.* · changes v1

❓ OK?

✅ **Decided 2026-10-13:** yes.

**CH19 · Guests: later, and one model for the whole app** *(opening call)*
- **The need:** agencies talk to clients, PMs to stakeholders, hackathons to judges and sponsors. A guest would see one conversation (and later one project or note) and nothing else, without taking a seat.
- **Why later:** permissions v1 left guests out; a chat-only guest would have to be rebuilt when Notes and Tasks want the same.
- **Proposed:** not in this plan's MVP. Planned with the permissions model as one guest for every module, after the hackathon.
- **48a:** anyone client-facing (freelancers, consultants, teachers with parents) would want it; that's why it should be one app-wide model, not chat's.
- *Recommend: later, one model.* · new (later)

❓ OK?

✅ **Decided 2026-10-13:** yes.

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

✅ **Answered 2026-10-13:** *"no idea, probably ~100 people on the whole hackathon tops. polish and english as languages, but english is okay for the app. not sure how that info helps now"*
- **Recorded:** date unknown; at most ~100 people (about 20–25 teams of 4); the app stays English.
- **How it helps:** 100 people in team workspaces of 4–5 is well inside what Moduo is built for, so nothing in Chat needs to scale up for the event. The date stays the one open fact: until it's known, the build order (CH26) is a ranked list and the spec draws the hackathon line on it later.

**CH21 · Do participants already live in the organizers' Discord?**
- If **yes**, the realistic first step is structure D (CH22): Discord keeps the event's announcements and help desk, and Moduo is each team's workspace and chat. The smallest MVP, and the least of a Moduo moment.
- If **no**, Moduo can hold the whole event (structure C).
- ❓ Yes, no, or unknown?

✅ **Answered 2026-10-13:** *"not necessarily."* Participants don't already live in an organizers' Discord.

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

✅ **Decided 2026-10-13:** none of A–D as drawn: *"no event workspace necessary, just team plans handed out to teams."*
- **What it means for Chat:** each team gets its own workspace on a Team plan; organizers don't run an event space in Moduo. Chat needs nothing that reaches across workspaces for the event (CH6's "in any workspace" stays, for people in several workspaces).
- **Consequences:** CH23 and CH24 lose their hackathon reason (re-asked below); CH25 is how the Team plans are handed out; the hackathon plan records the structure.

**CH23 · Announcements that can't be missed**
- **An announcement channel** (v1's "Only managers can post", kept) pings everyone once per post, **even on "Mentions and replies"**; only "Nothing" silences it. It reaches people in any workspace (CH6, CH22 C).
- **Organizers see a quiet "Seen by 38 of 41"** under their own post; nobody else sees counts, and there are no per-person read receipts.
- **Scheduled posts** ("Submissions close in 1 hour" written the night before): should-have for the event.
- **48a:** a founder's weekly update, an agency's client notice and a teacher's class news are the same thing: rare posts that must land once.
- *Recommend: yes; scheduled posts if the date allows.* · changes v1

❓ OK?

❓ **Answered 2026-10-13:** *"not sure what that means"* → re-asked as **CH23a**.

**CH24 · A help desk** (new; [research/hackathon.md](./research/hackathon.md) §1.5, §2.1)
- **The pattern that works at hackathons:** mentors pick from a queue instead of being pinged ("pull, don't push").
- **Proposed, built on what Tasks already has:** a "Help desk" channel where each question is a thread with a state: **Open → Someone's on it → Answered**. A mentor takes one (Tasks' claim); the asker sees who's on it; organizers see every open question in one list. "Add to FAQ" copies the answer into a pinned FAQ note, so the next team gets it as a card in one click.
- Questions are public by default (others learn); "Only organizers" keeps a team's code question private.
- **48a:** agencies (client requests), a dev team's support rotation and teachers' office hours would all want claimable questions; that's why it's built on Teams and claims, not as a hackathon-only ticket system.
- *Recommend: yes, in the hackathon MVP if structure C or A; not needed under D.* · new

❓ OK?

⏸ **Parked 2026-10-13:** *"no need for it, I think, but we could explore it."* Not in the hackathon cut (no event workspace); explored later as a general tool (agencies' client requests, a team's support rotation).

**CH25 · Chat in event workspaces, whoever owns them** (audit D35; shared with the hackathon plan)
- **v1:** chat works only when the workspace owner is on Duo, Team or Founder. Hackathon workspaces' owners won't be.
- **Proposed:** keep the owner's-plan rule, and add a second way in: a workspace can carry its own chat entitlement **with an end date**, set by Moduo staff (an event or a comp). After it ends, history stays readable, posting stops, and the owner sees "Keep chatting on Duo or Team".
- **Rejected:** ungating chat in "event" workspaces with no end (a loophole), and spending each team owner's one trial on the event.
- **48a:** the same dated grant serves classes, bootcamps and comps for early users.
- *Recommend: yes.* · changes v1

❓ OK?

✅ **Decided 2026-10-13:** *"yes, if we set it up."* A dated chat entitlement per workspace, set by Moduo staff, is how the hackathon's Team plans are handed out.

### G · Round 1b: re-asks and follow-ups *(2026-10-13)*

**CH3a · Spaces and capitals in channel names** *(re-asked: "do we keep the no-spaces rule for the channel names that Discord and Slack use?")*
- **Why Slack and Discord forbid spaces:** in their apps you type a channel *into text* as `#name`, and a token can't hold a space (Slack: lower case, no spaces, up to 80 characters; Discord turns spaces into hyphens). Teams and Google Chat, where you pick a channel instead of typing it, allow "Marketing team".
- **In Moduo you never type a channel's name as a token:** you pick it from the `@` menu and it becomes a chip (CH14). So the reason for the rule doesn't exist here.
- **Recommended: names as typed.** Spaces and capitals allowed, up to 80 characters, unique in the workspace ignoring case, spaces at the ends trimmed. A channel linked to "Acme rebrand" can carry the same name; "Launch v1" reads better than "launch-v1" (rule 40).
- **Rejected:** Slack's rule. Familiar to Slack users, but it exists only for a `#name` token Moduo doesn't have.
- **48a:** people who've never used Slack expect spaces; Slack users lose nothing.

❓ Names as typed?

**CH4a · What people see when the workspace's plan doesn't include chat** *(re-asked: "why? not sure if I understand, tell me more")*
- **When it happens:** chat works only while the workspace owner's plan includes it. It stops when the owner's Duo or Team ends (cancelled, a failed payment) or when a dated grant ends (the hackathon's Team plans, CH25). The members are still there, with all their conversations.
- **v1:** everyone, including members who can't pay for someone else's workspace, gets a full marketing page: "Upgrade to Duo — $20/mo for two", four feature cards.
- **Proposed:**
  - Chat stays in the top bar and **every conversation stays readable**: history never disappears (Slack's free plan hides anything older than 90 days, the most-cited reason people resent it).
  - The composer is replaced by one line. A member sees "Chat is paused: this workspace's plan doesn't include it. Anna can turn it back on." The owner sees the same line with "Choose a plan".
  - No marketing page; the same screen after a hackathon grant ends.
- **Rejected:** hiding Chat (people would think their messages were deleted); v1's upgrade page (sells to the wrong person, inside a work tool).
- **48a:** anyone whose plan lapses keeps their history; that's a trust point for everyone.

❓ OK?

**CH16a · Who configures the quick reactions** *(from "those should be configurable")*
- **Options:** (a) **per person**: your own one-click row, starting from Moduo's six (Slack lets each person set theirs); (b) **per workspace**: an admin picks the six for everyone; (c) a workspace default that each person can override.
- **Recommended: (a)**, set in Settings → Chat and from "Customize…" at the end of the hover row. The full picker, with the workspace's custom emoji (CH16b), is always one click further.
- **Comments follow:** one reaction component app-wide, so the same personal row appears on task and note comments. This amends Tasks 88 ("six fixed; nobody picks their own"). Reactions still never notify.
- **48a:** people who react a lot set their row once; everyone else never notices the setting.

❓ Per person? And do comments follow?

**CH16b · Custom workspace emoji** *(new, from "we also need custom workspace emoji")*
- **Adding one:** any member, unless a role switch (next to PERM-7's chat switches) restricts it. Upload a PNG, GIF or WebP up to 256 KB; it shows at up to 128 px. A name like `:shipit:` (letters, numbers, `_`, `-`).
- **Using them:** in messages, reactions and comments; `:` opens the picker with the workspace's own emoji first.
- **Quiet:** an animated one plays when you hover it, never on its own, and never with reduced motion.
- **Managing:** Settings → Chat → Custom emoji lists them with who added each; admins remove any. They're part of the export.
- **Timing — recommended: right after the hackathon cut.** A team of four can live a weekend without them; the work fits once files (CH17) exist, since it uses the same upload pipeline.
- **48a:** communities, classes and clubs use them as much as companies.

❓ OK? Right after the hackathon cut, or inside it?

**CH23a · Announcement channels, in plain words** *(re-asked: "not sure what that means")*
- **What it is:** a channel where only its managers can post, and everyone else reads and reacts. A founder's "Company news", a studio's "Client updates" for the team. v1 already has the switch ("Only managers can post").
- **With no event workspace (CH22),** the hackathon doesn't need anything more.
- **Recommended:** keep v1's switch, and let managers turn it on or off later, not only when creating the channel (§6 #11). A post there counts as addressed to everyone in it, so it pings once even on "Mentions and replies". Drop "Seen by N" and scheduled posts for now.
- **48a:** any team with one person sharing news to the rest.

❓ OK?

**CH26a · The build order, in plain words** *(re-asked: "not sure what you mean")*
- **What it means:** which parts get built first, so that if the hackathon comes before everything is done, the most important parts already exist.
- **With each team in its own workspace (CH22),** the hackathon needs what a team of four needs for a weekend, in this order:
  1. chat in the handed-out Team workspaces (CH25);
  2. messages that reach you outside the app (CH6);
  3. the new look: sidebar, message rows, editor (CH5, CH15, CH27, CH28, CH29);
  4. files and screenshots (CH17);
  5. links and "make a task" (CH14, CH10);
  6. Catch up (CH8);
  7. whatever replaces threads (CH30).
- **Then for teams of 2–5:** linked channels and "Mentioned in" (CH2, CH11), decisions (CH13), Focus holding pings and quiet hours (CH7), presence (CH9), agents (CH18), custom emoji (CH16b), search in ⌘K, the Home widgets, the MCP tools.
- **Later:** guests (CH19), the help desk (CH24), previews of outside links, polls, integrations, calls.

❓ OK?

**CH28a · Why not green presence dots** *(re-asked: "why green for presence dots?")*
- **v1 uses green**, like Slack, Discord and Teams. I proposed grey for three reasons:
  1. **The accent budget (rule 46):** green would be the only colour on the screen besides the accent; Moduo keeps hues for things people choose (project and label colours).
  2. **Contrast:** v1's green measured 2.17:1 on the light theme, under the 3:1 a dot needs.
  3. **Honesty:** "online" only means "Moduo is open", not "free to talk", and green reads as an invitation.
- **The case for green:** everyone recognises it at once.
- **Options:** (a) **grey**: a filled dot when here, an outline when away, a small moon in quiet hours, the Focus mark while focusing; (b) **green** when here, grey when away (the convention, with the light theme fixed).
- **Recommended: (a).** It's a taste call; the next prototype shows both side by side.

❓ Grey or green?

**CH28b · A shared "who's around" indicator** *(re-asked: "should we have a shared workspace activity/presence indicator, or is that useless?")*
- **What it would show:** the team's state at a glance: who's here, who's focusing on what, who's in quiet hours.
- **Where it could live:**
  - (a) **the top bar**, as a row of faces: always visible, on every screen. Costs a permanent social signal (pressure to look busy), and the top bar holds global tools, not people.
  - (b) **where you'd message someone:** each direct-message row and the person card on hover anywhere show "Focusing on Draft homepage copy · until 3:00 PM" or "Quiet hours · back 9:00".
  - (c) **Home:** a "Team now" line in Tasks' team widget (who's focusing on what), for when you want the overview.
- **Recommended: (b) and (c), not (a).** You see someone's state when you're deciding to message them, and on Home when you want the picture; nothing follows you around. It's the brief's "ambient, glanceable shared state", and "focusing on Draft homepage copy" is something only Moduo can show.
- **48a:** any team; one-person workspaces never see it.

❓ (b) and (c)?

**CH29 · The look** *(new topic; the next round's prototype answers it)* — Slack/Discord-grade visuals on Tasks' kit. A research lane is measuring Slack, Discord, Teams, Google Chat, Linear, Campfire, Zulip, Telegram, Element and Mattermost; the next prototype shows 2–3 complete variants, and lists every place a Tasks rule would have to bend.

**★ CH30 · Replies, not threads** *(rethought from CH12; [research/threads.md](./research/threads.md), prototype round 2)*
- **What the research found:** his complaint is the oldest known problem with chat threads, and Slack's own team wrote it up first (2017): it was unclear when to start a thread, so they "did both interchangeably". Replies shown *in* the channel made busy channels unreadable; replies taken *out* stopped marking anything unread, so Slack had to invent an "All Threads" view. Google Chat and Teams moved toward Slack's model in 2023–25 and still get the same complaint (a June 2026 Google forum post). Discord's separate threads keep the up-front choice. **Nobody has solved "people don't pick the right place up front".** The tools that cope best **remove the choice** (every answer is just a reply; the app shows the structure: iMessage, WhatsApp) or **let anyone fix it afterwards** (Zulip moves messages between topics).
- **Options weighed:** A Slack threads (v1) · B quote-replies in the stream only · C replies shown in place under their message · D people just reply and the app groups a chain once it gets tangled · E anyone tidies afterwards · F Zulip topics · G "wrap up" a chain with its outcome (Linear's resolve). Comparison table in the research file, §3.
- **Proposed: B as the base, D on top, E and G as tidy tools.**
  1. **One action, Reply.** A reply posts at the bottom, in time order, visible to everyone, with one muted line quoting what it answers (click it to jump). No "Reply in thread", no "Also send to channel", no second reply button.
  2. **A message with replies gets a small line:** "2 replies · Alex, Mike ›". Clicking it opens the whole chain in the right panel (root, replies in order, its own reply box), as an item with a back arrow.
  3. **A chain folds only when it gets tangled:** once it has 3+ replies *and* other talk has happened in between, its replies in the stream become **one row**, sitting where the latest reply is: "↳ Sofia's 'Can someone get the logo SVGs…' · 6 replies · Anna: Sent them… · 11:02". A new reply moves that row to the bottom, so an active side conversation is never buried. A chain that isn't tangled never folds: two people going back and forth just read as chat. Nothing folds above where you're reading.
  4. **Tidy afterwards**, from a message's ⋯ or with several selected: **Reply to…** (attach a stray message to its chain), **Move to a conversation**, **Make a task** (CH10), **Make a note** and **Move to a task's comments** (proposals for the Notes and Tasks plans), and **Wrap up** on a chain (it folds for good, showing the reply that settled it).
  5. **Per-person display option:** "Reply chains: Fold when tangled (default) · Always show every reply".
- **What reaches you (CH6, CH8):** "a reply in a thread you're in" becomes **"a reply in a chain you're in"** (you wrote its first message, replied, or were mentioned). A reply to your own message is always addressed to you. Catch up groups a chain's new replies as one item. Every reply is an ordinary message, so unread works as everywhere else (no separate thread unread, Slack's and Matrix's trap).
- **Why it fixes his two problems:** "half in, half out" is gone for anything sent with Reply, and "Reply to…" fixes anything sent without it; "I didn't know it would become a thread" is gone, because growing a side conversation is the app's job, by a rule anyone can predict.
- **The new part is the fold rule** (no product found folds only when tangled). It's tested in round 2's prototype and later on the research workspace's 3,000 messages; the threshold (2/3/5 replies) and whether a folded chain ever unfolds are tuned there.
- **Hackathon cut:** 1, 2 and the chain in the right panel (cheap; the database already stores what a message replies to). 3–5 follow in the teams-of-2–5 cut once the fold is tested.
- **48a:** this is how WhatsApp and iMessage already work, so it suits people who never used Slack; Slack users lose a checkbox, not a capability.
- *Recommend: yes.*

❓ OK? (prototype round 2, frame "Replies")

### F · Visual *(added after round 1 was sent, from the visual audit)*

**CH27 · How dense a conversation is**
- **v1:** one fixed layout; the app's density setting doesn't reach messages.
- **Proposed:** one layout (avatar and name once per group of messages, like Slack's default), that the app's density setting tightens like everything else (rule 44): avatar 32 → 24 px, the gutter and row padding narrower, body text 14 px at every step. **No chat-only "compact" toggle**: density stays one setting app-wide.
- **48a:** dense-UI people get it through the one setting they already use.
- *Recommend: yes.* · changes v1

❓ OK?

✅ **Decided 2026-10-13:** yes.

**CH28 · Mentions and the "New" line: one accent each** (rule 46)
- **v1:** a mention stacks a row tint, a bar and a pill (and the row stops showing hover); five accent marks can show at rest on one screen.
- **Proposed:** in a conversation only two things use the accent: the `@you` mark in the text, and the "New" line. No row tint, no bar. In the sidebar, unread is weight and the count is neutral (CH5). Presence dots stay neutral grey, not green.
- **48a:** calmer for everyone; mentions still stand out because they're the only accent in the text.
- *Recommend: yes.* · changes v1

❓ OK?

✅ **Decided 2026-10-13:** yes, with two questions: *"why green for presence dots? also, should we have a shared workspace activity/presence indicator, or is that useless?"* → **CH28a**, **CH28b**.

**CH26 · How the MVP is cut** (the exact cut waits for CH20's date)
- **Hackathon MVP** (in order): CH6 pings that leave the app · CH17 files · CH23 announcements · CH25 chat in event workspaces · CH24 help desk · CH14/CH15 one grammar and one editor · CH10 make a task · CH5 the left panel · CH8 Catch up · moderation basics (remove a message or a person; pinned code of conduct).
- **Then teams of 2–5:** CH2 linking and CH11 · CH13 decisions · CH7 Focus and quiet hours · CH9 presence · CH12 threads in the panel · CH18 agents · search in ⌘K · the Home widgets · the MCP tools.
- **Later:** guests (CH19), link previews for outside sites, polls, scheduled sends beyond announcements, integrations, calls.
- *Recommend: this order.*

❓ OK?

❓ **Answered 2026-10-13:** *"not sure what you mean"* → re-asked as **CH26a**.

## 9. What happens next

1. **Round 1** (this): Maciej answers CH1–CH26. The current-state and visual lanes fold into §1.3 and §5 as they land.
2. **Rounds 2a/2b:** every surface, view by view and state by state (empty, loading, error, read-only, offline, very large); Chat's panel views, capture type, References previews, MCP tools, notification rows, Home widgets, key map; a gap audit by a separate agent.
3. **Round 3:** v1's code, block by block: keep, re-scope, salvage or retire (for Mike).
4. **The spec** `specs/chat-v2.md` on Fable 5.1, with the hackathon MVP cut as explicit blocks, then decision entries, the supersession banner on `specs/chat.md`, a validator pass, and "Ready to execute".
