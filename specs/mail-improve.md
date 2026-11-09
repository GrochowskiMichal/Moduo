# Spec: Mail, improved: close the holes in Mail v3

> Status: **Ready** · Owner: mike · Draft from /product-studio, grilled 2026-11-08
>
> **Design:** [Mail, improved](https://claude.ai/artifact/UkqArK5YNviQ2wfosdwpdH), with its source in [.design/email/improve/](../.design/email/improve/README.md). Blind critics scored it 7.7 in round 3 (bar 8.0, every lab gate 10). Mail as built scored 7.0 under the same jury on 2026-11-07.
>
> **Builds on:** [specs/mail-v3.md](./mail-v3.md) (MV-0…MV-12, on `develop` since #800) and [docs/decisions/email.md](../docs/decisions/email.md).
>
> **Related briefs:** `.design/email/BRIEF.md`, `.design/email/DESIGN_BRIEF.md`
>
> **Execution:** a single refactor. All blocks are built back to back on one branch and land as one PR (see §Execution mode).

## Scope

Mail v3 shipped the right model: rail, tabbed list, reader with the state line, Today beside it, composer under the thread. A blind critique of the build (`/product-studio criticise email`, 2026-11-07, lab `20261107-0207-email-v3-baseline`) found 17 holes and 4 candidates, none severe, all in the triage loop and its polish. The improve prototype closed all of them and three critic rounds added more. This spec brings the build to the prototype.

It is a polish pass on existing screens. There is no new route, no new table, no Supabase migration and no contract change. Two small engine changes: the collapsed-message snippet skips salutations, and undo reports the threads it restored.

**Holes it closes** (ids from the critique; the artifact's Why tab has each with its state):

| Hole | What's wrong today | Block |
| --- | --- | --- |
| H1 | The Today panel shows for some threads and not others; the reading column jumps ~270 px | MI-2 |
| H2, C1, H13 | Row avatar: hover/selection draw over it, account ring adds a second hue | MI-3 |
| H3 | 50 controls whose accessible name doesn't start with the visible label | MI-7 |
| H4 | Keyboard-triggered motion up to 400 ms | MI-7 |
| H5, H6 | Undo doesn't select the restored thread; no clickable Undo after Done | MI-4 |
| H7 | Send + Done leaves the done thread open | MI-4 |
| H8 | `;;thanks` shows no offer before it expands | MI-6 |
| H9 | Failed-send reason truncated | MI-6 |
| H10 | Failure cards 5–7 lines tall | MI-6 |
| H11, C3 | "Why here?" covers the subject; non-matching rules struck through | MI-5 |
| H12 | 13–15 unlabeled toolbar icons | MI-5 |
| H14 | Inbox zero leaves the reader blank | MI-6 |
| H15 | "+N •" unexplained | MI-6 |
| H16, H17 | Off-grid margins, stray transitions, colour-only hover | MI-7 |
| C2 | A pin glyph on every pinned row | MI-3 |
| C4 | At 1024 the panel squeezes the reader | MI-2 |

## Product answers (Mike, 2026-11-08)

- **Compact density** becomes one line, 32 px: sender (first name) · subject · time. Comfortable stays two lines.
- **New keys:** ⌥0 toggles the side panel, F6 / ⇧F6 cycle panes, `g p` `g v` `g n` `g l` jump to Personal, the first custom tab, Notifications and Newsletters.
- **Account marker** on rows is a small filled tick, not a ring and not a dot.
- **New tokens:** `--measure-thread: 48rem`, `--measure-reading: 70ch`, `--scrim`.

## Product behavior & UX

The concept card from the artifact:

```
Idea:         Your inbox is a queue of things to decide; every thread says what it is to you, and one key turns it into linked work.
Core loop:    j/k (reader follows) → read the newest message → e Done / s Snooze / t Task / r Reply → the next thread is already open, nothing else on screen moves.
Signature:    The state line under the subject, and an undo that brings the thread back selected and open.
Motion verb:  advance. Keyed changes swap in --motion-fast with opacity only; nothing slides or resizes on a key press.
100th use:    The layout never shifts between threads; one hue per row; three labelled toolbar buttons; a failure is one quiet line.
```

Visuals, copy and every state are in the artifact; pick the state named in brackets from its switcher. This section says what to build where it isn't obvious from the picture.

### 1. Layout that holds still (H1, C4)

- The side panel's visibility is the person's setting: ⌥0, the toolbar's panel button, or the ⌥1–3 view keys. Nothing else shows or hides it: not a thread, not a place, not compose. *(default, undoDone)*
- Below a 1180 px window the panel folds to a 40 px icon strip (one icon per view). Clicking an icon opens that view as an overlay over the reader; Esc closes it. This reacts to resize, not only at mount. *(1024 window)*
- The reading column has one width for every thread in a session. The thread column (subject, chips, sender card, collapsed rows, messages, composer) is capped at `--measure-thread` and left-aligned; message text at `--measure-reading`. Extra width is margin.
- The rail's upper part scrolls above a pinned footer (Connect account). At rest no item is half-covered; when it scrolls, a fade shows at the bottom edge.

### 2. List rows (H2, C1, H13, C2)

- **Avatar:** the sender's initials on `bg-label-fill` with the sender's `avatarHue` (unchanged). The account ring is removed.
- **Account tick:** after the time, a filled 4×10 px tick in the account's hue (`[data-label]`), half opacity on read rows. Tooltip and screen-reader text name the account. Hidden when there is one account. The rail's account marks use the same tick.
- **Hover:** a check ring drawn inside the avatar circle. **Picked:** the circle fills with `--primary` and shows a check. In selection mode, unpicked rows show the plain avatar (no check).
- **Quick actions** (Done · Snooze · More) sit over a fade of the row's own background so the preview fades under them.
- **Pinned group:** no per-row pin flag under the PINNED heading (the flag stays elsewhere, e.g. in search results).
- **Selected row:** the fill and outline mark selection; sender and subject keep full foreground contrast. The unread dot stays if unread.
- **Opening a thread** clears its unread dot at once.
- **Compact density:** one line, 32 px: sender as a narrow fixed column (first name, `--mail-sender-w`), subject takes the remaining width, then preview if room, then time and tick. 20+ threads fit at 1440×900. *(dense)*

### 3. Triage feedback and undo (H5, H6, H7)

- **One toast for every triage action** (Done, Snooze, Move, Archive, Delete, Spam, Mute, bulk): `"Done · in Archive"` with an Undo button and the ⌘Z key cap, through the existing `undoToast`. *(undoDone)*
- **The hint line** under the list goes back to key hints only ("j k to move · e Done · s Snooze · t Task · ? all keys"). It no longer carries results.
- **Undo** (button, `z` or ⌘Z) restores the threads, then selects the first restored thread and opens it in the reader, switching tab or place if needed.
- **Send & Done:** ⌘⇧↩ in the composer sends and marks Done. Any send that removes the thread from the view (the "Done on send" box included) advances like `e`: the next thread is selected and open. The undo-send toast stays; undoing the send reopens the reply. *(undoSend)*
- **Task made:** the toast's "Also mark the email Done" is a button with its `e` key cap, styled like Undo. The task title opens as an editable, auto-growing field with the text selected; Enter saves, Esc cancels. *(taskMade)*

### 4. Reader (H11, C3, H12)

- **Toolbar**, one roving Tab stop (`components/ui/toolbar.tsx`), arrow keys inside, groups divided by separators: Reply · Reply all · Forward | **Done** · Snooze · Remind | Task · Link | panel toggle | ⋯. Done always shows its label; Snooze and Remind show labels from 1280 px up. The ⋯ menu gains Pin, Move, Private note (with their keys) next to Mute, Spam, Why here?, Mark unread, Delete. Every icon button keeps its tooltip `Label  key`. *(default)*
- **"Why here?"** opens as a sheet inside the reader, under the sender card, so the subject and card stay visible. Steps before the decider are dimmed with a "didn't match" tag (no strikethrough); the decider is marked "decided it". "Settings → Mail → Rules" is a ghost button that opens Settings at the Rules section. Esc or × closes. *(whyHere, whyRule)*
- **Chips:** the link chip reads "Link…" with the `l` key cap after it.
- **Title:** wraps fully, no clamp.
- **Sticky subject:** while the inline composer is open and the title has scrolled away, a compact subject line stays at the top of the reader. *(reply)*
- **Collapsed messages** show the first line of substance: salutations ("Hi Robin,") and sign-offs are skipped, double spaces collapsed. Each reads to a screen reader as "Jonas Weber, Thu: Following up on today's call…, collapsed".
- **Side panel:** "Create event from this email" is hidden when the open item is a draft, an Outbox message or a new message.
- **Attachments** truncate in the middle so the version and extension stay visible; the full name is in the tooltip.

### 5. States and system lines (H8, H9, H10, H14, H15)

- **Failed send** *(sendFailed)*: the draft row and the reader banner lead with the cause and wrap to two lines: "Not sent · Server refused: attachment over 25 MB". The action fits the cause: size limit → "Remove {file} and send" plus Edit; transient → Retry plus Edit. The draft shows the offending attachment chip flagged in `--warning`.
- **Failed actions** *(failed, failedOpen)*: one line each, at most 32 px: "Couldn't archive "{subject}" · {cause} · Retry · Undo"; the subject truncates in the middle with one ellipsis, the cause never. Two or more fold into "{n} actions didn't sync · Show · Retry all".
- **Snippet offer** *(snippet, snippetInserted)*: typing `;;tha` shows the offer under the caret (name, first line, "Tab to insert", "↑↓ n of m", "Esc dismiss") before anything is inserted. The popup exists (`useSnippetPopup`); the lab never saw it at `;;thanks`, so verify the trigger shows on a partial name and stays until Tab.
- **Inbox zero** *(inboxZero)*: the list says "{Tab} is clear · You cleared {n} today"; the reader shows only a small "Next" label and the next tabs as buttons with counts and their `g` key. No second heading.
- **Empty place** *(emptyFolder)*: the list keeps its empty state with "Back to Inbox" and its `g i` key cap as a ghost button; the reader is plainly empty.
- **Tab overflow:** "+N" has the tooltip "{n} more tab(s) · {m} has new mail"; its menu lists only the hidden tabs with their unread counts.
- **Screener** *(newSenders)*: Allow/Block show on unselected rows; for the selected thread only in the reader's sender header, and the triage toolbar is dimmed and `aria-disabled` until the sender is screened.
- **First run** *(firstRun)*: folders and smart views are dimmed (muted text, `aria-disabled`, tooltip "Connect an account first"), not hidden.
- **Web view** *(web)*: compose and + are hidden in the bottom bar; the linked conversations sit in one centred column at `--measure-thread`.
- **Dialogs:** the scrim uses `--scrim` so the content behind doesn't show through. *(connect)*

### 6. Keyboard and focus (H3)

- **Skip link:** "Skip to mail list" is the first focusable element of the app shell on the Email route, visible on focus; Enter focuses the selected row.
- **F6 / ⇧F6** cycle rail → list → reader → side panel (when shown). Listed in the `?` sheet and ⌘K.
- **One Tab stop each** for the rail, the tab strip and the reader toolbar, arrow keys and Home/End inside. Tab from the skip link reaches the list row in at most 3 stops.
- **⌥0** toggles the side panel; **`g p` `g v` `g n` `g l`** jump to tabs. The `?` sheet lists drag as a pointer gesture without a key cap and undo as "z or ⌘Z".
- **Accessible names** start with the visible label; shortcuts go in `aria-keyshortcuts`. Avatar initials are `aria-hidden`. List rows read "Jonas Weber, 6 messages, priority person, 1 attachment, has a task, 9:58, Hale & Co, …" with commas between parts.
- **Focus rings** follow the house rule: 2 px `--ring`, no offset; fields use the ring edge. The tab strip leaves room so the ring isn't clipped.

### 7. Motion and craft (H4, H16, H17)

- Keyed changes (list after an action, reader swap, panel open, toasts, sheets) fade at `--motion-fast` with opacity only, once on first appearance, never on every `j`/`k`. No slide, scale or height animation. Reduced motion: none.
- Spacing on the house spacing tokens; transitions on `--motion-*`; hover changes background, and selected/current items have their own hover.

## Edge cases

- **One account:** no account tick on rows or in the rail.
- **Narrow window while the panel is open:** resizing below 1180 folds it to the strip; widening restores the person's last state (open or hidden).
- **Undo after the place changed:** the restored thread's place or tab is opened, then it's selected.
- **Undo of a bulk action:** all threads come back; the first in list order is selected and opened.
- **Undo-send after advancing:** undo reopens the sent thread with the reply open, and selects it.
- **Send & Done in a place where the thread stays** (e.g. Sent): no advance.
- **Send failure with an unknown cause:** Retry plus Edit; the cause text is the server's, unclipped.
- **Failed action on a thread with a 200-char subject:** middle truncation, cause in full, full text in the tooltip.
- **Many failures:** the fold reads "{n} actions didn't sync"; expanded, the list scrolls inside a max height of five lines.
- **Snippet with no match:** the existing `snippetMissLine`.
- **Why here on a thread a rule decided:** the rule's step is "decided it" and links to that rule.
- **Collapsed message that is only a salutation** ("Hi Robin,"): fall back to the next non-empty line, then to the subject.
- **Toolbar at 1024:** Done keeps its label; Snooze and Remind are icons.
- **Compact density with a long sender name:** the first name truncates inside its column; the subject always gets at least the remaining width.
- **Screener with Allow/Block pending and a key press `e`:** the toolbar is disabled; `e` shows the hint "Allow or block the sender first".
- **Reduced motion:** no fades.
- **Web (no desktop engine):** only the web view's changes apply.

## Acceptance criteria

- **AC1** The side panel's visibility changes only through ⌥0, ⌥1–3, the panel button or the strip; walking 50 threads with `j`/`e` never changes the reader's width.
- **AC2** Below a 1180 px window the panel shows as a 40 px strip; a strip icon opens that view as an overlay; this follows live resizes.
- **AC3** The thread column is no wider than `--measure-thread` and message text no wider than `--measure-reading` at 1920 px.
- **AC4** At 1024×700 no rail item is half-covered by the footer; when the rail scrolls, a bottom fade shows.
- **AC5** Rows show the sender's initials, no account ring, and an account tick after the time (hidden with one account; tooltip names the account).
- **AC6** Hover shows a check ring inside the avatar; picked rows fill with primary and a check; unpicked rows in selection mode show no check.
- **AC7** Rows under PINNED show no pin flag; quick actions fade the preview under them.
- **AC8** The selected row's sender and subject use full foreground contrast; opening a thread clears its unread dot.
- **AC9** Compact density renders one 32 px line per thread with the subject taking the remaining width; 20 threads fit at 1440×900.
- **AC10** Every triage action shows one toast "{Action} · {where}" with an Undo button and ⌘Z key cap; the hint line shows only key hints.
- **AC11** Undo restores the threads and selects and opens the first restored one, switching place or tab if needed.
- **AC12** ⌘⇧↩ sends and marks Done; a send that removes the thread from the view advances to the next thread; undoing the send reopens the reply on that thread.
- **AC13** After `t`, the toast's "Also mark the email Done" is a button with an `e` key cap, and the task title field is editable with its text selected.
- **AC14** The reader toolbar is one Tab stop with arrow navigation and the groups listed in §4; Done always shows its label; Snooze and Remind show labels at ≥1280 px; Pin, Move and Private note are in ⋯.
- **AC15** "Why here?" renders inside the reader under the sender card; the subject stays visible; non-matching steps say "didn't match" without strikethrough; the Settings button opens Settings at Mail → Rules.
- **AC16** The link chip reads "Link…"; the reader title isn't clamped; a sticky subject shows while composing once the title scrolls away.
- **AC17** Collapsed message rows skip salutations and sign-offs and read "{Name}, {time}: {snippet}, collapsed" to assistive tech.
- **AC18** "Create event from this email" is absent for drafts, Outbox items and new messages; attachment names truncate in the middle.
- **AC19** A size-limit send failure shows the cause first, unclipped, with "Remove {file} and send" and Edit (no Retry) and the flagged attachment chip; a transient failure shows Retry and Edit.
- **AC20** Failed actions render one ≤32 px line each with the cause; two or more fold into a summary with Show and Retry all.
- **AC21** Typing `;;tha` in the composer shows the snippet offer before insertion; Tab inserts; Esc dismisses.
- **AC22** Inbox zero shows the cleared line in the list and only the next-tab buttons (with counts and `g` keys) in the reader; an empty place shows its state only in the list.
- **AC23** "+N" has the tooltip "{n} more tabs · {m} has new mail" and its menu lists only hidden tabs.
- **AC24** In the Screener the selected thread shows Allow/Block only in the reader header and the triage toolbar is `aria-disabled` until screened.
- **AC25** On first run folders and smart views are dimmed and `aria-disabled`; the web view hides compose; dialogs use `--scrim`.
- **AC26** "Skip to mail list" is the first focusable element on the Email route; F6/⇧F6 cycle the panes; from the skip link the list is reached in ≤3 Tab stops.
- **AC27** ⌥0, F6 and `g p`/`g v`/`g n`/`g l` work and appear in the `?` sheet and ⌘K; the sheet shows "z or ⌘Z" and no key cap for drag.
- **AC28** No mail control has an accessible name that doesn't start with its visible text (axe `label-content-name-mismatch` 0); avatar initials are hidden from assistive tech.
- **AC29** Keyed list, reader, panel, toast and sheet changes use opacity only at ≤ `--motion-fast`; the lab's keyboard-action motion p99 ≤ 150 ms.
- **AC30** The lab on the built module: accessibility gate ≥ 9.5 with no serious axe rule, system gate ≥ 9.8 (token drift counts `color-mix` tokens as on-token), states 10, every new state and journey below passing.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `apps/app/src/features/email/panels/side-panel.test.tsx` · "visibility only follows the person" | AC1 | Selecting other threads, places and opening compose never changes `panel`. |
| `…/panels/side-panel.test.tsx` · "folds to a strip below 1180 and follows resize" | AC2 | A resize event below 1180 renders the strip; above restores the last state. |
| `…/reader/mail-reader.test.tsx` · "thread column uses the measure tokens" | AC3, AC16 | The column has the measure classes; the title has no clamp; the sticky subject appears when composing and scrolled. |
| `…/ui/mail-rail.test.tsx` · "pinned footer and scroll fade" | AC4 | The rail body scrolls above the footer and gets the fade class when it overflows. |
| `…/ui/mail-row.test.tsx` · "avatar, tick and checks" | AC5, AC6 | Sender initials, no ring, tick with account name (none for one account), check states for hover, picked and unpicked-in-selection. |
| `…/ui/mail-row.test.tsx` · "pinned rows, fade, selected contrast, accessible name" | AC7, AC8, AC28 | No pin flag under PINNED; the fade wrapper; selected text classes; the row's name reads with commas and no initials. |
| `…/ui/thread-list.test.tsx` · "compact is one 32 px line" | AC9 | Compact rows are 32 px with the narrow sender column. |
| `…/ui/mail-shell.test.tsx` · "triage shows one undo toast; hint line keeps keys" | AC10 | `e` calls `undoToast` with the action and place; the hint line text is the key hint. |
| `…/commands/triage.test.ts` · "undo returns restored ids" | AC11 | `commands.undo()` resolves with the thread ids the engine restored. |
| `…/ui/mail-shell.test.tsx` · "undo selects and opens the restored thread" | AC11 | After undo the cursor is on the first restored id, the reader shows it, the tab switches if needed. |
| `…/compose/mail-composer.test.tsx` · "⌘⇧↩ sends and marks Done" | AC12 | The binding calls send with done; the shell advances; undo-send reopens the reply. |
| `…/ui/mail-page.test.tsx` · "task toast has an Also mark Done button" | AC13 | The toast renders a button with the `e` key cap; the title field is focused with its text selected. |
| `…/reader/reader-toolbar.test.tsx` · "roving toolbar, groups and labels" | AC14 | One tab stop, arrow moves, Done labelled, Snooze/Remind labelled at ≥1280, Pin/Move/Private note in ⋯. |
| `…/reader/why-here.test.tsx` · "sheet under the card, no strikethrough, rules link" | AC15 | Rendered in the reader body; "didn't match" tags; no `line-through`; the button dispatches settings `mail/rules`. |
| `apps/desktop/src-tauri/src/mail/host/reader.rs` · `snippet_skips_salutations` | AC17 | "Hi Robin,\n\nFollowing up…" yields "Following up…"; only-salutation falls back. |
| `…/reader/message-card.test.tsx` · "collapsed row name" | AC17 | The collapsed header's name is "Jonas Weber, Thu: …, collapsed". |
| `…/panels/side-panel.test.tsx` · "create event hidden for drafts" | AC18 | No event action for draft, outbox or new message. |
| `…/ui/attachment-name.test.ts` · "middle truncation" | AC18 | Long names keep the end and extension. |
| `…/ui/mail-places.test.tsx` · "failed send leads with the cause and fits the action" | AC19 | Size-limit → Remove-and-send + Edit and the flagged chip; transient → Retry + Edit. |
| `…/ui/system-lines.test.tsx` · "failed actions are one line and fold" | AC20 | One line per op with cause; ≥2 fold with Show and Retry all. |
| `…/compose/snippet-area.test.tsx` · "partial trigger shows the offer" | AC21 | `;;tha` shows the popup with the matching snippet before insertion. |
| `…/ui/mail-states.test.tsx` · "inbox zero and empty place" | AC22 | Next-tab buttons only in the reader; empty place only in the list. |
| `…/ui/mail-tabs.test.tsx` · "+N tooltip and hidden-only menu" | AC23 | Tooltip text and menu items. |
| `…/reader/who-card.test.tsx` · "screener disables triage" | AC24 | Allow/Block in the header; toolbar `aria-disabled`. |
| `…/ui/mail-shell.test.tsx` · "first run dims places" · `…/web/*.test.tsx` · "no compose on web" | AC25 | `aria-disabled` places; no compose button on web; dialog overlay uses the scrim class. |
| `apps/app/src/components/app/skip-link.test.tsx` · "first focusable, focuses the list" | AC26 | The skip link is first in tab order on Email; Enter focuses the selected row. |
| `…/ui/use-mail-shell-keys.test.ts` · "F6 cycles panes; ⌥0 and g p/v/n/l" | AC26, AC27 | Key handlers move focus and toggle the panel; registry entries appear in the legend. |
| `e2e/lab` run (`mail-improve` label) | AC28, AC29, AC30 | Axe, motion p99, gates and the new states and journeys. |

## Assumptions & technical decisions

1. **Tokens added to `tokens.css`:** `--measure-thread: 48rem`, `--measure-reading: 70ch`, `--scrim: color-mix(in oklab, var(--background) 82%, transparent)`. `dialog.tsx` overlay moves from `bg-background/60` to `--scrim` (app-wide: every dialog gets the stronger scrim). Rejected: reusing `--width-prose-max` (36rem is too narrow for the thread with its cards).
2. **Avatars keep `--label-fill` (DS-6).** The prototype used a neutral fill with hued initials only because the lab's drift check can't resolve `color-mix` tokens. Fix the check instead (MI-7: compute each token's resolved value in the page and compare resolved to resolved). Rejected: changing the avatar look to satisfy a measuring tool.
3. **Undo reports what it restored.** `commands.undo()` returns the thread ids of the ops it undid (from the undo stack's op records, which already hold them); the shell selects the first that reappears in the window (wait for the next list refresh, up to 1 s, then give up quietly). No engine change. Verify in code: `commands/triage.ts:39`.
4. **Advance on send:** `finishSend`'s `markDone` goes through the shell's `act` path (or a new `onRemoved` callback) so `advanceAfterRemoval` runs. Verify in code: `compose/session.ts:181`, `ui/mail-page.tsx:253`.
5. **Snippet salutation skipping is in the engine** (`reader.rs:311`), applied at read time to `message.snippet`; no stored data changes, no migration. A short list of greetings ("hi", "hello", "hey", "dear", "good morning/afternoon/evening", "cześć", "dzień dobry", "hallo", "hola") followed by a name and comma or line break, and sign-off lines. Rejected: doing it in the UI (the engine also feeds MCP).
6. **Toolbar uses the existing roving `components/ui/toolbar.tsx`**; the skip link and F6 live in the app shell (`components/app/`) behind a route check, so other modules can adopt them later. No new top-level route; no IA change.
7. **Panel strip** reuses `RightPanel`'s view icons; the overlay is the shell `RightPanel` in a positioned layer, not a dialog. `SIDE_PANEL_MIN_VIEWPORT` becomes 1180 and the check moves to a resize listener.
8. **One toast surface:** triage results go through `undoToast` (sonner); `resultHint` and its 4 s state are removed from the hint line. The "Next time press e" coaching after a pointer action moves into the toast's description.
9. **Focus ring:** the house rule (2 px, no offset; fields on the edge) wins over the prototype's offset ring.
10. **Settings deep link:** `dispatchOpenSettings({ section: "mail", sub: "rules" })` — add `sub` if missing. Verify in code: `features/settings`.
11. **Tier:** TS, `tokens.css`, one Rust function under `src/mail/`. Expected Tier 1; run `bun scripts/ci/tier.ts origin/mike` and the validator once if it says Tier 2.

## Execution mode

A single refactor, like MV:

1. Cut `t/mike/mail-improve` off `origin/mike` (after this spec merges) in its own worktree.
2. Open one draft PR into `mike` titled `[MI] Mail, improved: close the holes in Mail v3`. Its body lists MI-0…MI-7.
3. Run `/s2` once inside `/goal`: "build MI-0 through MI-7 in order on this branch". Per block: tests first, build, `bun run verify` (plus `cargo test -p moduo mail::` for MI-1), commit `MI-n: <name>`.
4. Three failed attempts at one problem → ❓ in the PR body, move to the next independent block. A fresh context resumes from this spec, `git log` and the PR checklist.
5. MI-0's test files are frozen after its commit.
6. When MI-7 passes: mark ready, merge into `mike` on green, then `/product-studio criticise email` for the new baseline against 7.7.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| MI-0 | **Frozen tests and fixture states** | The failing test skeletons from the tests table; fixture-engine states the lab needs (failed send with size cause and attachment, failed ops with causes, screener pending, first run, a 200-char subject thread, salutation-only message). | AC1–AC30 (skeletons) | — |
| MI-1 | **Engine and commands** | Snippet salutation skipping in `reader.rs` with Rust tests; `commands.undo()` returns restored ids; send-removal advance hook. | AC11, AC12, AC17 (engine) | MI-0 |
| MI-2 | **Layout, tokens and focus shell** | The three tokens and the dialog scrim; panel visibility and the resize-reactive strip with overlay; thread-column measures; rail scroll with pinned footer and fade; skip link, F6, ⌥0; roving rail and tab strip. | AC1–AC4, AC25 (scrim), AC26, AC27 | MI-0 |
| MI-3 | **List rows** | Ring removed, account tick (rail too), check states, quick-action fade, no pin under PINNED, selected contrast, unread clears on open, one-line compact, row accessible names. | AC5–AC9, AC28 (rows) | MI-2 |
| MI-4 | **Triage feedback and undo** | One undo toast for triage, hint line keys-only, undo selects and opens, ⌘⇧↩ and advance on send, task toast button and selected title. | AC10–AC13 | MI-1, MI-3 |
| MI-5 | **Reader** | Roving grouped toolbar with labels and the new ⋯ items; Why-here sheet; link chip label; unclamped title; sticky subject; collapsed-row names; create-event rule; middle-truncated attachments. | AC14–AC18 | MI-1, MI-2 |
| MI-6 | **States and system lines** | Failed send by cause; failed-action lines and fold; snippet offer on partial trigger; inbox zero and empty place; "+N" copy; screener; first-run dimming; web compose hidden. | AC19–AC25 | MI-3, MI-5 |
| MI-7 | **Accessibility, motion, lab and close** | Label-first names and `aria-keyshortcuts` across mail; motion pass; the lab drift check resolving `color-mix` tokens; the lab states and journeys below; docs: `docs/decisions/email.md` MI entries, `.design/email/DESIGN_BRIEF.md` pointer to the improve design, `docs/gotchas/email.md` if a trap appeared. Full `bun run verify`. | AC28–AC30 | MI-4, MI-5, MI-6 |

**MI-7: the lab** (`e2e/lab/mail-lab.ts`) gains the states `undoDone`, `undoSend`, `taskMade`, `snippet`, `failedOpen`, `emptyFolder`, `newSenders`, `firstRun`, `connect`, `whyRule`, `long` and the windows 1024×700 and 1920×1080 on `default`. Journeys: `mail-triage-undo` asserts the restored thread is selected and open; new `mail-send-done` (reply, ⌘⇧↩, next thread open, undo-send); new `mail-keyboard-reach` (skip link → list in ≤3 Tabs, F6 cycle). The focus, hover and reduced-motion passes switch to the fixture engine (the 7 Nov lab gap).

## Out of scope

- New routes, IA changes, Settings redesign (only the Rules deep link).
- Rule editing in Settings, live link chips (Realtime publication for `links`), the open MV validator minors (stale-draft send after a failed save, rules double-running after a crash, ⌘A → tasks cap): separate fast-lane fixes.
- Multi-step undo.
- Light-mode tuning, mobile layouts.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [x] **Open questions is empty**: the four product calls were answered 2026-11-08; technical calls are recorded above.
- [x] **Data model:** no Supabase change; no local-store migration (snippet skipping is at read time).
- [x] **Module feature:** spine wiring, MCP tools and the widget are unchanged from Mail v3 (this is a polish pass); the collapsed snippet change also improves `email_get` output.
- [x] **Execution blocks** are decomposed, sequenced, and each is context-sized and self-contained.
- [x] **Design constraints acknowledged:** tokens only (three additions above), shadcn-wrapped primitives, DESIGN_RULES R1–R10, house focus ring.
- [x] **Manual-test surfaces identified:** the desktop app on a real account (triage loop with undo, Send & Done, Why here, compact density, 1024 and 1920 windows, Tab from the top), plus the artifact for comparison.

**Ready to execute.**

## Open questions

- [ ] (none)
