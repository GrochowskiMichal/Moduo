# CV-8b — The panel and the dialogs (client)

> Branch `t/maciej/cv-8b-panel-dialogs` · head: see the hand-back · status: built, not landed
> Migration: none

## Delivered against the row

- **Panel registry** (`src/features/chat/panel-views.ts`): Chat registers **Details · Reply chains · Files**, all *about this*, ⌥1–3 in that order (the registry's `panelShortcutNumber`). The screen renders Details only, so `RightPanel` lists one view and draws its title as a plain heading; the "Details ▾" switcher appears by itself when CV-12 / CV-9 pass render functions for `chains` / `files` (nothing else to change). `panel-registry.test.ts` covers the order and the narrowing. `MAX_PANEL_VIEWS` and the other modules are untouched.
- **The right panel is on** (`shell/chat-screen.tsx`): `hideRight` is gone whenever a conversation is open; the panel stays inside the 3×3 shell (`FeaturePanelsShell`'s right column), toggled from the bottom bar as before. Items ("← item", `usePanelStack`): a **person** and a **message in context**; the stack clears when you switch conversation; opening an item opens a collapsed panel (`dispatchLayoutPanelsSet`).
- **Details** (`panel/details-view.tsx`, frame 4 "As a member"): About (the topic) · Linked to (the empty frame: "Not linked to a project or task yet.", CV-13) · People with count, you first, avatar with the online dot, "you" / "former member", the status slot empty (`data-slot="person-status"`, CV-17) · Your notifications (Notify me: Every message / Mentions and replies / Nothing via the kit's `PropertyValue` menu; Pin to sidebar switch; both `chat_op_set_prefs`) · Reply chains ("No reply chains yet.", CV-12) · Decisions ("Nothing marked as a decision yet.", CV-14) · Pinned (count, excerpt, date; a click opens the message in context) · **History** (AC15.5: `FeedItem` lines "**Name** pinned a message · 5m", newest first, six then "Show all N") · Archive / Unarchive (managers and admins, not on a paused plan) and Leave (not General, not DMs). It reads its people, pins and history through `panel/use-conversation-details.ts`, again whenever the channel's stamp, your membership or the window's pins / edits / deletes change.
- **History reads** `runtime.chat.history` (new): `module_activity` for `entity_type = chat_channel`, `module = chat`, filtered to `CHAT_HISTORY_OPS` (`model.ts`): create, rename, topic, archive / unarchive, join, leave, member add / remove, pin / unpin, message edit / delete / restore. `spine/activity.ts` gains the lines for `chat.pin`, `chat.message_edit`, `chat.message_delete`, `chat.message_restore`, `chat.react` (tested in `activity.test.ts`).
- **Person card** (`panel/person-card.tsx`): avatar with presence, name, "You" / "Former member" / "Online", the empty status slot, **Message** (opens or starts your direct message; hidden for a viewer, on a paused plan, for yourself and for a former member). Opened from Details' People, a message author's name and an @mention in a message (the stream's `onPersonClick`, which used to open a DM at once); **previewed on hover** over an author's name (`stream/rows.tsx` `AuthorName`, a `HoverCard`; `RowHandlers.personPreview`).
- **Message in context** (`panel/message-in-context.tsx`): the message and ten either side, read with `message` + two `page` calls (the open stream's window never moves), day labels, the message lit, the title "Message from <author>", and **Open in conversation** (the title row's "Open in …" action) landing on it with `m=`. `readInContext` is exported for CV-11's Catch up and Search.
- **New conversation** (`dialogs/new-conversation-dialog.tsx`, frame 3 "New channel" / "New direct message"): opened by ⌘N and the bottom bar's + (`onCreateNew`), the left panel's "+ New conversation" (now passed), and Browse channels' "New channel". Tabs Channel · Direct message (the kit's `SegmentedControl`). Channel: Name (as typed, 1–80; the server's clash message shows inline), Topic, People (chips + find by name, ↵ adds the first, ⌫ removes the last), Private, **Only managers can post** (`p_announcement`, newly passed through `ChatRuntime.createChannel` → `chat_op_create_channel`). Direct message: To (up to nine with you); only yourself → "A conversation with only yourself is a note" + **Capture a note** (opens the app's capture as a note); more than eight others → a line to make a channel. Hidden for viewers and on a paused plan; the tabs follow `create_public` / `create_private` (`use-chat-rights.ts` now reads them).
- **Browse channels** (`shell/browse-channels.tsx`, frame 3 "Browse channels"): a centre surface at `/chat?view=browse` (keeps `c`, so Details stays on the right), opened from the hairline's ⋯ and the dialog's footer. Title + count, a filter (the search icon), "New channel"; public channels by name with topic · N people · you're in, Join (secondary) or Open; then **Archived** (read only, Open). `runtime.chat.memberCounts` reads the counts in one request per 100 channels.
- **Toolbar people count** comes from Details' member read for every channel (CV-8a's note).
- **Details reads again only on what it draws** (`detailsStamp` in `panel/details-model.ts`: the window's pins, edits, deletes and event lines, plus the channel's name, topic, archive, privacy, announcement flag and your membership), never on a plain new message (every send stamps the channel's `updated_at`).
- **Archive is never offered on General** (Details and the toolbar's ⋯; the server refuses it).
- **The "New" pill read mark** (CV-3 / CV-7a / CV-8a's note): `store.open()` now moves `newAfter` to your read mark when you return to a conversation it already holds (never while you stay in it). Leaving Chat (the screen unmounting) calls the new `store.close()`, so coming back to the same conversation from another module counts as a return too. `store.test.ts` · "returning to a loaded conversation moves the New pill to your read mark" (fails without the fix).

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC15.5 | `tests/chat-details.spec.ts` · "Details: history, decisions, chains, people" ("You created a channel", "Piotr Wis pinned a message" in the history); `spine/activity.test.ts` · "renders a conversation's message changes for Details' history (CV-8b)" |
| AC8.7 (frames) | same spec: the Decisions and Reply chains sections with their empty lines (content is CV-14 / CV-12) |
| AC11.4 (people with state, partial) | same spec: People, you first, your own presence dot; another person's dot is proven only in `panel/details-model.test.ts` · "Details' people (frame 4)" (`online(id)`). Statuses complete with CV-17 |
| AC10.9 (partial: never starts a conversation) | `tests/chat-details.spec.ts` · "a direct message with only yourself offers a note; a viewer can't start one (AC10.9)" (no "New conversation", no Message on a person card); reacting and receiving are CV-8a's / CV-7c's tests |
| §12 New conversation | same specs (create a channel with a person; DM with yourself → Capture a note); `details-model.test.ts` · "New conversation (frame 3)" |
| §12 Browse channels | `tests/chat-details.spec.ts` · "Browse channels joins a public channel"; `details-model.test.ts` · "Browse channels (frame 3)"; `search.test.ts` · the `view` param |
| #10 panel registry | `src/lib/panel-registry.test.ts` · "gives Chat Details · Reply chains · Files on ⌥1–3, Details alone until the others render" |
| Message in context | same spec (a pin opens in context with Open in conversation); `details-model.test.ts` · "a message in context (spec #10)" |
| New pill fix | `store/store.test.ts` · "returning to a loaded conversation moves the New pill to your read mark" |

Screens compared with round 5 (1440 × 900): Details vs frame 4 (member), the dialog vs frame 3 (channel, DM), Browse vs frame 3 (browse). Same sections in the same order; the differences are the agent's choices below.

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **Browse channels is a centre surface, not a dialog** · agent · frame 3 draws it in the centre with its own toolbar (the brief's "two dialogs" names it loosely); `view=browse` on `/chat` keeps the open conversation so Details stays · rejected: a dialog (a list of channels with Join reads better as a page, and the frame wins).
- **Notify me uses the kit's `PropertyValue` (no chevron)** · agent · Tasks' detail panel's value control (one property grammar across panels) · rejected: frame 4's chevron (a one-off control).
- **History lists changes, not reactions or bell rows** · agent · "a quiet history of every change": `chat.react` is a wall and `chat.mention/reply/announcement` say who was told, not what changed; the lines exist in `activity.ts` for the bell and any later use · rejected: every logged op.
- **History shows six lines, then "Show all N"** · agent · a mirror, never a wall · rejected: the full 50.
- **Details has no Files section** · agent · frame 4 draws one, but Files is its own view (CV-9) and an empty duplicate would be a dead section · CV-9 adds it if it wants the summary.
- **A person's name in the stream opens their card** (the panel item), and hover previews it; it no longer opens a DM at once · agent · brief: "Person card (item, also on hover anywhere)"; Message on the card starts the DM · rejected: keeping the instant DM (no way to see who someone is).
- **The hover preview is on authors' names only**, not on avatars or @mentions · agent · one trigger per row keeps the 10k-message budget (no extra Radix roots per mention); an @mention click opens the card · revisit with CV-17's statuses.
- **Viewers keep their own Notify me and Pin to sidebar, and Leave** · agent · §12's table: viewers receive and may leave; these are their own settings, not the conversation's · hidden for viewers: New conversation, Archive, Message.
- **Linked to shows only its empty line** (no disabled "Link to…") · agent · a control that does nothing is worse than none; CV-13 adds the chip and the action.
- **Presence words: "Online" or nothing** (no "Away") · agent · presence is off on a paused plan, where "Away" would be untrue; shapes and statuses are CV-17's.
- **New conversation: Private is locked when the role may make only one kind**; the announcement switch says "You're its manager" · agent · the server's `create_public` / `create_private` checks; the creator is the first manager.
- **"Capture a note" opens the app's capture as a note** (`dispatchOpenCapture({ type: "note" })`) · agent · §1: no notes-to-self conversations.
- **The DM tab's "To" field offers you too** · agent · so "only yourself" can be picked and offered a note, as the brief asks.

## Gotchas (area: ui)

- `getByLabel` also matches `aria-label`: a suggestion list labelled "People" under a field labelled "People" made the locator ambiguous; the list is "Suggestions".
- `scrollIntoView` in the panel can scroll every scrolling ancestor; the message in context scrolls only its own list (`offsetTop` on a `relative` list).

## For later blocks

- **CV-12:** pass `chains: () => …` in `chat-screen.tsx`'s `RightPanel` views and the switcher appears; replace Details' "Reply chains" empty line (`data-slot="details-chains"`) with open-then-wrapped chains; a chain is an item, not a view, when opened from the stream.
- **CV-9:** pass `files: () => …`.
- **CV-11:** `MessageInContext` / `readInContext` (panel/message-in-context.tsx) for Catch up's right side and Search hits; push `{ type: "message" }` entries through `openMessageInPanel`.
- **CV-13:** Details' "Linked to" section (`data-slot="details-link"`) takes the chip and "Link to…"; New conversation's link field goes between Name and People (frame 3).
- **CV-14:** Details' "Decisions" section (`data-slot="details-decisions"`).
- **CV-15:** frame 4 "As a manager": Manager labels in People, + to add people, the Channel settings block (announcement switch, Private one way, Name/topic/link Edit), Delete; Archive is already in Details' footer.
- **CV-17:** `data-slot="person-status"` in Details' People and on the person card; presence shapes replace the dot (`PresenceAvatar`).
- **Orchestrator / CV-7a:** on a warm reopen (`page.goto` to a conversation the device copy holds) of a short conversation, the stream's "Today" separator overlapped the conversation-start block in a screenshot (frame 7 layout, `message-stream.tsx`'s bottom-anchored short stream); the first visit drew it right. Not this block's area (no stream code changed beyond the author's name), left as is.

## Manual checklist (step → expect → surface)

- [ ] Open a channel → the right panel shows Details: About, Linked to, People (you first, a green dot for who's online), Your notifications, Reply chains, Decisions, Pinned, History → web
- [ ] Change Notify me to Nothing → the left panel's row stops counting; Details shows Nothing → web
- [ ] Turn Pin to sidebar on → a Pinned section appears in the left panel → web
- [ ] Pin a message → it appears under Pinned and "You pinned a message" in History → web
- [ ] Click a pinned message → "← Details" with the message lit and ten around it; Open in conversation lands on it → web
- [ ] Hover a message author's name → their card; click it → the card in the panel; Message opens your DM → web
- [ ] ⌘N → New conversation; make a channel with a person, Private off → it opens; both see it → web
- [ ] New conversation → Direct message → pick only yourself → "Capture a note" opens the capture as a note → web
- [ ] Hairline ⋯ → Browse channels → Join a public channel → it opens and joins the left panel → web
- [ ] As a viewer → no "New conversation", no Archive, no Message on cards; Notify me still works → web
- [ ] Leave a channel, come back to a conversation you'd read → the "New" pill sits where you stopped → web

## Verify before release

- History reads `module_activity` under its existing read rule (workspace member + `perm_can_see_entity` for `chat_channel`); confirm on staging that a member of a private channel sees its history and a non-member doesn't.
- `memberCounts` counts members of public channels you can read; confirm counts on a workspace with more than 100 public channels (batched by 100).
- Details reads members, pins and history again on every pin / edit / delete / event line in the window (three small reads); watch the request count in a busy channel.
- `memberCounts` pages chat_members 1,000 rows at a time per 100 channels; a grouped-count RPC would be one request (a migration; not worth one here).

## Review (validator, round 1)

One MAJOR fixed (Details re-read on every message: the refresh key used the channel's `updated_at`). MINORs fixed: Archive on General, `memberCounts` truncation at the API's row cap, the pill on returning from another module, "Message from Former member" for app messages, the viewer test's empty Archive check. MINORs left: the author name in the stream isn't a keyboard stop (`tabIndex -1`, like the row's other mouse affordances; the card is reachable from Details' People) and the New conversation people picker has no combobox semantics or arrow keys (↵ adds the first match; Tab reaches the suggestions) — a kit people-picker is the better fix, for CV-15's add-people. NITs left: History reads the newest 50 ("Show all 50" can hide older lines); a failed read shows the empty line rather than an error; sections carry `aria-label` beside their heading.
