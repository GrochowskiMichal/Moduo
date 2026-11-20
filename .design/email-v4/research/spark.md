# Spark Mail (Readdle) vs Moduo Mail: feature inventory and gap map

> Research lane for the Email v4 rethink, 2026-11-21. Benchmark: **Spark Mail 3.x for macOS** (changelog read up to 3.33.0, 2026-11-20). iOS/Android-only features are marked **(mobile only)**.
> Moduo side: read from `specs/mail-rebuild.md` (MR, built), `specs/mail-v3.md` (MV, built, PR #797/#800), `specs/mail-improve.md` (MI, built, PR #804), `docs/decisions/email.md`, `.design/email/BRIEF.md`, `.design/email/DESIGN_BRIEF.md`, and spot checks in `apps/app/src/features/email/` and `apps/app/src/lib/hotkeys/registry.ts`.

## Read this first

1. **Spark is not "free with everything".** Since 2026-11 its plans are **Free / Plus ($10 per user per month) / Pro ($20) / Enterprise**; the old Premium and Teams tiers are gone. The Free plan explicitly lists only: Smart Inbox, unlimited accounts, Smart Notifications, "essential productivity" and Calendar. The help center calls these **paid** features: Gatekeeper, Home Screen, Smart Folders, Templates, Group by **domain**, Mute, Integrations (Save to Todoist etc.), delegation, Spark Cloud large files, Autopilot and Auto-Drafts (Pro), Read Statuses (Pro) and all +AI beyond a small quota. The comparison table lost its checkmarks when fetched, so the tier is shown per row below as **Free**, **Paid** (a help article says so) or **? (verify)**. If the designer uses these features today, he is on a paid plan, a legacy Premium plan, or a Spark Classic grandfathered plan. It is worth asking him which.
2. **Spark has turned into an agent platform** in 2026: Spark CLI for AI agents (May), an agents sidebar and "hand off to agent" (Aug), Auto-Drafts in your voice (Sep), Autopilot plain-language rules (Oct), and Raycast plus a background mode so agents can reach it with the app closed (Nov). Moduo's MCP-only AI stance maps onto **Spark CLI**, not onto +AI. That is the comparison that matters for us.
3. **Moduo already covers most of the Spark core** after MR, MV and MI: unified inbox, Done, snooze, pin, priority people, screener, follow-up reminders, undo send, mute, block, unsubscribe and subscriptions, rules, custom tabs, ⌘K search with operators, saved searches, invite card, aliases, tracker blocking and outbox. The gaps cluster in four places: **the composer** (rich text, templates, signatures), **personalisation** (shortcut presets, swipes, layouts), **Spark-only triage verbs** (Set Aside, Home Screen, Recently Seen), and **things the "mail stays on the Mac" decision rules out** (send later, cross-device state, sharing).

Status key: **built** (code seen on `develop`) · **partial** · **specced (verify)** (spec text only) · **cut** (decided out, with the answer key) · **missing** (never considered).

Tier key: **Free** = listed under Free/Essentials or no paywall mentioned in the help article (not a confirmed checkmark) · **Paid** = a help article or plan list says so · **?** = unknown.

**Who made the cuts:** the X-keys (X8, X9, X13, X14, X27, X28) are answers labelled "designer, 2026-11-03" inside `specs/mail-rebuild.md`, a spec **owned and authored by Mike** (git author GrochowskiMichal). Maciej should confirm they are his calls. Only the first send-later cut (DESIGN_BRIEF 2026-07-04, a planning interview with Maciej) is clearly his.

---

## 1. Accounts and the unified inbox

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| Unlimited accounts | Any number of accounts | Free | built | Spec target is 6 accounts and ~100k mails. |
| Providers | Gmail/Workspace, iCloud, Outlook/M365/Exchange, Yahoo/AOL, custom IMAP, Proton via Bridge (restored 2026-08) | Free | built | Gmail, Workspace, iCloud, Microsoft and custom IMAP are in (MR I65/I66). Proton Bridge isn't named: verify that custom IMAP on localhost with STARTTLS works. |
| Unified inbox, or each account separately | Toggle between one merged inbox and one inbox per account | Free | built | Unified row plus per-account rows in the rail. |
| Account name, title and colour | Rename an account and pick its colour, used for labels too | Free | partial | Account hue dot exists. Verify that you can rename and recolour. |
| Fast inbox switching, custom inbox views (3.24, 2025-06) | Quick switcher between saved inbox views | ? | partial | Moduo has tabs plus `[`/`]` and `g` chords. No user-defined "views" beyond 3 custom tabs. |
| Aliases (send-as) | Per-account aliases; shared-inbox aliases on teams | Free | built | MR E39. |
| Default mail client | Set as the macOS default for `mailto:` | Free | built | MR X25. |
| Cross-device sync of settings and state | Spark account syncs settings, pins, snoozes and reminders across Mac, iOS and Windows through its servers | Free | **structural gap** | Moduo snoozes, follow-ups and pins live in the desktop engine (MV §13: the web shows only linked threads). There is no phone app. See "Structural gaps". |
| Check New Email button (3.27.5) | Manual refresh at the top of the sidebar | Free | built | "Sync now" sits in Settings → Accounts. Verify a one-click refresh exists in the shell itself. |
| Email storage and backups | Mail stays on the provider. Spark's servers hold tokens or encrypted passwords, push snippets for 4 h, send-later mail and team data. | Free | built (different) | Moduo keeps secrets in the macOS keychain and mail on the Mac only, with per-account storage and Clear buttons (MR S7). This is a privacy **advantage**. |

Sources: https://sparkmailapp.com/plans-comparison · https://sparkmailapp.com/help/add-manage-accounts/choose-the-account-name-title-and-color · https://sparkmailapp.com/help/manage-your-inbox/display-the-inbox-of-each-account-separately · https://sparkmailapp.com/spark3/mac/changelog

## 2. Smart Inbox, layouts and inbox organisation

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| Three inbox layouts | **Focused List** (priority on top, then grouped categories), **Unread Cards** (cards per category: Gatekeeper, Priority, People, Notifications, Newsletters, Pins, Seen, Shared Drafts), **Simple List** (plain chronological). ⌘⌥1/2/3 switch between them. | Free | partial | Moduo has one model: split tabs (Personal · up to 3 custom · Notifications · Newsletters). There's no card view or single plain list. Is a "Simple list / all inbox" option needed? Verify whether an "All" tab exists. |
| People / Notifications / Newsletters | Automatic categorisation | Free | built | Deterministic classifier with a "Why is this here?" explainer (MV). |
| Seen section | Read mail drops into a "Seen" bucket in card mode | Free | missing | Only meaningful if card mode is adopted. |
| Card actions | Mark the whole card read, done or deleted in one click | Free | partial | Moduo has "Get me to zero" in the tab ⋯ menu and bulk select with ⌘A. There's no per-section bulk Done. |
| Priority (senders and threads) | `I` marks a sender or thread as priority: orange highlight, pinned to the top with a configurable count, Priority notification mode | ? (verify; listed under paid "Enhanced Productivity") | built (partial) | Priority people with a list mark and opt-in notify (MR X2), plus "Mark Priority" in the more menu. Spark also has **per-thread** priority and a top-of-inbox block: verify whether Moduo floats them. |
| Pins | `D` pins, shown in a sidebar Pins section or an inbox section; for "find again" mail like tickets | Free | built | `p` pins; pinned threads float within their tab. Spark's key is `D`, ours is `p`. |
| Set Aside | `G` parks mail in a bubble at the bottom left (⌘G opens it). It isn't done, isn't snoozed and has no date: a "deal with this soon" shelf. | Free | **missing** | A Spark signature verb that heavy users rely on. The nearest thing in Moduo is pin. |
| Mark as Done | `E` archives (Gmail: drop the INBOX label). A "show Done" toggle mixes them back in, greyed. | Free | built | The triage centrepiece. Moduo has `e`/`⇧E` and Archive. Verify that a "show Done inline" toggle exists. |
| Group by sender | Collapse all of one sender's mail to one row (set from the sender menu) | Free | partial | Moduo groups by sender **only in the Newsletters tab**. Spark lets you group any sender anywhere. |
| Group by domain (3.24.6) | The same, for a whole domain | Paid | missing | |
| Home Screen | A launch or idle (15 min) summary of what arrived (counts or previews by category) plus an "Email Focus Schedule" of three default check-in times with reminders | Paid, desktop | missing | Moduo has the dashboard widget and "came back while you were away" (MV). It fits the "quiet notifications" brief well. |
| Recently Seen folder (3.27.5) | The last 10 opened emails per account, pinnable in the sidebar | Free | missing | Cheap, and handy after Done-by-accident. |
| Smart Folders (3.25) | Save a search as a sidebar folder; desktop folders sync between Mac and Windows, not with mobile | Paid | built | Moduo has **saved searches in the rail** (MR G59). It's equivalent. |
| Folders and nested folders, starred folders, ⌃G go to folder (3.22) | Create, rename, nest, star and sort folders; a quick folder jump | Free | partial | Moduo has the folder tree, create/rename/delete (MR C19–C23) and `m` move. There's **no "go to folder" jump** and no starred folders. ⌘K may cover the jump: verify. |
| Gmail labels | Several labels per mail with `L`, shown in the list and reader, coloured per label | Free | partial | Moduo shows labels as folders, has `mail-labels.tsx` and `label_add`/`label_remove` ops. **`L` is "Link" in Moduo**, so a Spark user's `L` muscle memory clashes. Verify there's an add-label UI outside rules. |
| Spam handling | Report spam with ⇧1 | Free | built | Report spam is in the more menu. |
| Display system labels; avatars on or off; preview lines (3.27.5) | Appearance settings | Free | built | Density with 1/2-line preview and Compact (MV A4), and a sender-logo toggle. Verify there's an avatar on/off switch. |

Sources: https://sparkmailapp.com/help/manage-your-inbox/customize-your-inbox · https://sparkmailapp.com/help/set-up-focus/set-aside-vs-pin-vs-snooze · https://sparkmailapp.com/help/manage-your-inbox/mark-as-done · https://sparkmailapp.com/help/sending-emails/pin-and-priority · https://sparkmailapp.com/help/manage-your-inbox/group-emails-by-sender · https://sparkmailapp.com/help/set-up-focus/home-screen · https://sparkmailapp.com/help/manage-your-inbox/create-smart-folder · https://sparkmailapp.com/help/tips-tricks/gmail-labels · https://sparkmailapp.com/help/tips-tricks/whats-new-in-spark-desktop-3275

## 3. Gatekeeper, blocking and unsubscribe

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| Gatekeeper | First-time senders wait **before the inbox** (New senders section), are flagged **inside it** (a prompt on open), or aren't screened. Accept or block; senders aren't told. | Paid | built | The Screener is off by default, with a New senders view and `y`/`b` keys (MR X1). Moduo has no "screen inside inbox" mode: verify it's wanted. |
| Bulk accept and block | Accept all or block all (⌘⇧T / ⌘⇧B) | Paid | specced (verify) | Check that new-senders-panel offers "all". |
| Block domain | ⌘⌥⇧B blocks a whole domain | Paid | partial | Rules can block by domain (MR X3). There's no one-gesture "block domain" from the reader. |
| Blocked folder plus "Empty all" (3.24.6) | A sidebar section of blocked mail, emptied in bulk | Paid | partial | Moduo sends blocked mail to a destination you choose (Trash by default), with the blocked list in Settings. |
| Unsubscribe | From Command Center ("Unsubscribe") on newsletter mail; the AI Assistant can also do it in bulk | Free | built | Moduo is **ahead**: an unsubscribe bar on the reader (RFC 8058 one-click), a Subscriptions view with "Done all from them" (MR X6, B17). |

Sources: https://sparkmailapp.com/help/sending-emails/accept-or-block-new-senders · https://sparkmailapp.com/glossary/one-click-unsubscribe · https://sparkmailapp.com/spark3/mac/changelog

## 4. Snooze, reminders, send later and undo

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| Snooze | `S`; presets editable in Settings; any custom time (3.27.5); returns as new | Free | built | `s` with presets and a custom datetime. Verify that the **presets are editable** in Settings (Spark lets you set "later today = 18:00" and similar). |
| Follow-up reminders ("Remind me") | On compose or on a sent mail: if nobody replies by a time (up to 2 months), it comes back; a Reminders sidebar folder | Free | built | `w` "Remind me if no reply", composer footer, Follow-ups rail, "No reply from Anna in 3 days" (MR X19). It's at parity or better. |
| Send later | Pick a preset or custom time up to 6 months out. Stored **encrypted on Spark's servers** and sends with the app closed. Edit or reschedule it in Outbox. | Free | **cut** | Cut twice: DESIGN_BRIEF 2026-07-04 (Maciej's planning interview) and MR **X9** "no" (labelled "designer" in Mike's spec; confirm). The reason is structural: there's no cloud relay, and nothing runs while the app is closed. A "send at time, only if the Mac is awake" version is possible but needs a product call. |
| Undo send | Default 5 s, adjustable timer (3.25.2) | Free | built | 5/10/20/30 s, default 10, with Undo and **Edit** (MR X22). Ahead. |
| Send again | ⌘⇧J resends a sent mail | Free | missing | Small. |
| Undo last action | Undo toast for triage | Free | built | 8 s undo for every action, `z`/⌘Z. |

Sources: https://sparkmailapp.com/help/sending-emails/schedule-an-email-to-send-later · https://sparkmailapp.com/help/sending-emails/set-follow-up-reminders · https://sparkmailapp.com/help/sending-emails/customize-undo-send-timer · https://sparkmailapp.com/help/tips-tricks/undo-the-last-action

## 5. Composer, templates and signatures

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| Rich text editor (3.20, 2025-01) | Toolbar with fonts, sizes, headings, lists, quote, indent, link, clear formatting; **tables**; automatic link detection; full ⌘ shortcut set (⌘B/I/U, ⌘⇧7/8/9, ⌘⇧K) | Free | **partial** | Moduo has **markdown line shortcuts only** (`- `, `1. `, `> `, `#`, `**bold**`, `_italic_`, `` `code` ``). There's no toolbar, fonts, tables or link dialog. A daily Spark user will feel this at once. |
| Inline images | Drag an image into the body, resize with a slider, caption, link | Free | **partial** | In Moduo, pasted or dragged images become **attachments**, not inline images. |
| Embedded media | Paste a media link to embed | Free | missing | |
| Templates | Saved emails with subject, To/Cc/Bcc, body and attachments; auto placeholders (name) and fill-in blanks; picked from a template icon or ⌘⇧T; reorderable (3.22.6); synced across devices | Paid ("custom templates" = Plus) | **partial** | Moduo has `;;` **snippets** with `{first name}` placeholders (MR E41): body text only. There's no subject, recipients, attachments or fill-in blanks. Snippets are faster to type, but they are a different thing. |
| AI templates | +AI adapts a template to the mail you're replying to | Plus | cut (AI) | MCP-only rule. |
| Signatures | **Several** signatures; HTML on desktop; a default per account (or none, or most recent); arrows in the composer to switch, or hide for one mail | Free | **partial** | Moduo has **one signature per alias**, swapped when you change alias (MV §9). There's no in-composer switcher and no multiple signatures per address. |
| From switch | Click the From address (⌘1) | Free | built | The alias menu shows when there's more than one alias. |
| Field jump keys | ⌘1–⌘6 jump to From, Subject, To, Cc, Bcc, Body | Free | missing | Cheap keyboard parity. |
| @-mention recipients in body (3.22.6) | Typing @name in the body adds them as a recipient | Free | specced (verify) | The BRIEF mentions `@contact` in compose. Verify it's built. |
| Contact groups | Email a group of contacts (Mac and iOS) | Free | missing | Moduo Contacts may supply groups or tags. |
| Auto Cc/Bcc | Per account, always Cc or Bcc an address | Free | missing | Small. Users with a CRM BCC address depend on it. |
| Send and mark Done | ⌘⇧↩ | Free | built | "Done on send" setting plus a footer checkbox (MR E48). |
| Composer in a new window | Pop out the composer (⌃⌥N) | Free | **cut** | MR **X27** "no" (labelled "designer" in Mike's spec; confirm). In Moduo, New message takes over the reader column. |
| Draft safety | Prompt to save on close; drafts sync | Free | built | Saved locally as you type, then to the server's Drafts after 2 s. Ahead. |
| Large attachments via cloud link | Spark Cloud upload, up to 2 GB a file | Paid, **mobile only** | missing | Moduo shows an honest over-limit message (MV §9). Desktop Spark doesn't do this either. |
| Instant intro, move to Bcc | n/a | n/a | built | Moduo-only (MV §9). |
| "Sent with Spark" tagline | Default footer, can be turned off | Free | n/a | Moduo should never add one. |
| Quick replies | One-tap canned replies (mobile only); AI quick replies | Free / +AI | missing | Mobile in Spark, so low priority. |
| Translate | +AI translates incoming and outgoing mail (⌥⇧T) | Paid +AI | cut (AI) | MCP-only. |

Sources: https://sparkmailapp.com/help/sending-emails/compose-an-email · https://sparkmailapp.com/help/sending-emails/use-rich-text-formatting-in-emails · https://sparkmailapp.com/help/spark-ai/templates-ai · https://sparkmailapp.com/help/sending-emails/manage-email-signatures · https://sparkmailapp.com/help/sending-emails/automatically-cc-or-bcc-emails · https://sparkmailapp.com/help/sending-emails/send-large-email-attachments-with-spark · https://sparkmailapp.com/help/sending-emails/multi-window-support-in-spark-desktop

## 6. Keyboard, Command Center, swipes and toolbar

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| **Shortcut presets** | Settings → Shortcuts: **Spark Desktop**, Spark Classic, **Apple Mail**, **Gmail**, **Superhuman** and **Custom** (rebind any action) | Free | **missing** | Moduo's map is fixed (`registry.ts`). It is close to Gmail/Superhuman (`e`, `s`, `j/k`, `r`, `a`, `f`, `#`, `g i`), but there's no preset picker and no rebinding. |
| Spark Desktop default keys | ←/→ next/prev · **⇧R reply, R reply-all** · F forward · U read · E done · ⌘⇧E all done · **I priority** · **D pin** · **G set aside** · S snooze · **L label** · ⌘⇧M move · Delete · ⇧1 spam · **P print** · O / ⇧O collapse/expand · C compose · ⌘↩ send · ⌘⇧↩ send+done · ⌘⇧T template · ⌘⇧A attach · ⌘K Command Center · ⌘F search · ⌘L copy deep link · ⌘⇧L shared link · ⌘S/⌘D/⌘G Snoozed/Pinned/Set-aside lists · ⌘E show Done · ⌘/ change layout · ⌘⇧H Home | Free | partial | **Muscle-memory conflicts for a Spark-default user:** Moduo `r` = reply (Spark: reply-all), `p` = pin (Spark: print; Spark pin = `D`), `l` = link (Spark: label), `g` = chord prefix (Spark: set aside), `o` = expand all (Spark: collapse). If the designer runs Spark's default set, either add a "Spark" preset or decide on purpose to break with it. |
| Superhuman-like mode | A Superhuman preset exists | Free | partial | Moduo's defaults are Superhuman-ish already. |
| Command Center (⌘K) | Lists every action with its shortcut; runs on the selected mail (block domain, unsubscribe, save to…, create smart folder, open in new window) | Free | built | ⌘K carries mail actions derived from the registry (MR-9) plus a `?` legend. Verify that every more-menu action is in ⌘K. |
| System-wide shortcuts (3.22.6) | Global hotkeys (for example compose from anywhere) | Free | missing | Possible via Tauri global shortcuts. |
| Swipes | Assign an action per swipe in Settings (trackpad on Mac; doesn't sync between devices) | Free | missing | A trackpad swipe on rows is rarely used on desktop. Hover cluster (Done, Snooze, ⋯) instead (MR). Nice-to-have. |
| Toolbar personalisation | Reorder or choose toolbar actions (**mobile only**) | Free | missing | Mobile in Spark. |
| Shortcut hints | n/a | n/a | built | Moduo-only hint line (MR X21). |

Sources: https://sparkmailapp.com/help/tips-tricks/use-keyboard-shortcuts · https://sparkmailapp.com/help/general/spark-command-center · https://sparkmailapp.com/help/manage-your-inbox/manage-emails-with-swipes · https://sparkmailapp.com/help/tips-tricks/personalize-the-toolbar

## 7. Reading, threads and the reader

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| Threaded conversations | Always threaded (can't switch off); oldest at top, newest at bottom | Free | built | Moduo shows the newest expanded and older collapsed. Neither app lets you turn threading off. |
| Delete one message from a thread (3.25.2) | Remove a single message | Free | specced (verify) | |
| Show original (3.21.3) | ⌥⇧O raw source | Free | built | In the more menu. |
| Expand or collapse all | O / ⇧O | Free | built | `o` expands all. |
| Mute thread | New replies skip the inbox. **Conflicting sources (verify):** the threads help article says mobile only, while the plans table and the 2022 Mac redesign coverage list mute. | Paid | built | Mute in the more menu, plus a `mute` engine op. |
| Print / PDF | Print one mail or the whole thread, with or without history and comments (3.27.5); attachment names on the PDF | Free | **cut** | MR **X28** "no" (labelled "designer" in Mike's spec; confirm). A frequent everyday need (receipts, contracts); recommend reopening it. The webview can print the sanitized HTML cheaply. |
| Reader font | Change the reading font | Free | missing | Ties to the density and text-size axis in memory. |
| Split View vs full-screen reader | Settings → Appearance → Layout: side-by-side list and reader, or list then full reader | Free | partial | Moduo is always three panes, and the side panel folds below 1180 px (MI). There's no full-width reading mode. |
| Thread in a new window (3.24) | Double-click or ⌃⌥N opens a separate window | Free | **missing** | X27 cut only the pop-out composer; pop-out reading was never asked about. |
| Remote images | Load by default (configurable) | Free | built | Blocked by default, with Block / Contacts only / Always, plus tracker stripping (MR S4, X7). **Ahead.** |
| Read statuses (tracking your own sent mail) | Eye icon showing if and when a recipient opened it | **Pro** | **cut** | MR **X8** "never" (labelled "designer" in Mike's spec; confirm). Correct for the privacy stance. |
| Attachment preview (3.30.5) | Space for Quick Look, arrows to move between attachments | Free | built | Space preview, drag out to Finder or onto a task (MR). |
| Attachments view | n/a as a folder in Spark (search with `has:`) | n/a | built | Moduo has an Attachments rail view. Ahead. |
| Translate thread | +AI | Paid | cut (AI) | |
| Summaries (short, detailed, action points) | +AI ⌘⇧S / ⌘⇧D / ⌘⇧A | Paid +AI | cut (AI) | MCP-only. An agent could do it if MCP could read bodies (it can't today). |

Sources: https://sparkmailapp.com/help/manage-your-inbox/threads-in-spark · https://sparkmailapp.com/help/tips-tricks/how-can-i-print-an-email · https://sparkmailapp.com/help/tips-tricks/how-to-enable-split-view-in-spark · https://sparkmailapp.com/help/spark-for-teams/read-statuses · https://sparkmailapp.com/help/tips-tricks/change-the-font-for-reading-emails-in-spark

## 8. Search

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| Smart Search, natural language | "from: Amazon last month", relative dates ("last week", "this month"); no exact dates | Free | partial | Moduo ⌘K has `from: to: subject: has:attachment is:unread is:pinned in: before: after:` (checked in `search/query.ts`). It has **exact dates but no relative phrases** like "last month". |
| Operators | `from:` `to:` (domain `@x.com`), `subject:`, `has:pdf` (type-specific), `in:`, `is:pinned` / `is:unread`, combined | Free | partial | `has:` accepts only `attachment` (checked in `search/query.ts`); there's **no `has:pdf`** type filter. Verify `from:@domain`. |
| Scope | All accounts by default, narrowable to one; Gmail covers everything except Trash/Spam | Free | built | Plus the "Search older mail on {account}" server escalation (Moduo is ahead). |
| Saved searches | Star a query (**mobile only**); desktop uses Smart Folders | Free/Paid | built | Saved searches sit in the rail. |
| Recent searches with clear (3.27.5) | Recent queries list, removable | Free | specced (verify) | Depends on ⌘K recents. |
| Search by meaning | Semantic search ("Search by meaning", CLI and AI) | Paid +AI | cut (AI) | |
| "Shared via link" filter | Find the mail you've shared | Paid | n/a | Moduo has no sharing. |

Sources: https://sparkmailapp.com/help/manage-your-inbox/use-smart-search · https://sparkmailapp.com/features

## 9. Notifications and badges

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| Per-account modes | **All / Smart** (people only) **/ Priority only / None**, set separately per account | Free | **partial** | Moduo is global: badge-only by default, optional "notify for Personal", priority people can always notify (MR A2/A3/X2). There are **no per-account modes**. |
| Per-sender unmute | Toggle notifications for one sender | Free | partial | Priority people does this. |
| Badge count | Configurable app badge | Free | built | Personal / All inbox / Off. |
| Calendar and meeting notifications | Separate settings | Free | n/a | Calendar module. |
| Previews, lock-screen actions, sounds, thread grouping | Mobile only | Free | n/a | |
| Notifications need the app running | Mac notifications require Spark open or in the background | Free | built (same) | Same constraint as Moduo (MR A4). Spark 3.33 now **keeps running in the background after quit**. |

Sources: https://sparkmailapp.com/help/add-manage-accounts/customize-notifications · https://sparkmailapp.com/help/add-manage-accounts/enable-notification-badges

## 10. Calendar inside mail

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| Built-in calendar | Google, Exchange/Outlook, iCloud; create, edit and delete events; Zoom, Meet and Teams links | Free | built (elsewhere) | The Moduo Calendar module, plus a **Today panel** in Mail (⌥1). |
| Invites in the reader | Accept or decline from the mail. App Store reviews report duplicate or UTC-shifted events after accepting. | Free | built | Invite card in the reader (MR). Verify RSVP round-trips to the organiser. |
| Event from email | Not documented as a standalone Spark feature | n/a | built | "Create event from this email" plus drag a thread onto a calendar day (MR). Ahead. |
| Meet with | Type people and see their shared availability, suggested slots; paste a list of addresses (3.27.5) | Free | n/a | A Calendar-module concern (offer times exists in MCP). |
| Meeting Notes | Bot-free transcription plus AI summary, share as email; auto-transcribe on Join (3.32.1) | 5 lifetime / Plus 40 / Pro ∞ | out of scope | Different module. Note it, because Spark bundles it into "email". |

Sources: https://sparkmailapp.com/help/calendars/enhance-your-productivity-with-calendar-scheduling-features · https://sparkmailapp.com/help/spark-ai/ai-meeting-notes · https://apps.apple.com/app/id6445813049

## 11. Teams and sharing

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| Shared threads plus private comments | Share a thread with teammates and discuss it in comments beside the mail | Free (2 collaborators) / Paid | **cut** | MR **X13** "later" (labelled "designer" in Mike's spec; a privacy call). Moduo's version would be thread → Chat or a comment on the email entity. |
| Shared drafts | Co-write a draft in real time, with reactions (3.25) | Free/Paid | missing | |
| Shared links | Public or team-only web page of one mail or a thread, updating live, revocable, addresses can be hidden (⌘⇧L); comments on shared links (3.28.5) | Free standard / Paid advanced | missing | Needs a cloud copy of the body, which collides with "mail never leaves the Mac". |
| Delegate / assign an email | Hand a mail to a teammate with status (10 assignments free) | Paid | partial | Moduo's answer is `t` convert → task, then assign the task. That's arguably better. |
| Shared inboxes plus aliases | Several people work one address (Pro) | Pro | cut | BRIEF non-goal: real-time collaborative inbox. |
| Team templates, roles and admin | Team-level templates and permissions | Paid | missing | |
| Copy deep link | ⌘L copies a `readdle-spark://` link that only you can open | Free | built | Copy link in the more menu, plus `moduo://` back-links in converted tasks. |

Sources: https://sparkmailapp.com/help/spark-for-teams · https://sparkmailapp.com/help/spark-for-teams/shared-links-move-your-emails-outside-the-inbox · https://sparkmailapp.com/help/tips-tricks/streamline-your-workflow-with-deep-links

## 12. Integrations, sharing out, and agents

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| Save to… (⌥ + key) | Send a mail to Todoist, Things, OmniFocus, Reminders, Asana, Trello, Notion, Evernote, Bear, OneNote, TickTick, Slack and others from ⌘K "Save to…" | Paid | built (native) | Moduo's spine: `t` task, `n` private note, `l` link, drag to a task or day. This is the core differentiator; the native version beats an export. |
| CRM (HubSpot 3.28.5; Salesforce and Pipedrive coming) | Log or see CRM context | Pro | built (native) | The Contact panel (last touch, open tasks, notes, mail and files with the person). |
| Slack sharing (3.26) | Share an email to Slack | Paid | missing | Moduo Chat would be the native target. Missing: "send this thread to a Chat channel". |
| macOS Share extension (3.27.5) | Share files, links and text from other apps into a new Spark mail | Free | missing | Nice. |
| Siri Shortcuts, widgets, Focus filters, Apple Watch | **Mobile only** | Free | n/a | |
| **Spark CLI for agents** (3.29, 2026-05) | A local CLI that lets Claude, ChatGPT, Cursor or Raycast read mail, calendar and notes; access levels Off / **Read-only** / **Triage**; agent activity log with undo; undo window for agent-sent mail; works with the app closed (3.33) | Free read / Pro triage | **partial** | Moduo MCP has `email_list/get/search/link/snooze/follow_up`, but it is **metadata-only** (no body read, no send). There is a **known mismatch**: MCP snooze and follow-up write cloud `email_refs`, which the desktop engine ignores (MV out-of-scope). Spark is now *more* agent-open than Moduo on mail. |
| Agent hand-off, Recipes, Auto-Drafts, Autopilot (2026-08 to 11) | Hand a thread to an agent; plain-language automations with a dry-run preview, schedules and digests; drafts written in your voice | Pro | cut (AI) / partial | Moduo's rules are structured (MR X3) with an "apply to the N already here" dry run (MV). That's the non-AI half of Autopilot. Digests are missing. |

Sources: https://sparkmailapp.com/help/integrations/integrations · https://sparkmailapp.com/help/spark-cli · https://sparkmailapp.com/help/spark-ai/autopilot-in-spark · https://sparkmailapp.com/help/spark-ai/ai-assistant · https://sparkmailapp.com/spark3/mac/changelog

## 13. Spark +AI (listed only; Moduo is MCP-only by rule)

Writing assistant (compose or rewrite, proofread, change tone) · My Writing Style and Personalization (tone, length, samples) · AI quick replies · summaries (short, detailed, action points) · translate in and out · AI templates · AI Assistant chat over mail, attachments (PDF/TXT), calendar and notes, with history of 1 month (Free), 1 year (Plus) or everything (Pro) · AI bulk unsubscribe and cleanup · Auto-Drafts · Autopilot content rules and digests · Meeting Notes summaries · semantic search. All are shared on a monthly credit quota. **Moduo status: cut by product rule.** The equivalent route is an agent through MCP, which today can't read bodies.

Sources: https://sparkmailapp.com/help/spark-ai/spark-ai-desktop · https://sparkmailapp.com/help/spark-ai/auto-drafts-in-spark · https://sparkmailapp.com/help/spark-ai/personalization

## 14. Other

| Spark feature | How it works in Spark | Tier | Moduo | Notes |
| --- | --- | --- | --- | --- |
| Dark mode, themes | Light, dark, system | Free | built | App-wide. |
| Expanded or compact sidebar | Collapse the sidebar to icons | Free | partial | App shell. |
| Out-of-office | Not in-app; links to provider instructions | n/a | cut | MR X14 "no". Spark doesn't have it either. |
| Offline | Cached mail readable; send queued | Free | built | Outbox with an offline queue and honest lines (MR E43). |
| VoiceOver (3.28.2) | Screen-reader support | Free | built | MI-7 accessibility pass. |
| App language | Localised UI | Free | missing | Not a Mail-specific item. |
| Sender profile | Click the sender: address, priority, notifications, grouping, block | Free | built | Contact panel plus who-card, plus "Add as contact" after 3+ replies (MR X23). Ahead. |

---

## Gap map (ranked by how much a daily Spark Mac user would miss it)

### Must-have (felt in the first day)
1. **Rich-text composer.** Toolbar, fonts and sizes, links, tables and **inline images** (Moduo: markdown shortcuts only; images become attachments).
2. **Templates.** Full saved emails with subject, recipients, attachments and fill-in blanks (Moduo: `;;` body snippets only).
3. **Multiple signatures with an in-composer switcher** (Moduo: one per alias).
4. **Shortcut presets and rebinding**, at least a "Spark Desktop" preset. Key conflicts: `r`/⇧R, `d`/`p` pin, `l` label vs link, `g` set aside vs chords, `i` priority, `p` print.
5. **Set Aside** (`G`, shelf without a date). It's one of Spark's three core triage verbs, alongside Done and Snooze.
6. **Print / save as PDF** of a mail or thread. Cut as X28 (labelled "designer" in Mike's spec; confirm); recommend reopening it.
7. **Per-account notification modes** (All / Smart / Priority / None).

### Should-have
8. **Send later.** Cut as X9 (labelled "designer" in Mike's spec; confirm) for structural reasons. Offer "send at a time while Moduo runs" or keep it cut, but make it an explicit call, because Spark users reach for it weekly.
9. **Group by sender anywhere**, and group by domain (Moduo: Newsletters tab only).
10. **Home Screen / focus schedule**: a "while you were away" summary plus batched check-in times. It fits the quiet-notification brief.
11. **Full-width reader / Split-or-Full layout toggle**, and a thread in its own window (only the compose pop-out was cut).
12. **Agent access parity.** MCP body read (opt-in) and real triage that the desktop engine honours. This fixes the known MCP snooze mismatch. Spark CLI already does read-only and triage levels.
13. **Natural-language dates in search** ("last month") and `has:pdf` attachment types.
14. **Auto Cc/Bcc per account** and **contact groups** as recipients.
15. **Recently Seen** (last 10 opened), plus a **"show Done inline"** toggle (verify: no such toggle found in `features/email/ui`).

### Nice-to-have
- Per-thread Priority floating to the top; one-gesture **block domain** from the reader; bulk accept/block in Screener.
- "Send again", ⌘1–⌘6 composer field jumps, system-wide compose hotkey, macOS Share extension.
- Go-to-folder jump and starred folders; per-label colours.
- Reader font choice (ties to the density and text-size axis).
- Send a thread to a Chat channel (Spark's Slack share, done natively).
- Trackpad swipes on rows.
- Shared threads and comments, shared drafts, shared links (X13 "later"; each needs a cloud copy of mail, which collides with the on-Mac decision).

### Structural gaps (not features: consequences of "mail stays on the Mac")
- **No phone app**, so none of Spark's mobile half (quick replies, widgets, lock-screen actions, Siri).
- **Nothing runs while the app is closed**: no send later, no reminders firing on another device. Spark 3.33 now even keeps running after quit.
- **Pins, snoozes, follow-ups and Done state don't follow you to another device**; the web shows linked threads only.
- **No shareable web copy of a mail** (Spark's shared links).

### Where Moduo is already ahead of Spark
Convert to task with contact and thread links · link, private note, drag to a task or day · contact context panel · Subscriptions view with one-click RFC 8058 unsubscribe · tracker stripping and blocked remote images by default · undo send with **Edit** · "Why is this here?" classifier explainer · rules with a dry-run count · server-side search escalation · secrets in the keychain, mail never on a vendor server.

---

## Where Spark is weak (known complaints)

- **Privacy and server dependence.** By Readdle's own privacy article, Spark stores an app token (Gmail, Outlook, Yahoo) or your **actual login and password**, encrypted (AOL, Exchange, custom IMAP), on its servers. It also keeps an encrypted subject and snippet for 4 hours per push notification, holds send-later messages until they go, and needs its servers for teams, shared links, delegation and templates. +AI sends content to AI providers. This is the most-cited reason people leave (competitor blogs are loudest; weigh accordingly). Source: https://sparkmailapp.com/help/privacy-data/spark-email-privacy-everything-you-need-to-know
- **Paywall creep.** Spark went subscription in 2022 (Premium), then replaced Premium and Teams with Plus/Pro in 2026-11. Gatekeeper, templates, smart folders, mute, group by domain, Home Screen, integrations and Autopilot are all paid. Free AI history is one month.
- **AI-first drift.** Since 2025 most releases are AI or agent features (Assistant, Auto-Drafts, Autopilot, CLI, Meeting Notes); classic mail fixes ship as "stability improvements". Some users find the UI busier and the plans confusing.
- **Reliability after Spark 3.** Reports of slowdowns and crashes, pins removed from server mailboxes, and calendar invite accepts creating duplicate or UTC-shifted events (App Store and Setapp reviews: anecdotes).
- **Rigid threading.** You can't turn threading off or reverse the order (oldest on top), and Readdle says it has no plans to change this.
- **Platform gaps.** Spark Cloud large files are mobile only (and mute may be too: sources conflict); settings like swipes and integrations don't sync between devices; smart folders don't sync desktop↔mobile; out-of-office isn't in the app.
- **Spark-only state.** Set Aside, reminders and Done-as-concept exist only in Spark, invisible in the provider's webmail.

Sources: https://www.getmailbird.com/best-spark-alternatives-macos-privacy-email-clients/ · https://clean.email/blog/ai-for-work/spark-mail-ai-review · https://setapp.com/apps/spark-mail/customer-reviews · https://www.macrumors.com/2022/10/04/spark-email-mac-redesign/ · https://apps.apple.com/app/id6445813049 · https://toolradar.com/tools/spark/pricing · https://sparkmailapp.com/help/manage-your-inbox/threads-in-spark · https://sparkmailapp.com/help/tips-tricks/out-of-office-auto-reply
