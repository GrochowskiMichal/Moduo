# Spec: Mail v3: the screens catch up with the engine

> Status: **Ready** · Owner: mike · Draft from /product-studio, grilled 2026-11-06
>
> **Design:** [Mail, rethought v3.1](https://claude.ai/artifact/CvUks2CuUUcm1Cdp4mNM6F), with its sources in [.design/email/v3/](../.design/email/v3/README.md). Blind critics scored it 7.7 in round 6 (bar 8.0); the shipped module scored 6.0 under the same jury.
>
> **Builds on:** [specs/mail-rebuild.md](./mail-rebuild.md) (MR-0…MR-16: the engine, store and screens this spec changes) and [docs/decisions/email.md](../docs/decisions/email.md).
>
> **Related briefs:** `.design/email/BRIEF.md`, `.design/email/DESIGN_BRIEF.md`
>
> **Execution:** a single refactor. All blocks are built back to back on one branch and land as one PR (see §Execution mode).

## Scope

The MR rebuild gave Mail a fast local engine: an SQLite store, an ops outbox with undo, a send outbox, per-account workers with push, on-demand bodies, the classifier, rules, custom tabs, aliases, snippets and size limits. The screens use only part of it.

- **Wired to nothing:** five things the store already has. The Outbox count is fixed at 0, custom tabs are never passed to the shell, the offline flag is never set, "came back while you were away" is computed but never shown, and Reconnect drops the account.
- **Never given props:** the composer's size limit, intro and correspondent props.
- **Overpromising:** the web page claims snoozes and follow-ups show there.
- **Engine bugs:**
  - Rules collect their effects on new mail but never run them, so move, mark read, skip inbox, block and label do nothing.
  - The `op_failed` event sends no thread ids.
  - A draft's upload is never reported.

This spec does four things:

1. It wires everything the engine already supports.
2. It fixes those engine gaps.
3. It adds the small engine reads the design needs: why a thread is in its tab, when an account last synced, whether new mail is pushed, the Outbox count, and per-thread row flags.
4. It rebuilds the rail, list, reader, composer and side panel to match the artifact.

It is for the founder who lives in Mail and Tasks. It lands before open alpha (16 Nov 2026).

**One refactor, not a block a session (Mike, 2026-11-06).** The blocks below are the order of work and the checkpoints. They run in one unattended lane on one branch and land as one PR into `mike`.

## Product answers (Mike, 2026-11-06)

These override the prototype wherever the two disagree.

| # | Question | Answer |
| --- | --- | --- |
| A1 | Account status button on each rail row? | **No.** The rail keeps its coloured dot, plus the warning glyph when an account needs attention. The full status card (state, push or every minute, last synced, history depth, Sync now, Sign in again) goes in **Settings → Mail → Accounts**. |
| A2 | Tabs that don't fit? | **Fold into a "+N" menu.** The selected tab never folds. |
| A3 | Rules from inside a thread? | **Explain only.** "Why is this in X?" shows the classifier's steps and which one decided, read-only, with a link to the right Settings section. The prototype's "Always put X in" control, "Make a rule…" and the rule dialog are **not built**. Rules stay in Settings, which gains "Also apply to the N already on this Mac". |
| A4 | Compact rows? | **Single line.** Compact is one 32 px line: sender, subject, a fading snippet, flags and time. Comfortable stays 72 px with one or two preview lines. |

## Product behavior & UX

The artifact is the visual and interaction reference. Each surface below names its prototype state ids (`STATES` in `.design/email/v3/part4-interact.js`) and the copy that must ship exactly. Where this section is silent, build what the prototype shows.

### 1. Rail (prototype `default`, `firstSync`, `backfill`, `attachments`, `outbox`)

- **Header:** "Mail", a Sync button (tooltip "Synced 2 min ago" from the newest `lastSyncedMs` of all accounts, "Syncing…" while any account syncs) and a settings button (⌘,) that opens Settings → Mail.
- **New message:** a primary button with its `c` key cap shown outside the button, at the top. It is hidden on first run (no account).
- **Places, with icons:** Inbox (unread count), Sent, Drafts (count), Archive, Trash, Spam. **Outbox** shows only while it holds a message, with its count, between Drafts and Archive.
- **Smart views, each with its count:**
  - Snoozed.
  - Follow-ups, with an amber due dot when one came due.
  - New senders, only with the Screener on.
  - Subscriptions.
  - **Attachments.** This view is new to the rail; `AttachmentsView` exists but is unmounted.
- **Accounts:**
  - The section comes before Saved searches. Both have eyebrow headings, "Accounts" and "Saved searches".
  - Each account row shows its hue dot, label and unread count, plus the warning glyph when its state is `reconnect` or `error`.
  - The twist button toggles the account's folder tree. Clicking the row scopes the list and tab counts to that account; clicking it again, or Inbox, unscopes.
  - "Load more history" moves inside the expanded tree.
  - "Syncing history · 40%" with Cancel stays as shipped.
- **First sync:** while every account is `first_sync`, the rail lists only the syncing account(s).
- **Short windows:** at a window height of 780 px or less, rail rows use `--row-h-sm` and the section gaps tighten. All three accounts stay visible at 1024 × 700.
- **Saved searches:** each one opens ⌘K with the Email chip and its query. Saved searches are hidden while the store is loading.
- **Connect account** stays at the foot.

### 2. Tabs (prototype `investors`, `notifications`, `newsletters`)

- **Order:** Personal, then up to three custom tabs from Settings (`custom_tab` items, in their position order), then Notifications and Newsletters. Each tab shows its unread count, and the counts follow the account scope.
- **"+N" overflow:**
  - After every render, and again once fonts have loaded, tabs that don't fit hide from the right behind a "+N" button.
  - The selected tab never hides.
  - The "+N" button has an unread dot when a hidden tab has unread mail.
  - Its menu lists every tab with its count, then "Custom tabs… Settings".
  - `[` and `]` still move through every tab, hidden ones included.
- **⋯ menu:** "Get me to zero in {Tab}" with the note "Archives everything here · z undoes".

### 3. Thread list (prototype `default`, `dense`, `long`, `away`, `newsletters`, `outbox`, `sendFailed`)

- **Width:** 320 px at window widths of 1200 px and up; `clamp(17rem, 40%, 20rem)` below. It is the same in every place and in compose.
- **Place heading:** outside Inbox, a heading with the place's name sits where the tabs would be.
- **Groups, in order:**
  1. **"Came back while you were away"** (Personal only), for threads in `awayReturned`.
  2. **"Pinned"**.
  3. **"Everything else"**.

  Group headers are virtual-list items and are never sticky.
- **Newsletters tab:** one row per sender ("Lumen Weekly · 4"), expanded on Enter, with "Done all" on the group. It uses `newsletter-groups`, as Subscriptions does.
- **Row lead:**
  - An avatar in the sender's identity hue (`[data-label]` + `--label-fill`), with a 2 px ring in the account's hue when more than one account exists.
  - An unread dot.
  - On hover, or while anything is selected, a checkbox over the avatar. It toggles the pick, the same as `x`.
- **Row text:**
  - In Sent, Follow-ups, Outbox and Drafts the row reads "To {name}".
  - Subjects drop leading `Re:`, `Fwd:`, `Fw:`, `AW:`, `WG:` and `Antw:`, repeated and case-insensitive. The full subject stays in the `title` attribute.
- **Flags** (right side, before the time; at most three, then "+N"):

  | Flag | Shown when |
  | --- | --- |
  | Priority star | — |
  | Pin | — |
  | Attachment | — |
  | Invite | — |
  | Muted | — |
  | Snoozed | — |
  | Task (check-square glyph) | the thread is linked to a task |
  | Note | the thread is linked to a note |
  | Waiting | a follow-up is set: "Reminds Thu" |
  | "Waiting for connection" or "Sending…" | the row is in the Outbox |
  | "Not sent" (destructive text) | a draft with a send error |
  | "Back" (neutral) | it came back from snooze |
  | "New reply" | a reply unsnoozed it |

- **Time, by place:**
  - Inbox: time today, a weekday within 6 days, then the date.
  - Snoozed: "Returns Mon 9:00".
  - Follow-ups: "No reply · 7 days" or "Reminds Thu".
  - Outbox: "Waiting".
- **Hover actions** (Done, Snooze, ⋯) overlay the end of the snippet. Time and flags never move. A done row's hover offers "Not done".
- **Density:**
  - Comfortable: 72 px, with one or two preview lines (as shipped).
  - **Compact: 32 px, one line** (A4). Sender at a fixed width of 9rem, then subject, then the snippet fading out, then flags and time. Compact has no preview-line choice.
- Rows are divided by a hairline (`--hairline`).

### 4. Empty, loading and system lines (prototype `inboxZero`, `emptyFolder`, `firstRun`, `firstSync`, `offline`, `reconnect`, `failed`, `away`, `followups`)

- **Empty tab:** "**{Tab} is clear**" with "You cleared N today." when N > 0, else "Nothing waiting on you here." Below it, one button per other tab with unread mail ("Notifications · 4").
- **Empty place:** per-view copy, taken from the prototype's `emptyCopy`, plus a "Back to Inbox" button. When the list is empty, the reader stays blank: no "No conversation selected".
- **First sync:** the line "Getting your newest mail. History follows in the background.", then skeleton rows. No centred spinner.
- **No account:** a connect card with four providers: Google, Microsoft, iCloud and Other (IMAP). The chosen provider opens the connect dialog on that provider.
- **System lines above the list** (`role="status"`, the failed line `role="alert"`), in this order:
  1. **Offline:** "**Offline, changes will sync**", followed by "{n} message waits in Outbox. {m} triage actions are saved on this Mac." When both counts are 0: "Reading works from what's on this Mac."
  2. **One line per account in `reconnect`:** "**{Account} needs you to sign in again**", followed by "Its new mail is paused until you sign in; other accounts keep syncing." It has a primary **Reconnect** button that opens the connect dialog in reconnect mode for that account.
  3. **One line per account in `error`:** "**{Account} couldn't sync**", followed by "{lastError, humanised}; retrying every minute." It has a **Retry now** button (Sync now for that account).
  4. **Away:** "**{n} emails came back while you were away**", followed by "Snoozes return only while Moduo runs, so these came due while it was closed. They're first in Personal, under Came back." It has a Dismiss button, which calls `clearAwayAnnouncement`.
  5. **Failed ops:** "**{n} actions didn't reach {Account}**", followed by a sentence naming each: "Done · Workshop materials, and Move to Receipts · Studio rent, November." Then "{server reason}; Moduo keeps retrying for a day." It has **Undo both** (tooltip "Shows the threads as the server has them") and a primary **Retry now**. With three or more actions it reads "Undo all", and the list shows the first two plus "and N more".
  6. **Follow-up nudge:** shown only on the Personal tab and only when no other line shows. "**No reply from {first name} · {n} days**", followed by the subject. It has Dismiss (tooltip "Stops waiting for {first name}").

### 5. Toasts, hint line, undo

- **Undo send:** the undo toast (`lib/undo-toast.tsx`) reads "{Reply to Ana | Message to Ana} sends in {n} s", with " · thread marked Done" or " · reminds you {Thu}" when those happened. Its buttons are **Undo** (⌘Z) and **Edit**.
- **Triage toasts** follow the existing undo-toast rule: "Done · ⌘Z undoes", "Snoozed until Mon 9:00", and so on.
- **Hint line:** at the foot of the list, one persistent line. At rest it shows the next useful key ("e Done · s Snooze · t Task"). After a key it shows the result for 4 s ("Done, in Archive · ⌘Z undoes"). After a pointer action it shows "Next time press e" for 4 s. It follows the Settings "Show key hints" toggle.

### 6. Selection and bulk (prototype `bulk`)

- With two or more threads picked, the reader becomes the selection:
  - "**{n} selected**".
  - "Every action below applies to all {n}, as one step that z undoes."
  - The threads, each with an avatar, sender and subject.
  - The buttons Done `e`, Snooze… `s`, Make tasks `t`, Move… `m` and Delete `#`.
  - "Esc clears the selection."
- `t` on a selection makes one task per thread. Today it converts only the first.
- ⌘A selects every thread in the tab, not only the loaded window. The bulk op takes thread ids from the store's full id list for the current query.

### 7. Keyboard (prototype `keys`)

The registry (`lib/hotkeys/registry.ts`) gains the following, each with a handler:

- **Single keys:** `⇧E` Not done, `w` Remind me if no reply, `o` Expand all messages, `⌫` Delete (same as `#`), `⌘Z` Undo, `⌘N` New message (same as `c`), `↓`/`↑` (aliases of `j`/`k`), and **`Enter` opens the thread**. Enter is registered today but has no handler.
- **Panel keys:** `⌥1` Today, `⌥2` Contact, `⌥3` Task (§10).
- **`g` chords, pressed within 1 s:** `gi` Inbox, `gf` Follow-ups, `gs` Snoozed, `ga` Archive, `gt` Sent, `gd` Drafts. The registry gains chord support: a key whose `keys` is a two-step sequence. While the first key waits, the hint line shows "g…".
- **The `?` sheet:**
  - Three columns: Move, Act, Connect.
  - Connect holds ⌥1–3, `t`, `l` and `n`.
  - A Write group holds ⌘↵ Send, `;;` Snippet and Esc Close.
  - Key pairs read "next · previous" ("j k", "] [").
  - Move and delete reads "m # ⌫".

### 8. Reader (prototype `default`, `long`, `invite`, `bodyOffline`, `bodyFetch`, `unknownSender`, `newSenders`, `whyHere`, `whyRule`, `moreMenu`, `linkPicker`, `snoozePicker`, `remindPicker`, `outbox`, `sendFailed`)

- **Toolbar:** Reply `r`, Reply all `a`, Forward `f` | Done `e`, Snooze `s`, Remind `w` | Task `t`, Link `l`, Note `n` | Pin, Move `m`, ⋯ | Panel toggle. These are icon buttons with tooltips naming the key. The pressed state shows a dot.
- **Subject,** then the **chip row:**
  - **State chips:** "Waiting · reminds Thu", "Returns Mon 9:00", "Done".
  - **One chip per linked entity:**
    - Task: "Task: Confirm Acme pilot", which opens the task.
    - Note.
    - Event.
    - Contact.

    Each chip has a hover ✕ that unlinks, with undo.
  - **The Link chip:** a link icon with its `l` key cap, `aria-label` "Link to a task, contact or note".

  Links come from the spine (`links` where one side is this thread's `email_ref`). They are read once per open thread and refreshed on the `links` realtime channel.
- **Link picker** (`l`): the shipped mention picker. Rows already linked show "Linked" in place of their hint and toggle an unlink.
- **Who-card** (top of the conversation, contact known): avatar, name, role · company, "Last: {lastTouch}", counts ("2 open tasks · 1 note · next meeting Thu"), and Open contact. When the sender is not a contact: "Not in your contacts" and Add as contact. When the thread is screened (New senders): primary **Allow** `y` and ghost **Block** `b`, which replace Add as contact. The shipped "Mail with X" `<details>` is removed; its content moves to the Contact panel.
- **Message cards:**
  - Each card has an avatar, the name, and a to-line ("to you, Dana · Show addresses").
  - Per message: reply, reply all, forward.
  - Threads with more than five messages fold the middle into "{n} earlier messages", which expands on click or `o`.
  - The quoted toggle stays.
  - "Show original" moves into ⋯.
- **Tracker bar:** shown only when images are blocked or trackers were stripped. One line: "**{n} trackers blocked** · images off", with Load images and Always.
  - Always remembers the sender on this Mac. The engine kv is `images_allow:<address>`; it is not synced (see §Assumptions).
  - An "Original colours" toggle sits at the end of the bar for HTML mail in dark mode.
- **Body states** (`MailMessage.bodyState`):
  - `full`: render.
  - `text_only` or `evicted` while online: the snippet, then "Downloading the rest of this message…" with a 2 px progress hairline. It swaps in when the engine's `threads_changed` event names the thread.
  - `none` or `text_only` while that account is offline: "Available when you're back online". Attachments show as dashed "pending" tiles.
- **Send notes** (Outbox and failed sends, in the reader):
  - Outbox: "**Waiting for connection**" (or "Sending…"), with Edit.
  - A draft with `lastError`: "**Not sent:** {reason}", with **Fix and send**, which opens the composer on that draft.
- **⋯ menu, in order:**
  - Remind me if no reply… `w`
  - Mark unread `u`
  - Move… `m`
  - Labels… (Gmail only)
  - Mute
  - **Why is this in {Tab}?**
  - Mark Priority
  - Show original
  - Copy link
  - Block {sender}
  - Report spam
  - Delete `#`

  Mute, Report spam and Block run the existing `mute`, `spam` and `block_sender` ops. Each has an undo toast.
- **"Why is this in {Tab}?"** (A3, explain only):
  - A popover with the heading "Why this is in {Tab}" and one sentence naming the deciding reason. For example: "Your Investors tab collects mail from northzone.vc." · "Your rule 'Receipts' moved it." · "Ana is in your contacts." · "Lumen sends with an unsubscribe header, so it reads as a newsletter."
  - An ordered list of the six steps (Blocked senders, Your rules, Your choice for this sender, Custom tabs, People in your contacts, Mailing-list headers). Steps before the deciding one are dimmed, and the deciding step is marked with an sr-only "(this decided it)".
  - The footer links to the Settings section that controls that step ("Edit rules in Settings", "Edit custom tabs in Settings", "Blocked senders in Settings"). For `known_contact` and `header_heuristics` it reads "Change where Ana goes in Settings → Mail → Rules".
  - No segmented control and no rule dialog.
- **Snooze picker:**
  - The presets (Later today 18:00, Tomorrow 9:00, This weekend Sat 9:00, Next week Mon 9:00, Someday), each with its resolved time.
  - A typed field replaces `datetime-local`. It parses "thu 9am", "in 3 days", "next week" and "dec 2" with a live preview, and "Can't read that" when it can't parse.
  - The note "Returns to the top of Personal at that time."
  - It is anchored to the trigger button.
  - The remind picker (`w`) uses the same presets, with "if no reply".

### 9. Composer (prototype `reply`, `newMessage`, `alias`, `snippet`, `tooBig`, `intro`, `undoSend`)

- **Placement:** a reply opens inline under the conversation. A New message fills the reader column, which the list keeps beside it. The floating bottom-right box is removed. Esc closes it and keeps the draft.
- **From:**
  - A menu, shown only when more than one alias exists. Each alias row shows its account dot and address, and the default alias reads "default for {account}".
  - Under the From line: "Signs '{first line of signature}'" and "Aliases and signatures…", which opens Settings.
  - Choosing another account's alias switches the account. This fixes a shipped bug where the `accountId` stayed put.
  - The alias's signature is inserted on open and swapped on change (`swapSignature`).
  - `pickAlias` chooses the alias on reply.
- **Recipients:**
  - To is a token input. Typing autocompletes from `correspondents(query)`, debounced 120 ms. Comma or Enter makes a token, and Backspace on an empty input removes the last token.
  - A "Cc Bcc" reveal adds the same fields for Cc and Bcc.
  - Reply all keeps Cc (as shipped).
- **Snippets:**
  - Typing `;;` opens a popup listing `;;key` and its preview.
  - Typing filters it. Tab or Enter inserts with placeholders resolved: `{first name}` comes from the recipient's display name, falling back to the address's local part only when there is no name.
  - An unknown key shows "No snippet called ;;{key}. Make one in Settings → Mail → Snippets."
  - The toolbar hint is ";; snippets".
- **Attachments:**
  - Each tile shows the name, size and a remove ✕.
  - The total is checked live against `sizeLimit(accountId)`.
  - Over the limit: "This message is {x} MB; {Provider} accepts up to {lim} MB. Remove {largest file} or share it as a link." Send is disabled, with a tooltip saying why.
- **Draft status** (right of the footer):
  - "Saved on this Mac" after a local save.
  - "Saved to Drafts" once the server has it (tooltip "Saved to Drafts on {account}").
  - While offline: "Saved on this Mac · reaches Drafts when you're online".
- **Instant intro:**
  - When replying to a message whose sender added someone new in Cc, a banner reads "{Priya} introduced you."
  - It has the button **Move {Priya} to Bcc**.
  - Undo returns her to To.
- **Footer:** Send ⌘↵, remind if no reply ("Remind me Thu if no reply", with the `w` presets), "Also mark the email Done" (Done on send), discard.
- Markdown shortcuts, paste-image and drag-to-attach stay as shipped.

### 10. Side panel (prototype `default`, `contact`, `unknownSender`, `taskMade`)

The right panel is togglable: the panel button, or `⌥1`, `⌥2`, `⌥3` to switch views. A view menu lists the three views and Hide. It hides by default below 1200 px. The fixed always-on Today column is removed.

- **Today** (`⌥1`):
  - The date in the heading.
  - Due-today count.
  - Events, with past ones muted.
  - Task drop targets (as shipped).
  - The drop hint shows whenever a thread is being dragged.
- **Contact** (`⌥2`):
  - The head: avatar, name, role · company, Open in Contacts.
  - Last touch.
  - Open tasks, notes and meetings with the person.
  - The mail and files with them, from the shipped `contact-mail.tsx`.
  - When the sender is unknown: "Add as contact", prefilled from `suggest-contact`.
- **Task** (`⌥3`, new): the task linked to this thread, shown after `t` or when the chip is clicked. It shows the title, status, due date, project and notes, plus "Open in Tasks". With no linked task: "No task yet · t makes one".

### 11. Search

As shipped (MR-13): **Mail has no search field of its own.** Search runs through ⌘K: `/` opens it with the Email chip, the operators work, and "Search older mail on {account}" and "Save this search to Mail" are there. This spec adds one thing: with the Email chip on, the placeholder reads "Search mail: from: subject: has:attachment is:unread". The dead legacy `features/email/search.ts` and its test are deleted.

### 12. Settings → Mail (A1, A3, A4)

- **Accounts:** each account is a card with:
  - Its hue dot and label.
  - **State:** "Up to date", "Syncing…", "Getting history · 40%", "Offline", "Needs you to sign in again" or "Can't sync: {reason}".
  - **"New mail arrives instantly"** (push) or **"Checks for new mail every minute"** (polling).
  - "Last synced {relative time}".
  - **History on this Mac:** the depth select, as shipped, with the line "Each device keeps its own."
  - **Buttons:** Sync now, Sign in again (only for `reconnect`), Disconnect.
- **Storage on this Mac:** unchanged, as shipped.
- **Rules:**
  - Saving a new or edited rule asks in place: "Also apply to the {n} already on this Mac?", with "Apply" and "Only new mail". The count comes from a dry run.
  - Rules now act on new mail, after the engine fix.
- **Custom tabs:** the add button disables at three, with the note "Up to 3 custom tabs".
- **Density:** the options become "Comfortable, 2-line preview", "Comfortable, 1-line preview" and "Compact, one line". A stored `compact` with `previewLines: 2` reads as Compact.

### 13. Web (prototype `web`)

`/email` on the web says what is true.

- **Banner:** "**Mail lives on your Mac.** Here you see the conversations you linked to a task, a note or an event, so the rest of your work can find them. Snoozes and follow-ups stay on the Mac." It has the button **Open Moduo for Mac**, which uses the existing desktop deep-link and falls back to the download page.
- **Section:** only "Linked conversations {n}". Each card shows the subject, the sender and the time, plus "Open task / note / event: {title}" chips and a "Continue on Mac" chip.
- **Removed:** the Snoozed and Follow-ups due sections.

## Edge cases

- **Several accounts offline** while one syncs: the offline line shows only when every account is offline. Otherwise each offline account gets its own "{Account} is offline" line in the account-line slot. Body pending states check the thread's own account.
- **An account is removed while scoped:** the scope clears, and the list returns to Inbox.
- **A custom tab is deleted while selected:** the selection falls back to Personal.
- **A tab rename:** takes effect within a second through the mirror.
- **"+N" with a 1024 px window and three custom tabs:** at least Personal plus the selected tab show.
- **The outbox drains while the user views Outbox:** the place stays, showing its empty copy, until the user leaves it. The rail entry hides when the user leaves.
- **A failed send is edited** and sent again: its `lastError` clears on save.
- **Undo window:**
  - An undo after the 8 s window takes the compensating path (MR-5), unchanged.
  - The toast's countdown uses `undoUntilMs` from the engine, not a UI clock.
- **Failed ops on two accounts:** one failed line per account.
- **Away:**
  - With more than 20 threads in `awayReturned`, the group shows the first 20 and "Show {n} more".
  - The line counts all of them.
- **Explain on an old thread** classified before the v2 store (no stored stage): the engine re-runs the classifier on the stored headers and answers. If headers are missing, the popover shows "Moduo sorted this before it kept a reason. It's in {Tab}." and the steps without a mark.
- **Rule apply-to-existing over thousands of threads:** the work runs as one bulk op in chunks of 500. The Settings row shows "Applying to 4,000…" until the command resolves, then "Applied to 4,000 · Undo". Closing Settings doesn't stop it.
- **Compact rows with a 200-character subject:** the subject truncates, and the snippet hides first.
- **Compact rows below 1200 px:** the sender column shrinks to 7rem.
- **Snippet placeholders with no recipient:** `{first name}` becomes an empty string, and the double space is collapsed.
- **Size limit:** inline images count. On Microsoft send through Graph the limit is 3 MB. The copy names "Outlook" and the 3 MB figure.
- **Intro detection with two new people in Cc:** detection takes the sender, not the new people. If the sender is the user, there is no banner.
- **Bulk across tabs:** the selection keeps only the current tab's threads. Switching tabs clears it.
- **⌘A on 100k threads:** the op is one bulk op with one undo. The engine chunks it.
- **`g` chord timing:** if the second key never comes, the chord drops after 1 s. Any non-chord key cancels it and acts normally.
- **Web without any linked thread:** "No linked conversations yet. Link an email to a task on your Mac and it shows here."
- **Reader for a thread whose account is in `reconnect`:** reading works from the store, and actions queue. The reader shows the line "{Account} needs you to sign in again; your changes wait."

## Acceptance criteria

Each criterion names the prototype state it must match. A criterion is met by the test named in the next section, or by the lab state named in MV-12.

**Wiring and engine**

- **AC1:** The rail's Outbox shows with its count whenever a send is queued, and opens a list of the queued messages. It hides when the queue is empty. (`outbox`)
- **AC2:** Custom tabs from Settings appear in the tab strip in position order, at most three, and filter the list. (`investors`)
- **AC3:** When the engine reports an account offline, the offline line and the body pending states appear without a reload. (`offline`, `bodyOffline`)
- **AC4:** Snoozes that came due while the app was closed show as the "Came back while you were away" group and line. Dismiss clears both. (`away`)
- **AC5:** Reconnect opens sign-in for that account, and Retry now runs Sync now for that account.
- **AC6:** A rule with a move, mark read, skip inbox, label or block action acts on new mail as it syncs.
- **AC7:** Saving a rule in Settings offers to apply it to the N matching threads already on this Mac. Apply runs it as one undoable bulk op.
- **AC8:** "Why is this in {Tab}?" names the deciding step and the reason for any thread, including threads synced before this change. (`whyHere`, `whyRule`)
- **AC9:** A failed op line names each action and its thread, and Undo and Retry act on exactly those ops. (`failed`)
- **AC10:** The draft status moves from "Saved on this Mac" to "Saved to Drafts" once the server has the draft. Offline, it shows the offline suffix. (`reply`)
- **AC11:** A send that fails returns to Drafts with "Not sent: {reason}", and "Fix and send" reopens it. (`sendFailed`)

**Shell and list**

- **AC12:** The rail matches §1: the header with Sync and Settings, New message, icons, Outbox only when non-empty, view counts, Attachments, Accounts before Saved searches, account scope, the first-sync filter, and the compact rail at 700 px height. (`default`, `firstSync`, `attachments`)
- **AC13:** Tabs that don't fit fold into "+N". The selected tab never folds, and the menu lists all tabs with counts. (`investors` at 1024 px)
- **AC14:** The list shows the away, pinned and everything-else groups. Newsletters group per sender with Done all. (`default`, `away`, `newsletters`)
- **AC15:** Rows match §3: the identity avatar with the account ring, the unread dot, the hover checkbox, "To {name}" by place, the stripped subject, every flag in the table, time by place, and hover actions that never move the time. (`default`, `followups`, `snoozed`, `outbox`, `sendFailed`)
- **AC16:** Compact density is one 32 px line. Comfortable is 72 px with one or two preview lines. The Settings density options match §12. (`dense`)
- **AC17:** Empty states read "{Tab} is clear" with the other tabs' unread buttons, plus the per-place copy and Back to Inbox. First sync shows skeleton rows. No account shows four providers. (`inboxZero`, `emptyFolder`, `firstSync`, `firstRun`)
- **AC18:** The system lines appear in §4's order with §4's copy. The nudge shows only on Personal when no other line shows. (`offline`, `reconnect`, `failed`, `away`, `followups`)
- **AC19:** Undo send uses the undo toast with "{Reply to Ana} sends in {n} s · thread marked Done", plus Undo and Edit. The hint line behaves as §5 says. (`undoSend`)
- **AC20:** Two or more picked threads turn the reader into the bulk summary with five actions. `t` makes one task per thread, and ⌘A selects the whole tab. (`bulk`)
- **AC21:** Every key in §7 works, including Enter and the `g` chords. The `?` sheet shows the three columns and the Write group. (`keys`)

**Reader, composer, panel, settings, web**

- **AC22:** The reader shows the toolbar, the chip row with linked entities and the Link chip, and the link picker marking what is linked. Unlinking from a chip undoes. (`default`, `linkPicker`, `taskMade`)
- **AC23:** The who-card shows for known senders, "Not in your contacts" for unknown ones, and Allow/Block for screened ones. Allow and Block act as the New senders panel does. (`default`, `unknownSender`, `newSenders`)
- **AC24:** Message cards fold past five messages, show a to-line and per-message actions, and `o` expands everything. (`long`)
- **AC25:** The tracker bar reads "{n} trackers blocked · images off". Always loads this sender's images from then on, on this Mac. Original colours toggles. (`default`)
- **AC26:** The ⋯ menu has §8's items in order. Mute, Report spam and Block run their ops with undo. (`moreMenu`)
- **AC27:** The snooze picker parses typed times and shows the note, and it is anchored to its button. (`snoozePicker`, `remindPicker`)
- **AC28:** A reply composes inline and a New message fills the reader column. No floating composer remains. (`reply`, `newMessage`)
- **AC29:** The From menu switches alias, account and signature together. (`alias`)
- **AC30:** To, Cc and Bcc are token inputs with correspondent autocomplete. (`newMessage`)
- **AC31:** `;;` snippets preview and insert with the recipient's first name. An unknown key shows the help line. (`snippet`)
- **AC32:** An over-limit message names the provider, its limit and the largest file, and Send is disabled. (`tooBig`)
- **AC33:** Replying to an intro shows the banner, and "Move {name} to Bcc" moves them. (`intro`)
- **AC34:** The side panel toggles, switches with ⌥1–3, and shows Today, Contact and Task as §10 says. Below 1200 px it starts hidden. (`default`, `contact`, `taskMade`)
- **AC35:** Settings → Mail account cards show state, push or polling, last synced, depth, Sync now and Sign in again. Custom tabs cap at 3, and density offers the three options. (Settings lab state)
- **AC36:** The web `/email` shows only the honest banner and Linked conversations, with entity chips. Nothing claims snoozes or follow-ups. (`web`)
- **AC37:** ⌘K's Email chip shows the mail placeholder, and the legacy `features/email/search.ts` is gone. (`search`)

**Gates**

- **AC38:**
  - The Mail lab states in MV-12 render with no serious axe violation.
  - Token conformance stays Tight: no raw colours, sizes or radii. The 32 px compact row is a token.
  - `bun run verify` and the Rust mail tests pass.
  - The Mail paint budget from MR (150 ms to first rows on the 100k fixture) still holds.

## Tests that prove them

The layers:

- `apps/app` unit and component tests are Rstest, with Testing Library for components.
- Rust tests run under `cargo test -p moduo mail::`.
- The lab states live in `e2e/lab/mail-lab.ts`, on the fixture engine.

The paths below are relative to `apps/app/src/features/email/` (E/) and `apps/desktop/src-tauri/src/mail/` (R/).

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| R/store/schema.rs · `v2_adds_columns_and_keeps_rows` | AC8, AC12 | Opening a v1 database upgrades it to v2 without losing a row. |
| R/sync/engine.rs · `round_runs_rule_effects` | AC6 | A rule that moves or marks read actually queues that op when new mail arrives. |
| R/rules.rs · `apply_existing_counts_then_applies_in_chunks` | AC7 | The dry run counts matching threads; the apply queues one bulk op in chunks. |
| R/sync/classify.rs · `stage_and_rule_id_are_persisted` | AC8 | Each message stores which step sorted it and which rule. |
| R/host · `explain_falls_back_to_reclassify` | AC8 | A thread with no stored reason is re-classified on its headers to answer. |
| R/host · `op_failed_carries_thread_ids_and_subject` | AC9 | The failure event names the threads, and the failed list has subjects. |
| R/send · `draft_upload_emits_draft_changed_with_server_uid` | AC10 | After the 2 s upload the app hears the draft reached the server. |
| R/sync/live.rs · `last_synced_and_push_are_reported` | AC12, AC35 | The account row reports when it last synced and whether it uses push. |
| R/store · `counts_include_outbox` | AC1 | The counts include the number of queued sends. |
| R/store · `thread_row_flags` | AC15 | A thread row carries follow-up time, return reason and outbox/failed state. |
| R/ops · `mute_archives_new_replies` | AC26 | A reply to a muted thread skips the Inbox. |
| E/ui/mail-page.test.tsx · "passes outbox count, custom tabs, offline and reconnect account" | AC1–AC5 | The page hands the shell real data, not the old placeholders. |
| E/ui/mail-rail.test.tsx · "header, new message, outbox only when non-empty, view counts, order, scope" | AC12 | The rail shows every §1 element and scopes on account click. |
| E/ui/mail-tabs.test.tsx · "folds overflow into +N and never folds the selected tab" | AC13 | With a narrow width the extra tabs move into the menu; the selected one stays. |
| E/shell/use-thread-window.test.ts · "away, pinned and everything-else groups" | AC4, AC14 | The list window yields the three groups with headers in order. |
| E/ui/mail-row.test.tsx · "flags, to-line, stripped subject, time by place" | AC15 | Each flag shows in the right case, and subjects lose Re:/Fwd:. |
| E/ui/mail-row.test.tsx · "compact is one 32 px line" | AC16 | Compact rows render a single line at the compact token height. |
| E/ui/mail-states.test.tsx · "tab clear, per-place empty, skeleton, four providers" | AC17 | Each empty and first-run state shows its copy and buttons. |
| E/ui/system-lines.test.tsx · "order, copy, nudge only alone" | AC3, AC4, AC5, AC9, AC18 | The lines appear in order with the agreed copy, and the nudge hides when another line shows. |
| E/ui/mail-page.test.tsx · "undo send toast copy and edit" | AC19 | The undo toast names who it sends to and what else happened. |
| E/ui/hint-line.test.tsx · "rest, after key, after click" | AC19 | The hint line shows the next key, the last result, then the key tip. |
| E/ui/bulk-reader.test.tsx · "n selected with five actions; t makes n tasks" | AC20 | The reader becomes the selection, and Make tasks makes one per thread. |
| E/shell/selection.test.ts · "select all takes the full id list" | AC20 | ⌘A picks every thread in the tab, not just the loaded ones. |
| lib/hotkeys/registry.test.ts · "chords resolve within 1 s and cancel on other keys" | AC21 | `g` then `i` goes to Inbox; a slow or different second key doesn't. |
| E/ui/mail-shell.test.tsx · "every §7 key has a handler" | AC21 | No key in the legend is dead (Enter included). |
| E/reader/mail-reader.test.tsx · "toolbar, chips from links, link chip" | AC22 | The reader shows its toolbar and one chip per linked entity. |
| E/reader/who-card.test.tsx · "contact, unknown, screened" | AC23 | Each sender kind gets its card and buttons. |
| E/reader/message-card.test.tsx · "fold past five, to-line, per-message actions" | AC24 | Long threads fold; each card has its to-line and actions. |
| E/reader/tracker-bar.test.tsx · "copy, Always remembers sender" | AC25 | The bar's copy, and Always records the sender in the engine. |
| E/reader/mail-reader.test.tsx · "body pending online and offline" | AC3 | Older mail shows downloading or offline copy by state. |
| E/reader/more-menu.test.tsx · "items in order; mute, spam, block run ops" | AC26 | The ⋯ menu matches the spec and its actions call the engine. |
| E/reader/why-here.test.tsx · "names the deciding step for each stage" | AC8 | For each of the six steps the popover marks it and links to Settings. |
| E/snooze.test.ts · "parses thu 9am, in 3 days, next week, dec 2" | AC27 | Typed snooze times resolve to the right moment. |
| E/compose/mail-composer.test.tsx · "inline reply, reader-column new message" | AC28 | No floating composer; it renders where the spec says. |
| E/compose/mail-composer.test.tsx · "alias switch changes account and signature" | AC29 | Picking another account's alias moves the account and swaps the signature. |
| E/compose/recipients.test.tsx · "tokens, autocomplete, cc/bcc reveal" | AC30 | Typing makes tokens from suggestions; Cc and Bcc appear on demand. |
| E/compose/snippets.test.ts · "first name from display name; unknown key line" | AC31 | `{first name}` uses the real name; a missing snippet shows help. |
| E/compose/size-limit.test.ts · "names provider, limit and largest file; graph 3 MB" | AC32 | The over-limit message is specific, and Send is disabled. |
| E/compose/intro.test.ts · "detects introducer, moves to Bcc, undo" | AC33 | The intro banner appears only for real intros and moves the introducer. |
| E/compose/mail-composer.test.tsx · "draft status stages and offline suffix" | AC10 | The status text follows the engine's save and upload events. |
| E/ui/mail-page.test.tsx · "failed send shows Not sent and Fix and send" | AC11 | A draft with an error shows its reason and reopens. |
| E/panels/side-panel.test.tsx · "toggle, ⌥1–3, hidden under 1200" | AC34 | The panel switches views by key and starts hidden on narrow windows. |
| features/settings/mail/accounts-group.test.tsx · "state, push, last synced, depth, actions" | AC35 | Each account card shows its live status and buttons. |
| features/settings/mail/items-groups.test.tsx · "apply to existing prompt; tabs cap at 3" | AC7, AC35 | Saving a rule offers to apply it; a fourth custom tab can't be added. |
| E/ui/email-web-view.test.tsx · "honest banner, linked only, chips" | AC36 | The web page says Mail lives on the Mac and shows only linked threads. |
| components/app/global-command-palette.test.tsx · "email chip placeholder" | AC37 | The mail placeholder shows with the Email chip on. |
| scripts/ci/legacy-email.test.ts · add `features/email/search.ts` | AC37 | The old search file stays deleted. |
| e2e/lab/mail-lab.ts · the MV-12 states and journeys | AC38 | The lab renders every new state with no serious axe rule and token conformance Tight. |

## Assumptions & technical decisions

Each entry is a decision, why it was made, and the alternative rejected. The entries marked **(decision)** go into `docs/decisions/email.md` as MV entries.

1. **(decision) One refactor, one PR.** All blocks run back to back on `t/mike/mail-v3` and land as one PR into `mike`. The PR is a draft until the last block, and each block is a commit with verify green. *Why:* Mike asked for it; the blocks touch the same shell files, so parallel sessions would conflict. *Rejected:* a session per block.
2. **(decision) Local schema v2, no Supabase migration.** `R/store/schema.rs` gains a second migration entry. *Why:* every new fact is device-local; synced settings already fit `email_settings_items`. *Rejected:* adding `last_sync_at` to the cloud `email_accounts` upsert, because nothing on the web needs it. The new columns are:
   - `accounts.last_synced_ms INTEGER` and `accounts.push INTEGER`.
   - `messages.classify_stage TEXT` and `messages.classify_rule_id TEXT`.
3. **Classifier reasons are stored at ingest, with a re-classify fallback.** The new command is `mail_explain(threadId) → { stage, ruleId?, customTabId?, address, tab }`. It reads the newest message's stored stage, or re-runs `classify` on its stored headers when the stage is NULL. *Why:* this is exact for new mail and still answers for old mail. *Rejected:* explain only by re-running, which drifts from the truth after rule edits.
4. **Rule effects run after each sync round.** `RoundReport.effects` goes through `rules::plan_effects` into `ops::enqueue_op` as a `system` origin. These ops are excluded from the undo toast and from the failed line unless they fail. *Why:* this is the documented MR-12 behaviour that never got wired.
5. **Apply to existing is a new command,** `mail_apply_rule_existing(ruleId, dryRun) → { count }` over `rules::apply_to_existing`. It queues the ops in chunks of 500 under one bulk id (one undo), and resolves when every chunk is queued.
6. **No new event kinds.** These are all already in the contracts:
   - The draft upload re-emits `draft_changed`, with `serverUid` now set.
   - `op_failed` carries its thread ids.
   - Bodies arrive through `threads_changed`.
   - Offline comes from `sync_status`.
   - Rule-apply progress needs no event: the command resolves when the apply has run.

   *Why:* `@contracts/mail` stays untouched, which keeps this out of Tier 2.
7. **Row flags come partly from the engine and partly from the spine.**
   - The engine adds `followUpAtMs`, `returnReason: "snooze" | "reply" | null`, and `outboxState: "pending" | "in_flight" | null` to `MailThreadRow`.
   - Task and note flags come from one batched spine read per visible window. This is a new `linkedKindsFor(threadIds)` on `MailSpinePort`, cached in the store and refreshed on the `links` realtime channel.
   - "Not sent" comes from drafts with `lastError`.
   - *Why:* links live in Supabase, not the mail store. *Rejected:* mirroring links into SQLite.
8. **The Outbox count joins `Counts` in Rust** (`outbox: number`). `OutboxView` is mounted, and its state names are fixed to the engine's `pending` and `in_flight`.
9. **Offline per account** comes from `syncState === "offline"`. The global offline line shows only when every account is offline. *Why:* the engine's state is per account.
10. **"Came back while you were away" uses the existing `awayReturned`.** It needs no last-seen timestamp. Follow-ups that came due while the app was closed join it, because the controller already computes `followupsDue` at launch.
11. **The image allow list is device-local:** engine kv `images_allow:<address>`, through a new `mail_set_image_allow(address, allow)` and a read in `getThread`. *Why:* adding a synced settings kind needs a CHECK migration and contracts (Tier 2) for a small gain. *Rejected:* a new `email_settings_items` kind; that can come later.
12. **Mute archives new replies** on ingest when the thread is muted (Rust: check `muted` in the round, then a `system` archive op).
13. **Compact row height is a token,** `--mail-row-compact: 2rem` in `tokens.css`. `ROW_HEIGHT.compact = 32` in `mail-row.tsx` mirrors it, and a test asserts they are equal. *Why:* the virtual list needs a number, and tokens remain the source.
14. **The density vocabulary is unchanged.** `MailDensity` stays `comfortable | compact`, and compact ignores `previewLines`. *Why:* no contracts change and no preferences migration.
15. **`g` chords are a registry feature:** `keys: ["g", "i"]` as a sequence, resolved by the hotkey dispatcher with a 1 s window. *Why:* other modules will want chords. *Rejected:* a Mail-local key listener, which would bypass the legend.
16. **The side panel uses the shell's right panel** (`components/app/right-panel.tsx`, `feature-panels-shell.tsx`) through Mail's own `panel-views.ts`, the way Tasks registers its panel views. The open view is kept in the store (`panel: "today" | "contact" | "task" | null`). *Rejected:* a Mail-only panel component.
17. **The composer renders in the reader slot.** A reply is a child of the conversation; a New message replaces the reader content. The floating box and its `placement` prop are removed.
18. **"Why here?" is read-only (A3).** The `sender_override` writer stays Settings-only, and no rule dialog is built.
19. **The account status card lives in Settings (A1)** and reads the same `MailAccount` fields. The rail keeps only the dot and the warning glyph.
20. **No reauth deadline.** The Google 7-day re-approval note is not shown, because no token issue time is stored. *Rejected:* storing it now, for a state only testing-mode OAuth clients hit.
21. **The fixture engine grows with the engine.** Every new port method and field gets a fixture implementation in `features/email/testing/`, so the lab states and tests run without IMAP. *Why:* the lab runs on the fixture engine (MR-16).
22. **The spine link kind is `references`.** It is fixed separately in GrochowskiMichal/Moduo#795. If that hasn't merged into `mike` by MV-8, merge `origin/mike` into the build branch once it has; MV touches nothing else in `commands/spine.ts`.
23. **MCP and the dashboard widget are unchanged** (module contract). MCP email tools keep their shape. See Out of scope for the snooze mismatch.

## Execution mode

This runs as a single refactor:

1. Cut `t/mike/mail-v3` off the spec commit (`t/mike/mail-v3-spec`, or `origin/mike` once the spec has merged) in its own worktree.
2. Open one draft PR into `mike` titled `[MV] Mail v3: the screens catch up with the engine`. Its body lists MV-0…MV-12; that claims them in the queue.
3. Run `/s2` once inside `/goal`, with the instruction "build MV-0 through MV-12 in order on this branch". For each block:
   - Write that block's tests first, then build.
   - Run `bun run verify`, plus `cargo test -p moduo mail::` for blocks that touch Rust.
   - Commit as `MV-n: <name>`.
4. Rules that keep the run moving:
   - Three failed attempts at one problem: record it under ❓ in the PR body and move on to the next block that doesn't depend on it.
   - Compaction is expected. A fresh context resumes from this spec, `git log`, and the PR body's checklist.
5. MV-0 sets the contract: the port types and the fixture. Those test files are frozen after MV-0's commit.
6. Tier: TS plus Rust under `src/mail/` (not on the Tier 2 list) and `tokens.css`. No contracts or migrations change, so Tier 1 is expected. If `bun scripts/ci/tier.ts origin/mike` says Tier 2, run the validator once before the PR is marked ready.
7. When the last block passes, mark the PR ready, merge into `mike` on green, then run `/product-studio criticise email` for the new baseline against 7.7.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| MV-0 | **Contracts, fixture and frozen tests** | The TS port additions are listed under this table. The fixture engine implements all of them, plus the states the lab needs (outbox item, failed send, away returns, offline account, reconnect account, failed ops with subjects, explain answers per stage). It also writes the failing test skeletons from the tests table. | AC1–AC38 (skeletons) | — |
| MV-1 | **Engine: store v2 and reads** | Schema v2 (decision 2), stamping `last_synced_ms` and `push`, persisting the stage and rule id, `mail_explain` with the fallback, thread-row flags, outbox in `Counts`, `op_failed` thread ids plus the subject on failed ops, `undoUntilMs` returned, `draft_changed` after upload, the image allow kv and command. Rust tests. | AC1, AC8, AC9, AC10, AC12, AC15, AC25 (engine) | MV-0 |
| MV-2 | **Engine: rules and mute act** | `plan_effects` wired into each round, `mail_apply_rule_existing` (dry run plus chunked apply with progress), mute archives new replies. Rust tests. | AC6, AC7 (engine), AC26 (mute) | MV-1 |
| MV-3 | **Wiring the page** | `MailPage` → `MailShell` gets the outbox count, custom tabs, per-account offline, `awayReturned`, Reconnect and Retry per account, view counts and the chosen provider. The composer gets `sizeLimit`, `correspondents`, `introducer` and `now`. The alias `accountId` fix, the snippet first name, `OutboxView` mounted with the state names fixed. The web view's honest copy and linked-only section. Legacy `search.ts` deleted, and the ⌘K mail placeholder. | AC1–AC5, AC11, AC36, AC37 | MV-0 (fixture); MV-1 for live data |
| MV-4 | **Rail** | §1 in full, with the account scope through `useThreadWindow` and the counts. | AC12 | MV-3 |
| MV-5 | **List rows, groups and density** | §3: widths, place heading, the three groups, newsletter grouping, row lead, to-line, subject strip, flags (engine fields plus the spine `linkedKindsFor`), time by place, hover overlay, hairline, the compact 32 px token. Settings density options. | AC14, AC15, AC16 | MV-3, MV-1 |
| MV-6 | **Tabs, empty states, system lines, toasts, hint line** | §2, §4 and §5: the "+N" overflow, "{Tab} is clear", per-place empties, skeleton first sync, four providers, the system lines in order, the nudge gate, the undo-send toast through `undoToast` with `undoUntilMs`, the persistent hint line. | AC13, AC17, AC18, AC19, AC9 (UI) | MV-3 |
| MV-7 | **Selection, bulk and keyboard** | §6 and §7: the bulk reader, multi-convert, ⌘A over the full id list, registry chords, the new keys and handlers, Enter, the three-column `?` sheet. | AC20, AC21 | MV-5, MV-6 |
| MV-8 | **Reader** | §8, except the ⋯ menu and "Why here?": the toolbar, chip row with spine links and unlink undo, link picker "Linked", who-card (contact, unknown, screened Allow/Block), message cards with fold, to-line and per-message actions, the tracker bar with Always and Original colours, body pending states, send notes. "Mail with X" removed. | AC22, AC23, AC24, AC25, AC3 (reader), AC11 (reader) | MV-3, MV-1 |
| MV-9 | **⋯ menu, "Why here?" and pickers** | The full ⋯ menu with Mute, Spam and Block ops, the read-only "Why is this in {Tab}?" popover over `mail_explain` with links into Settings, the snooze and remind picker with typed parsing, the note and a real anchor. | AC8 (UI), AC26, AC27 | MV-8, MV-2 |
| MV-10 | **Composer** | §9: inline and reader-column placement (floating box removed), the From menu with aliases, signature and account, token To/Cc/Bcc with autocomplete, snippet popup, attachment tiles with live size checks and Send disabled, two-stage draft status and offline suffix, the intro banner, the footer. | AC10 (UI), AC28–AC33 | MV-8 |
| MV-11 | **Side panel and Settings** | §10: the togglable right panel with Today, Contact and Task and ⌥1–3 (the fixed column removed). §12: account cards, apply-to-existing in Rules with its progress line, custom-tab cap. | AC34, AC35, AC7 (UI) | MV-8, MV-2 |
| MV-12 | **Lab, docs and close** | The lab states and journeys listed under this table. Docs: `docs/decisions/email.md` MV entries, `specs/mail-rebuild.md` line 152 corrected, `docs/data-layers.md` §6 (store v2), `docs/gotchas/email.md` if a trap appeared, `.design/email/DESIGN_BRIEF.md` pointer to v3. A full `bun run verify` and the Rust mail tests. | AC38 | MV-4, MV-7, MV-9, MV-10, MV-11 |

**MV-0: the port additions**

- `MailEngine.explainThread`.
- `MailEngine.applyRuleExisting`.
- `MailEngine.setImageAllow`.
- `MailAccount.lastSyncedMs` and `push`.
- The `MailThreadRow` fields `followUpAtMs`, `returnReason` and `outboxState`.
- `Counts.outbox`.
- `MailOpRecord.subject`.
- The `applyOp` result `undoUntilMs`.
- `MailSpinePort.linkedKindsFor`.

**MV-12: the lab**

`e2e/lab/mail-lab.ts` gains these states, mapped to the prototype ids:

- `outbox`, `sendFailed`, `away`, `investors` at 1024 px, `whyHere`, `bulk`, `keys`
- `bodyOffline`, `newMessage`, `alias`, `tooBig`, `intro`, `contact`, `dense` (compact)
- `inboxZero`, `firstSync`, `failed`, `reconnect`, `web`, `settings-mail`

It also gains the journeys "triage three with keys and undo", "reply inline with a snippet and send", "open Why here" and "bulk Done".

## Out of scope

- The rail account status card (A1: it is in Settings).
- Rule creation from a thread and the "Always put X in" sender override (A3).
- A synced image allow list. It is device-local in this spec.
- Google re-approval deadlines.
- Mobile layouts, light-mode tuning, new routes.
- MCP tool changes and dashboard widget changes.
- **Known mismatch, follow-up:** the MCP `email_snooze` and `email_follow_up` tools write cloud `email_refs`, which the rebuilt desktop engine no longer reads (its snoozes are local). Snoozing from an agent therefore doesn't snooze on the Mac. Fixing it needs a design decision (the engine reading refs, or MCP refusing) and is not part of this refactor.
- A single-line comfortable density, and further densities.
- Depth ceiling: this spec changes no sync, ingest or send semantics beyond the gaps named in §Scope.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [x] **Open questions is empty.** A1–A4 are answered and every technical unknown is recorded under Assumptions.
- [x] **The data model is named.** It is a local SQLite v2 (decision 2) with no Supabase migration, a deliberate exception recorded with its reason.
- [x] **Module feature:** spine wiring is enumerated (§8 chips and unlink, link picker, `t`/`n`, drag to Today, Task and Contact panels). MCP tools and the widget are unchanged (decision 23).
- [x] **Execution blocks** are decomposed and sequenced, each context-sized and self-contained. They run back to back in one lane (§Execution mode).
- [x] **Design constraints acknowledged:** tokens only (the compact row is a token, decision 13), shadcn-wrapped primitives, `docs/DESIGN_RULES.md` R1–R10 for every new surface, and the undo-toast rule.
- [x] **Manual-test surfaces identified** for the PR's "Test this":
  - Offline, then back online, with a queued send.
  - A rule applied to existing mail.
  - Compact density at 1024 × 700.
  - Reply to an intro.
  - The `g` chords.
  - The web `/email`.

**Ready to execute.**

## Open questions

- [ ] (none)
