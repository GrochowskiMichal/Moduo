# Superhuman and others: speed, keyboard flow, cross-module links

Research lane for Email v4 (Mail). Benchmark #2 = Superhuman. Spark is covered in its own file. Researched 2026-11-21 from public pages; Superhuman's help center blocks automated fetching (HTTP 403), so some details come from Superhuman's blog, press and third-party write-ups and are marked as such. Moduo has no built-in AI (MCP only), so AI features are listed for completeness, not as candidates.

---

## 1. Superhuman Mail

### 1.1 Product shape

- A Gmail/Outlook client (now branded "Superhuman Mail", part of the Grammarly/Superhuman suite). Desktop app, web, mobile. Single list view by default, the open thread replaces the list (no permanent three-pane reading split; reviewers ask for one).
- Everything is reachable from the keyboard; the mouse is a fallback. Shortcuts are not customizable and are tuned for US QWERTY (separate guidance for international layouts).
- **Command palette (Cmd+K)** is the spine: every action, every setting, every navigation target is a palette command, and each row shows its single-key shortcut, so the palette doubles as a shortcut tutor. Hover tooltips on toolbar icons also show the key. `?` opens the full shortcut sheet.

Sources: [Superhuman help: Shortcuts and Cmd+K](https://help.superhuman.com/article/478-superhuman-command) (search snippet), [Blake Crosley design guide (secondary)](https://blakecrosley.com/guides/design/superhuman), [G2 reviews](https://www.g2.com/products/superhuman/reviews), [dev.to 2026 review](https://dev.to/pickuma/superhuman-review-is-a-premium-email-client-worth-it-for-developers-in-2026-5d81).

### 1.2 Triage flow and the inbox-zero ritual

- The mental model is a three-way sort per message: **done today, for another day, or done**. `E` = Done (archive), `H` = Remind me (snooze, with typed natural-language times like "tue 9am"), reply then `Cmd+Shift+Enter` = send and mark done.
- Optimistic UI: the row leaves immediately, focus moves to the next conversation, sync happens in a background queue. A small toast with Undo (`Z`) confirms every action.
- **Select all from here** (`Cmd+A` in a list position) plus `E` clears a backlog in one gesture; recommended once during onboarding to reset to zero.
- Reaching zero shows a full-screen landscape photo: a deliberate reward that makes the ritual sticky.
- Onboarding historically was a mandatory 30-minute 1:1 session with a specialist who drills shortcuts and gets the user to zero live; now offered rather than required. The lesson: they teach the *flow*, not the features.
- Filters on the current list: `Shift+U` unread, `Shift+S` starred, `Shift+R` no reply (sent mail without a response).

Sources: [Superhuman: how to split your inbox](https://blog.superhuman.com/how-to-split-your-inbox-in-superhuman/), [Superhuman: coaching session](https://blog.superhuman.com/the-fastest-way-to-inbox-zero-a-single-coaching-session/), [Contrary Research report](https://research.contrary.com/reports/superhuman), [tutorialtactic shortcut list](https://tutorialtactic.com/blog/superhuman-shortcuts/).

### 1.3 Split Inbox

- The inbox is split into tabs ("splits") across the top; `Tab` / `Shift+Tab` moves between splits, `J/K` within one. Each split shows a count. You can hit zero per split.
- Defaults: **Important / Other** (people vs automated). Common additions: VIP (hand-picked senders), Team (company domain), Calendar (invites + Calendly-type mails), News, tool splits (GitHub, Figma, Jira, Docs).
- **Custom split = saved search**: run any search, then Cmd+K "Split Inbox" saves it. Temporary splits for a project, deleted when done.
- Since 2025, **Auto Labels** (AI) can feed splits: built-in labels (Marketing, Pitch, Social, News, Needs reply, Waiting on, Meeting request) and custom prompt labels on higher tiers. Auto Archive can skip the inbox for marketing/cold pitches.

Sources: [How to split your inbox](https://blog.superhuman.com/how-to-split-your-inbox-in-superhuman/), [The next Superhuman AI](https://blog.superhuman.com/the-next-superhuman-ai/), [TechCrunch, Feb 2025](https://techcrunch.com/2025/02/19/superhuman-introduces-ai-powered-categorization-to-reduce-spammy-emails-in-your-inbox), [AlternativeTo, Apr 2025](https://alternativeto.net/news/2025/4/superhuman-s-new-update-brings-auto-reminders-auto-drafts-auto-labels-and-auto-archive).

### 1.4 Writing and sending

- **Snippets**: reusable templates with variables, inserted with `Cmd+;` in a draft (`G ;` lists them). Can carry recipients, attachments.
- **Send later**: `Cmd+Shift+L`, natural-language time.
- **Remind me if no reply**: `Cmd+Shift+H` in a draft; the thread comes back to the inbox at the chosen time only if nobody answered. 2025 "Auto Reminders" sets this automatically when a sent mail clearly expects an answer.
- **Undo send**: on by default (configurable delay); `Cmd+Shift+Z` = instant send, skipping the delay. Undo (`Z`) also covers archive, star, label moves.
- **Instant Reply / Auto Drafts** (AI): ready-made short replies or drafts on threads that need a response.
- Compose fields all have keys (`Cmd+Shift+O` To, `C` Cc, `B` Bcc, `F` From, `S` subject, `A` attach, `I` move recipients to Bcc). Drafts can pop out (`Cmd+Shift+P`) so you can keep triaging while a draft is open, and `Cmd+D` jumps back to it.

Sources: [tutorialtactic shortcut list](https://tutorialtactic.com/blog/superhuman-shortcuts/), [crm.org on undo](https://crm.org/news/superhuman-email-a-whole-new-category-of-speed), [Gmail hacks (Superhuman blog)](https://blog.superhuman.com/gmail-hacks/).

### 1.5 Read statuses

- Opt-in per user since the 2019 tracking-pixel backlash: off by default, no location shown. When on, the thread shows who opened, when and on which device.
- Takeaway for Moduo: if offered at all, it must be opt-in and quiet (brief: quiet notifications).

Sources: [Superhuman: Read Statuses](https://blog.superhuman.com/read-statuses/), [ITPro on pixel tracking](https://www.itpro.com/piracy/33952/premium-email-firm-superhuman-ends-pixel-tracking-after-backlash).

### 1.6 Calendar inside mail

- Calendar is a second view in the same app: `1` = mail, `2` = calendar (older builds: `0` toggles a calendar side panel, `-`/`=` previous/next day).
- When an open email mentions a date, the right panel shows **your day at that date** for context, without leaving the thread.
- **Instant Event (`B`)** in a thread: creates an event pre-filled from the thread (title, attendees, suggested time, location, your default video link).
- **Share Availability (`Cmd+Shift+A`)** in a draft: a calendar overlay appears, you drag over free slots, and the draft gets the times as text plus a booking link that exposes only those slots. Times update if your calendar changes; you can mark internal meetings as overridable for VIPs. Template with `{times}` / `{booking_link}` placeholders. Desktop only.
- **Find Time (`M` in calendar)**: type a teammate's name, see mutual free time inline, book with one click.
- No documented in-reader Accept/Decline shortcut found (gap, not proof of absence).

Sources: [Share Availability post](https://blog.superhuman.com/share-availability/), [TechCrunch Dec 2024](https://techcrunch.com/2024/12/04/superhuman-launches-availablity-sharing-as-it-thinks-about-building-a-calendar-app), [Find Time](https://blog.superhuman.com/find-time/), [Calendar spotlight](https://blog.superhuman.com/feature-spotlight-superhuman-calendar/).

### 1.7 Sender profile ("social insights")

- Right sidebar on every open thread shows the other person: photo, role/company, location, social links (LinkedIn, X), and **recent conversations with them**. Inherited from Rapportive (the founder's previous product). It answers "who is this and what did we last talk about" without a click.
- Moduo angle: Moduo already has Contacts; the sidebar should be the contact record plus everything linked to it (tasks, events, notes, chat mentions), not scraped social data.

Sources: [TechCrunch 2017 launch](https://techcrunch.com/2017/08/18/rapportive-founders-new-startup-superhuman-is-what-gmail-would-be-if-built-today/), [Chrome Web Store listing](https://chrome.google.com/webstore/detail/superhuman/dcgcnpooblobhncpnddnhoendgbnglpn), [ITPro review](https://www.itpro.com/network-internet/email-providers/367893/superhuman-review).

### 1.8 Team features

- **Team Comments**: internal comments inline in an external thread, `@mention` a teammate (even non-users, who get a guest web view). Comments never go to the external recipients.
- **Shared Conversations**: share a whole thread with a teammate who is not on To/Cc/Bcc; they follow future replies. Shared threads show a share icon and avatar stack in the list.
- No assignment, no shared team inbox (Missive/Front own that).

Sources: [Shared Conversations and Team Comments (help)](https://help.superhuman.com/hc/en-us/articles/38457432565267), [Team Comments blog](https://blog.superhuman.com/how-to-use-team-comments-to-reimagine-email-collaboration/), [efficient.app](https://efficient.app/post/superhuman-releases-team-comments-shared-conversations).

### 1.9 AI features (list only; Moduo is MCP-only)

Write with AI / Instant Reply / Auto Drafts with voice-and-tone matching · Auto Summarize (one-line summary above each thread, updates on new mail) · Ask AI (natural-language search and Q&A over mail + calendar) · Auto Labels and custom prompt labels · Auto Archive · Auto Reminders · Workflows / planned auto follow-up. Source: [The next Superhuman AI](https://blog.superhuman.com/the-next-superhuman-ai/), [Tom's Guide](https://www.tomsguide.com/uk/ai/superhuman-email-can-generate-emails-send-reminders-and-more-heres-how-to-sign-up).

### 1.10 Speed engineering and what it means for UX

| Claim | What it implies for the UI |
| --- | --- |
| Every interaction under 100 ms, aim under 50 ms; new renderer shows a mail in ~32 ms | No spinners on navigation, ever. Reading a thread must come from local data. |
| Local database of recent mail (reported: last 30 days on install), works offline | The list and reader read from a local store first; the network is a background concern. |
| Prefetch and prerender threads likely to be opened next | The next/previous thread in the list is already rendered when you press `J`/`K` or `E`. |
| Optimistic actions + background sync queue | Archive/snooze/label apply instantly; failures surface later as a quiet retry, with Undo always available. |
| Minimal animation (secondary source: ~150 ms archive slide, 200 ms palette entrance) | Motion confirms, never blocks; input is accepted during animation. |
| Shortcut hints everywhere, palette shows keys | Learning curve is paid down inside the product, not in docs. |
| Faster key-repeat for `J/K` (secondary, unverified) | Holding a key should scroll lists smoothly. |

Sources: [Built for speed (Superhuman blog)](https://blog.superhuman.com/superhuman-is-built-for-speed/), [SE Daily interview](https://softwareengineeringdaily.com/2020/09/16/superhuman-with-rahul-vohra/), [Blake Crosley (secondary, internal targets unverified)](https://blakecrosley.com/guides/design/superhuman), [Inc. on search](https://www.inc.com/ben-sherry/email-innovator-superhuman-says-its-ai-search-is-twice-fast-as-gmail.html).

Criticism worth noting: the dev.to 2026 review says Superhuman is excellent at clearing mail but "does nothing with the work email creates", which is exactly Moduo's opening (email to task, note, event).

---

## 2. Superhuman keymap (Mac)

Compiled from the long-standing public list (tutorialtactic, mirrors of Superhuman's own PDF) plus 2024–2025 blog posts for calendar keys. Verify against the in-app `?` sheet before copying; a few keys moved over time (noted).

### Global and navigation

| Key | Action |
| --- | --- |
| `Cmd+K` | Command palette (every action) |
| `?` | Shortcut sheet |
| `/` | Search |
| `Esc` | Back / close |
| `Enter` | Open conversation |
| `J` / `K` | Next / previous conversation |
| `N` / `P` | Next / previous message within a thread |
| `Tab` / `Shift+Tab` | Next / previous split (in a message: cycle links and dates) |
| `Space` / `Shift+Space` | Scroll down / up |
| `Cmd+Up` / `Cmd+Down` | Jump to top / bottom |
| `Cmd+N` / `Cmd+T` | New window / new tab |
| `Cmd+1..9` | Switch tab |
| `Ctrl+1..9` | Switch account |
| `Ctrl+/` | Copy link to the page |
| `Cmd+= / - / 0` | Font size up / down / reset |
| `1` / `2` | Mail / Calendar (2025 calendar) |
| `0` | Toggle calendar panel (older builds) |
| `-` / `=` | Previous / next day in calendar panel |

### Go-to (sequence)

| Key | Destination |
| --- | --- |
| `G I` | Inbox / Important |
| `G O` | Other |
| `G S` | Starred |
| `G D` | Drafts |
| `G T` | Sent |
| `G E` | Done |
| `G H` | Reminders |
| `G M` | Muted |
| `G ;` | Snippets |
| `G !` | Spam |
| `G #` | Trash |
| `G A` | All mail |
| `G L` | A label (picker) |

### Triage (conversation)

| Key | Action |
| --- | --- |
| `E` | Mark done (archive) |
| `Shift+E` | Mark not done |
| `H` | Remind me (snooze, typed time) |
| `S` | Star |
| `U` | Read / unread |
| `#` | Trash |
| `!` | Spam |
| `Shift+M` | Mute |
| `Cmd+U` | Unsubscribe |
| `Z` | Undo last action |
| `X` | Select conversation |
| `Shift+J` / `Shift+K` | Extend selection |
| `Cmd+A` | Select all from here |
| `L` | Add / remove label |
| `V` | Move to label (remove from inbox) |
| `Y` | Remove label |
| `[` / `]` | Remove label and go next / previous |
| `Shift+Y` | Remove all labels |
| `B` | Instant Event from this thread (2025) |

### List filters

| Key | Filter |
| --- | --- |
| `Shift+U` | Unread |
| `Shift+S` | Starred |
| `Shift+I` | Important |
| `Shift+R` | No reply |

### Reading and replying

| Key | Action |
| --- | --- |
| `Enter` | Reply all |
| `R` | Reply |
| `F` | Forward |
| `C` | Compose |
| `O` / `Shift+O` | Expand message / all messages |
| `Cmd+O` | Open link or attachment |
| `Shift+Enter` / `Shift+R` / `Shift+F` / `Shift+C` | Pop-out reply-all / reply / forward / compose |

### Compose

| Key | Action |
| --- | --- |
| `Cmd+Enter` | Send |
| `Cmd+Shift+Enter` | Send and mark done |
| `Cmd+Shift+Z` | Instant send (skip undo delay) |
| `Cmd+Shift+L` | Send later |
| `Cmd+Shift+H` | Remind me (if no reply) |
| `Cmd+Shift+A` | Share availability (in draft; older lists: attach) |
| `Cmd+;` | Insert snippet |
| `Cmd+Shift+O / C / B / F` | Focus To / Cc / Bcc / From |
| `Cmd+Shift+S` / `Cmd+Shift+M` | Edit subject / body |
| `Cmd+Shift+I` | Move recipients to Bcc |
| `Cmd+Shift+,` | Discard draft |
| `Cmd+Shift+P` | Pop draft in / out |
| `Cmd+D` | Switch to / from the open draft |
| `Cmd+B / I / U / K` | Bold / italic / underline / link |
| `Cmd+Shift+X / 7 / 8 / 9` | Strike / numbered / bullets / quote |

### Calendar view (2025)

| Key | Action |
| --- | --- |
| `M` | Find time with a teammate |
| `B` | Instant event |
| `Cmd+K` → Open Week / Create Empty Event | Calendar commands |

Note: one secondary design guide claims `H`/`L` switch splits; Superhuman's own materials use `H` for Remind me and `Tab` for splits. Trust the latter.

Sources: [tutorialtactic (106 shortcuts)](https://tutorialtactic.com/blog/superhuman-shortcuts/), [nickgray.net mirror of the v7 PDF](https://nickgray.net/?p=6835), [Find Time](https://blog.superhuman.com/find-time/), [Share Availability](https://blog.superhuman.com/share-availability/).

---

## 3. Others: only where they beat both Spark and Superhuman

### HEY (Basecamp)

- **Screener**: a first-time sender waits in a queue until you say yes or no, once; "yes" also chooses the destination (Imbox / Feed / Paper Trail). Better than any auto-classifier for trust: one human decision per sender, forever.
- **Imbox / Feed / Paper Trail**: three destinations by *intent*, not by AI category. Feed shows newsletters already expanded as a reading stream; Paper Trail is receipts you search, never triage.
- **Reply Later + Focus & Reply**: a stack you park mail in, then a single page that lays out every parked thread with its own reply box, so you write replies in one batch. Clearly the best "answer time" mode anywhere.
- **Set Aside**: a reference shelf for mail you need handy (a boarding pass), separate from to-dos.
- **Bundles**: all mail from one sender collapses to one row.
- **Private thread notes, rename subject (only for you), merge threads**: lightweight ways to make a thread *yours* without touching what others see.

Sources: [hey.com/features](https://hey.com/features/), [How it works](https://hey.com/how-it-works), [Thread notes](https://www.hey.com/features/thread-notes/), [Merge threads](https://hey.com/features/merge-threads), [Rename subjects](https://hey.com/features/rename-subjects), [The Sweet Setup review](https://thesweetsetup.com/hey-email-disrupted-my-email-workflow/).

### Shortwave

- **Bundles** (Inbox-by-Gmail heritage): related threads grouped into one row that you can mark done, snooze or delete as a unit without opening them.
- **Todos tab with `T`**: one key turns a thread into a todo in its own inbox tab; todos can hold a description and span several threads. The cleanest "email becomes a to-do" gesture in a mail client.
- Typed snooze ("4 hours").

Sources: [Shortwave: todos and stars](https://shortwave.com/blog/todos-and-stars), [clean.email review](https://clean.email/blog/email-clients/shortwave-review), [Shortwave docs](https://www.shortwave.com/docs/).

### Notion Mail

- **Views**: any filter (label, sender set, read state) saved as a view with its own hover actions; essentially Superhuman's saved-search splits with configurable row actions.
- Auto labels trained by correction (manual relabel teaches the classifier) and applied retroactively.
- Caveat: Notion has announced Notion Mail shuts down on 2026-09-22, so treat it as a pattern source only.

Sources: [Notion help: auto labeling](https://www.notion.com/help/guides/organize-your-inbox-with-notion-ai-auto-labeling), [Zapier review](https://zapier.com/es/blog/notion-mail/).

### Missive

- **Chat on the thread**: every email conversation has an internal chat bar under it; `@mention` grants a teammate access to that one thread.
- **Assign = task**: assigning a conversation turns it into a tracked task with a due date, visible in a team Tasks view grouped by person/status. Rules can create sub-tasks from incoming mail ("New client" mail creates five tasks).
- Team inboxes with full audit trail ("who did what, when").

Sources: [Missive features](https://missiveapp.com/features), [Assignment docs](https://missiveapp.com/docs/core-features/triage-and-assignment), [Tasks docs](https://missiveapp.com/docs/core-features/tasks), [Tasks announcement](https://missiveapp.com/blog/tasks-announcement).

### Front

- **Comments vs internal discussions**: comments live on the customer thread; a "discussion" is a comment-only conversation (no external mail) you can assign, snooze, archive like any thread.
- **Auto-assign on reply**: whoever replies first to an unassigned shared-inbox thread owns it. Prevents double replies with zero ceremony.
- `@group` shortcuts via rules.

Sources: [Front: @mentions](https://help.front.com/t/k924vw), [Front: internal discussions](https://help.front.com/en/articles/2098), [Macha: assignment explained (third party)](https://www.getmacha.com/blog/front-assignment-explained).

### Mimestream

- Native Swift macOS client on the Gmail API (not IMAP), so it can do Gmail-only things a native app usually can't: **server-side Gmail filters edited in-app**, synced aliases and signatures, Gmail categories. Feels like a Mac app, keeps Gmail shortcuts. The bar for "native feel" in a Tauri app.

Sources: [MacRumors 2023](https://www.macrumors.com/2023/05/25/mimestream-gmail-client-macos-released), [9to5Mac hands-on](https://9to5mac.com/2022/02/25/mimestram-gmail-app-macos-hands-on/), [mimestream.com](https://mimestream.com/).

### Apple Mail (Categories)

- Four fixed categories: Primary, Transactions, Updates, Promotions. **Time-sensitive mail from a non-Primary category also surfaces in Primary** (e.g. a delivery today). Non-Primary categories open as a **per-sender digest**. "Categorize Sender" moves all past and future mail from a sender in one step.

Sources: [Apple: use categories in Mail on Mac](https://support.apple.com/guide/mail/mlhl64d76621/mac), [Apple: iCloud Mail categories](https://support.apple.com/guide/icloud/mmafbebd3108/icloud).

---

## 4. Speed patterns worth taking

| Pattern | Source | Why it fits a keyboard-first desktop client |
| --- | --- | --- |
| Command palette shows each command's key | Superhuman | Moduo already has a palette; showing keys turns it into the shortcut teacher, no tutorial needed. |
| Optimistic actions + always-on Undo (`Z`) + background sync | Superhuman | Lets triage keys fire at typing speed; Undo replaces confirmation dialogs. |
| Auto-advance to next thread after E/H/send-and-done | Superhuman | The core rhythm of keyboard triage: you never navigate, you only decide. |
| Local-first read path + prefetch next/previous thread | Superhuman | The 100 ms bar is only reachable from a local store; Tauri can hold one. |
| Single-key triage verbs (E done, H later, S star, L label, U unread, # trash) | Superhuman | Matches Linear-style single-key verbs Moduo uses in Tasks. |
| `G`-sequence go-to keys | Superhuman (Gmail heritage) | Cheap, memorable navigation across folders and across Moduo modules. |
| Splits = saved searches as top tabs, `Tab` to cycle, zero per split | Superhuman, Notion Mail views | Gives structure without folders; one-gesture creation from any search. |
| Select all from here + E | Superhuman | One keystroke recovers from a backlog; makes inbox zero reachable on day one. |
| Send and mark done (`Cmd+Shift+Enter`) | Superhuman | Collapses two decisions into one at the moment you're done. |
| Remind me if no reply (in draft) | Superhuman | Follow-up lives on the sent mail itself, no separate to-do needed (Moduo MCP already has `email_follow_up`). |
| Natural-language snooze/send-later field | Superhuman, Shortwave | Typing "tue 9" beats any date picker for keyboard users. |
| Pop-out draft + jump back (`Cmd+D`) | Superhuman | Keeps triaging while a reply is half-written. |
| Focus & Reply batch mode | HEY | A dedicated "answer time" view: one keyboard pass writes all parked replies. |
| Screener for first-time senders | HEY | One yes/no per sender, deterministic, no AI; quieter than any classifier. |
| Bundles by sender/kind | HEY, Shortwave, Apple | Collapses notification noise into one row you can clear with one key. |
| Inbox-zero reward screen | Superhuman | Small, quiet reward that makes the ritual stick; fits "quiet" if understated. |

---

## 5. Cross-module patterns

| Need | Best pattern found | Who | Notes for Moduo |
| --- | --- | --- | --- |
| Email → task | One key (`T`) adds the thread to a Todos list; todo can span several threads and carry a description | Shortwave | Moduo version: one key creates a Moduo task linked to the thread (spine link), title prefilled from subject, thread stays openable from the task. |
| Email → task (team) | Assigning the conversation *is* the task: owner + due date + status, team view by person | Missive | Fits "assign thread to teammate" if Moduo ever does shared inboxes. |
| Follow-up without a task | Remind me if no reply, set while drafting | Superhuman | Already modelled in Moduo MCP (`email_follow_up`). |
| Scheduling from a thread | Instant Event (`B`): event prefilled from the thread, attendees = participants, default video link | Superhuman | Natural spine link: event ↔ thread. |
| Offering times | Drag free slots in a calendar overlay inside the draft; inserts text + a booking link limited to those slots; live updates | Superhuman Share Availability | Moduo has `calendar_offer_times` / booking; the in-draft overlay is the UX to copy. |
| Mutual availability | Type a teammate's name, see shared free time inline | Superhuman Find Time | Uses Moduo calendar data directly. |
| Date context while reading | Right panel shows your day when a mail mentions a date | Superhuman | Good use of Moduo's switchable right panel. |
| Invite RSVP in reader | Not documented in Superhuman; standard in Apple Mail/Gmail (accept/maybe/decline bar on the invite) | Gmail, Apple Mail | Gap to fill: RSVP bar + your day preview in the reader, with keys. |
| Sender side panel | Person card + recent conversations on every thread | Superhuman (Rapportive heritage) | Moduo: the Contact record + linked tasks/events/notes/chat. Create contact in one key if unknown. |
| Notes on a thread | Private notes and files on any thread, invisible to others | HEY | Moduo: link or create a Note from the thread; or a thread-scoped private note. |
| Make a thread yours | Rename subject (only for you), merge threads | HEY | Useful for linking: a renamed thread reads better as a link chip elsewhere. |
| Comment with teammates | Inline team comments with @mention inside the external thread; share a thread with a non-recipient | Superhuman, Front, Missive | Moduo: comments on the email entity (MCP `comments_add` exists) or "discuss in chat" that posts a thread link to a chat channel. |
| Internal discussion as its own item | Comment-only conversation that can be assigned/snoozed | Front | Moduo already has Chat; link instead of duplicating. |
| Who handles it | Auto-assign to first replier | Front | Only relevant for shared inboxes. |
