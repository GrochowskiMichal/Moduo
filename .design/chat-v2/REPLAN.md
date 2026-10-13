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

*Round 1, from the role-journeys and hackathon lanes.*

## 4. The views — today and their target

*Rounds 2a/2b.*

## 5. The visual north star, applied to Chat

*From the visual audit.*

## 6. Technical decisions I'm taking

*Round 1 onward. Each with the alternative I rejected.*

## 7. What Chat waits on from the Tasks v3 build

## 8. The calls

## 9. What happens next
