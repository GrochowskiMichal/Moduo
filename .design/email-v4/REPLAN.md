# Mail v4: the rethink

> **Status (2026-11-21): round 1 sent, waiting for Maciej's answers.** Phase 1 (design, with Maciej). No product code, no migrations.
> - Branch `t/maciej/email-plan` (from `origin/maciej` @ e566e71ef). Research: [`research/`](./research/) (Spark, Superhuman and others, Mail as built). Round-1 prototype: [`prototypes/round-1.html`](./prototypes/round-1.html).
> - **Open:** calls 1–46 (§8). ★ marks the load-bearing ones.
> - **Blocked:** the live-app baseline score. 2026-11-23: with Maciej's OK, the shared stack was restarted with its data kept, and the gateway is back. But the local DB still sits at its 2026-10-15 snapshot and is missing the repo's later migrations, so the lab seed fails (`calendar_op_event_create` has the old signature). Catching up is not safe to do blind: the 10-15 → 11-04 range is half-applied, there is no migration ledger, and some files are one-shot or destructive. The Calendar session has put it to Maciej as one call: a clean rebuild from a fresh snapshot, a rehearsed catch-up on a copy, or leave both baselines pending. The baseline runs once he decides. Interim numbers: Mail as built scored 7.0 on 2026-11-07 (before "Mail, improved" landed), the improve prototype 7.7. The current build is unscored.
> - **Next:** answers → round 2a (every surface, state by state, plus the live baseline critique) → 2b → reconcile → final prototype through the critic loop → `specs/mail-v4.md` → Ready.
> - **Re-entry point for a fresh session:** this status block, then §8.

## 0. How to read this

| § | What it covers |
| --- | --- |
| §1 | Diagnosis: what Mail is today, what's strong, what's missing |
| §2 | The benchmark in one table (full tables in `research/`) |
| §3 | The proposed shape of Mail v4 |
| §4 | What only Moduo can do: the links |
| §5 | Technical decisions the agent takes (never asked) |
| §6 | For Mike: changes that need his systems, raised as calls in product terms |
| §7 | Cross-module asks (Calendar and others) |
| §8 | The calls, by round |
| §9 | What happens next |

**Who decides:** Maciej decides product (features, UX, UI, copy, keys, feel). Mike owns systems; his Mail rebuild (MR-0…16), Mail v3 (MV-0…12) and "Mail, improved" (MI-0…7) are the foundation, all landed in v1.8.0. Agent's choices are marked as such.

**Collision classes on each call:** (a) builds on what exists · (b) new · (c) re-decides an earlier product answer (named).

---

## 1. Diagnosis

### 1.1 Root cause

Mail was specified three times in a month by the systems side (MR on 2026-11-03, MV on 11-06, MI on 11-08), each round answering "what does the engine need the screens to show?". The engine is now genuinely strong. But the product questions a Spark user asks first (*can I write a proper email? can I set it aside? can I send it tomorrow at 9? can my teammate see it?*) were answered as quick yes/no lines inside engine specs (X8, X9, X13, X27, X28), mostly "no" for engine reasons. Every gap below has that shape: **a mail-client feature decided as an engine side effect.**

The second shape: Mail was laid out before Tasks v3 set the app's rules, so it doesn't use the bottom-bar mode (82b), its right panel has three fixed views where the app wants a switchable registry, and its link features are a reader chip row rather than the spine.

### 1.2 What's genuinely strong (keep)

