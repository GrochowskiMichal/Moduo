# Spec: Mail rebuild (engine, store, screens, power features)

> Status: **Draft, awaiting approval** · Owner: mike · Planned 2026-11-03 (`/s1`, three recon passes over `origin/mike` 725a482fc) · Milestone: **Open alpha** (16 Nov)
> Related: [.design/email/BRIEF.md](../.design/email/BRIEF.md) (JTBD, spine wiring, still authoritative) · [.design/email/DESIGN_BRIEF.md](../.design/email/DESIGN_BRIEF.md) (triage model §2, great moment §4; **this spec supersedes its §3 layout, §6 search and §8 provider list**) · [specs/email.md](./email.md) (EM-1…EM-11, the module this replaces) · [specs/global-search.md](./global-search.md) (GS-9, the ⌘K Email group this feeds) · [specs/import.md](./import.md) (IM-2 history depth; IM-2c-b is absorbed here) · [docs/data-layers.md §6](../docs/data-layers.md)
>
> **Execution mode (designer call, 2026-11-03):** one orchestrated run in a single session, built by waves of subagents on one task branch `t/mike/mail-rebuild`, one PR into `mike`. This deliberately overrides the one-block-per-session rhythm. The blocks below still exist, because they are the unit each subagent builds and the unit a fresh session resumes from if the run stops.

## Scope

A complete rebuild of Moduo Mail on the desktop: a new engine, a new local store, a new front-end state layer, rebuilt screens, and the daily-driver and power features a Spark/Superhuman replacement needs. It's built for **6 accounts and about 100,000 emails, with every interaction instant**. Mail stays **on the Mac** (designer call): no cloud mail relay, the inbox never leaves the machine, and web keeps the read-only linked-threads view. The legacy engine and screens are **deleted outright, not kept alongside**.

**Why now: what the recon proved is broken today** (each item is backed by the code at `origin/mike` 725a482fc):

1. **New mail never reaches the screen by itself.** IDLE writes to redb, but nothing emits to the webview (zero `emit`, zero `listen`). The list reloads only on mount, Refresh or triage. The front end never sends `mailForeground`, so the engine always runs its 5-minute background cadence.
2. **Opening an email gets slower as the store grows.** On every body fetch, `prune_body_cache_lru` deserializes every cached body of every account. A cache miss costs 3–4 TLS logins and 2–3 full downloads (body, `listAttachments`, inline images, per-envelope flag flush).
3. **The list command deserializes the whole folder and caps at 500 rows.** `envelope_to_dto` parses each row's full cached body just to set a boolean. The UI renders every row unvirtualized, with 4 tooltips and a dropdown per row, and nothing is memoized.
4. **Only the INBOX exists.** There is no Sent, Drafts, Archive, Trash or Spam, and backfilled history can't be reached.
5. **Changes made in other clients are lost.** Flags and deletions are reconciled only in the top 75 UIDs (200 forced). CONDSTORE is used with `CHANGEDSINCE 1`, which saves nothing. A burst of more than 50 arrivals skips UIDs.
6. **Failures vanish.** Flag and op outboxes drop entries silently after 8 tries. Triage commit errors are swallowed. Send has no outbox.
7. **Gmail OAuth is never refreshed in the IDLE/poll workers**, so after 5 failures a worker drops to polling for the rest of its life.
8. **State races.** A reload inside the 8 s undo window resurrects archived threads, and Undo then duplicates them. The account list is an unlocked read-modify-write that `send` clobbers.
9. **Drafts are discarded** on close. Compose is a modal over the thread.
10. **No tests** cover sync orchestration, IDLE, the outboxes, the body cache, send or OAuth. There are no e2e or lab journeys for mail, and no mail seed data.

## Product behavior & UX

The numbered answers this section relies on are in *Product answers* at the end. Their keys (A1, X3, …) are cited inline.

### Layout (three panes, in the existing `/email` route; no new top-level routes)

- **Rail:**
  - **Unified** with Inbox, Sent, Drafts, Archive, Trash, Spam and Outbox. Outbox shows only when non-empty.
  - **Snoozed**, **Follow-ups**, **New senders** (only when the Screener is on), **Attachments**, **Subscriptions** and **Saved searches**.
  - Then each account: hue dot, unread count, status glyph, and its folder tree, collapsed. Gmail labels appear as folders.
  - Connect account sits at the bottom.
  - A sync/progress line appears under an account while it backfills ("Syncing history · 40%" with Cancel).
- **List:**
  - Split-inbox **tabs** across the top: **Personal** · up to 3 custom tabs · **Notifications** · **Newsletters**. Each shows an unread count. `[` and `]` switch tabs.
  - The **Newsletters** tab groups by sender: one row per sender, which expands.
  - The list is **virtualized** over the whole folder. There is no row cap, and scrolling stays at 60 fps across 100k threads.
  - Rows show: sender(s) with avatar, subject, a 1- or 2-line snippet (density setting), time, account hue, unread weight, a pin, attachment and invite glyphs, the thread count, a Priority-person mark, and muted/snoozed marks.
  - Hover gives **one** compact action cluster: Done, Snooze, and a ⋯ menu.
  - Pinned threads float to the top of their tab.
  - "Get me to zero" sits in the tab's ⋯ menu.
- **Reader:**
  - A conversation stack: newest expanded, older collapsed to sender and snippet.
  - Quoted text and long signatures collapse.
  - Inline **reply composer** under the thread.
  - Attachments strip: preview with Space, drag out to Finder or onto a task.
  - An invite card for calendar invites.
  - An unsubscribe button for newsletters.
  - A tracker shield ("Blocked 2 trackers").
  - The images bar, and "Show original".
- **Right panel** (the app-wide switcher, existing):
  - Detail (spine hub).
  - **Contact**: sender context plus "All mail with this person" and their files.
  - **Task**, which opens after a convert.
  - **Today**: your agenda, plus "Create event from this email".
- **New message** takes over the reader pane. There are no pop-out windows (X27).

### Main flows

1. **Open Mail.** The last view paints instantly from the local store. New mail streams in at the top without moving your selection or scroll (A1).
2. **Triage.** `e` Done · `s` snooze · `p` pin · `#` delete · `u` unread · `m` move · `t` task · `l` link · `n` private note · `x` select (`⇧J`/`⇧K` extend, `⌘A` all in tab) · `z` undo.
   - Every action applies in the same frame and is reversible for 8 s.
   - After Done, snooze or delete, the next thread down opens (D27).
   - Failures are never silent. A failed action shows in a "Couldn't sync N actions" bar with Retry and Discard. Discard puts the thread back as the server has it.
3. **Read.** Opening a pre-downloaded thread paints at once. Older mail downloads on demand in about a second.
   - Remote images are blocked by default (D25 / S4).
   - Trackers are always stripped (X7).
4. **Reply.**
   - `r`, `a`, `f` open the inline composer under the thread. `c` starts a new message.
   - Drafts save locally as you type and to the server's Drafts folder 2 s after you stop typing (E37).
   - `⌘Enter` sends. The undo-send toast (5/10/20/30 s, default 10) has **Undo** and **Edit** (X22).
   - Replying from the inbox marks the thread Done on send (setting, default on; E48).
   - Offline, the message waits in **Outbox** and sends when you're back online (E43). A failed send returns to Drafts with the reason (E44).
