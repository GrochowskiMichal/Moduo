# CV-8b: The panel and the dialogs (client)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-8b-panel-dialogs`; record `docs/build/chat-v2/CV-8b.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 8b | **CV-8b** The panel and the dialogs *(client)* | Details (people with state, Pinned, Decisions and Reply chains sections, level, Pin to sidebar, the link's chip, history) in the panel registry with the "← item" stack (person card, message in context, reference) and ⌥1–3; New conversation; Browse channels; `tests/chat-details` | AC15.5, AC10.9, AC11.4 (people with state) | 8a |

**Depends on:** CV-8a.

## 2. What to build

**§12 Channels: lifecycle and who may do what** (prototype frames 3, 4, 7)
- **New conversation** picks people (a direct message) or makes a channel: name, topic, private or public, people, the announcement switch, an optional link. **Browse channels** lists public channels with Join, and Archived (read only).
- **Details** (the panel's first view): the linked item with its live state, people (with presence and status), Pinned, Decisions, Reply chains (open, then wrapped), notification level (Every message · Mentions and replies · Nothing), Pin to sidebar, managers (add and remove), the announcement switch (managers and admins may turn it on or off later, CH23a), Link to…, Make private (one way, CH59; it asks once: "Make Founders private? It can't go back to public. 4 people stay in it."), Archive, Delete (CH62), Leave, and a quiet history of every change.

**§15 Settings, and where each thing lives**
- **A conversation's Details:** its notification level, Pin to sidebar, managers, the announcement switch, the link.

## 3. Acceptance criteria

**AC15 — Module contract**
- **AC15.5** the activity trail renders in Details.

**AC10 — Channels and permissions**
- **AC10.9** viewers react and receive, never post.

**AC11 — Presence, statuses and Focus**
- **AC11.4** statuses with presets, your own saved ones and "clear after", one for every workspace, shown wherever you'd message the person and on the line above the box

**Tests that prove them** (file · name · AC · plain English)

- `tests/chat-details.spec.ts` · "Details: history, decisions, chains, people" · proves AC15.5, AC8.7, AC11.4 · Details shows the quiet history of every logged op, the Decisions and Reply chains sections, and people with presence and status.

## 4. Decisions that bind it

- **Panel registry** (#10): `PanelModule` in `src/lib/panel-registry.ts` gains `chat` with views **Details · Reply chains · Files** (group *about this*, ⌥1–3 through `panelShortcutNumber`, matched on `event.code`), declared in a new `src/features/chat/panel-views.ts` (pattern: `src/features/notes/panel-views.ts`). Items, not views, in the right panel's "← item" stack (`src/components/app/right-panel.tsx`): a chain, a person, a message in context, any reference. Register all three views now; the page's `available(id)` hides Reply chains and Files until CV-12 and CV-9 render them (my reading).
- **Details** (the first view; quoted above): build what the existing ops support now: the people list with the state that exists (presence shapes and statuses are CV-17's: leave the slot, so AC11.4's "people with state" completes there), Pinned, notification level (`chat_op_set_prefs`), Pin to sidebar, Archive, Leave, and the **quiet history** (the activity rows of every logged op, #15, read as the conversation's readers: AC15.5; extend `src/features/spine/activity.ts` for the `chat.*` ops, entity type `chat_channel`). Draw the frames and empty states of **Decisions** (CV-14), **Reply chains** (open, then wrapped; CV-12) and the **link's chip and "Link to…"** (CV-13). Managers, the announcement switch, Make private and Delete are CV-15's.
- **Person card** (item, also on hover anywhere): name, avatar, "Message" starts a direct message; the status line arrives with CV-17. **Message in context** (item): ten lines either side with "Open in conversation" (CV-11's Catch up and Search reuse it).
- **New conversation** (§12, ⌘N): picks people (a direct message) or makes a channel: name (as typed, 1–80, a clash with "launch v1" is refused by the server), topic, private or public, people, the announcement switch; the optional link waits for CV-13. Picking only yourself offers "Capture a note" (§1: no notes-to-self conversations). **Browse channels:** public channels with Join, and Archived (read only).
- Viewers see Details read-only: hide edit affordances (the kit's state rules, §17).

## 5. Files

New: `src/features/chat/panel-views.ts`, the Details view, person card, message-in-context item and the two dialogs under `src/features/chat/`, `tests/chat-details.spec.ts`. Touch: `src/lib/panel-registry.ts` (+ `panel-registry.test.ts`), `src/components/app/right-panel.tsx`, `src/routes/pages/chat-page.tsx` (CV-8a's adapter), `src/features/spine/activity.ts`, `src/lib/min-build.ts` (`READ_RPCS` for any new read RPC the client calls).

## 6. From earlier blocks

CV-8a: the page adapter, sidebar, toolbar, the bottom-bar toggles, the 3×3 shell. CV-2b: `chat_op_create_channel`, `_open_dm`, `_set_prefs`, `_archive_channel`, `_leave`, `_join`, `chat_people`. CV-3: the store (people, members, channel rows).

## 7. Watch out

- `MAX_PANEL_VIEWS` is 6; the panel registry is shared with Tasks, Notes, Calendar, Contacts and Email: change it additively.
- Tokens only; new chrome uses raw HTML, not the `src/tw` shim.
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

Chain content and Wrap up (CV-12), Decisions (CV-14), the Files view's content (CV-9), links (CV-13), managers, announcement switch, make private, delete and restore (CV-15), presence and statuses (CV-17), the Catch up view (CV-11).
