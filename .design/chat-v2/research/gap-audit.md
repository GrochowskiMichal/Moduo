# Gap audit: what the Chat re-plan doesn't answer yet

> Raw research report from the Chat re-plan, 2026-10-13. Nothing here is decided.
>
> **Read against:** `REPLAN.md` as of commit 9a009126 (group K decided "all ok"; round 5 running), every report in this folder, prototypes `round-3.html` and `round-4.html`, `specs/tasks-v3.md` (the north star), `docs/moduo-module-contract.md`, `docs/PRODUCT_BRIEF.md` §4, §6, §7, §9, `specs/_template.md` (the Definition-of-Ready gate), `specs/universal-inbox.md` (the bell), `specs/attachments.md`, `specs/BUILD_ORDER.md`, the Notes re-plan on `t/maciej/notes-replan`, and spot checks in code. Method copied from [the Tasks gap audit](../../tasks-v3/research/gap-audit.md).
>
> **Method:**
> - each role's normal week against the decided calls: a hackathon team of four over a weekend, duo founders, a developer team of 3–5, a PM, an agency of 2–4 with clients, a solo founder with a contractor;
> - every view (sidebar, channel, direct message, Catch up, a reply chain and "Reply chains", Details, search and ⌘K, new conversation and Browse, channel settings, message actions, the composer, presence and statuses, Home widgets, notifications) in every state (empty, loading, filtered to nothing, offline, viewer, paused plan, archived, deleted, private item, very large, error, first open, someone who left);
> - the shared pieces Chat plugs into (panel registry, capture, References, the notification table, the key map, MCP, search, activity, export, erasure, roles, the spine, Time & region, Focus, reminders);
> - contradictions, and what the spec's Definition-of-Ready would fail on;
> - what a team of four at the hackathon would hit.
>
> **Filter:** an item is here only if it's **not addressed**, **contradictory** (two calls, or a call and a binding Tasks rule, disagree) or **too thin** (a builder would have to stop and ask a product question). Round 5 draws every surface; this file lists the *rules* round 5 can't settle by drawing.
>
> **Who decides:** "Maciej" = a product call, written as a question with options and a recommendation. "Technical" = the agent decides and records the rejected alternative (module-replan rules).

**Severity:**

| Label | Meaning |
| --- | --- |
| **blocks** | A role can't run a normal week without the old tool, or the spec can't pass its Definition-of-Ready |
| **degrades** | They switch, but it hurts |
| **polish** | Noticeable, not costly |

---

## Ranked gaps

Ranked by how much each changes a normal week, then by what the spec can't be written without. G2, G18, G24, G25 and G28 are **blocks** because the Definition-of-Ready fails without them, not because people feel them most.

**Count:** 28 findings. 20 need a call from Maciej (G1, G3, G4, G6, G8–G18, G20–G23, G26); 8 are technical (G2, G5, G7, G19, G24, G25, G27, G28), of which G7 and G19 also carry one small question. Plus 5 smaller gaps and 16 contradictions (C13 carries one question).

### G1 · Catch up and the bell are two inboxes for the same message

**Type:** contradictory · **Severity: degrades** (every role, every day) · **Where:** Catch up, the bell, notifications

**What's missing.** CH6 sends an `@you`, a reply in your chain and an announcement to the bell *and* to Catch up. CH8 makes Catch up "one place for what's addressed to you", and its own reason is that Slack splits this across Activity, Unreads and Later. The bell (DF-21) has its own life cycle: unread → read → dismissed, with Undo. Catch up has Done, Later and "reading it clears it". Nothing says whether clearing one clears the other. Both even have the same empty state: "You're all caught up." (bell) and "You're caught up." (CH8).

**Why it matters.** A PM who clears Catch up in the morning still sees the same five mentions in the bell all day, or the reverse. Two lists to finish is the Slack problem CH8 exists to fix.

**Evidence:** REPLAN CH6 (table, "Bell" column), CH8; `specs/universal-inbox.md:19` (bell life cycle), `:24` (@mentions in the bell).

**Proposed resolution:** one state behind two windows. A chat item in the bell and in Catch up is the same item: reading it, Done, dismissing it or Later in either place clears or hides it in both.

