# CV-8a: Sidebar, toolbar and states; v1's screens retired (client, large)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-8a-sidebar-states`; record `docs/build/chat-v2/CV-8a.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 8a | **CV-8a** Sidebar, toolbar and states; v1's screens retired *(client, large)* | the left panel on NavRow (Catch up row, Pinned, Channels, Direct messages, "+ New conversation"; the row's empty trailing slot for a live huddle, §18), the conversation toolbar (its empty huddle slot, §18), every state of frame 7 (new, first open with the welcome, loading, archived, paused, offline, older history, viewer, non-manager, former member), the `/chat?c=&m=` adapter, the panel toggles in the bottom bar; **v1's `ui/*`, hooks, dialogs, stories and the Settings chat-caps panel deleted**; `tests/visual/chat-states` | AC1.8, AC10.3, AC10.9, AC2.1, AC6.5, AC14.1 | 7b, 5 |

**Depends on:** CV-7b (the composer) and CV-5 (Catch up items, for the count and the row).

## 2. What to build

**§1 Words, shape and who sees Chat**
- **Words:** the module is **Chat**; any channel or direct message is a **conversation**; a named one is a **channel**; one between two to nine people is a **direct message**. No `#` in front of channel names (`#` is tags). "Pin to sidebar" for conversations; "Pin to conversation" for messages. Notes-to-self conversations don't exist: picking only yourself in New conversation offers "Capture a note".
- **When the plan doesn't include chat** (a lapsed Duo, a grant that ended): Chat stays in the top bar, **every conversation stays readable and searchable**, and the composer is replaced by one line: "Chat is paused: this workspace's plan doesn't include it. Anna can turn it back on." The owner sees the same line with "Choose a plan". No marketing page (CH4a). Reading, marking read and unread, clearing Catch up, Later and Remind me, reacting, notification levels, Pin to sidebar, leaving, presence and statuses keep working, as do search, the Home widgets and read-only MCP; posting, editing, deleting, creating channels, files, moving, linking, decisions, pins and custom emoji wait for the plan.
- **A new workspace's first open** (CH37): "General" exists, everyone is in it, and the conversation shows a one-line welcome ("Reply to keep answers together · @ links anything in Moduo") that disappears after the first message. Frame 7.