5. **Search lives in ⌘K** (G, S1).
   - Mail has **no search bar of its own**. `/` in Mail opens ⌘K with the Email chip on.
   - Operators: `from:` `to:` `subject:` `has:attachment` `is:unread` `is:pinned` `in:<folder>` `before:` `after:`. Suggestions appear as you type an operator.
   - Results show instantly over all synced mail. Enter opens the thread in Mail with the triage keys live.
   - A "Search older mail on <account>" row reaches beyond the history depth.
   - A search can be saved to the rail (G59).
6. **Spine moments.**
   - `t` converts to a task (unchanged behavior, now instant).
   - `l` links to a task, contact, note or project.
   - `n` creates a private Moduo note linked to the thread.
   - Drag a thread onto a task or a calendar day.
   - "Create event from this email" works from the Today panel or an invite card.

### Sender intelligence

- **Priority people** (X2): mark a sender. Their mail gets a mark in the list and, if you choose, always notifies you, even though new mail is otherwise badge-only.
- **Screener** (X1, off by default): mail from someone you've never exchanged mail with, who isn't a contact, waits in **New senders** with Allow and Block.
- **Rules** (X3): **when** from / domain / to / subject contains / is a newsletter **then** move to folder · add label · put in tab · mark read · skip inbox · mark Priority · block. Rules apply to new mail as it arrives. "Apply to existing mail" runs on demand.
- **Custom tabs** (B8): up to 3, each defined by senders, domains or rules.
- **Block sender** (B18 / S3): future mail goes to Trash (default), Spam, Archive or a chosen folder (setting). The blocked list lives in Settings.
- **Subscriptions** (X6): every newsletter sender, when they last mailed you, one-click unsubscribe, and "Done all from them".
- **Unsubscribe** (B17): RFC 8058 one-click where offered, otherwise a mailto (sent for you, with a confirm) or the web page.
- **Avatars** (X17), in order:
  1. a Moduo contact photo;
  2. the sender's own domain logo (BIMI, then the site's icon), fetched once from that domain only, never through a third-party logo service, and never for free-mail domains;
  3. initials.

  There's a setting to switch fetching off.
- **"Add as contact" suggestion** after you've replied to someone 3+ times (X23). Never automatic.

### Notifications and badges

- New mail updates the badge only. The badge counts unread **Personal** by default; Settings offers Personal / All inbox / Off (A3 / S2). The same count shows on the Dock icon.
- The optional "notify me for Personal" is off by default (A2). Priority people can notify regardless.
- Due snoozes and follow-ups notify, as today. A due follow-up also returns to the top of the inbox as "No reply from Anna in 3 days", with **Dismiss** (X19).
- Mail runs whenever the app runs, on any page (A4): sync, snooze returns, follow-up checks, reply-unsnooze. Nothing runs while the app is closed. At launch, snoozes that came due show "came back while you were away" (A5).

### Settings → Mail

- **Accounts:** status, Reconnect, Disconnect. Disconnect deletes this Mac's copy of the account's mail (I69).
- **Aliases:** send-as addresses with a default per account (E39). **Signatures:** one per alias (E40).
- **Snippets:** inserted with `;;` and supporting `{first name}`-style placeholders (E41).
- **Rules**, **custom tabs**, **Priority people**, **blocked senders**, and the **Screener** switch.
- **Behavior:**
  - badge (S2);
  - notify for Personal (A2);
  - remote images: Block / Contacts only / Always (S4);
  - tracker blocking (X7, on);
  - spell check (X18, on);
  - undo-send length (E42);
  - Done on send (E48);
  - density Comfortable/Compact with 1- or 2-line previews (X24);
  - shortcut hints (X21, on);
  - sender logos (X17, on);
  - history depth per account (I67).
- **Storage per account:** "mail X GB · attachments Y GB" (S7), the disk cap (default 2 GB), and the buttons **Clear attachments** and **Clear all downloaded mail**.
- **Default mail app:** "Make Moduo the default mail app" (X25).

### Accounts

- **Providers:**
  - Gmail (personal): app password or Sign in with Google.
  - **Google Workspace**: Sign in with Google only (I66 / S6).
  - iCloud: app-specific password.
  - **Microsoft**: Outlook.com/Hotmail and Microsoft 365, Sign in with Microsoft (I65 / S5).
  - Custom IMAP.
- **Honest copy:**
  - Google sign-in in testing mode asks you to re-approve every 7 days.
  - A Workspace or M365 org may need its admin to allow Moduo once, and the error says so.
  - An M365 org that has turned off app sending still sends (decision 14).
- **First sync** (I68): the newest mail is usable within about 10 s, then history fills in with visible progress and Cancel.
- **Upgrade from the old engine** (K75): accounts and keychain secrets carry over without re-login. Mail re-downloads in the background, and the inbox is usable within seconds. Snoozes, pins and follow-ups carry over, because they already live on the server and in the cloud.

### Web

Unchanged read-only tissue view (Snoozed, Follow-ups, Recently linked), plus a proper loading state (J72). Email still appears in ⌘K on web as pulled-in threads only (GS-9).

## Edge cases

- **Undo inside the window, after a reload or a new sync round.** The thread stays hidden, because local state is the truth. Undo restores exactly one copy, never duplicates.
- **Undo after the op reached the server.** A compensating op moves it back (for example, MOVE from Archive back to INBOX). If that fails, it lands in the failed-actions bar.
- **Another client changes flags or deletes mail anywhere in the synced history.** Moduo matches it within one sync round (CONDSTORE modseq where the server has it, otherwise a UID-set diff).
- **The server recreates a mailbox (`uid_validity` change).** Its rows are re-downloaded. Ops queued against old UIDs are re-targeted by Message-ID, or failed with a reason, never applied to the wrong message.
- **A burst of N new messages (N > 50).** All N arrive, with no UID skipping, including non-contiguous UID ranges.
- **The Gmail/Microsoft token expires mid-session.** It refreshes asynchronously before any IMAP/SMTP use, in every worker. A refused refresh (`invalid_grant`) turns the account into "Reconnect" and never spins.
- **An org admin blocks the OAuth app.** The connect dialog says "Your organization's admin needs to allow Moduo", with the provider's own error code in the details.
- **An M365 tenant with SMTP AUTH off** (535 5.7.139). The message sends through Microsoft's own mail API instead (decision 14), and nothing is shown to the user.
- **Offline.** "Offline, changes will sync" shows. Reading works from downloaded mail. An undownloaded body shows "Available when you're back online". Every action and send queues.
- **Disk cap reached.** Least-recently-opened bodies and attachments are evicted first; headers are never evicted. Search over evicted bodies still works for the text index until "Clear all downloaded mail".
- **Account disconnect.** The account's rows, bodies, attachments, drafts, ops, outbox and index entries are deleted from this Mac, and its keychain secret is removed. An unsent Outbox item asks first ("1 unsent message will be discarded").
- **Two Moduo devices on one mailbox.** No conflict: the mail server is the truth for mail, and Moduo settings sync per row (last writer wins per rule/snippet/alias, not per whole settings blob).
- **A huge message (>25 MB) or a huge attachment.** Headers and text show. Attachments download on click with progress. Compose blocks attachments above the provider limit before Send (E45).
- **Malformed MIME, unknown charset or broken HTML.** It shows the best-effort text, with the raw source one click away. It never crashes the reader.
- **A thread spanning folders** (reply in Sent, original in Inbox). It shows as one conversation everywhere it appears.
- **A Gmail message with several labels.** It appears in each label folder. Done removes only the Inbox label.
- **The Screener is on and a known sender emails a new address of theirs.** A known *contact* is never screened; an unknown address is.
- **Snooze returns while the app is closed.** At the next launch it comes back with "came back while you were away".
- **A reply arrives on a snoozed thread.** It is unsnoozed immediately (H61).
- **A follow-up was due, but the counterpart replied from another device.** The reply clears it before any nudge.
- **Rules conflict** (two rules match). The first in list order wins for exclusive actions (move/tab); additive actions (mark read, label, Priority) all apply. The order is draggable in Settings.
- **An invite with no organizer or a malformed ICS.** It shows "Add to calendar" only, with no RSVP buttons.
- **One-click unsubscribe fails.** It falls back to opening the unsubscribe page, and says so.
- **No accounts.** A calm connect state with the three provider chips, never "Inbox zero".
- **Inbox zero.** A calm full-pane moment: "You cleared 34 today" (B12).