- **The engine:** local SQLite store per user, 100k-thread virtualized list, push, an ops outbox with undo snapshots, a send outbox, on-demand bodies, drafts synced to the server, server search escalation. This is the Superhuman speed foundation (Superhuman's 100 ms bar only works from a local copy; Moduo already has one).
- **The triage loop:** j/k with the reader following, `e` Done advancing to the next thread already open and read, undo that brings it back selected, Send & Done (⌘⇧↵), `w` remind-if-no-reply, typed snooze. On par with Superhuman.
- **Trust:** trackers stripped before images load, remote images blocked by default, secrets in the keychain, one-click RFC 8058 unsubscribe, "Why is this here?" explaining the classifier.
- **Spine pieces:** `t` convert to task with contact and thread links, `l` link, `n` private note, drag onto a task or a calendar day, invite RSVP card, Contact panel with the person's tasks, notes, meetings, mail and files. Spark has none of this.

### 1.3 What's missing or broken, by kind

| Kind | Items | Source |
| --- | --- | --- |
| **Spark parity, felt on day one** | Rich-text compose with inline images · templates (whole emails with blanks) · several signatures with a switcher · Set Aside · print / PDF · per-account notification modes · shortcut presets | research/spark.md gap map 1–7 |
| **Spark parity, felt weekly** | Send later · group by sender anywhere · a full-width reading layout · natural dates in search ("last month") · auto Cc/Bcc · contact groups · Recently seen | gap map 8–15 |
| **Structure** | No bottom-bar mode; right panel has 3 fixed views; four visible columns at 1440 px (rail, list, reader, panel); custom tabs capped at 3 | code-inventory.md |
| **Trust bugs** | A failed list read is swallowed and shows "Inbox is clear" · saved searches can't be removed and appear only after a reload · an agent's snooze (MCP) never reaches the Mac · folder create/rename/delete was answered yes (C19–C23) but never built | code-inventory.md §6 |
| **Capability gaps (links)** | No scheduling from a thread (offer times, booking link) · no share-to-chat · Quick capture from Mail has no "From" chip · links are a chip row, not a panel view · link chips don't update live | code-inventory.md §5 |
| **Teams** | Nothing: a teammate can't see, discuss or take over an email. The first user is a 2–5 person agency. | spark.md §11 |
| **Structural** | Mail lives only on the Mac: nothing fires while the app is closed, no phone, no web reading | spark.md "Structural gaps" |

**Whose call the old cuts were:** X8 (read receipts), X9 (send later), X13 (sharing), X14 (out-of-office), X27 (pop-out) and X28 (print) are labelled "designer" inside Mike's rebuild spec, but only the July send-later cut is clearly Maciej's. Each one reopened here is a call, so his answer now is the record.

**Spark's price has changed:** Spark moved to Free / Plus / Pro in November 2026, and Gatekeeper, templates, group by domain and the Home Screen are now paid. The plan matches the full feature set anyway.

### 1.4 What Mail must adopt from Tasks v3

The 3×3 layout with the bottom bar (48b) · the bottom-bar mode row with keys plus More (82b) · the right-panel view registry with its title dropdown and "← item" stack (SH-1) · References (RF-1): Mail defines the email chip, card, hover preview, "Private email" and "Deleted email" · capture with a type registry (⌘⇧K) · the three text levels, one interaction language, one date grammar, avatars (38–46a) · density applies to everything (44) · the state rules.

---

## 2. The benchmark in one table

Full inventories: [research/spark.md](./research/spark.md), [research/superhuman-and-others.md](./research/superhuman-and-others.md). Moduo status from [research/code-inventory.md](./research/code-inventory.md).

| Area | Spark | Superhuman | Moduo today | Call |
| --- | --- | --- | --- | --- |
| Layout | Split or full reader | List, then full-width thread | Split, always | 1 |
| Inbox model | Smart Inbox (sections or cards), Simple list | Split Inbox (tabs from searches) | Tabs, ≤3 custom | 5, 6 |
| Triage verbs | Done, Snooze, Set Aside, Pin, Priority | Done, Remind, Star | Done, Snooze, Pin, Remind | 8, 9 |
| Compose | Rich text, inline images, tables, templates, signatures | Snippets, send later, remind | Markdown, snippets, one signature per alias | 13–16 |
| Send later | Yes (server) | Yes (server) | Cut (X9) | 17 ★ |
| Print / PDF | Yes | Yes | Cut (X28) | 18 |
| Keys | Presets (Spark, Gmail, Superhuman, Apple Mail, Custom) | Fixed, taught by ⌘K | Fixed, close to Superhuman | 21 |
| Notifications | All / Smart / Priority / None per account | Important only | Global badge, Personal toggle | 19 |
| Calendar | Invite RSVP, event from email | Calendar panel, share availability, instant event | Invite RSVP, create event | 30, 31 ★ |
| Teams | Share thread, private comments, shared drafts, shared links | Team comments | None | 34–36 ★ |
| Links to work | Send to Todoist and friends | None ("does nothing with the work email creates") | Task, link, note, contact panel | 26–33 ★ |
| Agents | Spark CLI, +AI | AI built in | MCP metadata only | 38 |
| Where it lives | Mac, iOS, web; server-side | Mac, iOS, web; server-side | Mac only, nothing on a server | 39 ★ |

---

## 3. The proposed shape of Mail v4

**Idea, one sentence:** *Spark's inbox at Superhuman's speed, where every email can become, or join, the work it's about.*

- **Layout (calls 1–4):** the centre is the list and the open conversation side by side; a Full layout swaps to a full-width conversation (one key). The right panel is a switchable view (Person by default). The bottom bar carries the conversation's actions with their keys, so the reader loses its toolbar.
- **Inbox (5–7):** Spark's sectioned Smart Inbox by default (Pinned, People, Notifications, Newsletters, Seen), each section clearable with one key; tabs stay as a Display choice. Splits (saved searches) can be pinned.
- **Verbs (8–12):** Done, Snooze, Set aside, Pin, Remind if no reply, Task. Set aside is Spark's dateless shelf, and its page is a batch-reply page (HEY's Focus & Reply).
- **Compose (13–18):** rich text on the editor Moduo already uses, inline images, templates with blanks, several signatures, send later, print.
- **Links (26–33):** an email and its task stay connected; scheduling happens inside the email (offer times, booking link, invite RSVP with your day beside it); a Links view shows everything an email touches; Quick capture knows where it came from.
- **Team (34–36):** share one conversation with the team (opt-in, per conversation) so teammates read and comment on it in Moduo; "Discuss in chat" posts it to a channel.
- **Agents (38):** MCP gets real triage the Mac honours, opt-in body read, and drafts. Never send.

The prototype's frame 1 shows this shape; the other frames show each call's variants.

---

## 4. What only Moduo can do: the links