**§2 The left panel** (prototype frame 1)
Order: **Catch up** (with its count) · hairline · **Pinned** (only when something is pinned) · **Channels** (alphabetical) · **Direct messages** (most recent first) · "+ New conversation". GroupHeaders are the kit's, sentence case, collapsible and remembered. **Unread is weight** (the name turns bold); **a number appears only for what's addressed to you** (a direct message's unread, your mentions and replies in a channel, every message in a channel you set to "Every message"); one count style, never a coloured pill; a muted conversation ("Nothing") still turns bold and never counts. Presence shows on direct-message rows and the person card (§10). Archived channels and Recently deleted open from the panel's ⋯, never as permanent rows.

**§3 The conversation: toolbar, stream and message row** (prototype frames 5, 6, 7)
- **Toolbar** (the kit's grammar): the glyph · the name · the linked item's chip with its live state (project colour · name · status; a client's company; a team's mark) · the people count · Search · ⋯. An announcement channel says so under the name.

**§18 Calls: the seams Chat leaves**
- **the conversation toolbar** keeps a slot before Search for "Start a huddle", hidden until calls exist;
- **a sidebar row** keeps a trailing slot beside the count for a live-huddle mark (who's in it);

**Edge cases this block handles** (§Edge cases)
- A viewer → reads, reacts, receives direct messages, can't post or start one; the composer shows a line, not a box; Catch up's `R` opens nothing to type into.
- A member posts in an announcement channel → refused with "Only managers post here · Reply privately"; a manager's post pings everyone once.
- A former member → their messages keep their name with a quiet label; their direct message reads "Jana left the workspace"; a deleted account reads "Former member".
- A workspace's plan lapses → every conversation stays readable and searchable; the composer shows the paused line; the owner sees "Choose a plan"; Catch up, widgets and read-only MCP keep working; a queued "Waiting to send" message becomes "Not sent · Retry".

## 3. Acceptance criteria

**AC1 — Trust pass (v1's fourteen trust bugs, REPLAN §1.3 B)**
- **AC1.8** a viewer or a non-manager in an announcement channel sees a line, not a box

**AC10 — Channels and permissions**
- **AC10.3** one glyph plus a lock
- **AC10.9** viewers react and receive, never post.

**AC2 — A hackathon team's weekend (the hackathon cut)**
- **AC2.1** a handed-out Team workspace shows Chat with General and the welcome line

**AC6 — An agency's week (internal chat)**
- **AC6.5** a contractor who left reads as a former member and their direct message stays readable

**AC14 — North star**
- **AC14.1** the stream matches round 5 in structure: 15 px text at every density, names by weight, 24/20/16 and 6 px rhythm, one left edge, centred day separators, the "New" pill and floating chip, fades at both ends, the one-row composer that grows

**Tests that prove them** (file · name · AC · plain English)

- `tests/visual/chat-states.spec.ts` · "every state" · proves AC1.8, AC10.9, AC6.5 · New channel, first open with the welcome, loading skeleton, archived, paused, offline, older history, viewer, non-manager in an announcement channel, former member: each matches round 5 frame 7 in structure.

Shared: `tests/visual/chat-stream.spec.ts` (CV-7a) already draws the stream at three densities; this block's states test covers the frames around it.

## 4. Decisions that bind it

- **Left panel** (§2, #32): the kit's `NavRow`, `GroupHeader`, `MetaCount` (`src/components/ui/`): Catch up (with its count) · hairline · Pinned (only when something is pinned) · Channels (alphabetical) · Direct messages (most recent first) · "+ New conversation"; GroupHeaders collapsible and remembered; unread is weight (NavRow's unread weight is a kit addition: story at three densities); a number only for what is addressed to you, from the store's slice. Archived channels and Recently deleted open from the panel's ⋯ (the Recently deleted list is CV-15's). The Catch up row shows its count; its view is CV-11's.
- **Seams** (§18, #37): the conversation toolbar keeps an empty slot before Search (a live-huddle button) and a sidebar row an empty trailing slot beside the count; props of your components, nothing else for calls.
- **3×3 layout** (Tasks 48b; spec §1): left = conversations, centre = the open conversation, right = context; the bottom bar holds Chat's tools (Search · Capture · New conversation) and each panel's toggle (`src/components/app/global-bottom-bar.tsx`, `bottom-bar-mode.ts`, `feature-panels-shell.tsx`, `right-panel.tsx`); no rails, strips or extra columns.
- **The page** `src/routes/pages/chat-page.tsx` becomes a thin adapter for `/chat?c=&m=` (no new routes; a chain opens from the message). The Chat tab shows with two or more members (a one-member workspace keeps it only while chat history exists); its badge in `app-chrome.tsx` reads the store, not `useChatBadge`.
- **Frame-7 states** (copy, #33): first open with the welcome line · loading skeleton · "This channel is archived. Everything stays readable and searchable." · paused ("Chat is paused: this workspace's plan doesn't include it. Anna can turn it back on."; the owner sees "Choose a plan") · "You're offline · reading from this device" · older history · viewer: "You can read this conversation but not post in it" · non-manager in an announcement channel: "Only managers post here · Reply privately" · former member: "Jana left the workspace" in the composer's place, "Former member" for a deleted account. A line replaces the composer; never a disabled box.
- **Delete v1** (spec row): `src/features/chat/ui/*`, `hooks/use-chat-module.ts`, `use-chat-badge.ts`, `use-chat-live.ts` (+ tests), `emoji.ts`, `markup.ts` (+ test), and `src/features/sharing/chat-caps-panel.tsx` with its mount in `src/features/settings/sections/access-section.tsx`; CV-15 builds the role editor's chat rows.

## 5. Files

New: `tests/visual/chat-states.spec.ts`; the sidebar and toolbar components under `src/features/chat/`; stories. Touch: `src/routes/pages/chat-page.tsx`, `src/components/app/app-chrome.tsx`, `src/components/ui/nav-row.tsx`, `src/lib/panel-registry.ts` (`PanelModule` gains `chat`; CV-8b registers its views). Keep `search.ts` (CV-19) and `widget.ts` (CV-22) until those blocks delete them.

## 6. From earlier blocks

CV-7b: the composer; CV-7a: the stream and kit additions; CV-5: Catch up counts; CV-3: the store (unread slice, plan state). Check that nothing outside `src/features/chat/ui/*` still imports what you delete (`grep` before deleting).

## 7. Watch out

- **Hot:** `src/routes/pages/chat-page.tsx` and `src/components/app/app-chrome.tsx` (shared shell).
- Tokens only; new chrome uses raw HTML, not the `src/tw` shim.
- **Hot files:** `src/routes/pages/chat-page.tsx` (rewritten as a thin adapter) and `src/components/app/app-chrome.tsx` (the Chat tab's badge reads `useChatBadge`, which this block retires). Keep edits there small; another builder may change them too.
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

Details, New conversation, Browse channels, the panel registry's views (CV-8b); the Catch up view (CV-11); linked chips (CV-13); the role editor's chat rows and Recently deleted (CV-15); presence shapes (CV-17).