## Acceptance criteria

**Performance** (measured on the reference fixture: 6 accounts, 100,000 messages, an M-series Mac, a release build):

- **AC1:** opening Mail paints the first screen of the current view ≤ 150 ms after navigation (warm app). A cold app launch shows a usable inbox ≤ 1.5 s.
- **AC2:** `j`/`k`, every triage key and tab switches update the screen in the next frame (≤ 16 ms render). Scrolling the full list holds ≥ 55 fps. No row cap.
- **AC3:** opening a downloaded thread paints its content ≤ 50 ms. An undownloaded one is readable ≤ 1 s on a normal connection, with a single server round-trip set (one login is reused, not repeated).
- **AC4:** the ⌘K Email group returns ≤ 100 ms after the debounce for word queries and operator queries over the full fixture.
- **AC5:** new mail in a live folder (Inbox, Sent, Drafts) is on screen ≤ 5 s after server delivery, without Refresh. Other folders refresh on open within 1 s.
- **AC6:** a newly connected account shows its newest mail ≤ 10 s. History backfill shows determinate progress and can be cancelled.
- **AC7:** the engine stays ≤ 250 MB resident at the fixture size, with ~0% CPU when idle.

**Sync correctness:**

- **AC8:** flag changes and deletions made by another client anywhere within the synced history show in Moduo after one sync round. A burst of >50 arrivals and non-contiguous UIDs lose nothing. A `uid_validity` change re-syncs that mailbox with no stale rows and no misapplied ops.
- **AC9:** every folder of every account is listed with its role (Inbox, Sent, Drafts, Archive/All Mail, Trash, Spam, custom). Gmail labels show as folders, and a multi-label message appears in each.
- **AC10:** tokens refresh before every IMAP/SMTP use on every path. A refused refresh marks the account Reconnect, and no worker spins or downgrades for good.

**Triage:**

- **AC11:** Done, snooze, pin, delete, unread, move, mute, spam/not-spam and block apply in the same frame, survive any reload or sync inside the 8 s window, and Undo restores exactly the previous state. After the window, `z` issues a compensating op.
- **AC12:** a failed action is never dropped. It shows in the failed-actions bar with Retry and Discard. Discard restores the server's state.
- **AC13:** multi-select with `x`, `⇧J`/`⇧K` and `⌘A` applies bulk Done, move, snooze, delete, read and pin as one undoable action. "Get me to zero" marks Done everything older than a day/week/month in the tab, undoably.
- **AC14:** after Done, snooze or delete, the next thread down is selected and opened. The `j`/`k` selection always stays in view.

**Reading:**

- **AC15:** remote images follow the setting (Block default / Contacts only / Always), with per-message "Load images" and per-sender "Always". Known trackers stay stripped even after images load when tracker blocking is on, and the shield shows the count.
- **AC16:** quoted text and long signatures collapse behind "…". "Show original" shows the raw source. Malformed mail renders best-effort, never as a crash.
- **AC17:** attachments preview in-app with Space (images, PDF). Other types open in their default app. They can be dragged to Finder (save) or onto a task (attach).
- **AC18:** a calendar invite shows an event card. Accept/Maybe/Decline sends a standards-compliant reply, and "Add to Moduo calendar" creates the event linked to the thread.
- **AC19:** newsletters show Unsubscribe. One-click (RFC 8058) is used where offered, otherwise mailto or the web page, with the fallback named.

**Compose:**

- **AC20:** `r`/`a`/`f` open an inline composer under the thread; `c` opens a new message in the reader pane. One compose is active at a time, and switching away saves it as a draft.
- **AC21:** drafts persist locally on every change and upload to the server Drafts folder ≤ 3 s after typing stops. Reopening Mail or the app restores them. Server drafts made elsewhere appear in Drafts.
- **AC22:** Send queues the message with the undo window (setting 5/10/20/30 s). **Undo** cancels and **Edit** reopens the draft. Offline, it waits in Outbox and sends automatically on reconnect. A failure returns it to Drafts with the reason and a notification.
- **AC23:** compose supports send-as aliases with per-alias signatures; recipient autocomplete from contacts plus correspondents, ranked by frequency; `;;` snippets with placeholders; Markdown shortcuts; Finder drag and image paste; spell check (setting); the provider size limit enforced before Send; "Remind me if no reply in…"; Done-on-send (setting); and the instant-intro key.
- **AC24:** `mailto:` links inside Moduo open compose. "Make Moduo the default mail app" makes macOS route `mailto:` links to Moduo compose.

**Sender intelligence:**

- **AC25:** split-inbox tabs (Personal, up to 3 custom, Notifications, Newsletters) classify every message deterministically by: block → rules → per-sender overrides → custom tabs → known-contact → existing header heuristics. `[`/`]` switch tabs, and Newsletters groups by sender.
- **AC26:** rules run on new mail as it arrives and, on demand, on existing mail. First match wins for exclusive actions; additive actions all apply.
- **AC27:** Priority people get a list mark and optional always-notify. The Screener (off by default) holds first-time non-contact senders in New senders until Allow or Block.
- **AC28:** blocked senders' new mail goes to the configured destination (Trash default), and the list is editable in Settings.
- **AC29:** Subscriptions lists every newsletter sender with last-received, Unsubscribe and "Done all".
- **AC30:** the Contact panel shows "All mail with this person" and their files. The Attachments view lists every attachment across synced mail, filterable by type, with preview. After 3+ replies to a non-contact, Moduo suggests "Add as contact".
- **AC31:** avatars resolve contact photo → own-domain logo (never third-party, never free-mail) → initials, with a setting to stop fetching.

**Search (⌘K):**

- **AC32:** Mail has no search bar of its own. `/` in Mail opens ⌘K with the Email chip on. The Email group searches subject, participants, body text and attachment names over all synced mail, with the operators above and operator suggestions. Enter opens the thread in Mail. Saved searches pin to the rail. "Search older mail on <account>" escalates to the server.

**Spine:**

