# CV-8a — Sidebar, toolbar and states; v1's screens retired

> Branch `t/maciej/cv-8a-sidebar-states` · head: see the hand-back · status: built, not landed
> Migration: none

## Delivered against the row

- **The left panel** (`src/features/chat/shell/chat-sidebar.tsx`, model `sidebar-model.ts`) on the kit's `NavRow` and the rail's section header: Catch up (its count) · hairline with the panel's ⋯ (Archived channels, a submenu) · Pinned (only when something is pinned; "Pin to sidebar" = the member's `starred`) · Channels (alphabetical) · Direct messages (most recent first) · "+ New conversation" (drawn when a handler is given: CV-8b). Sections collapse and are remembered on the device (`moduo.chat.sidebar.collapsed`). Unread is weight (bold label, sr-only ", unread"); a number only for `unread[c].addressed` (DM unread, mentions, replies in your chains, every message on "Every message"); "Nothing" turns bold and never counts. One glyph (a bubble) plus a lock for a private channel (AC10.3); DM rows show the person's avatar with an online dot. Each row takes `huddleOf(c)` in NavRow's always-visible indicator slot beside the count (§18 seam, empty).
- **Kit addition (#32):** `NavRow` gains `unread` (weight + foreground + sr-only "unread"), story `UnreadDensities` at three densities, registered in `kit.ts` / `kit.test.ts` (so `tests/visual/kit.spec.ts` reads it).
- **The toolbar** (`conversation-toolbar.tsx`): glyph · name (18 px semibold, no `#`) · `linked` slot (CV-13's chip) · "Archived" chip · people count · `huddle` slot before Search (§18, empty) · Search · ⋯ (Pin to sidebar / Unpin, Mark as read, Notify me about: Every message / Mentions and replies / Nothing, Archive / Unarchive for managers, Leave channel except General). An announcement channel reads "Announcements · only managers post" under the name.
- **Frame 7's states** (`composer-state.ts` decides, `conversation-states.tsx` draws): the start of a conversation (a new channel; General "Everyone in <workspace> is here."; a DM's people), General's one-line welcome until its first message, loading skeleton and older history ("Jump to present", both CV-7a's stream), and one line in the composer's place for archived ("This channel is archived. Everything stays readable and searchable." + Unarchive for managers), paused ("Chat is paused: this workspace's plan doesn't include it. <owner> can turn it back on."; the owner gets "Choose a plan" → Settings › Billing), viewer ("You can read this conversation but not post in it"), non-manager in an announcement channel ("Only managers post here · Reply privately"), former member ("Jana left the workspace"; a deleted account reads "Former member"), and a public channel you're not in ("You're not in this channel" + Join). Offline adds "You're offline · reading from this device" above the composer (sends wait). Message rows of someone who left keep their name with a quiet "former member" label (`stream/rows.tsx`).
- **A paused plan still reads** (`store/store.ts`): the store no longer stops at "locked"; it loads the sidebar (without bootstrapping General), counts, windows and live rows, and sets `snapshot.paused`; `sync` (rejoin, focus, online, manual) re-reads the plan, and a plan that comes back re-reads the sidebar making General if none exists. `ChatStatus` lost `"locked"`. The Conversations widget keeps showing conversations on a paused plan.
- **Posting vs. message tools:** `MessageStream` gains `canUseTools` (default `canWrite`): readers of a live conversation (a viewer, a paused plan, a non-member, a DM with someone who left) keep react, mark unread, copy link, make a task and reply; only posting, edit, delete, pinning (`MessageVerbs.onPin` is now optional) and typing into the composer need `canWrite`. An archived conversation draws no tools.
- **Short streams sit at the bottom** by the composer, as frame 7 draws them (`stream/message-stream.tsx`: the virtual list's box takes `mt-auto` in a column scroller; long streams are unchanged).
- **The page** `src/routes/pages/chat-page.tsx` is a thin adapter for `/chat?c=&m=` (`t` still accepted and lands on the chain's first message until CV-12); the screen is `features/chat/shell/chat-screen.tsx` on `useChatStore` / `useChatSnapshot` directly. An unknown `c` shows "That conversation isn't available" in the centre, without a toast or a redirect (CV-6b's deferral fixed: a notice from another workspace now switches there quietly).
- **The Chat tab** (`shell/chat-tab.ts`, moved from `hooks/use-chat-badge.ts`): the count, presence and dock badge as before, read from the store; the tab shows with two or more people in the workspace, a one-person workspace keeps it only while chat history exists (`chatTabShows`; an unloaded member list keeps it).
- **Panel registry:** `PanelModule` gains `chat` with no views yet (`src/features/chat/panel-views.ts`; CV-8b registers them). The right panel is hidden for now; the bottom bar's panel toggles are the app's.
- **v1 retired:** `src/features/chat/ui/*` (sidebar, header, composer, emoji picker, dialogs, thread/details/search panels, message list/item, locked page, stories), `hooks/use-chat-module.ts` (+ test), `use-chat-live.ts` (+ test), `use-chat-badge.ts` (moved), `emoji.ts`, `markup.ts` (+ test), the v1 parity harness `markup-v2/v1-compare.ts` / `v1-fixture.ts` (+ test, it parsed with `markup.ts`), and `src/features/sharing/chat-caps-panel.tsx` with its Settings › Access "Chat" entry. Stragglers repointed: `spine/reactions.test.ts` (the composer's picker), `dashboard/ui/widgets/chat-widget.tsx` (`@/lib/initials`), `notice-deliveries.tsx`, `lib/notices/ring.test.ts`, `global-css.test.ts`, `selection-guard.test.ts`, `scripts/check-text-rules.ts`.

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC1.8 | `tests/visual/chat-states.spec.ts` · "every state" (viewer and announcement lines, no box); `src/features/chat/shell/shell.test.ts` · "tells a non-manager in an announcement channel (AC1.8)" |
| AC10.3 | `tests/visual/chat-states.spec.ts` · "the left panel" (no `#`, the lock on Founders only) |
| AC10.9 | `chat-states.spec.ts` · "every state" (viewer: messages readable, a line, the hover toolbar's reactions; the same on a paused plan); `tests/chat-shell.spec.ts` · "an announcement channel and a viewer get a line, never a box" (a viewer reacts on the live stack); `shell.test.ts` · "gives a viewer a line, in channels and direct messages alike (AC10.9)" |
| AC2.1 | General's welcome: `chat-states.spec.ts` · "every state" ("first"); the grant side is CV-4's `chat_plan.test.sql` |
| AC6.5 | `chat-states.spec.ts` · "every state" ("former": name kept, the label, "Jana Lis left the workspace"); `shell.test.ts` · "says who left in a direct message with a former member (AC6.5)" |
| AC14.1 | CV-7a's `tests/visual/chat-stream.spec.ts` (passes on this branch); the frames around it: `chat-states.spec.ts` |
| §1 paused | `store/store.test.ts` · "a paused plan (CV-8a, CH4a) › still loads every conversation and its messages, and notices the plan coming back"; `chat-states.spec.ts` ("paused", "paused-owner") |
| §2 order and counts | `shell.test.ts` · "the left panel (spec §2)" (4 tests); `chat-states.spec.ts` · "the left panel" |
| Tab rule | `shell.test.ts` · "the Chat tab (spec §1)" |

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **A paused plan keeps the store running** · agent · the spec's paused state reads every conversation, and the store stopped at "locked" (CV-3) · rejected: a separate read-only loader for paused workspaces.
- **Rights read from `chat_caps_get` + `chat_channel_managers`** (`shell/use-chat-rights.ts`), only to choose a line over a box; the server still decides every write · agent · the same rows `chat_has_cap` reads; v1's "creator, owner or admin" guess was wrong for managers · rejected: a new RPC (a migration for UI hints).
- **"+ New conversation" is drawn only with a handler; CV-8b passes it** · agent · New conversation is CV-8b's; a row that does nothing is worse than a missing one for one landing · rejected: keeping v1's dialogs alive.
- **Catch up's row opens the first conversation waiting for you until CV-11's view** · agent · a row that goes nowhere is a dead control · rejected: an empty centre view.
- **Archived channels: a submenu of the hairline's ⋯** · agent · the spec's "open from the panel's ⋯, never as permanent rows" · rejected: a dialog (Browse channels is CV-8b's). Recently deleted is CV-15's; not shown.
- **The welcome copy is the spec's line** ("Reply to keep answers together · @ links anything in Moduo"), not frame 7's longer sentence · agent · the spec quote is binding.
- **"Reply privately" opens a direct message with the channel's managers** (up to eight) · agent · the line has to lead somewhere; the managers are who you'd reply to · rejected: a DM with the last poster.
- **"You're not in this channel · Join"** in the composer's place for a public channel you opened but haven't joined · agent · v1 had Join in the header; the server refuses a post from a non-member · rejected: posting to join implicitly.
- **Toolbar Search opens ⌘K** until find-in-conversation (CV-19) · agent · v1's search panel is retired with `ui/*`.
- **⌘J (switcher) and Esc (close the panel) are gone** with v1's dialogs and panels; ⌥↑/⌥↓ and ⌥⇧↑/⌥⇧↓ step through the open sections · agent.
- **A chain link (`t`, `onOpenChain`) keeps `t=` in the URL and lands on the chain's root** until CV-12 · agent · v1's thread panel is retired; CV-7a's key test expects `t=` · Reply / R change only the URL until then.
- **An announcement channel's composer area stays empty until its managers load** · agent · a manager must never see "Only managers post here" for a moment.
- **A link to a conversation the device copy doesn't hold shows the spinner while the screen reads from the device**, then "That conversation isn't available" · agent.
- **The right panel stays hidden** until CV-8b registers views · agent · `hideRight`, as frame 7's first/new states draw it closed.
- **The v1 parity harness went with `markup.ts`** (`v1-compare.ts`, `v1-fixture.ts`) · agent · the brief deletes `markup.ts`; the conversion ran (CV-1) and its SQL tests stay · rejected: copying the v1 parser in. `docs/build/chat-v2/drafts/check_v1_to_v2.ts` (a CV-0 one-off) no longer runs.
- **The Settings › Access "Chat" entry is removed** with `chat-caps-panel.tsx`; CV-15 builds the role editor's chat rows.

## Gotchas (area: ui)

- A chat person from the workspace list carries `former: false`; `composerLine` treats someone missing from both lists as a former member (a deleted account).
- `NavRow` spreads extra props onto its outer `div`, not the button: an `aria-label` there names nothing. Put words for screen readers inside the button (the kit's sr-only spans).

## For later blocks

- **CV-8b:** pass `onNewConversation` to `ChatSidebar` and wire the bottom bar's `onCreateNew` to it; register views in `features/chat/panel-views.ts` and drop `hideRight` in `chat-screen.tsx`; the toolbar's people count is only known for DMs and General (pass the member count from Details' load).
- **CV-11:** `ChatSidebar`'s `catchupCurrent` + `onOpenCatchup` are the seam for the Catch up view.
- **CV-12:** `onOpenChain` and the page's `t` land on the first message; replace with the chain panel.
- **CV-13:** `ConversationToolbar`'s `linked` slot takes the chip; frame 7's "new linked channel" start text ("Linked to the project …", Add people / Set a topic) is yours.
- **CV-15:** Recently deleted belongs in the hairline's ⋯ (`PanelHairline`); the role editor's chat rows replace the removed Access entry.
- **CV-17:** presence on DM rows is a plain online dot (`ConversationGlyph`); shapes and statuses are yours. The workspace presence topic still needs the plan, so presence is off while paused (`chat-tab.ts`, `chat-screen.tsx`).
- **CV-19:** the toolbar's Search opens ⌘K today (`onSearch`).
- **CV-3 / orchestrator:** `store.open()` doesn't refresh the "New" pill's read mark when you return to an already-loaded conversation (CV-7a's note) — it's in the store's `open()`, not this block's area; left as is.
- **Feed accessibility (shared with CV-7b):** sidebar rows announce ", unread" and their addressed count; the feed's own semantics are CV-7b's.
- **Presence wording ("Presence isn't available")** stays with CV-17.

## Manual checklist (step → expect → surface)

- [ ] Open Chat in a two-person workspace → General opens; the left panel reads Catch up · hairline · Channels · Direct messages; no `#` anywhere → web
- [ ] New workspace, first open → General shows "Everyone in … is here." and the welcome line; send a message → the welcome goes → web
- [ ] Pin a conversation from ⋯ → a Pinned section appears above Channels; unpin → it goes → web
- [ ] Have someone post in a channel on "Mentions and replies" → its name turns bold, no number; @mention you → a number → web
- [ ] Collapse Direct messages, reload → still collapsed → web
- [ ] Archive a channel (as its manager) → the composer becomes the archived line with Unarchive; the channel moves to the hairline ⋯ › Archived channels → web
- [ ] As a viewer, open General → messages readable, reactions work, "You can read this conversation but not post in it" → web
- [ ] Make a channel announcements-only; as a member → "Only managers post here · Reply privately"; Reply privately opens a DM with the managers → web
- [ ] Remove someone from the workspace; open your DM with them → "<name> left the workspace"; their messages keep their name with "former member" → web
- [ ] Lapse the plan (local: drop the grant) → every conversation still opens; the owner sees "Choose a plan", a member sees "<owner> can turn it back on." → web
- [ ] Go offline with Chat open → "You're offline · reading from this device" above the composer → web
- [ ] Open a `/chat?c=<another workspace's conversation>` link → no toast; the app switches workspace if it's yours → web
- [ ] One-person workspace with no messages → no Chat tab → web

## Verify before release

- A paused workspace opened from the device copy shows a working composer until the plan check answers (a send then comes back "Not sent · Retry"); keep `paused` in the device copy if that shows up.
- Viewer is chosen on the client from the role and chat's module level (`chat-page.tsx`, `readOnly`); the server reads the role's `read_only` / system key. A custom role with chat view-only and `read_only` false would see the viewer line while the server lets it post (the UI errs strict). CV-15's role editor should keep them aligned.
- Presence is off while paused (the presence topic needs the plan); spec §1 says it keeps working — CV-17.
- `global-css.test.ts` no longer names a chat pane in its gutter check: `.chat-stream` has no `pane-scroll` (CV-7a's scroller); repoint when the stream takes the gutter.
- The welcome's disappearance is proven after a reload (`tests/chat-shell.spec.ts`); live it follows the channel's `last_message_at`.

- The Chat tab rule on a workspace whose member list fails to load (treated as "loading": the tab shows).
- Paused presence: no presence dots while paused (CV-17 drops the plan from the presence topic).