| Moment | Today | v4 proposal | Call |
| --- | --- | --- | --- |
| An email asks you to do something | `t` makes a task; the link is then a chip | The email and the task stay one piece of work: replies show on the task, completing the task offers Done, and the email's row shows the task's state | 26 ★ |
| An email asks to meet | Invite card or "Create event" | Offer times from the composer (pick free slots, insert them plus a booking link); RSVP with your day beside the invite; "Schedule" from any email | 30, 31 ★ |
| An email is about a client project | Link it by hand | Linking to a project files future replies from that conversation too; the project shows its emails | 27 |
| You want to know who this is | Contact panel | Contact view, richer: the contact, their company, open work, recent mail, next meeting | 3 |
| You want to see what an email touches | A chip row | Links view in the right panel: tasks, events, notes, chat posts, the project | 3, 28 |
| You want to note something | Private note | Note from email: a Moduo note linked both ways, or the private note | 29 |
| You want a teammate's eyes | Nothing | Share with team (comments) or Discuss in chat | 34, 35 ★ |
| You capture a thought while reading | Quick capture with no source | Quick capture carries "From: <email>" and links on save | 32 |

---

## 5. Technical decisions the agent takes (never asked)

Each with the rejected alternative. Product-visible effects are raised as calls instead.

1. **Rich text uses Lexical**, the editor Notes already runs (`docs/` stack: "Lexical for rich text"). Outgoing mail is HTML with a plain-text alternative generated from the same tree. Rejected: a contentEditable composer (the designer overruled exactly this once: memory "don't silently deviate").
2. **Templates and signatures are `email_settings_items` kinds** (MR-7's owner-only table; new kinds `template`, more than one `signature` per account), so they sync across devices like snippets. Rejected: local-only storage (Spark's top complaint is settings that don't sync).
3. **Print uses the webview's print of a print-only render** of the conversation (headers, bodies, attachment list), which gives Save as PDF for free on macOS. Rejected: a PDF library in Rust.
4. **Set aside is a local thread state** like pinned (engine store, synced to IMAP as a keyword where the server allows, e.g. `$SetAside`), so Spark-style shelving costs no new folder. Rejected: a server folder (it would hide the email from the inbox in other clients, which is snooze's job).
5. **Sections in the Smart Inbox are a grouping of the existing classifier output** (people / notifications / newsletters plus pinned and seen). No new classifier. Rejected: a second classifier for "Priority".
6. **The bottom-bar mode reuses Tasks' `useBottomBarMode`** contract (82b); the reader keeps only the subject, chips and per-message actions.
7. **The right panel moves to the app's view registry** (SH-1) with Mail's hand-picked views; the 1180 px strip goes (the panel follows its toggle and the app's narrow-window rule).
8. **A failed list read shows an error state** with Retry and keeps the last rows on screen (state rule "partial"). This is a trust fix, built without a call.
9. **Saved searches** get remove/rename and live updates. Folder create, rename and delete (C19–C23, answered yes, never built) get built. Trust fixes, no call.

## 6. For Mike: changes that need his systems

These are raised to Maciej as numbered calls in product terms (17, 34, 38, 39, 40) with cost; whatever is chosen is also noted for Mike in the spec's assumptions and the PR description.

| Need | Product effect | Cost (agent's estimate) | Call |
| --- | --- | --- | --- |
| A small cloud scheduler for outgoing mail | Send later and reminders fire when the Mac is asleep | M–L: a server holds a ready-to-send copy until its time; an SMTP/Graph send from an Edge Function; credentials or a send token leave the Mac | 17 |
| A cloud copy of shared conversations | Teammates read and comment on a shared email | M: one table plus storage for the shared bodies; per-conversation, opt-in; RLS by workspace | 34 |
| An agent-ops queue the Mac drains | An agent's snooze, Done, label and draft actually happen | S–M: a queue table written by MCP, applied by the engine on next sync | 38 |
| Prefetch the next and previous bodies | Opening the next email is always instant | S: engine reads ahead around the selection | 40 |

---

## 7. Cross-module asks

### To Calendar (the session on `t/maciej/calendar-plan`)

Mail owns how these look and behave inside Mail; Calendar owns the event model and its own screens.

1. **Invite RSVP:** an API to accept / maybe / decline an iTIP invite into the right calendar, return the event id, and report conflicts with the person's day (for the "your day" strip beside the invite). Today `R/invite.rs` parses iTIP and "Add to Moduo calendar" writes an event; the RSVP reply goes by mail.
2. **Offer times:** a read of the person's free slots for a date range with working hours and buffers applied (MCP already has `calendar_offer_times` / `calendar_release_offer`), and a "hold" concept so offered slots show as tentative until booked or released.
3. **Booking links:** list the person's booking links with a short URL each, so the composer can insert one; and a booking made from a link Mail sent should link the event to that email.
4. **Event from an email:** create an event with the email's participants as guests, the subject as title, and a spine link event ↔ email.
5. **The Today view:** Mail's right panel shows Calendar's day (events, focus blocks, free gaps). Mail needs the component or a read of the day, and Calendar decides how a day looks.
6. **Booking emails** (TX-5/TX-6, sent by Moduo itself): when they arrive in Mail, they should open the booking's event, not read like ordinary mail.

### What Calendar asks of Mail (read from `origin/t/maciej/calendar-plan` §9, 2026-11-21)

| Calendar's ask | Mail's answer |
| --- | --- |
| 1. The invite card answers the same invitation Calendar shows, through the event's provider, and shows a reply already given in Calendar (C7) | Yes: call 31's bar uses Calendar's RSVP state and writes through it |
| 2. A button in Mail's reply opens Calendar's offer with the thread's people and takes back the inserted text and link (C28) | Yes: call 30's Schedule view is Calendar's offer, hosted in Mail's right panel; Calendar owns the slot model, Mail owns the panel and the insert |
| 3. A follow-up draft from a past meeting, with the guests, the thread and the meeting note linked (C27) | Yes: Mail's composer accepts "new message from event" (to = guests, links = event, note, thread) |
| 4. A booking or offer made from a thread becomes an event the thread shows as a reference | Yes: call 26/28's Links view and the link line under the subject |

**One difference to settle:** Calendar wants booking emails to read as ordinary mail; my ask 6 below wants them to open their event. Proposed middle: ordinary mail, plus the event as the first item in the link line. Not a conflict worth a message yet; I'll raise it in round 2 if Maciej's answers to 30–31 make it matter.

### To Tasks

7. Email ↔ task as one piece of work (call 26): the task shows "New reply" when its email gets one; completing the task offers Done on the email. Needs a reply signal on the task row (the Waiting state, 53a, may already carry it).

### To Contacts and Chat

8. The Contact view (call 3) reads the contact's company, open work and next meeting. Chat: "Discuss in chat" (call 35) posts an email reference card into a channel; the chat composer already accepts `email_thread` references.

---

## 8. The calls

Answer by number ("10. ok … 14. drop it"). Each call has the question, options, my recommendation and why. ★ = load-bearing. Frame pointers refer to [`prototypes/round-1.html`](./prototypes/round-1.html) (keys 1–9 pick a frame, V cycles variants, T switches light/dark, D cycles density).

### Round 1 (2026-11-21): the shape

#### A · Layout

**1 ★ · Where the conversation opens** · (c, re-decides MV §1's fixed three panes)
- **a. Split:** the centre holds the list and the open conversation side by side; the right panel is context. This is today, minus the reader toolbar.
- **b. Full:** the centre shows the list; Enter opens the conversation full width in the centre; Esc goes back. Superhuman's model.
- **c. In the right panel:** the centre is the list; the conversation opens in the right panel like a task's detail. Tasks' model, but it leaves no room for context.
- **d. Split by default, Full one key away** (Spark has this as a setting; we make it a key, `⇧Enter` or a Display choice).
- *Recommend d.* Split keeps triage fast (j/k with the reader following); Full is what you want for a long email or a newsletter. Anyone outside the target group (a freelancer on a 13" laptop) benefits most from Full.
- Frame 1, variants a–c.

**2 ★ · The bottom bar carries the conversation's actions** · (b, adopts 82b)
- When a conversation is open, the bar's centre shows its most-used actions with keys: **Done `e` · Snooze `s` · Set aside `⇧S` · Reply `r` · Task `t` · More ▾** (exact list in round 2). Multi-select shows its own row; the composer shows **Send `⌘↵` · Send later · Template · Attach**.
- The reader loses its toolbar; the subject, links and per-message Reply/Forward stay in the reader.
- **a.** Yes, the bar · **b.** Keep the reader toolbar (today) · **c.** Both.
- *Recommend a:* one place for actions app-wide, more room for the email, and the keys are always in view, which teaches them.
- Frame 3, variants a–c.

**3 ★ · The right panel's views, and which one opens first**
- Hand-picked views, keys as today plus one: **Today** `⌥1` (your day from Calendar) · **Contact** `⌥2` (the sender: contact, company, open work, recent mail, next meeting; today's view, richer) · **Task** `⌥3` (opens after `t`, or when you open a linked task, with "← email") · **Links** `⌥4` (everything this email touches; its name is call 45) · **Schedule** (Calendar's offer, hosted here when you offer times; call 30).
- Default: **a.** Contact · **b.** Today (today's default) · **c.** remember the last one.
- *Recommend a, Contact:* when you read an email, who it's from and what you're doing with them is the context you use; your day is one key away. Superhuman's sidebar is the sender for the same reason.
- Frame 4, variants Contact / Links / Today / Schedule.

**4 · The rail**
- Order: **Inbox** (unified) · **Set aside** · **Snoozed** · **Follow-ups** · **Drafts** · **Sent** · then **Accounts** (each with its folders, collapsed) · **Saved searches** · **More** (Archive, Trash, Spam, Subscriptions, Attachments, Recently seen, New senders).
- Today's rail lists every place flat. Spark's sidebar puts the triage verbs' places first and folders in a collapsible tree.
- **a.** This order · **b.** Keep today's flat list · **c.** You reorder (drag) and hide rows.
- *Recommend a, with c later:* the places you work in first, the archive-like places folded. Customising the rail is a known want (customization is a product value) but adds a settings surface; round 2 can add it.
- Frame 1 (rail).

#### B · The inbox

**5 ★ · How the inbox is organised** · (c, re-decides MR B7 "tabs")
- **a. Tabs** (today): Personal · up to 3 custom · Notifications · Newsletters, one at a time.
- **b. Sections** (Spark's Focused list): one scrolling list with **Pinned · People · Notifications · Newsletters (one row per sender) · Seen**, each section with a header, a count and its own "Done all" (`⇧E` on the header).
- **c. Cards** (Spark's Unread cards): each section is a card showing its top 3 with "Show all".
- **d. b by default, a as a Display choice** (Layout: Sections · Tabs · Simple list).
- *Recommend d.* Sections show everything at once, so nothing waits in a tab you forgot (Spark's Focused list; tell me if you use Spark's cards or Simple list instead); tabs stay for people who want one queue at a time (Superhuman users); Simple list for those who want neither.
- Frame 2, variants a–c.

**6 · Splits: any saved search can become a section or tab** · (c, re-decides MR B8 "up to 3")
- "Save as split" on any search (`from:@acme.com`, `to:me is:unread`); a split becomes a section (or tab) in the inbox with its own count. Up to 6, then "+N".
- **a.** Yes, up to 6 · **b.** Keep 3 custom tabs defined in Settings.
- *Recommend a:* the agency user wants one split per client; Settings-only creation is too far from the moment you notice the pattern.

**7 · Group by sender anywhere**
- Any sender (or whole domain) can be grouped to one row, like the Newsletters section does today ("Group mail from Linear"). From the ⋯ menu or the Person view.
- **a.** Yes, sender and domain · **b.** Sender only · **c.** No.
- *Recommend a:* notification-heavy senders (GitHub, Stripe, Linear) are the noise agencies drown in. Spark charges for domain grouping.

#### C · The verbs

**8 ★ · Set aside: Spark's dateless shelf** · (b)
- Set aside parks an email out of the inbox without a date and without calling it done ("I'll reply to this today"). It's one of Spark's three triage verbs.
- **a.** Yes, its own place in the rail · **b.** No; use Pin.
- *Recommend a.* Pin keeps it in the inbox (noise) and Snooze needs a time (friction). This is the verb Spark users miss on day one.
- Frame 7.

**9 · Set aside's page is a batch-reply page** · (b)
- Opening Set aside shows every set-aside email stacked, each with its reply box open, so you answer them in one pass (HEY's Focus & Reply). `⌘↵` sends and moves to the next.
- HEY keeps these apart: Set Aside holds reference you keep handy, Reply Later is the batch. This option merges them, because a dateless shelf mostly holds replies you owe.
- **a.** Batch-reply page · **b.** Ordinary list · **c.** Both, as two places (HEY's split).
- *Recommend a:* it turns the shelf into a routine ("answer time"), and nobody else combines Spark's shelf with HEY's batch. If a looks too heavy, b with a "Reply to all of these" mode.
- Frame 7, variants a–b.

**10 · Keys for the verbs**
- Proposed: `e` Done · `s` Snooze · `a` Set aside · `p` Pin · `w` Remind if no reply · `t` Task · `r` Reply · `⇧R` Reply all (today `a`) · `f` Forward · `⇧A` open Set aside.
- Collision: today `a` is Reply all (Gmail and Superhuman use `a` too). Spark uses `G` for Set aside, which collides with Moduo's `g` chords.
- **a.** This map (`a` = Set aside, `⇧R` = Reply all) · **b.** Keep `a` = Reply all and give Set aside `⇧S`.
- *Recommend b:* `a` for Reply all is muscle memory from Gmail and Superhuman for many people, while `⇧S` reads as "set aside" next to `s` snooze. (Presets in call 21 can remap.)

**11 · Done shows where it went, and Recently seen**
- After Done, "Recently seen" (last 20 opened) in the rail's More lets you find what you just cleared; a Display toggle "Show done in the inbox" greys them in place until you leave (Spark).
- **a.** Both · **b.** Recently seen only · **c.** Neither (Undo and Archive cover it).
- *Recommend b:* cheap, and it covers "where did that go"; showing done mail inline fights inbox zero.

**12 · Priority** · (a, extends MR X2 "Priority people")
- Spark marks a sender **or a single conversation** as priority (floats to the top, priority notifications). Moduo has Priority people only.
- **a.** Add per-conversation priority (`i`) · **b.** Keep people only.
- *Recommend b:* Pin already floats a conversation; two "float this" verbs is one too many.

#### D · Writing

**13 ★ · Rich-text compose with inline images** · (b)
- Toolbar on selection (bold, italic, link, lists, quote, headings), markdown shortcuts kept, pasted or dropped images inline (resizable), tables later.
- **a.** Yes · **b.** Markdown only (today).
- *Recommend a:* it's the first gap a Spark user hits, and replies with a screenshot are everyday mail. Built on the editor Notes uses.

**14 · Templates: whole emails with blanks** · (b)
- A template is subject + recipients + body + attachments, with blanks (`{first name}`, `{date}`, and fill-ins you type) and a picker (`⌘⇧T`). Snippets (`;;`) stay for short pieces.
- **a.** Yes, both · **b.** Snippets only.
- *Recommend a:* agencies send the same proposal, invoice-chase and onboarding emails weekly.

**15 · Several signatures, switched in the composer** · (a, extends one-per-alias)
- Any number of signatures, a default per account and alias, ← → to switch in the composer, "none" for one email.
- **a.** Yes · **b.** One per alias (today).
- *Recommend a.*

**16 · Composer extras from Spark**
- Auto Cc/Bcc per account (a CRM's BCC address), contact groups as recipients (from Contacts' tags), `⌘1–⌘5` jumps to From/To/Cc/Subject/Body, "Send again" on a sent email.
- **a.** All four · **b.** Pick some.
- *Recommend a:* each is small and each has a user who depends on it.

**17 ★ · Send later** · (c, re-decides MR X9 "no")
- **a.** No (today).
- **b.** On this Mac: the email waits in the Outbox and sends at its time if Moduo is running; if the Mac was asleep, it sends the moment Moduo wakes and says it was late.
- **c.** Always on time: a Moduo server holds the email and sends it at its time even if your Mac is off. Needs Mike (§6): a copy of that one email and a send permission leave the Mac.
- **d.** b now, c later as Mike's call.
- *Recommend d:* Spark users schedule weekly; b is honest and costs nothing on the server; c is the real thing and is a systems decision. Reminders ("Remind if no reply", snooze returns) have the same limit today; c would fix them too.
- Frame 3 variant c (the composer's Send later).

**18 · Print and Save as PDF** · (c, re-decides MR X28 "no")
- `⌘P` prints the conversation (or one message); the macOS dialog gives Save as PDF.
- **a.** Yes · **b.** No.
- *Recommend a:* invoices, contracts and tickets get printed; it's small.

#### E · Notifications and keys

**19 · Notifications per account** · (a, extends MR A2/A3)
- Each account: **All · People** (the Personal/People section only; default) **· Priority people · None**, and the Dock badge follows the same choice.
- **a.** Yes · **b.** Keep the global setting.
- *Recommend a:* a work account and a personal account rarely want the same noise. Quiet stays the default.

**20 · A quiet check-in summary** · (b)
- When you open Mail after a while (or at times you set, like 9:00, 13:00, 17:00), the inbox opens with one line: "Since 9:00: 4 from people, 12 notifications, 2 follow-ups due" with a key to start. No pop-up, no separate home screen.
- **a.** Yes, the line plus optional check-in times · **b.** The line only · **c.** No.
- *Recommend b:* today's "came back while you were away" line already does half of this; check-in times are a habit feature for round 2 if wanted. Spark's Home Screen is paid and separate; we keep it a line.

**21 · Keyboard presets** · (b)
- Settings → Keyboard: **Moduo** (default) · **Superhuman / Gmail** · **Spark** · **Apple Mail**, each remapping the Mail keys only.
- **a.** Presets · **b.** Presets plus rebinding any action · **c.** One fixed map.
- *Recommend a:* the people switching to Moduo come with muscle memory from one of these four; full rebinding is an app-wide settings project, not a Mail one.

**22 · Search understands plain dates and file types**
- ⌘K mail search adds "last week", "this month", "since Monday", `has:pdf`, `has:image`, `larger:5mb`. Today it takes exact dates only.
- **a.** Yes · **b.** No.
- *Recommend a:* Spark's search works like this and it's what people type.

**23 · The Screener's default** · (a, MR X1 "off by default")
- New senders wait in "New senders" until you allow them (HEY, Spark's Gatekeeper). Today it's off by default, a Settings toggle.
- **a.** Keep off, and offer it once at first run ("Screen new senders?") · **b.** On for new accounts · **c.** Keep off, no offer.
- *Recommend a:* screening is loved by people with public addresses and annoying for everyone else; one honest offer lets each choose.

**24 · A draft in its own window** · (c, re-decides MR X27 "no")
- `⌘⇧D` pops the draft you're writing into its own small window so you keep triaging, and brings it back (Superhuman's pop-out). Opening a conversation in its own window too.
- **a.** Draft only · **b.** Draft and conversation · **c.** No (today).
- *Recommend a:* long replies get written between other things; a separate conversation window adds little next to Full (call 1).

**25 · Out-of-office reply** · (c, re-decides MR X14 "no")
- Set an automatic reply with dates from Settings → Mail, through the provider (Gmail and Microsoft have it; plain IMAP accounts don't).
- **a.** Yes, where the provider supports it · **b.** No; use the provider's website.
- *Recommend b:* it's a once-a-year setting, the provider's page does it, and half the accounts can't.

#### F · Moduo's links

**26 ★ · An email and its task stay one piece of work** · (b, extends EM-8 convert)
- After `t`: the email's row shows the task's state (a small check, "Task · due Fri"); a new reply on that email shows "New reply" on the task and in the inbox; completing the task offers "Also Done the email"; opening either shows the other in the right panel ("← email" / "← task").
- **a.** Yes · **b.** Keep them separate after creating (today: a link chip only).
- *Recommend a:* this is the single thing Spark and Superhuman can't do, and the connective-tissue spine's best demo. People outside the agency case (students, freelancers) use email-as-task the most.
- Frame 5 variant a.

**27 · Link an email to a project** · (b)
- From the Links view or `l`, link a conversation to a project; replies to that conversation stay linked; the project's page lists its emails (a project view, owned by Tasks). For agencies, "client mail" per project.
- **a.** Yes · **b.** Link to tasks and contacts only (today).
- *Recommend a:* agencies think in clients and projects, not inboxes.

**28 · The Links view replaces the chip row** · (a)
- Today an email's links are chips under the subject. v4 keeps one short line under the subject ("Task · Hero photos · 2 more") and puts the full list, with add and remove, in the right panel's Links view.
- **a.** Line + Links view · **b.** Chips only (today) · **c.** Links view only.
- *Recommend a:* chips grow until they push the email down; one line plus a view scales.
- Frame 4 variant Links.

**29 · Note from an email**
- `n` today makes a *private note* on the email. v4: `n` creates a **Moduo note** linked both ways (title = subject, quoting the selected text), and the private note becomes "Add a note to this email" inside the Links view.
- **a.** Yes · **b.** Keep the private note only.
- *Recommend a:* meeting prep and client briefs start from an email; a private sticky note is a smaller job.

**30 ★ · Scheduling from an email** · (b; Calendar owns the event model, §7)
- **Offer times:** in the composer, "Offer times" (`⌘⇧O`) opens Schedule in the right panel: your week, drag to pick slots; it inserts them as a short list plus a booking link limited to those slots, and holds them as tentative until booked or released.
- **Booking link:** insert one of your booking links (`/book` in the composer).
- **Schedule:** from any email, "Schedule" makes an event with its people as guests, linked to the email.
- **a.** All three · **b.** Booking link and Schedule only.
- *Recommend a:* "when are you free?" is the most common email that turns into work, and Moduo has the calendar right there. Superhuman's version is its most loved feature.
- Frame 5 variant c.

**31 ★ · Invites: answer with your day beside it** · (a, extends the invite card)
- An invite shows a bar: **Accept `y`… · Maybe · Decline** (keys in round 2), and the right panel switches to Today on that date with the invite drawn as a ghost among your events, conflicts marked.
- **a.** Yes · **b.** Keep today's card.
- *Recommend a:* you can't answer an invite without seeing your day. Gmail and Apple Mail do the bar; nobody puts the day beside it.
- Frame 5 variant b.

**32 · Quick capture from Mail knows its source** · (a)
- ⌘⇧K while reading an email pre-fills "From: <subject>" and links the new task, note or event to the email.
- **a.** Yes · **b.** No.
- *Recommend a:* the capture source type already exists and nothing in Mail uses it.

**33 · Drag an email anywhere** · (a, extends drag to a task or day)
- Drag an email onto a project, a note, a chat channel or a contact to link it there (today: tasks and calendar days).
- **a.** Yes · **b.** Keep today's targets.
- *Recommend a:* one gesture for every link, which is the spine's rule ("link by default, easy to remove").

#### G · Teams (the first user is a 2–5 person agency)

**34 ★ · Share a conversation with the team** · (c, re-decides MR X13 "later")
- "Share with team" on one conversation (opt-in, per conversation): teammates see it in Moduo (desktop and web) with its messages, can comment under it (Moduo comments, with @mentions), and new replies keep it up to date. Unsharing removes it. Nothing else of your mail leaves the Mac.
- **a.** Yes · **b.** Later (today's answer) · **c.** Only "Discuss in chat" (call 35).
- *Recommend a:* an agency's client emails are team work; Spark Teams and Missive are built around this. It needs a cloud copy of the shared conversations only (Mike, §6, cost M). People outside agencies (solo) never see it.
- Frame 6 variant a.

**35 · Discuss in chat** · (b)
- From an email, "Discuss in chat" posts an email card (subject, sender, excerpt, link) into a channel or DM, with your message. Teammates without access see the card and the excerpt you chose.
- **a.** Yes · **b.** No.
- *Recommend a:* the cheap half of sharing; works without call 34.
- Frame 6 variant b.

**36 · Hand an email to a teammate**
- "Assign" makes a task for a teammate from the email (call 26's link included) and, if the conversation is shared (34), they can reply from their own account with the history in view.
- **a.** Yes · **b.** No.
- *Recommend a:* delegation is the agency's daily move; through Tasks it costs no new concept.

**37 · Shared inboxes (hello@, support@)**
- A team inbox several people work from, with assignment and "who's replying" (Front, Missive).
- **a.** In v4 · **b.** Its own plan later.
- *Recommend b:* it's a different product (a help desk); v4 makes personal mail team-aware first.

#### H · Agents and where Mail lives

**38 ★ · What agents can do with your mail (MCP)** · (c, re-decides Q-E6 "metadata only")
- Today an agent can list, search, link and snooze, but its snooze never reaches the Mac.
- **a.** Agents' triage really happens (Done, snooze, label, pin, link) through a queue the Mac applies; reading a body is opt-in per account; agents can write **drafts** that wait in your Drafts; agents **never send**.
- **b.** Keep metadata only and remove the snooze tools that don't work.
- *Recommend a:* "AI only through MCP" means MCP has to be good; drafts-never-send keeps you in control. Needs Mike (§6, cost S–M).

**39 ★ · Mail stays on the Mac** · (c, re-opens "the inbox never leaves the machine")
- Spark and Superhuman run on servers, which gives them phones, web and on-time sending. Moduo keeps your mail on the Mac only.
- **a.** Keep it Mac-only for v4; sharing (34) and send later (17c) are the only, opt-in exceptions.
- **b.** Plan a server copy so Mail works on the web and, later, the phone. Needs Mike: a large change.
- *Recommend a:* privacy is the top reason people leave Spark, and it's Moduo's edge; revisit with mobile, which is its own plan.

**40 · Instant next email (for Mike)** · (b)
- The engine reads the next and previous emails' bodies ahead of time, so opening the next email never shows "downloading". Cost S.
- **a.** Yes · **b.** No.
- *Recommend a.*

#### I · Vocabulary and principles

**41 · One name for an email exchange**
- Chat already uses "thread" for replies. Mail today mixes "thread" and "conversation".
- **a.** "Conversation" in the list and reader; a link chip says "Email" with the subject. · **b.** "Thread".
- *Recommend a:* no collision with Chat, and "email" is what people call it.

**42 · "Done" vs "Archive"**
- The verb is **Done** everywhere; the place it goes is **Archive** (where you find done mail).
- **a.** Keep both words in those roles (today) · **b.** Call the place "Done".
- *Recommend a:* Archive matches the server folder people see in other clients.

**43 · Densities reach Linear level**
- Comfortable (two lines), Compact (one 32 px line), and a new **Dense** (one 28 px line, smaller avatars, no snippet).
- **a.** Add Dense · **b.** Keep two densities.
- *Recommend a:* the densest setting should reach Linear and Notion (customization rule). Frame 9.

**44 · Light theme gets the same care as dark**
- Every frame in this plan ships in light and dark (T in the prototype). Light-mode tuning was out of scope in AGENTS.md; Mail's reading surface is where light matters most (email bodies are designed light).
- **a.** In scope for Mail v4 · **b.** Out, as today.
- *Recommend a:* most HTML email is designed on white, and readers often read in light.

---

**45 · One name for the "what this email touches" view**
- Calendar's plan calls its version **Details** (everything linked to an event). Mail's frames call it Links.
- **a.** Details, app-wide · **b.** Links.
- *Recommend a:* one name per concept across modules, and "Links" collides with the `l` Link verb.

**46 · What the right panel does in a narrow window** · (c, re-decides MI's "folds to a 40 px strip below 1180 px")
- The critics found the reader squeezed to a sliver at 1024 px with the panel open. Calendar's 30 Oct review stopped its panels folding at all.
- **a.** Below 1200 px the panel hides; its bottom-bar toggle brings it back over the reader · **b.** Keep the icon strip (today) · **c.** Never hide; the list narrows instead.
- *Recommend a:* no edge strips (the 3×3 rule) and the reader keeps its width. It should be one app-wide rule; I'll match whatever you pick for Calendar. The prototype draws a.

### Round 1 prototype: blind critics

Three fresh critics per round (the jury is "partly checked, not calibrated", so scores are estimates), prototype grading (0.375 Usability + 0.3125 Craft + 0.1875 Platform + 0.125 Character; speed isn't judged on a prototype). Dossiers are local (`.lab/`, gitignored).

| Round | Overall | Usability · Craft · Platform · Character | Gates (a11y · states · layout · system · pointer) | Severity 3 confirmed |
| --- | --- | --- | --- | --- |
| r1 | 6.75 | 6 · 7 · 7 · 8 | 8.5 · 10 · 10 · 9 · 10 | Person panel didn't follow the open email (3/3); reader collapsed at 1024 px (3/3); bulk summary named the wrong people (2/3); first run showed connected accounts (3/3, sev 2–3) |
| r2 | 7.13 | 7 · 7 · 7 · 8 | 8.5 · 10 · 10 · 9.2 · 10 | Right panel rows and collapsed messages not reachable by Tab (1 run sev 3, 1 run sev 2) |
| r3 | 7.13 | 7 · 7 · 7 · 8 (all three runs identical) | 8.5 · 10 · 10 · 8.7 · 10 | none |

All three critics read the idea the same way: *"mail as a keyboard-first triage desk inside the work: every email shows its task, project, person and calendar, and you finish an email by turning it into linked work."* That matches the intended idea (§3).

Fixed after r1: the Person panel follows the focused email (a multi-select shows the selected people, loading shows a skeleton); the right panel folds away below 1200 px so the reader keeps its width; the bulk summary and a check mark show the real selection; first run shows only "Connect an account"; compact rows keep the subject and shrink chips to icons; a skip link plus one tab stop per group puts the list two Tabs away; Inbox clear shows once; Send later opens beside its button and isn't styled as primary; the invite ghost sits beside the clashing event; "Done all" names its section; one hour format.

After r2: keyboard reaches panel rows and collapsed messages; first run's bar offers only Connect; Schedule has a legend; selection labels match; stronger hover; full long subject; panel data matches Today. After r3 (polish, no re-score): message avatars round again (a CSS clash), compose header on separate rows, format toolbar clear of the selection, Busy hatched and Offered outlined, account counts clear with the inbox, focus ring outside filled buttons, Today titled by its date when it shows another day.

**Bar not met (8.0) after three rounds, as expected for a shape prototype:** it is a set of variants, not one finished module. What holds the score at 7: polish items (identity colours not yet tokens, one light-mode contrast pair) and what a prototype can't show (undo, journeys). The final prototype gets its own critic loop before the spec.

## 9. What happens next

1. Maciej answers round 1 (by number).
2. Round 2a: every surface, state by state (list, reader, composer, panel views, rail, search, settings), the bottom-bar rows in detail, keys, and the live-app baseline critique once the local stack is back. A gap audit by a separate agent.
3. Round 2b: what 2a opens. Round 3: reconcile with anything in flight.
4. Final prototype through /product-studio's critic loop (bar 8.0) → "Turn into spec" → `/s1` grills only the gaps → `specs/mail-v4.md`, Ready.
5. Build phase after Maciej's go: one orchestrated run on one task branch, one PR into `maciej`.