- **AC33:** `t` convert (task spawned-from thread, thread references contact, Undo, "Also mark done"), `l` link, `n` private linked note, drag thread to task/calendar day, and "Create event from this email" all write spine links. The Detail panel shows them.
- **AC34:** snooze returns and follow-up checks run app-wide while the app runs (not only on /email). A reply on a snoozed thread unsnoozes it. A due follow-up shows at the inbox top with Dismiss. Due items that arrived while the app was closed are announced once at launch.

**Notifications and settings:**

- **AC35:** the nav and Dock badge follow the setting (Personal default / All inbox / Off) and are correct from app launch, not only after visiting Mail. New mail is badge-only unless "notify for Personal" or a Priority person's always-notify is on.
- **AC36:** every Settings → Mail control listed above exists, persists, and syncs across your devices where it isn't device-local (depth, disk cap and storage are device-local). Storage shows mail and attachments separately, and both Clear buttons work.

**Accounts:**

- **AC37:** connect works for Gmail (app password and OAuth), Google Workspace (OAuth), iCloud, Microsoft (Outlook.com and M365, OAuth) and custom IMAP. An admin-blocked org and the testing-mode re-approval show honest copy. M365 with SMTP AUTH off still sends.
- **AC38:** disconnect deletes the account's local data and keychain secret, and asks first if Outbox has unsent mail.
- **AC39:** the first launch after the upgrade keeps every connected account without re-login, re-downloads into the new store with the inbox usable within seconds, and removes the old engine's redb mail tables. No legacy mail code remains in the tree.

**States and surfaces:**

- **AC40:** every state renders deliberately: no accounts, first sync, syncing, offline, account error/reconnect, failed actions, empty folder, inbox zero, body unavailable offline, and web loading.
- **AC41:** the dashboard widget shows Personal unread and snoozes returning today. MCP stays metadata-only and unchanged in surface (J74). The web tissue view keeps working.
- **AC42:** the `?` legend and ⌘K's mail actions are generated from the hotkey registry, so they can't drift. Shortcut hints show briefly on a click when the setting is on.

## Tests that prove them