**Who decides:** Maciej. *Should a chat mention live in both the bell and Catch up?*
- (a) **Both, one shared state** (clear it in either, it's gone from both). *Recommended:* the bell is on every screen, Catch up is where you work through it; neither becomes a second to-do list.
- (b) Catch up only; the bell shows one line, "3 waiting in Catch up", that opens it.
- (c) As decided: both, cleared separately.

### G2 · Chat's notification rows aren't written in the app's table

**Type:** too thin · **Severity: blocks** (Definition-of-Ready; TV-D12 builds one generator from one table) · **Where:** the notification table

**What's missing.** §1.4 promises Chat's rows "in the same format (event · who hears · where · when · turned off by)". CH6's table uses other columns (OS · Bell · Chat tab · Catch up), has no "turned off by", and lists six events. Missing rows:
- added to a channel; removed from a channel (v1 removes you silently);
- `@channel` in an ordinary channel; `@Team` in chat (CH7); `@here` (v1 had it; the plan never mentions it);
- a reply to your own message (CH30: "always addressed to you");
- a mention added by an edit (audit D28: "record it in the table");
- a mention by an agent (§6 #12);
- a message marked as a decision, a chain wrapped up or reopened, a message moved (threads research: "no pings");
- the summary when Focus ends ("3 held until Focus ends", CH7);
- a channel archived, renamed or turned into an announcement channel;
- a new custom emoji (presumably nobody);
- an announcement during quiet hours, do not disturb or a vacation status.

The "turned off by" column also needs its switches named: per-conversation level, Settings → Notifications (which toggles?), "Show message text" (CH33), sound (CH34), browser permission, quiet hours.

**Why it matters.** TV-D12 implements "the §13 notification table as one generator with its mute switches". Without Chat's rows in that shape, each row gets decided in code.

**Evidence:** REPLAN §1.4 ("The notification table"), CH6, CH7, CH23a, CH30, CH33, CH34; `specs/tasks-v3.md` §13; audit D28; `research/current-state.md` §7 bug 14.

**Proposed resolution:** the spec carries one table in §13's format with every row above, built from the decided calls. Three rows are product calls; they are G3.

**Who decides:** Technical (the agent writes the table from the decided calls; G3 asks the three open rows). *Rejected:* leaving chat's rules inside CH6's prose.

### G3 · What "Every message", "Nothing" and the away states actually do

**Type:** too thin · **Severity: degrades** · **Where:** levels (CH7), statuses (CH28c, CH28d), quiet hours, Catch up

**What's missing.**
1. **"Every message" never pings.** CH6's table says "any other message" never leaves its conversation, and CH5 gives "Every message" channels a sidebar number. So the level only changes counting. A founder who sets "Sales leads" to Every message expects a notice per burst, as in Slack.
2. **`@you` in a "Nothing" conversation.** CH7: Nothing "never pings or counts". CH8: Catch up lists what CH6 would ping you for. So a direct mention in a conversation you set to Nothing leaves only a bold name behind: no count, no Catch up item. An announcement reaches you there only because CH23a says "only Nothing silences it".
3. **What happens when a hold ends.** Focus: held pings "arrive together" (CH7). Quiet hours, do not disturb by hand, and statuses with do-not-disturb (vacation, out sick): the prototype says "She won't be notified; your message waits in her Catch up". Nothing says whether a summary arrives at 9:00 or when the vacation ends, or whether an announcement breaks through.
4. **"Focusing · until 3:00 PM" has no source.** Tasks' Per-task timer has no end time (only an optional estimate countdown); Timer Off has nothing. So the "until" in CH28b and CH7's "until Focus ends" can't always be known.

**Why it matters.** These are the rules people feel every day. The quiet bar (brief §7) is decided; how it behaves at the edges isn't.

**Evidence:** REPLAN CH5, CH6, CH7, CH8, CH23a, CH28b, CH28c, CH28d; `specs/tasks-v3.md:85` (timer modes); round-4 prototype, Jana's direct message.

**Who decides:** Maciej.
- *Does "Every message" ping?* (a) **Yes, one notice per burst, like a direct message, only when Moduo isn't in front of you** *(recommended: you chose it for that channel)*; (b) no, it only counts (then rename it "Count every message").
- *Does an `@you` in a "Nothing" conversation reach Catch up?* (a) **Yes, silently: it never pings or counts, but waits in Catch up** *(recommended)*; (b) no, Nothing means nothing.
- *When quiet hours, do not disturb or a vacation end, what arrives?* (a) **Nothing pings; everything waits in Catch up and the Chat count** *(recommended: a 9:00 burst is an alarm clock)*; (b) one summary notice, like Focus. And *do announcements break through do not disturb?* **No** *(recommended, matching CH7's "nothing breaks through Focus")*.
- *What does "until" show when a Focus session has no end time?* **Just "Focusing"** *(recommended)*; the time appears only with a Pomodoro phase or an estimate.

### G4 · Nothing reaches you once Moduo is closed

**Type:** not addressed · **Severity: blocks** (duo founders away from the desk; the hackathon at meals and asleep) · **Where:** notifications, the phone gap

**What's missing.** CH6 delivers through the running desktop app (in the menu bar) or a browser that allowed notifications. Close both and a direct message waits until you next open Moduo. §3 names "no phone" as the risk no Chat call closes, and offers CH6 and CH23 as the mitigation, but neither reaches a closed laptop or a phone. Tasks rejected email for reminders (73), but a message from a person isn't a reminder you set yourself. The hackathon research found email is the fallback organizers already use. Moduo already has a transactional email outbox (TX-3).

**Why it matters.** Duos do most quick pings away from the desk; a hackathon team eats, sleeps and walks the venue on phones. Email is the one channel that reaches every phone today, with no mobile plan.

**Evidence:** REPLAN §3 ("The risk no Chat call closes"), CH6; `specs/tasks-v3.md:49`, `:435` (no email reminders); `research/hackathon.md` §1.4 (ETHGlobal's email fallback), §2.1 item 9; `specs/transactional-email.md`.

**Proposed resolution:** an email for unread direct messages and `@you` only, sent when nothing of yours has been open for a while, one email per conversation at most once an hour, with the message text following CH33's switch; a switch in Settings → Notifications.

**Who decides:** Maciej. *Should unread direct messages and mentions reach you by email when Moduo is closed?*
- (a) **Yes, on by default, after 1 hour unread with no Moduo open, at most one email per conversation per hour** *(recommended: the only phone channel until mobile)*;
- (b) yes, off by default;
- (c) no email (as Tasks 73).

### G5 · Chat's requirements haven't reached the Tasks blocks being built now

**Type:** not addressed · **Severity: blocks** (rework, or a cut that can't ship pings) · **Where:** TV-D12, TV-U13, TV-F6, TV-D14, TX-9b

**What's missing.** §7 lists what Chat waits on, and §9 step 4 plans to send proposals later. But the Tasks v3 build is running, and these blocks are "ready, not built":
- **TV-D12** builds push "on pg_cron" (tasks-v3 #16). Chat needs seconds, not a cron minute; only one device ringing; the server knowing Focus and quiet hours; a click landing on the message (blueprint §8, seven requirements). §9 step 4 only lists "chat's rows in the notification table".
- **TV-U13** builds "six fixed reactions" on comments (CH16a changes this; see G11).
- **TV-F6** builds the run record; Chat's "Focusing" needs teammates (or the server) to read it (see G10).
- **TV-D14** builds Time & region; quiet hours have no named owner or storage.
- **`plan_grants`** (comp grants, TX-9b) is what CH25's dated entitlement needs, and it isn't in §7 at all.

**Why it matters.** If TV-D12 ships cron-only push, CH6's direct messages arrive up to a minute late and every block after it reworks the sender. If TV-U13 ships six fixed, CH16a reworks it.

**Evidence:** REPLAN §6 #6, §7, §9 step 4; `research/tech-blueprint.md` §8 (points 1–7); `specs/tasks-v3.md:368`; `specs/BUILD_ORDER.md:157`, `:163`, `:168`, `:170`; `research/hackathon.md` §2.0 (`plan_grants` with TX-9b).

**Proposed resolution:** add a short "From the Chat re-plan" note to each of those block rows in BUILD_ORDER's 🟠 box now (requirements only, no design), and add TX-9b to §7's table.

**Who decides:** Technical (the agent hands the requirements over before those blocks start). *Rejected:* waiting for the Chat spec, which lands after some of them are built.

### G6 · Hackathon: "Team plans handed out" and "a chat entitlement" aren't the same grant

**Type:** contradictory · **Severity: blocks** (hackathon) · **Where:** CH22, CH25, CH4a, CH17

**What's missing.** CH22 says "team plans handed out to teams". CH25, decided as the way to do it, is "a dated chat entitlement per workspace". A chat-only entitlement leaves everything else on the owner's plan:
- **Seats.** A Free owner's workspace holds one seat; a team of four can't join it.
- **Files.** Limits follow the owner's plan, pooled per owner: Free is 20 MB per file and 2 GB in total. CH17's "50 MB per file today" is the platform ceiling, not what a Free-owned team gets. Demo videos are usually bigger.
- **The end.** CH4a covers chat pausing. Nothing says what happens to three members over a one-seat cap, or to files over the quota, when the grant ends.
- **The source.** `plan_grants` doesn't exist yet (TX-9b), and `planHasChat` reads only the owner's plan.

The hackathon plan owns grants, but its branch has no spec yet, so Chat's needs have nowhere to land.

**Why it matters.** It decides whether a team of four can even be in one workspace on day one.

**Evidence:** REPLAN CH17, CH22, CH25, CH4a; `specs/attachments.md:43–50`, `:167`; `supabase/functions/_shared/contracts/vocabularies.ts:852–854`; `research/hackathon.md` §2.0, §2.3.

**Proposed resolution:** the grant is a dated **Team-level plan on the workspace** (seats, chat, Team's file limits), not a chat switch; at its end the workspace keeps every member and file read-only for chat (CH4a), can't invite, and the owner sees "Keep going on Duo or Team". Recorded as a need for `specs/hackathon.md`.

**Who decides:** Maciej, with the hackathon plan. *What does a handed-out hackathon grant include?* (a) **A dated Team plan on the workspace: seats, chat, Team's file limits** *(recommended)*; (b) chat only, with seats granted some other way; (c) organizers own every workspace on a comped plan (hackathon.md §2.3 option 1).

### G7 · The hackathon cut lists what's new, not what has to exist, and rests on unbuilt blocks

**Type:** too thin · **Severity: blocks** (hackathon; the date is unknown) · **Where:** CH26a, §7

**What's missing.**
- **The basics aren't in the cut.** CH26a lists seven new things. But §8 says v1's screens "go entirely". A team still needs, in the new screens: channels and Browse, direct messages, edit and delete with Undo, pins, unread and the "New" line, levels, announcement channels, search inside a conversation, Mark unread, General, and the store block that fixes trust bugs 1–5 (failed sends that look sent, everything marked read, missing messages).
- **Its top items wait on other work.** Item 2 (pings that leave the app) waits on TV-D12; item 4 (files) on AT-2; the grant on TX-9b (G6). None has a fallback if the date comes first.
- **Moderation dropped silently.** The first cut (CH26) had "remove a message or a person; pinned code of conduct". CH26a doesn't. With one workspace per team that's mostly fine, but an admin deleting someone else's message (audit D7) isn't in §6 #10 either.
- **Template content.** The hackathon template copies notes and tasks into each team workspace. Nothing says what chat content it copies (channels, a pinned welcome, the rules note as a card in General).
- **Supabase limits beyond Realtime.** CH31 covers connections; the Free plan's storage and bandwidth allowances (images and files from 20–25 teams) aren't in spike 3's report.

**Why it matters.** If the date lands early, the team gets either v1's screens with the old `#` grammar and the trust bugs, or a new look that can't edit, pin or browse.

**Evidence:** REPLAN CH26, CH26a, CH31, §6 #10, §7, §8 ("the screens go entirely"); `research/current-state.md` §7; `research/tech-blueprint.md` Appendix D (store block first).

**Proposed resolution:** the spec's hackathon line includes, in order: the store block, the stream and composer with v1's basics, chat in granted workspaces, files, pings, links and make-a-task, Catch up, replies. Spike 3 also reports storage and bandwidth. The template's chat content is recorded as a need for the hackathon plan.

**Who decides:** Technical (block order and the basics). One question for Maciej: *if the date comes before server push (TV-D12) or files (AT-2) are ready, what do teams get?* (a) **A stop-gap: notices from the open desktop app or browser tab only (no server push), and files as task attachments or links** *(recommended)*; (b) hold the event's chat back and keep v1's screens; (c) ship without pings and files.

### G8 · Event news has no route into the team workspaces

**Type:** contradictory · **Severity: degrades** (hackathon) · **Where:** CH22, CH23a, CH24, §3

**What's missing.** CH22 decided no event workspace; CH24 parked the help desk; CH23a dropped scheduled posts and "Seen by". Yet §3 still says what closes the hackathon team's gap is "event news reaching them (CH22)". No call says how "Submissions close in 1 hour" reaches 20–25 team workspaces: organizers aren't members, there's no cross-workspace channel, and the bell is per workspace.

**Why it matters.** The countdown and schedule changes are the event's must-land messages (role journeys §1.1, hackathon research §1.6).

**Evidence:** REPLAN §3 (hackathon team row), CH22, CH23a, CH24; `research/hackathon.md` §1.6, §2.1 item 1; `research/role-journeys.md` §1.2.

**Who decides:** Maciej, with the hackathon plan. *How does event news reach the teams?* (a) **Outside Moduo for the first event (organizers' email, venue screens), stated in the hackathon plan; Chat builds nothing** *(recommended: matches CH22)*; (b) one organizer seat in every team workspace and a template "Event" announcement channel, posted N times or by the organizer's agent through MCP; (c) later, a channel followed into every workspace.

### G9 · Nobody is asked to allow browser notifications

**Type:** not addressed · **Severity: degrades** (every web user; most of the hackathon) · **Where:** notifications, first open

**What's missing.** CH6 makes browser notifications opt-in. Tasks says the same for reminders (73) without saying where the browser's permission is asked; for reminders you set yourself, Settings is a natural place. For chat, people who never visit Settings never get a direct message outside the tab. Nothing says when or where the browser's permission is asked, what the composer or Catch up shows when it was refused, or how to fix it afterwards.

**Why it matters.** Hackathon participants will mostly use the web app; a duo partner on the web would miss every direct message.

**Evidence:** REPLAN CH6, CH37; `specs/tasks-v3.md:250` ("Not allowed by the browser").

**Who decides:** Maciej. *When does the web app ask for notification permission?* (a) **Once, in context: the first time you open Chat in a browser, one quiet line "Get a notice when someone messages you · Allow · Not now"; refused shows "Notifications are off in this browser" in Catch up's empty state** *(recommended)*; (b) only in Settings → Notifications; (c) the first time a direct message arrives while you're elsewhere.

### G10 · "Focusing on <task>" and "Away since" show more than Tasks allows

**Type:** contradictory · **Severity: degrades** · **Where:** presence (CH9, CH28a–c), the person card, "Team now" (CH35)

**What's missing.** Tasks v3 keeps work sessions private: the team-load widget shows "nothing about runs or time per person", agent sessions are private by default, and a reference you can't see is "Private item" with no title. Chat now shows every teammate "Focusing on Draft homepage copy · until 3:00 PM" in direct-message rows, the person card, Details and a Home widget. The task may sit in a private project or someone's Inbox. The round-4 prototype also shows "Away since 1:10 PM", which tells teammates exactly when you stopped working: the reply pressure Maciej worried about in CH28a ("might enable surveillance"). CH9's "Show me as online" switch predates the new states, so it doesn't say what it hides.

**Why it matters.** It breaks a Tasks rule without saying so, and it's the one presence detail people can't opt out of.

**Evidence:** REPLAN CH9, CH28a, CH28b, CH35; `specs/tasks-v3.md:91`, `:118`, `:165`; `prototypes/round-4.html:1503`.

**Proposed resolution:** "Focusing" (and "until" where known, G3) is visible to all; the task's title shows only to people who can see that task and only if you turned on "Show what I'm focusing on" (off by default, like "Show my agent work to teammates"). "Away" never carries a time. "Show me as online" off = you read as offline to everyone; a saved status still shows.

**Who decides:** Maciej. *How much of your Focus do teammates see?* (a) **"Focusing" for everyone; the task's title only if you switch it on and they can see the task** *(recommended)*; (b) the title for anyone who can see the task, on by default; (c) as prototyped. And *"Away" with or without "since 1:10 PM"?* **Without** *(recommended)*.

### G11 · Reactions on comments: three calls and two plans disagree

**Type:** contradictory · **Severity: degrades** (and rework if TV-U13 ships first) · **Where:** CH16, CH16a, CH16b; Tasks 88 (TV-U13); the Notes re-plan

**What's missing.**
- CH16: "Comments keep only the six (88 unchanged)."
- CH16a (decided, "comments following"): one reaction component app-wide, so "the same personal row appears on task and note comments".
- CH16b: custom emoji are used "in messages, reactions and comments".
- Tasks' TV-U13 (not built) and the Notes re-plan both still say "six fixed reactions".
- CH1's bar still says "no custom emoji".

So nobody knows whether a task comment gets your quick row only, or the full picker and custom emoji too. §9 step 4's list of cross-module proposals doesn't include CH16a.

**Why it matters.** A reaction looks different on a task comment and in chat, and two Tasks blocks may build the wrong one.

**Evidence:** REPLAN CH1, CH16, CH16a, CH16b, §9 step 4; `specs/tasks-v3.md:103`; `specs/BUILD_ORDER.md:157`; `.design/notes-v2/REPLAN.md:57` on `t/maciej/notes-replan`.

**Proposed resolution:** one reaction component everywhere, with the same contents; add CH16a to §9 step 4 and to TV-U13's row now (G5).

**Who decides:** Maciej. *What can people react with on a task or note comment?* (a) **The same as chat: your quick row, any emoji and the workspace's custom emoji** *(recommended: one component, and CH16b already says comments)*; (b) your quick row only, no picker; (c) the six fixed, as Tasks 88 (reverses CH16a).

### G12 · Announcement channels and replies in the stream don't fit together

**Type:** contradictory · **Severity: degrades** (founders' updates, agencies' client notices) · **Where:** CH23a, CH30d

**What's missing.** CH23a: in an announcement channel only managers post, everyone else reads and reacts. CH30d: a Reply is an ordinary message at the bottom of the stream. So either members can't reply to an announcement at all, or their replies land in the stream the switch was meant to keep for managers. In v1, threads gave members a place to ask "does this include contractors?". Nothing says which.

**Why it matters.** Announcement channels are where a founder's update or an agency's client notice lands; people need to ask about it without breaking the channel.

**Evidence:** REPLAN CH23a, CH30d; `research/hackathon.md` §1.4 (Slack: announcement channels read-only, replies only in threads).

**Who decides:** Maciej. *Can members reply to a post in an announcement channel?* (a) **No; they react, or "Reply privately" opens a direct message to the author with the post quoted** *(recommended: keeps one reply rule)*; (b) yes, but replies stay in the chain on the right and never enter the stream (an exception to CH30d); (c) yes, in the stream.

### G13 · "Later" and `/remind` only cover what's addressed to you

**Type:** too thin · **Severity: degrades** (PM: must; duo and dev: should) · **Where:** Catch up (CH8), the composer (CH14), message actions

**What's missing.** Later (`H`) exists only inside Catch up, so only on items addressed to you. A PM's "ping me Thursday about this" or a founder's "remind me about this tonight" is usually about a message that wasn't. `/remind` is listed as "CH8's Later, for the conversation", which could mean "remind me about this conversation" or "send this to the channel at 5". Also undefined: whether a Later that comes back notifies (a Tasks reminder row: one precise notice, any workspace), and where you see what you've put off (Tasks' Inbox snooze has no list either).

**Why it matters.** Follow-ups on messages are a PM's daily habit; without them, Slack's "Later" keeps Slack open.

**Evidence:** REPLAN CH8, CH14; `research/role-journeys.md` §2.1 rows 5–6, §1.5; audit D23 ("save for later = a reminder"); `specs/BUILD_ORDER.md:129` (capture writes `/remind` as a personal reminder).

**Proposed resolution:** "Remind me…" (`H`) on any message, from hover ⋯ and in Catch up; at its time the message returns to the top of your Catch up with one precise notice (the Tasks reminder row). `/remind` in the composer means a reminder for you about this conversation, never a message sent later. Catch up ends with a quiet "Later · 3" line.

**Who decides:** Maciej. *Can you set "Remind me" on any message, or only on what's in Catch up?* (a) **Any message; it comes back into your Catch up with one notice** *(recommended)*; (b) Catch up only (make a task for the rest).

### G14 · Linked channels: who links, what gets created, and what happens later

**Type:** too thin · **Severity: degrades** (PM, agency) · **Where:** CH2, CH11, channel settings, a project's ⋯, a client's hub

**What's missing.**
- **Who may link or unlink** a channel (anyone in it? managers?).
- **What "Start a conversation for Acme rebrand" creates:** public or private, with whom, under what name (CH3a names are unique, so "Acme rebrand" may already be taken). For a private project, a public channel would show the project's name to the whole workspace, and an agency's contractor would see every client's channel.
- **Linking to a team** (CH2 allows it): does it mean the team's members are in the channel, kept in sync, or just a label?
- **When the linked item changes:** project archived, marked Done, deleted, or a contact deleted. Does "Conversation: Acme" stay on the item? Does the channel say "Linked to a deleted project"?
- **Who sees the lines on the item:** CH11 says "Mentioned in" shows only to people who can read the conversation. The same rule isn't stated for "Conversation: Acme · 3 new" or for decisions shown on a project overview (CH13), where a private channel may be linked to a project the whole workspace sees.
- **Capture's default destination** (CH10: the linked project) when you can't edit that project.

**Why it matters.** Linking is the one thing Slack can't copy (CH1); unclear rules make it leak or go stale.

**Evidence:** REPLAN CH2, CH3a, CH10, CH11, CH13; `research/role-journeys.md` §1.6 (contractors).

**Proposed resolution:** any member of the channel links or unlinks, named in the trail. "Start a conversation for X" makes a channel named after X, private with X's people when X is private, public otherwise. A team link is a label plus a one-time "Add the team's 4 people?" offer, never a sync. Every line on an item (the conversation, its decisions, "Mentioned in") shows only to people who can read the channel. Archiving or deleting the item leaves the channel and turns its header chip into the tombstone. Capture falls back to your Inbox.

**Who decides:** Maciej, two questions. *What does "Start a conversation for X" create?* (a) **Private with X's people when X is private; public otherwise** *(recommended)*; (b) always public; (c) always ask. *Does linking a team add its members?* (a) **A one-time offer, never a sync** *(recommended)*; (b) kept in sync; (c) a label only. The rest is technical.

### G15 · Decisions don't reach the item from a direct message, and overlap with Wrap up

**Type:** not addressed + contradictory · **Severity: degrades** (duo founders, PMs, agencies) · **Where:** CH13, CH30d, CH11

**What's missing.**
- **Duos decide in direct messages.** CH13 shows a decision on a project or client only "in a linked channel"; direct messages can't be linked (CH2 links channels). The duo's one great moment in the role research ("open Anna and see the three messages where the two of you decided what to tell her") isn't delivered: Anna's hub gets only "Mentioned in a direct message · Oct 12".
- **Two ways to record an outcome.** Wrap up shows "the answer that settled it"; Mark as decision records a decision. A wrapped-up chain's answer is often the decision. One way per job (Tasks 90b) isn't settled.
- **Who may mark and unmark** a decision isn't stated. A decision shows on a client's hub, so a joke marked as a decision lands there.
- **Who picks the settling answer** when wrapping up (the prototype shows Jana's reply; nothing says it was chosen).

**Why it matters.** "Slack buries decisions" is the founders' and PMs' top complaint; this is where Moduo answers it.

**Evidence:** REPLAN CH2, CH11, CH13, CH30d; `research/role-journeys.md` §1.3 ("One great moment").

**Proposed resolution:** a decision also shows on every item it references ("Decided in a direct message with Mike · Oct 12: …"), visible only to people who can read that conversation. Wrap up asks "Which reply settled it?" (last reply preselected) and offers "Also mark as decision" (ticked when the channel is linked). Anyone in the conversation marks or unmarks a decision, named in the trail, with Undo.

**Who decides:** Maciej. *Should a decision show on the items it mentions, even from a direct message?* (a) **Yes, to the people who can read that conversation** *(recommended)*; (b) only from linked channels, as decided. *Is a wrap-up's answer a decision?* (a) **Wrap up offers "Also mark as decision"** *(recommended)*; (b) always; (c) never, two separate things.

### G16 · Reply chains: the edges of Wrap up

**Type:** too thin · **Severity: degrades** · **Where:** CH30d, the stream, Catch up, "Reply chains"

**What's missing.**
- **A reply to a wrapped-up chain** (someone quotes a reply still visible elsewhere, or answers in the panel): does it reopen the chain, appear in the stream, ping the chain's people?
- **Unread replies that Wrap up hides.** If you hadn't read them, do they stay in Catch up, count as unread, or vanish with the fold?
- **Reopen:** do the replies come back into the stream at their own times?
- **Direct messages:** chains exist there too, and there are no managers; who wraps up?
- **v1 threads.** v1 keeps thread replies out of the stream and out of unread counts. CH30d's replies are ordinary messages. The plan converts v1 bodies but not v1 threads.
- **Stale text:** §6 #8 still says "thread", §6 #22 and the blueprint's spike 1 still test "folds"; CH6 still says "a thread you're in".

**Why it matters.** Wrap up is new, and a chain that hides unread replies or ignores late answers loses messages.

**Evidence:** REPLAN CH6, CH30, CH30d, §6 #8, §6 #22; `research/tech-blueprint.md` Appendix C (spike 1); `research/current-state.md` §4 (thread replies never count).

**Proposed resolution:** a new reply reopens the chain ("Reopened by Mike"), posts in the stream and reaches the chain's people as usual. Wrap up never clears anyone's unread: hidden replies you haven't read stay in Catch up as one chain item. Reopen restores replies in place. In a direct message, either person wraps up. v1 thread replies become chain replies at their own times, read for everyone who had read the parent.

**Who decides:** Maciej for one question: *does a new reply reopen a wrapped-up chain?* (a) **Yes, visibly** *(recommended)*; (b) no, it starts a new chain quoting the old one. The rest is technical (rejected: dropping v1 thread replies from the stream).

### G17 · Moving messages between conversations with different people

**Type:** not addressed · **Severity: degrades** · **Where:** tidy up (CH30, CH30c), "Move to a conversation"

**What's missing.** CH30c decided *who* may move messages. Nothing says *where to*. Moving from a private channel into a public one, or from a channel into a direct message, shows those words to people who weren't in the room. The threads research flagged it ("needs a clear privacy rule; round 2"), and it was never asked. Also open: what moves along (reactions, replies, files, the "Mentioned in" lines) and whether a mention in a moved message counts again in its new home.

**Why it matters.** Tidying up is the fix Maciej liked most (CH30); without an audience rule it can expose a private conversation.

**Evidence:** REPLAN CH30, CH30c; `research/threads.md` §4.4, §4.8 risk 4.

**Proposed resolution:** moving into a conversation whose people could all already read the source is one step with Undo. Moving to a wider or different audience is allowed only for your own messages and asks first: "2 people in Launch who aren't in Founders will see this. Move?" Replies, reactions and files move with the message; nothing pings again.

**Who decides:** Maciej. *Can messages move to a conversation with different people?* (a) **Freely when the new place's people could already read them; only your own, after a warning, otherwise** *(recommended)*; (b) only within the same audience; (c) anywhere, visibly, with Undo.

### G18 · Who may do what: no permissions table, and three audit calls never asked

**Type:** too thin · **Severity: blocks** (Definition-of-Ready; PERM-7's grid needs its rows) · **Where:** channel settings, message actions, Settings → Members and access

**What's missing.** §6 #11 makes PERM-7 honest, and CH30c and CH30d set who moves and who wraps up. The rest has no rule:
- **Never asked** (the decisions audit marked them as Maciej's): who adds people to a *private* channel (audit D4: managers or anyone inside); whether a channel can go from public to private later (D5); whether ⌘J survives next to ⌘K (D21, see G19).
- **Admins deleting others' messages** (D7): show it in the menu or drop the capability.
- **Unstated:** pin and unpin for everyone; mark a decision (G15); link a channel (G14); rename, topic, archive, unarchive; leave General; add custom emoji (CH16b: "any member unless a role switch restricts it"); `@channel` outside announcement channels; what a channel's last manager leaving does.

**Why it matters.** Every channel screen and the role editor need these rules; today they'd be decided in code.

**Evidence:** REPLAN §6 #10, §6 #11, CH7, CH16b, CH30c, CH30d; `research/early-decisions-audit.md` D4, D5, D7, D21, D36.

**Proposed resolution:** one table in the spec (action × owner/admin · channel manager · author · member · viewer), with the PERM-7 role switches it adds named.

**Who decides:** Maciej for two rows. *Who adds people to a private channel?* (a) **Its managers** *(recommended, audit D4)*; (b) anyone in it. *Can a public channel become private later?* (a) **Yes, by its managers, public → private only** *(recommended: the safe direction)*; (b) never (v1). The rest is technical.

### G19 · The keyboard: no way to reach a message, and `D` means two things

**Type:** too thin + contradictory · **Severity: degrades** (developers) · **Where:** the key map (§6 #14), messages, multi-select

**What's missing.**
- **Focus model.** §6 #14 binds `T` "on a selected message", CH13 binds `D`, Catch up binds `R Space T H`. Nothing says how a message gets selected by keyboard, or what happens when you type while the composer isn't focused (Slack and Discord send every keystroke to the composer). The Tasks key map's rule 6 ("editable fields swallow single letters") means none of these keys work while the composer has focus, which is almost always.
- **`D` for decision** (CH13) isn't in §6 #14. In Tasks, `d` sets due on rows, `D` is Date in multi-select, `D` opens the date picker on the Timeline.
- **Message keys missing:** reply, react, edit, pin, delete, copy link, mark unread, Wrap up, open the chain.
- **Multi-select** for tidy-up ("with several selected", CH30) needs its bottom-bar mode row and keys (Tasks 82b pattern).
- **⌘J** (audit D21) was never decided; Esc's order in Chat (composer edit → reply quote → chain panel → Catch up mode) isn't written.

**Why it matters.** Developers live on the keyboard, and a key that works in Tasks but not in Chat breaks one interaction language (39).

**Evidence:** REPLAN §6 #14, CH8, CH13, CH30; `.design/tasks-v3/research/keymap.md:29`, `:49`, `:77`, `:142`, `:144`.

**Proposed resolution:** typing anywhere in a conversation goes to the composer; ↑ in an empty composer edits your last message (v1); Esc in an empty composer (after any edit or reply quote is cancelled) moves focus to the newest message, ↑↓ step through messages, and there single letters act (`R` reply, `E` edit, `P` pin, `T` task, `⇧D` decision, `H` remind, `⌫` delete); typing a letter that isn't bound, or ⏎ on nothing, returns to the composer. ⌥↑↓ stays "previous/next conversation" (§6 #14). `D` alone stays unbound in chat.

**Who decides:** Technical (the key table, listed against Tasks' map). One question for Maciej: *does ⌘J stay as a conversation switcher?* (a) **No; conversations join ⌘K** *(recommended, audit D21)*; (b) yes, as ⌘K filtered to conversations.

### G20 · Several workspaces

**Type:** too thin · **Severity: degrades** (anyone in a personal and a company workspace, contractors, hackathon participants who also have their own) · **Where:** CH6, the Chat tab, the dock badge, the workspace switcher, statuses

**What's missing.** CH6 delivers pings "in any workspace, with the workspace's name". But:
- the bell is current-workspace only (DF-21), and Catch up lives in one workspace's left panel;
- the blueprint's dock badge counts across workspaces, while the Chat tab presumably counts the open one; the switcher shows nothing;
- clicking a notice from another workspace switches workspace; nothing says what happens to a running Focus session, an open capture or a draft;
- CH6 says "only when Moduo isn't in front of you or you're in another module"; being in another *workspace* isn't covered;
- quiet hours, do not disturb and saved statuses (CH28c, CH28d): per person across every workspace, or per workspace?
- no way to silence one workspace (a client's) without muting each conversation.

**Why it matters.** Contractors, founders and hackathon participants all sit in more than one workspace; pings are where it shows first.

**Evidence:** REPLAN CH6, CH7, CH28c, CH28d; `specs/universal-inbox.md:31`; `research/tech-blueprint.md` §8 (badges).

**Proposed resolution:** statuses, quiet hours and do not disturb belong to the person and apply everywhere. The switcher shows a count per workspace for what's addressed to you there; the dock badge is the sum; the Chat tab counts the open workspace. A notice from another workspace counts as "not in front of you". Clicking one switches workspace and keeps Focus running. The switcher's ⋯ offers "Pause notifications from this workspace".

**Who decides:** Maciej for two questions. *Is a status (vacation, do not disturb) one for all your workspaces?* (a) **Yes** *(recommended)*; (b) per workspace. *Can you pause one workspace's notifications?* (a) **Yes, from the switcher** *(recommended)*; (b) no, mute conversations one by one. The rest is technical.

### G21 · Offline: do messages wait and send themselves, or fail?

**Type:** contradictory · **Severity: degrades** (trains, planes, venue wifi) · **Where:** the composer, the stream, the state rules

**What's missing.** §1.4 says offline is "read-only from the device copy (plus queued sends, if decided)". §6 #2 then builds "an outbox for sends and uploads", and §6 #17 shows a failed send as "Not sent · Retry". These are two different behaviours: a queued message sends itself when you're back (possibly an hour later, out of context), while a failed one waits for you to press Retry. Reactions, edits, deletes, pins and Done in Catch up while offline aren't covered either.

**Why it matters.** A "yes" sent an hour late can mean the wrong thing; a message that silently fails is v1's worst trust bug.

**Evidence:** REPLAN §1.4 (the state rules row), §6 #2, §6 #17; `specs/tasks-v3.md:99` (Tasks: captures queue, other edits say "Offline").

**Who decides:** Maciej. *What happens when you press ⏎ offline?* (a) **The message waits in the conversation as "Waiting to send" and sends itself in order when you're back; Retry appears only if the server refuses it** *(recommended: matches Tasks' queued captures)*; (b) it fails at once with Retry; (c) the composer is disabled offline. Reactions, edits and deletes offline say "Offline" (technical, as Tasks).

### G22 · The Message capture (⌘7) is one line

**Type:** too thin · **Severity: polish** (becomes degrades once people use it) · **Where:** the capture shell, Tasks 90b

**What's missing.** §6 #8: "a Message capture type for ⌘7 (its destination is a conversation picker; ⏎ sends)". Open: the default destination (the last conversation? none?); picking a person you've never messaged (does it start a direct message?); what the "From:" chip becomes in a message (a reference card under it?); several lines and files in the capture; offline (queued like a task capture?); and a way back from a message sent to the wrong place from a modal.

**Why it matters.** ⌘7 is the fastest way to message someone from anywhere; a wrong destination with no way back is worse than no shortcut.

**Evidence:** REPLAN §6 #8, §1.4 ("One capture"); `src/lib/capture-registry.ts:6`, `:24`; `specs/tasks-v3.md:110–114`.

**Proposed resolution:** no default destination: the picker opens focused, recent conversations and people first; a person starts a direct message; the "From:" item becomes a reference card in the message; ⏎ sends and shows "Sent to Acme · Open · Undo" (Undo deletes it within 8 s).

**Who decides:** Maciej for the default. *Where does a ⌘7 message go if you don't pick?* (a) **Nowhere: you must pick, recent first** *(recommended)*; (b) the last conversation you were in. The rest is technical.

### G23 · A task handle typed in a message (`MOD-142`)

**Type:** not addressed · **Severity: degrades** (developers) · **Where:** the composer, References, the grammar

**What's missing.** The developer team's one great moment in the role research is "`MOD-142` in a message is a live chip". CH14 covers `@`, `#`, `/` and `:`; CH29g keeps "typing an item's exact name offers a link" for later and off. Handles aren't names: they're unambiguous. RF-1 left "a typed handle auto-linking in text" as an open item.

**Why it matters.** Developers name work by its handle all day; a live status in the message is what stops "is this done?" questions.

**Evidence:** REPLAN CH14, CH29g; `research/role-journeys.md` §1.4 ("One great moment"); `specs/BUILD_ORDER.md:158`.

**Who decides:** Maciej. *Does a typed task handle become a live chip?* (a) **Yes, as you type, like a date chip; Esc or ⌘Z keeps the text** *(recommended)*; (b) only through `@`.

### G24 · Which panel views Chat registers, and what Catch up opens on the right

**Type:** too thin · **Severity: blocks** (Definition-of-Ready: §1.4 binds the registry) · **Where:** the right panel, `src/lib/panel-registry.ts`

**What's missing.** `PanelModule` has no `"chat"` yet (`src/lib/panel-registry.ts:34`). §6 #8 lists "Details; items: thread, person", written before CH30d: "thread" is now a reply chain, and CH30d adds a **Reply chains** view that §6 #8 doesn't have. Also open: whether Files, Pinned, Decisions and "Linked" are sections of Details or views of their own; which views are *about this* and which *alongside*; the ⌥ numbers; what the panel shows with no conversation open; and what Catch up's "the selected item opens in context on the right" opens (a message with the lines around it is neither a view nor one of the listed items).

**Why it matters.** Chat can't adopt the shared panel (SH-1) until its views are listed; Catch up's right-hand side depends on it.

**Evidence:** REPLAN §1.4 ("The right panel"), §6 #8, CH8, CH30d; `src/lib/panel-registry.ts:34`, `:37`; audit D20.

**Proposed resolution:** views: Details (*about this*), Reply chains (*about this*), Files (*about this*); items: a reply chain, a person, a message in context (the message with ten lines either side and "Open in conversation"), any reference. Pinned and decisions stay sections of Details.

**Who decides:** Technical (the mechanism and the list, within 72a's "about 6 views"). *Rejected:* a Catch-up-only panel mode.

### G25 · MCP tools for chat v2 aren't listed, and agent posts as their creator have side effects

**Type:** too thin · **Severity: blocks** (Definition-of-Ready: "MCP tools are listed") · **Where:** MCP, CH18, §6 #12

**What's missing.**
- v1 has four tools: list channels, read, search, post (`supabase/functions/moduo-mcp/modules/chat.ts:111`, `:132`, `:166`, `:208`). The plan names none for v2. Candidates the calls imply: reply in a chain, react, list what's addressed to me (without direct messages, which keys never see), mark a decision, wrap up, create a channel, open a conversation's linked item.
- How CH18's per-key "Include private channels I'm in" sits in KEYS-1's None · View · Edit grid.
- A rate limit on agent posts, and whether a key may use `@channel` or post in an announcement channel (only if its person may, by "a key never gets more than its creator").
- **Agent posts are authored by the key's creator** (§6 #12). So your own agent's posts never look new to you (they're "yours"), and every reply to them is "a reply to your own message", which CH30 says always reaches you: a CI or stand-up agent would ping its owner on every reply.

**Why it matters.** The module isn't done without its MCP tools, and the authorship rule would make agents noisy for their owners.

**Evidence:** REPLAN CH18, CH30, §6 #12; `docs/moduo-module-contract.md` (registration); `specs/_template.md` (DoR: "MCP tools are listed"); `specs/tasks-v3.md:122` (agent notices go to the starter, by key).

**Proposed resolution:** list the v2 tools with scopes in the spec. Posts made through a key count as new for their creator; replies to them reach the creator only through that key's notification switch (Tasks' "That key's notifications"), unless the creator is mentioned.

**Who decides:** Technical. *Rejected:* treating a key's posts as the person's own for unread and replies.

### G26 · States without a rule

**Type:** too thin · **Severity: degrades** · **Where:** every view

**What's missing** (behaviour, not drawing; round 5 draws them):
- **Viewer** (never posts, audit D3): can they react, be messaged, start a direct message, use Catch up's `R`? v1 refuses a viewer opening a direct message.
- **Removed from a channel:** v1 says nothing (trust bug 14). Do you see a quiet line, and does the channel disappear or stay readable up to that point?
- **Archived channel:** who may archive (managers?); what happens to its Catch up items, its "Conversation:" line on a linked item, and search results (found, labelled?).
- **Deleting a channel:** v1 has none. Is "Archive" the only way, even for a channel made by mistake or holding something that must go?
- **A direct message with someone who left** (CH36): the composer is replaced by what?
- **Paused plan** (CH4a): do Catch up, notices for old mentions, search, the MCP tools, the ⌘7 capture type and the Home widgets keep working?
- **Leaving:** a private channel you leave can't be rejoined without being added; a channel's last manager leaving.
- **Very large Catch up** (a week away, 300 items): no "Done all in this conversation".

**Why it matters.** These are the states people hit in their first weeks; each needs one answer before it's built.

**Evidence:** REPLAN CH4a, CH8, CH36, §1.4 (state rules), §6 #9; `research/current-state.md` §6, §7 bug 14; audit D3.

**Proposed resolution:** viewers react and receive direct messages but don't start or post; removal leaves one quiet line in Catch up ("Sofia removed you from Launch"), no ping, and the channel leaves your sidebar; managers archive; archived channels stay searchable, labelled, and their Catch up items clear; delete exists only for a channel's managers and admins, into Recently deleted for 30 days; a former member's direct message reads "Jana left the workspace" in the composer's place; a paused workspace keeps reading, search, widgets and read-only MCP; Catch up's ⋯ offers "Done all in this conversation" with Undo.

**Who decides:** Maciej for three. *Can viewers react?* (a) **Yes** *(recommended)*; (b) no. *Does someone removed from a channel get told?* (a) **A quiet line in Catch up, no ping** *(recommended)*; (b) nothing. *Can a channel be deleted?* (a) **By managers and admins, into Recently deleted for 30 days** *(recommended)*; (b) archive only (v1). The rest is technical.

### G27 · Live v1 data the plan changes but doesn't convert

**Type:** not addressed · **Severity: degrades** (v1 is live) · **Where:** migrations

**What's missing.** §6 #3 converts v1 message bodies once. Other v1 data changes meaning and isn't mentioned:
- **Notes-to-self direct messages** (CH3 removes them): what happens to what people wrote there?
- **Slug names** (`acme-launch`, CH3a now allows names as typed): kept until renamed?
- **"Every message" set without asking** for every channel creator and direct-message member (current-state §4: "205 unread"): reset to the default, or kept?
- **General:** §6 #9 joins every member on the server. v1 people who left General would be pulled back in.
- **v1 threads** become reply chains (G16).

**Why it matters.** v1 is live; converting without these rules loses people's notes or quietly changes their settings.

**Evidence:** REPLAN CH3, CH3a, §6 #3, §6 #9; `research/current-state.md` §4 (who gets "Every new message"), §1 (General).

**Proposed resolution:** each notes-to-self conversation becomes a private note "Notes to self (from Chat)"; slugs stay until someone renames them; channel levels reset to "Mentions and replies" (v1 can't tell a chosen level from the forced one, so one quiet line in Catch up says so) and direct messages stay "Every message" (a direct message is addressed to you either way); only people joining after the migration are added to General.

**Who decides:** Technical. *Rejected:* deleting notes-to-self; renaming slugs automatically.

### G28 · What the spec's Definition-of-Ready would fail on (technical list)

**Type:** too thin · **Severity: blocks** (Definition-of-Ready) · **Where:** the spec

- **§4 is empty** ("The views — today and their target": "Rounds 2a/2b"). Round 5 fills it.
- **Closed vocabularies** (AGENTS.md rule 4: one place, a matching CHECK): §6 #5's link kind "conversation of" isn't in `RELATION_KINDS` (`supabase/functions/_shared/contracts/vocabularies.ts:339–348`); presence states, status "clear after" options, decision and wrap-up states, the "message" capture type and Chat's notification kinds need entries; the grant (G6) changes `CHAT_PLAN_TIERS` / `planHasChat` (`:852–854`), a Tier 2 path.
- **Migrations not named:** decisions; wrap-up and reopen; moved-from; statuses and saved statuses; reminders on messages (G13); each person's quick-reaction row; quiet hours; the link rows; the attachments entity type; the v1 conversions (G27). The blueprint names only the store migration and custom emoji.
- **Limits not set:** 8,000 characters per message (`supabase/migrations/20261006150000_chat_module.sql:109`) now counts Markdown and `moduo://` links, so a message of references reaches it sooner; files per message; reactions per message (v1: 20 kinds); custom emoji per workspace; status text length and number of saved statuses; the longest "Remind me" time; pins (v1: 100).
- **Erasure and export for every new user-keyed table** (Tasks' #26 rule): statuses, saved statuses, reminders, quick-reaction rows. §6 #16 exports "file links", but signed links expire in an hour; the export needs the files.
- **Kit additions:** CH29's note says the avatar size by density, the filled composer, NavRow's unread weight and the image size cap are "recorded in §6"; §6 doesn't list them. Visual research adds a neutral AvatarBadge and a FeedComposer size.
- **Copy for key lines:** "Not sent · Retry" vs "Waiting to send" (G21), the offline banner, the viewer's line, the non-manager line in an announcement channel, removal, archived, former member, browser permission refused (G9), the capture's "Sent to…" toast.
- **Where each setting lives:** Settings → Chat (quick reactions, custom emoji) vs Settings → Notifications (quiet hours, message text, sound, browser) vs the profile ("Show me as online", statuses), against `specs/settings-overhaul.md`.
- **Accessibility:** new messages announced to screen readers without taking focus; keyboard reach (G19).

**Why it matters.** The spec step can't mark "Ready to execute" with any of these open.

**Who decides:** Technical (the spec step on Fable). *Rejected:* leaving any of these to the build sessions.

---

## Smaller gaps (polish)

- **Scheduled send** is decided neither way: CH23a dropped scheduled announcements "for now", CH26a's "Later" list doesn't mention it, and the role research rates it "should" for PMs, developers across time zones and organizers. *Maciej, later:* recommend "later", stated in the spec's Out of scope.
- **"Make a task" from a message with files:** do the files come along? *Technical:* the task links the message; files stay on the message.
- **Message search beyond ⌘K's top 5:** the blueprint's "See all in Chat" has no surface, and the filters audit D19 suggested (from, in, has a file, date) aren't in §6 #7. *Technical:* the app search, filtered to Messages, with the FilterBar.
- **Catch up keys on a grouped item:** `R` and `T` act on which message of "Sofia · 3 messages"? *Technical:* the newest.
- **Chains and "Stop following":** CH12 had it, the prototype shows it, CH30d doesn't say it. *Technical:* keep it on the chain's header.

---

## Contradictions

Between decided calls, or between a decided call and older text in the plan or a binding Tasks rule. Several are stale text the spec step will rewrite; the rest point at a finding above.

| # | What disagrees | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| C1 | CH28 "Presence dots stay neutral grey, not green" vs CH28a, decided green | REPLAN CH28, CH28a | Strike the line in CH28 |
| C2 | CH27 "body text 14 px at every step" vs CH29a, decided 15 px | REPLAN CH27, CH29a | Note CH29a's bend in CH27 |
| C3 | CH1 "no custom emoji" vs CH16b; CH16 "comments keep only the six" vs CH16a; Tasks TV-U13 and the Notes re-plan "six fixed" | REPLAN CH1, CH16, CH16a, CH16b; `specs/tasks-v3.md:103` | G11 |
| C4 | CH6 "a reply in a thread you're in", §6 #8 "items: thread", §6 #22 and spike 1 "folds" vs CH30d (chains, no folding) | REPLAN CH6, CH30d, §6 #8, §6 #22; `research/tech-blueprint.md` Appendix C | Rewrite to chains and Wrap up (G16) |
| C5 | §3's hackathon row: "event news reaching them (CH22)" vs CH22, no event workspace | REPLAN §3, CH22 | G8 |
| C6 | §3's solo row: "Chat stays out of one-person workspaces (CH4)", but a founder plus a contractor is two members, and CH4 then shows Chat | REPLAN §3, CH4; `src/components/app/app-chrome-constants.ts:40` | Say in §3 that Chat appears at two members; a member's Chat permission "none" still hides it |
| C7 | §2's sketch: five channel icons (dot, company, team mark, lock, bubble) vs CH32, one glyph plus a lock | REPLAN §2, CH32 | Redraw §2 |
| C8 | CH23 still offers "Seen by 38 of 41", scheduled posts and reach "in any workspace (CH22 C)" vs CH23a (dropped) and CH22 (no event workspace) | REPLAN CH23, CH23a, CH22 | Mark CH23 superseded by CH23a |
| C9 | CH26's first cut (help desk, moderation, event workspaces) vs CH26a | REPLAN CH26, CH26a | G7 |
| C10 | CH7 "Nothing … it still turns bold" vs the visual research's "muted conversation … never bold" | REPLAN CH7; `research/visual-competitors.md:473` | Round 5 follows CH7 |
| C11 | CH29's note "recorded in §6" (kit additions) vs §6 #1–#22, which has none | REPLAN CH29, §6 | G28 |
| C12 | §1.4 "offline … plus queued sends, if decided" vs §6 #2 and §6 #17 | REPLAN §1.4, §6 #2, §6 #17 | G21 |
| C13 | CH28b's first version put "Team now" inside Tasks' team widget; CH35 makes it a Chat widget beside Tasks' team-load widget (two per-person widgets on Home) | REPLAN CH28b, CH35; `specs/tasks-v3.md:165` | *Maciej:* one "Team" widget with a "now" line and the load rows *(recommended)*, or two widgets as CH35 |
| C14 | CH17 "50 MB per file today" vs the per-plan limits (Free: 20 MB per file, 2 GB pooled) | REPLAN CH17; `specs/attachments.md:47` | G6 |
| C15 | §9 step 4's cross-module list leaves out CH16a (Tasks 88, Notes comments), CH29c (rule 41), CH13 (decisions on Tasks' project overview) and CH28b/CH35 (Focus shown to teammates) | REPLAN §9 step 4 | Add them; G5 |
| C16 | CH6's "Every message" level vs what people expect from it (it never pings) | REPLAN CH5, CH6, CH7 | G3 |

---

## Checked and covered

What was examined and found answered well enough for now. Pointers say where.

**Platform**
- The data shape, server ops, idempotent sends, soft deletes (§6 #1).
- The store, device copy, gap filling, "read is what you saw", keyset pages: v1's trust bugs 1–5 (§6 #2, #17).
- The virtual list, budgets, the five spikes and the 10,000-message fixture (§6 #18, #22).
- Message delivery at Moduo's size, zero requests per incoming message, and the Free plan's connection cap (§6 #19's message path, CH31). Storage and bandwidth are G7.
- Search, Polish text, people by name (§6 #7; blueprint §7).
- Loading, filtered to nothing, error and very large: the state rules (§1.4) plus the budgets (§6 #22) answer them; their copy is G28.
- No end-to-end encryption (§6 #21).
- Activity rows for every op, a history in Details, the search registry (§6 #15).
- Account deletion: erasure works today (current-state §2); new tables are G28.
- Export of conversations (§6 #16); files in it are G28.

**The shape and the grammar**
- Channels and direct messages, linkable (CH2); names as typed, one glyph, no `#`, Pin words, no notes to self (CH3, CH3a, CH32).
- Who sees Chat (CH4) and the paused screen (CH4a).
- The left panel and one count language (CH5).
- `@ # /`, one editor, drafts, clean paste, the composer that grows and its "+" (CH14, CH15, CH29g, §6 #3).
- References for messages and conversations, "Private item", "Deleted message" (§6 #4).
- Delete with Undo (§6 #10).
- Make a task through capture with "From:" (CH10); "Mentioned in" on items (CH11).
- Files through the attachments pipeline (CH17, blueprint §9); the grant's limits are G6.
- Custom emoji rules (CH16b, §6 #20); quick reactions per person (CH16a); comments are G11.

**Quiet by design**
- What pings and where (CH6); Focus holds pings, quiet hours (CH7); Catch up as a mode (CH8).
- Notification text and sound (CH33, CH34).
- Presence colours, the status set, saved statuses (CH28a, CH28c, CH28d); privacy is G10.
- `@channel` limited to "Mention everyone" (CH7); announcement channels (CH23a); replies there are G12.

**People and access**
- Viewers never post (audit D3, already in the database).
- Agents as delegates, private channels opt-in, direct messages never (CH18, §6 #12); tools are G25.
- Someone leaving keeps their name with "former member" (CH36).
- Guests later, one model for the app (CH19).
- PERM-7's managers and announcement switch made real (§6 #11); the full table is G18.

**Out of scope, on purpose**
- Mobile (a later plan), calls (Meet), the help desk (CH24, parked), integrations, polls and link previews (CH26a, "Later"), read receipts (CH1).

**Look**
- CH29 (Slack calm as the base), CH29a, CH29b, CH29c, CH29d, CH29f, CH27, CH28.

**The hackathon**
- Scale: ~100 people in team workspaces is within what Moduo is built for (CH20, CH22).
- First open with a welcome in General (CH37).