Layers:
- **Rust unit** (`cargo test --lib`).
- **Rust integration** against a local Dovecot plus an SMTP sink in Docker (`scripts/mail/test-server.sh`, its own containers, never the shared Supabase stack; run with `MODUO_MAIL_IT=1`).
- **Rust perf** (`cargo test --release -- --ignored mail_perf`, on the generated 100k fixture).
- **TS unit/component** (Rstest).
- **Stories.**
- **The lab and Playwright journeys** on the web build with the **fixture engine** (decision 18).
- **SQL/RLS tests** for the new cloud table.

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src-tauri/src/mail/store/perf.rs` · `mail_perf_list_page`, `mail_perf_counts`, `mail_perf_thread_open` | AC1, AC3 | On 100k messages, a list page, the tab counts and a thread load each come back well under budget (≤ 10 ms, ≤ 5 ms, ≤ 10 ms). |
| `src-tauri/src/mail/store/perf.rs` · `mail_perf_fts` | AC4 | Word and operator searches over 100k messages answer in ≤ 50 ms at the store, leaving headroom for ⌘K. |
| `e2e/lab` · journey `mail-open`, `mail-triage-50`, `mail-scroll` | AC1, AC2, AC14 | With the fixture engine, Mail paints ≤ 150 ms, 50 Done presses each land in one frame, and scrolling 100k threads holds ≥ 55 fps. |
| `src-tauri/tests/mail_it.rs` · `idle_new_mail_reaches_event_stream` | AC5 | A message appended to the test server reaches the UI event stream within 5 s. |
| `src-tauri/tests/mail_it.rs` · `first_sync_newest_first`, `backfill_progress_and_cancel` | AC6 | A new account lists its newest mail first, within 10 s on the fixture, and backfill reports percent and stops on cancel. |
| `src-tauri/src/mail/perf.rs` · `mail_perf_rss_idle` | AC7 | After loading the fixture, the engine's memory stays under 250 MB and idle loops don't spin. |
| `mail_it.rs` · `external_flag_change_deep_history`, `external_expunge_deep_history`, `burst_of_200_no_gaps`, `uidvalidity_reset_requeues_ops` | AC8 | Changes from "another client" deep in history show up; 200 arrivals all land; a recreated mailbox re-syncs and never applies an action to the wrong mail. |
| `mail_it.rs` · `folders_roles_special_use`; `src-tauri/src/mail/sync/gmail.rs` · `labels_map_to_folders` | AC9 | Every folder is found with its role, and a multi-label Gmail message appears in each label. |
| `src-tauri/src/mail/auth/*.rs` · `refresh_before_every_use`, `invalid_grant_marks_reconnect` | AC10 | Every IMAP/SMTP path refreshes the token first; a refused token flips the account to Reconnect without a retry loop. |
| `src-tauri/src/mail/ops/*.rs` · `undo_inside_window_cancels`, `reload_inside_window_keeps_hidden`, `compensate_after_flush`; `features/email/commands/triage.test.ts` | AC11 | Undo before the server sees it cancels cleanly, a reload doesn't resurrect the thread, and undo after it moves it back. |
| `ops/*.rs` · `failure_never_dropped`, `discard_restores_server_state`; `features/email/ui/failed-actions-bar.test.tsx` | AC12 | A failing action ends in the failed list with Retry/Discard, never silently deleted. |
| `features/email/commands/bulk.test.ts` · "bulk done one undo", "get me to zero by age" | AC13 | Selecting many and pressing Done is one undoable action; "get me to zero" picks exactly the older threads. |
| `features/email/ui/thread-list.test.tsx` · "auto-advance", "selection stays in view" | AC14 | After Done the next thread opens, and j/k scrolls the selection into view. |
| `features/email/reader/sanitize.test.ts` · "images policy", "trackers stripped after load", "shield count" | AC15 | Images obey the setting and sender allow-list; tracking pixels stay blocked and are counted. |
| `src-tauri/src/mail/mime/*.rs` · `quote_split`, `malformed_corpus_never_panics`; `reader/message-card.test.tsx` · "show original" | AC16 | Quotes collapse, the malformed-mail corpus parses without a panic, and the raw source opens. |
| `features/email/reader/attachments.test.tsx` · "space previews", "drag payload" | AC17 | Space opens the preview, and dragging gives Finder a file and a task a link. |
| `src-tauri/src/mail/invite.rs` · `itip_reply_partstat`; `reader/invite-card.test.tsx` | AC18 | The RSVP builds a correct iTIP REPLY; Add to calendar creates a linked event. |
| `src-tauri/src/mail/unsubscribe.rs` · `rfc8058_post`, `fallback_order` | AC19 | One-click unsubscribe POSTs correctly, and falls back to mailto then the web page. |
| `features/email/compose/*.test.tsx` · "inline reply", "one active compose saves draft" | AC20 | Reply opens under the thread; starting another compose saves the first as a draft. |
| `mail_it.rs` · `draft_append_replace`, `server_draft_appears`; `compose/drafts.test.ts` | AC21 | Drafts land in the server Drafts folder and replace their previous copy; drafts made elsewhere show up. |
| `src-tauri/src/mail/send/*.rs` · `undo_window_cancel`, `offline_outbox_drains`, `failure_back_to_drafts`; `mail_it.rs` · `smtp_send_and_sent_copy` | AC22 | Send waits out the undo window, offline sends go out on reconnect, failures go back to Drafts, and Sent gets one copy. |
| `compose/*.test.tsx` · "alias signature", "autocomplete rank", "snippet placeholders", "size limit", "instant intro" | AC23 | Each compose power feature does what it says. |
| `src-tauri/src/mail/mailto.rs` · `parse_mailto_rfc6068`; `features/email/compose/mailto.test.ts` | AC24 | mailto links (with subject, cc, body) open a filled compose. |
| `src-tauri/src/mail/classify/*.rs` · `pinned_order`, `custom_tabs`, `newsletter_grouping` | AC25 | Classification follows the pinned order, custom tabs catch their senders, and newsletters group by sender. |
| `classify/rules.rs` · `first_match_exclusive_additive_all`, `apply_to_existing` | AC26 | Rule precedence is exact; applying to existing mail queues the right actions. |
| `classify/*.rs` · `priority_notify`, `screener_holds_first_time` | AC27 | Priority mail notifies when set; first-time strangers wait in New senders until a decision. |
| `classify/*.rs` · `blocked_destination_setting` | AC28 | Blocked mail lands where the setting says. |
| `features/email/views/subscriptions.test.tsx` | AC29 | Every newsletter sender is listed with working Unsubscribe and Done all. |
| `features/email/panels/contact-mail.test.tsx`, `views/attachments.test.tsx`, `suggest-contact.test.ts` | AC30 | The person's mail and files are listed; the Attachments view filters; the add-contact suggestion appears after 3 replies. |
| `src-tauri/src/mail/avatar.rs` · `order_and_freemail_skip`, `never_third_party` | AC31 | Avatars come from contacts, then the sender's own domain only, never from free-mail or third-party services. |
| `features/email/search/query.test.ts` (operator parser), `components/app/global-command-palette-email.test.tsx` | AC32 | Operators parse; `/` opens ⌘K on Email; results open the thread; saved searches pin. |
| `features/email/commands/spine.test.ts` · convert, link, note, drag, event | AC33 | Each spine gesture writes the right links and its undo removes only what it created. |
| `features/email/engine/mail-engine-provider.test.tsx` · "app-wide restore", "reply unsnoozes", "away announcement" | AC34 | Snooze and follow-up checks run off the Mail page; a reply unsnoozes; due-while-closed is announced once. |
| `features/email/engine/badge.test.ts` | AC35 | Badge counts follow the setting from launch; new mail notifies only when allowed. |
| `features/settings/mail/*.test.tsx`; `supabase/tests/email_settings_items.test.sql` | AC36 | Every setting persists and syncs per row; only the owner can read or write their mail settings. |
| `src-tauri/src/mail/auth/microsoft.rs` · `scopes`, `graph_send_fallback_on_5_7_139`; `auth/google.rs` · `workspace_allowed`; `ui/connect-dialog.test.tsx` · "admin blocked copy" | AC37 | Each provider's sign-in asks for the right permissions; blocked M365 SMTP falls back to Microsoft's send API; blocked orgs get honest copy. |
| `src-tauri/src/mail/accounts.rs` · `disconnect_purges_everything` | AC38 | Disconnect removes every local trace and the keychain secret. |
| `src-tauri/src/mail/migrate.rs` · `legacy_accounts_carry_over`, `redb_mail_tables_dropped`; `scripts/ci` grep test · "no legacy email engine paths" | AC39 | Old accounts survive the upgrade without re-login, the old tables are gone, and no old engine code remains. |
| Stories `email-*.stories.tsx` for each state + `e2e/lab/lab.config.ts` mail states | AC40 | Each state has a story and a lab capture. |
| `features/email/widget.test.ts`, existing MCP email tests unchanged, `email-web-view.test.tsx` · "loading" | AC41 | The widget shows the right counts; MCP is unchanged; web shows a loading state. |
| `features/email/keys.test.ts` · "legend from registry" | AC42 | The legend and ⌘K list exactly the registry's mail keys. |

## Assumptions & technical decisions

1. **Mail stays a desktop-local engine, the recorded exception to Supabase-first** (data-layers §6, reaffirmed by the designer 2026-11-03). *Rejected:* a cloud relay. It puts mail bodies on Moduo servers, needs Google's restricted-scope verification plus a yearly CASA audit for Gmail, and adds months before any UX gain.
2. **The local store moves from redb to SQLite** (`rusqlite`, bundled, WAL, FTS5), in one file per signed-in user (`<app data>/mail/<user_id>/mail.db`), with bodies and attachments as content-addressed files beside it. *Why:* the workload is indexed range queries (thread lists per folder and tab, sorted by date), aggregates (counts per tab and folder) and full-text search. redb gives none of these, and the recon proves the cost (full-table scans, double JSON parsing, a commit per row). This does not extend redb (still paused). It retires redb's largest user. *Rejected:* redb with hand-built indexes (re-implements a database); tantivy beside redb (two stores to keep consistent).
3. **Schema (local).**
   - `accounts`;
   - `mailboxes`: role, uidvalidity, uidnext, highestmodseq, floor, backfill state, live flag;
   - `messages`: one row per RFC message per account, carrying header fields, flags bitset, snippet, list/precedence headers, the invite flag and body state;
   - `message_mailboxes`: (mailbox, uid, modseq) → message, which is how Gmail labels and multi-folder messages are represented;
   - `threads` and `thread_views`: denormalized per (thread, mailbox) for the list, holding last date, unread, flagged, tab, muted and snoozed, indexed `(mailbox_id, tab, last_date DESC)` and `(role, tab, last_date DESC)` for Unified;
   - `attachments`: from BODYSTRUCTURE at header time, so names are searchable before download;
   - `bodies`: sanitized-ready HTML and text, quote offset, tracker count, bytes, last access;
   - `ops` (the outbox), `outbox` (sends), `drafts`, `avatars`, `kv`;
   - `messages_fts` (FTS5, `unicode61 remove_diacritics 2`, prefix 2,3), covering subject, participants, body text and attachment names.

   The schema is versioned with forward migrations inside the binary.
4. **The engine is an async actor per account** on tokio, with no `block_on` facade. It holds one IDLE session on INBOX and a small command-session pool (≤ 3; Gmail allows 15, iCloud fewer) that it reuses. Commands enqueue work and never open their own login. Reconnect uses jittered backoff capped at 5 min, and an IDLE-unsupported server falls back to polling **per session**, not for life.
5. **Sync protocol:**
   - **SPECIAL-USE** finds the folder roles, falling back to the existing name lists.
   - **CONDSTORE** with the stored `HIGHESTMODSEQ` (`SELECT … (CONDSTORE)` plus `CHANGEDSINCE <modseq>`) handles flags.
   - Expunges come from a compact `UID SEARCH` set diff, run when `MESSAGES` count, UIDNEXT or modseq says something changed.
   - Servers without CONDSTORE get a chunked flag-and-UID diff over the whole synced range, spread across rounds.
   - New mail is fetched by UID range from UIDNEXT, chunked with no skipping, followed by a UID SEARCH for gaps.
   - The header fetch takes `ENVELOPE FLAGS INTERNALDATE RFC822.SIZE BODYSTRUCTURE` plus the existing header fields, and for live folders' newest 2,000 messages a 512-byte peek of the text part for the snippet.
   - Live folders are INBOX (IDLE), with Sent and Drafts checked every 60 s via a cheap `STATUS (UIDNEXT HIGHESTMODSEQ MESSAGES)`. Other folders sync on open, plus a 10-minute STATUS sweep.
   - **QRESYNC is not used**: async-imap 0.12 has no ENABLE or VANISHED parsing. *Rejected:* switching to io-imap or imap-codec, a riskier, less-proven client for a gain that CONDSTORE plus a set diff already covers.
6. **Gmail is synced from `[Gmail]/All Mail`** as the one canonical copy, plus Spam and Trash, which aren't in All Mail. `X-GM-MSGID`, `X-GM-THRID` and `X-GM-LABELS` map to messages, threads and folder membership, and `X-GM-RAW` stays for server search. Done removes the `\Inbox` label (`UID STORE -X-GM-LABELS`). *Why:* one copy per message instead of one per label, and Gmail's own threading. *Rejected:* syncing each label as a folder (duplicates, and Gmail's label folders can't be IDLEd cheaply).
7. **Threading:** Gmail uses X-GM-THRID. Other providers use a union-find over Message-ID, In-Reply-To and References, computed in the engine at ingest and stored, falling back to the normalized subject only when there are no references and the participants overlap within 14 days. Threads are per account.
8. **Bodies:**
   - The parser is **mail-parser** (Stalwart), replacing mailparse: faster and more tolerant of malformed MIME.
   - There's a prefetch queue with priorities: opened, then visible in the viewport, then the newest inbox messages, then the last 3 months.
   - Messages ≤ 2 MB are fetched whole. Larger ones get text parts first; attachments always download on demand.
   - For mail older than 3 months within the history depth, only the text part (≤ 32 KB) is fetched at idle time, purely to index it.
   - The per-account cap is 2 GB by default, with LRU eviction of bodies and attachments; headers and the index are never evicted.
   - Storage stats count mail and attachments separately.
9. **HTML safety stays two-layer in the webview**, as already reviewed: a DOM strip plus a nonce CSP in a `sandbox="allow-scripts"` iframe that never gets `allow-same-origin`. It gains tracker detection (1×1 and known-tracker host list) and a **stable per-message nonce**, so loading images doesn't remount frames. *Rejected:* moving sanitization into Rust (ammonia). That would throw away a reviewed, tested layer, and the webview's CSP is still needed.
10. **The UI is fed by events, not polling.**
    - The engine publishes compact change sets over a Tauri v2 `ipc::Channel` (`mail_subscribe`): `threads_changed {view_keys, thread_ids}`, `counts`, `sync_status`, `op_failed`, `new_mail`, `draft_changed`.
    - Reads are **windowed keyset queries** (`mail_list_threads {view, tab, after, limit}`) returning compact rows (≈ 14 fields, no bodies, no references), so IPC carries only what's on screen plus overscan.
11. **The front-end state is one external store** (`features/email/store/`, read through `useSyncExternalStore` with selectors), with commands in `features/email/commands/`, mirroring Tasks' reads-through-selectors and writes-through-commands split. A `MailEngineProvider` is mounted once in the app chrome on desktop and owns the event subscription, the badge and Dock count, snooze returns, follow-up checks, reply-unsnooze and the away announcement. `/email` only renders. The list is virtualized with `@tanstack/react-virtual` (already used by Tasks). Rows are memoized, take stable command references, and use **no per-row Radix roots**: one shared hover toolbar and one shared context menu. *Rejected:* the sync kernel and TanStack DB, which are built for Supabase rows; mail's truth is the local engine.
12. **Ops apply locally first, then reach the server.**
    - Every triage op writes its local effect in the same SQLite transaction that enqueues it, with `not_before = now + 8 s`.
    - Undo inside the window deletes the op and reverts the local effect atomically. After the window, `z` enqueues the inverse op.
    - The executor retries with backoff to 5 min for up to 24 h, then marks the op **failed**, which is surfaced and never dropped.
    - A `uid_validity` change re-targets queued ops by Message-ID, or fails them.

    This removes the JS-held undo timers and fixes the reload resurrection.
13. **Send:**
    - A persistent `outbox` with `not_before = now + undo seconds`, drained by the account actor through lettre SMTP (implicit TLS on 465, STARTTLS required elsewhere, as now).
    - A Sent copy is APPENDed (flagged `\Seen`) except on Gmail and Microsoft, which save it themselves.
    - Drafts are local rows, debounced 2 s, then APPEND to Drafts with the previous server copy deleted (UIDPLUS `APPENDUID` tracks it).
14. **Microsoft:**
    - Sign-in is OAuth with `offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send`, IMAP and SMTP with XOAUTH2, on `outlook.office365.com` / `smtp.office365.com`.
    - It uses the existing Microsoft public client (`MODUO_EMAIL_MICROSOFT_CLIENT_ID`, falling back to `MODUO_CALENDAR_MICROSOFT_CLIENT_ID`, `/common` tenant), with a **separate token** from calendar's Graph token, because one token covers one resource.
    - When SMTP AUTH is disabled for the tenant (`535 5.7.139`), sending uses Graph `POST /me/sendMail` with the MIME body, taking a `Mail.Send` Graph token requested incrementally on first need.
    - Admin-consent errors (`AADSTS65001`, `AADSTS90094`) map to the "ask your admin" copy.
    - The app registration needs these delegated permissions added to the existing app (`docs/email-runbook.md` gets the steps). This is a **manual portal step for Mike**.
15. **Google Workspace** reuses the Gmail OAuth flow with the personal-only restriction removed. Testing mode means a 7-day refresh-token life (the honest copy). `admin_policy_enforced` and org `access_denied` map to the admin copy. App passwords stay personal-Gmail-only.
16. **Moduo-side mail settings that follow the user** (rules, custom tabs, Priority people, blocked senders, Screener decisions, sender overrides, snippets, aliases with signatures, saved searches) live in **one new owner-scoped Supabase table `email_settings_items`**: `(id, user_id, kind, position, value jsonb, updated_at, deleted_at)`, with `kind` a closed vocabulary in `@contracts` and a matching CHECK. RLS is owner-only. Writes go through ops (`email_op_settings_upsert`/`_delete`), and conflicts resolve per row by last writer.
    - Scalar toggles stay in `user_preferences.email`.
    - The existing whole-object `overrides` migrate into `sender_override` rows, which fixes the whole-object LWW gotcha for everything new.
    - The desktop engine reads a local mirror, refreshed on change and on focus.
    - *Rejected:* growing `user_preferences.email` (whole-object LWW loses edits between devices); one table per kind (nine tables for one access pattern).
17. **Search:** a pure TS operator parser (`features/email/search/query.ts`) turns the ⌘K text into a structured query, and the engine runs it against FTS5 plus indexed columns. GS-9's Email group calls it, replacing `searchEnvelopes` and the body scan. "Search older mail" keeps the existing server search (X-GM-RAW / per-folder SEARCH). Mail's own search bar and `use-email-search` are deleted.
18. **The fixture engine:**
    - A deterministic generator (`features/email/testing/fixture.ts`, seeded) produces the 100k-message, 6-account reference mailbox. It powers stories, unit tests and lab journeys through a fake `runtime.email` that implements the same interface.
    - It is included only in non-production builds (`MODUO_MAIL_FIXTURE=1` at build time; tree-shaken otherwise).
    - The same generator writes Maildir trees for the Dovecot integration server and rows for the Rust perf tests, so all three layers measure the same mailbox.
19. **Avatars:** contact photo, then BIMI (DNS TXT `default._bimi.<domain>`, SVG only, size-capped) or `https://<domain>/apple-touch-icon.png` / `favicon.ico`. It's fetched by the engine, cached 30 days, never for a free-mail domain list, never via Gravatar or any third party, and off with the setting.
20. **Invites:** `text/calendar` parts are parsed with the existing ICS handling (`_shared/email/ics.ts` logic ported or the `ical.js` already used by Calendar). RSVP sends an iTIP `METHOD:REPLY` with PARTSTAT by SMTP. "Add to Moduo calendar" uses the Calendar module's create op and links the event to the thread.
21. **Default mail app:** `CFBundleURLTypes` gets `mailto` (a `tauri.conf.json` Info.plist addition, **Tier 2**). The deep link is received through `tauri-plugin-deep-link`. "Make default" calls `NSWorkspace setDefaultApplicationAtURL:toOpenURLsWithScheme:` (macOS 12+) through `objc2-app-kit`.
22. **Notifications:** `tauri-plugin-notification` (already a dependency) for opt-in Personal or Priority new mail, and the Dock badge through Tauri's `set_badge_count`. Due-reminder notifications stay on the spine (`notify_user_ids`), unchanged.
23. **Spine and MCP are unchanged in contract.** `email_refs`, the `email_op_*` ops, the MCP email tools and `email_thread` entity ids keep their shapes. Convert stays client-orchestrated (the recorded EM-8 decision) and runs on the new commands. Drag uses the app's existing drag-payload contract (`.claude/rules/ui-drag.md`). `n` creates a private note through the Notes create command and links it.
24. **Migration and removal:** at first launch of the new engine:
    1. accounts are read from the legacy redb blob (`NOTES_META email:accounts_v1` / `email_accounts_v2`) into SQLite;
    2. keychain secrets are reused under the same keys (no re-login);
    3. the redb mail tables are deleted.

    Then `apps/desktop/src-tauri/src/commands/email*`, `email_sync/`, the redb mail tables in `store_redb`, `mailparse`, and the old `features/email` hooks and UI are removed in the same change. A CI grep test keeps them out.
25. **Vocabularies:**
    - Cloud: `email_settings_items.kind` and the provider list (adds nothing; `outlook` already exists) live in `@contracts/vocabularies.ts` with CHECKs.
    - Local-only: mailbox role, op kind, tab kind, rule condition/action and event kind are defined once in `@contracts` as well. The Rust enums are drift-tested against a JSON export of them (`contracts/mail-local.json`), so there is still one source.
26. **Tier and review:** the change touches Tier 2 paths (`lib/runtime*`, migrations, contracts, `store_redb`, `tauri.conf.json`, capabilities). The `validator` runs once per wave on that wave's diff (advisory, findings fixed or answered), and a final full-diff validator runs before the PR. The three-draft race is replaced by per-wave validation, because one run builds everything. Rust gates on every wave: `cargo check`, `cargo check --features lite`, `cargo test --lib`. Then `bun run verify` and the integration and perf suites.
27. **Closes:** IM-2c-b (backfill progress and cancel) and the two `specs/import.md` open questions (depth now covers every folder; deep history is reachable through the virtualized list and FTS). Both are marked superseded there.

## Execution blocks

Blocks run as waves in one orchestrated workflow on `t/mike/mail-rebuild`. Each block is one subagent's unit, with its own tests, and is recoverable from this spec plus `docs/decisions/email.md`.

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| MR-0 | **Contracts, fixture and frozen tests** | `@contracts` mail vocabularies plus the `mail-local.json` export; the new `runtime.types.email.ts` interface (windowed reads, commands, event stream); the deterministic 100k fixture generator plus the fake engine; Dovecot and SMTP-sink Docker harness (`scripts/mail/test-server.sh`, own containers); the failing contract and perf test skeletons from the table above. **Tier 2.** | AC1–AC4 (skeletons), AC25 | — |
| MR-1 | **SQLite store** | rusqlite schema plus migrations, query layer (keyset thread lists, counts, thread load, FTS), write paths in transactions, storage stats, Rust perf tests green on 100k. | AC1, AC3, AC4, AC7 | MR-0 |
| MR-2 | **Account actor, sessions and auth** | Async-native IMAP sessions (no `block_on`), per-account actor plus pool, capability detection, reconnect; auth for password, Google (personal and Workspace) and Microsoft XOAUTH2 with refresh before every use; keychain reuse; connect/disconnect commands with full purge. | AC10, AC37, AC38 | MR-0 |
| MR-3 | **Sync engine** | SPECIAL-USE roles, Gmail All Mail plus labels, CONDSTORE deltas, expunge set diff, chunked gap-free new-mail fetch, live folders (IDLE plus STATUS), threading and classification at ingest, backfill with progress and cancel, the event channel. | AC5, AC6, AC8, AC9, AC25 | MR-1, MR-2 |
| MR-4 | **Bodies, attachments and MIME** | mail-parser, prefetch queue, partial fetch, text-only indexing fetch, attachments on demand, quote split, invite parse, disk cap plus LRU, "Show original". | AC3, AC16, AC17 (engine), AC18 (parse) | MR-1, MR-2 |
| MR-5 | **Ops outbox** | Local-first ops with the undo window, executor plus retries, failed list, compensating undo, `uid_validity` re-targeting, bulk ops. | AC11, AC12, AC13 (engine) | MR-1, MR-2 |
| MR-6 | **Send, drafts and Microsoft send** | Draft rows plus server APPEND/replace, send outbox with undo, offline drain, Sent copy rules, Graph sendMail fallback, size limits, iTIP REPLY, mailto parse. | AC21, AC22, AC24 (engine), AC18 (RSVP), AC37 (send) | MR-2, MR-5 |
| MR-7 | **Cloud mail settings** | Migration `email_settings_items` plus ops plus RLS plus erasure coverage, contracts plus CHECK, the SQL test, the overrides migration, runtime methods, local mirror. **Tier 2.** | AC36 (sync), AC25–AC28 (storage) | MR-0 |
| MR-8 | **Front-end store, commands and app-wide provider** | `features/email/store` plus commands on the new runtime, `MailEngineProvider` in the app chrome (badge, Dock, snooze/follow-up/reply-unsnooze, away announcement), and the Tauri runtime wiring. **Tier 2.** | AC34, AC35, AC11 (UI) | MR-0 (fake engine); wires to MR-3/MR-5 |
| MR-9 | **Shell, rail, tabs and list** | Rail (unified folders, accounts, trees, views, progress), split tabs, virtualized memoized list, row redesign, multi-select, auto-advance, keep-in-view, density, every state, the inbox-zero moment, the failed-actions bar, the registry-driven legend and hints. | AC1, AC2, AC13, AC14, AC40, AC42 | MR-8 |
| MR-10 | **Reader** | Conversation stack, stable-nonce iframe, images policy plus tracker shield, quotes, original, attachments strip with Space preview plus drag, invite card, unsubscribe, avatars. | AC15–AC19, AC31 | MR-8, MR-4 |
| MR-11 | **Compose** | Inline reply plus new-message pane, drafts UX, undo/Edit toast, Outbox view, aliases plus signatures, autocomplete, `;;` snippets, Markdown shortcuts, drag/paste attachments, spell check, follow-up footer, Done on send, instant intro, mailto wiring plus default mail app. **Tier 2** (`tauri.conf.json`). | AC20–AC24 | MR-8, MR-6, MR-7 |
| MR-12 | **Sender intelligence** | Rules engine plus UI, custom tabs, Priority people, Screener, block destinations, newsletter grouping, Subscriptions view plus unsubscribe actions, Attachments view, Contact-panel mail plus files, add-contact suggestion, avatar fetcher. | AC25–AC31 | MR-3, MR-7, MR-9 |
| MR-13 | **Search in ⌘K** | Operator parser plus suggestions, FTS query command, GS-9 Email group rewired, `/` opens ⌘K on Email, saved searches, server escalation row; Mail's own search removed. | AC4, AC32 | MR-1, MR-9 |
| MR-14 | **Spine, snooze and follow-ups** | Convert/link/note/drag/event on the new commands, Today panel, Someday preset, reply-unsnooze, follow-up nudge at inbox top with Dismiss, widget update, web loading state. | AC33, AC34, AC41 | MR-8, MR-9 |
| MR-15 | **Settings → Mail** | Every control in the Settings section above, storage with mail/attachment split and both Clear buttons, default-mail-app button. | AC36 | MR-7, MR-11, MR-12 |
| MR-16 | **Cutover, deletion and docs** | Legacy migration plus redb table drop, deletion of every old engine and UI path plus the CI keep-out test; lab config states plus journeys; docs: `data-layers.md` §6, `docs/decisions/email.md`, `docs/gotchas/email.md`, `.claude/rules/email.md` paths, `docs/email-runbook.md` (Microsoft and Google console steps), `specs/import.md` superseded marks, and `specs/email.md` pointer. **Tier 2.** | AC39, AC40 (lab) | all |

Waves: **W0** MR-0 → **W1** MR-1, MR-2, MR-7 (parallel) → **W2** MR-3, MR-4, MR-5, MR-8 (parallel; MR-8 on the fake engine) → **W3** MR-6, MR-9, MR-10 → **W4** MR-11, MR-12, MR-13, MR-14 → **W5** MR-15, MR-16 → a full-diff validator, the integration and perf suites, and the lab run. Each wave ends green on the Rust gates and `bun run verify` before the next starts.

## Out of scope

- A cloud mail relay, full web mail, a phone app, and sending while the app is closed (decision 1).
- Send later (X9), read receipts on your own mail (X8), vacation auto-reply (X14), sharing a thread with a teammate (X13, a later privacy call), pop-out compose windows (X27), encryption, print and export (X28).
- AI features of any kind. MCP stays metadata-only (J74, the PRODUCT_BRIEF MCP-only rule).
- Mobile and tablet layouts, and light-mode visual tuning (AGENTS.md out of scope).
- Google app verification (CASA) and Microsoft publisher verification, which are separate business steps. The testing-mode copy covers them meanwhile.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with a plain-English note.
- [x] **Open questions is empty.** Product questions were answered across three grilling rounds (below); technical unknowns are researched and recorded as decisions 1–27.
- [x] **The data model is named.** Local: SQLite (decisions 2–3), the recorded desktop-mail exception. Cloud: one new owner-scoped table `email_settings_items` plus ops (decision 16). Existing `email_refs`/`email_accounts` are unchanged.
- [x] **Module feature:** spine wiring (convert, link, note, drag, event, tags via the existing hub, snooze/follow-up notifications, activity) is in AC33/AC34. MCP is unchanged (AC41). The widget is defined (AC41).
- [x] **Execution blocks** MR-0…MR-16 are decomposed into waves, each context-sized and self-contained.
- [x] **Design constraints acknowledged:** tokens-only, shadcn-wrapped primitives, DESIGN_RULES R1–R10. The reader iframe is the one sanctioned non-token surface. No new top-level routes (views live inside `/email` and Settings).
- [x] **Manual-test surfaces:**
  - connecting a real Gmail, Workspace, iCloud and Microsoft account;
  - the first launch after the upgrade (accounts kept);
  - `mailto:` from Safari after "Make default";
  - an RSVP to a real invite;
  - a one-click unsubscribe;
  - offline send (Wi-Fi off) then reconnect.

## Open questions

- [ ] (none)

**Manual steps for Mike outside the code** (not blockers to build; needed before the real-account test):
- In the Microsoft app registration, add the delegated permissions `IMAP.AccessAsUser.All`, `SMTP.Send` (Office 365 Exchange Online) and `Mail.Send` (Graph).
- In the Google OAuth app, confirm `https://mail.google.com/` is on the consent screen and the Workspace test users are added.

## Product answers (designer, 2026-11-03)

Round 1:
- **Priority:** Open alpha, with Mail added to Focus.
- **Where mail lives:** on the Mac, rebuilt.
- **Scope:** gaps plus power features.
- **Scale:** 6 accounts, ~100k emails.

Round 2 (recommended unless noted):
- **A, live mail and notifications:**
  - A1 yes.
  - **A2** notify-for-Personal is a Settings toggle.
  - **A3** Personal-only badge by default, changeable in Settings.
  - A4–A6 yes.
- **B, inbox model:**
  - B7 tabs.
  - B8 custom tabs, up to 3.
  - B9–B17 yes.
  - **B18** block destination is a Settings choice, Trash by default.
- **C, folders:** C19–C23 yes (folder create, rename and delete included).
- **D, reading:**
  - D24 yes.
  - **D25** images blocked by default, changeable in Settings.
  - D26–D34 yes.
- **E, compose:** E35–E49 yes.
- **F, triage and keyboard:** F50–F55 yes.
- **G, search:** **no in-module search**. Mail is fully integrated into the ⌘K global search (G56–G59 apply there).
- **H, snooze, follow-up and spine:** H60–H64 yes.
- **I, accounts and settings:**
  - **I65** Microsoft in (the app is already registered for calendar).
  - **I66** Google Workspace in.
  - I67–I69 yes.
  - **I70** storage shows mail and attachments separately.
  - I71 yes.
- **J, other surfaces:** J72–J74 yes.
- **K, rollout:** **full replace, no legacy code kept.** Built now, in this session, by subagents, as one update.
- **L, the bar:** L77 yes. L78 led to the extra-features round.

Round 3:
- **S, clarifications:** S1–S7 yes.
- **X, extra features:**
  - **X1** Screener: available, off by default, a Settings toggle.
  - **X2** in, renamed to **Priority people**.
  - **X3, X4, X5, X6** in.
  - **X7** tracker blocking on by default, a Settings toggle.
  - X8 never. X9 no.
  - **X10, X11** must-haves.
  - **X12** in.
  - **X13** later.
  - X14 no.
  - **X15** in.
  - X16 yes.
  - **X17** contact photo first, then a fetched logo (the sender's own domain only, not third-party), then initials.
  - **X18** spell check, a Settings toggle.
  - **X19** in, with Dismiss.
  - X20–X26 yes.
  - X27, X28 no.
- **E, how the run works:** E1–E5 yes.
