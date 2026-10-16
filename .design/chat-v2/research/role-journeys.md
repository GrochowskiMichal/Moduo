# Role journeys — what "complete and pleasant" Chat means per role, and the gaps

> Raw research report from the Chat re-plan, 2026-10-13. Nothing here is decided.

> Research lane, 2026-10-13, read-only, based on `t/maciej/chat-replan` @ `b33922a6`. Format copied from the Tasks lane ([`../../tasks-v3/research/role-journeys.md`](../../tasks-v3/research/role-journeys.md)). Evidence tags: **[V]** read in official docs this session (some through a search summary of the official page) · **[F]** forum, vendor blog or review site · **[M]** from memory, not verified this session · **[I]** inference. Web budget held at ~10 lookups; no Reddit thread came back, so freelancer and founder habits are [M] or [F]. Frequencies in the journey tables are estimates [I] unless tagged.

**Reading frame.** "Complete" for a role = *they can run a normal week without opening Slack, Discord, Teams chat or a WhatsApp/Messenger group for work*. "Pleasant" = the first week feels like the old tool's best moments, not its setup. For each role: what they use today, the moments of the week with how often they happen, what keeps them in the old tool, what Chat v1 already covers, what Tasks v3 and the rest of Moduo already give, and the gaps.

**The hackathon frame (REPLAN §1.5).** Each hackathon team gets **its own prepared workspace** (organizers' info as notes, milestones as tasks). The cross-module layer (workspace per team from a template, invites at scale, organizer and judge access, plan gates, what happens to the data after) belongs to the hackathon readiness plan (`t/maciej/hackathon-plan`, `specs/hackathon.md`). For the hackathon, Notes and Chat are in; Email, Contacts and Calendar are out. Chat v1 is **per workspace**, so everything an organizer does *across* teams is a cross-workspace need. This file records those needs as proposals for that plan; it doesn't design them.

**Moduo vocabulary used below.** *Chat v1:* public and private channels, DMs, group DMs (≤9), notes-to-self, threads, pins, reactions, "New" divider, Mark unread, per-conversation notify level *Every new message · Mentions only · Mute*, `@channel`/`@here`, **managers-only ("Only managers can post") channels + channel managers + the role × capability grid** (permissions §7, migration `20261006210000`), `#` entity refs as live chips, *Create task from message*, the bell (mentions, `@channel`, thread replies) vs the Chat tab badge (DMs), online/offline dot, typing, unsent drafts kept per device, search inside Chat, agents posting through MCP into public channels with an "App" badge, the Home *Conversations* widget, the Duo gate (owner's plan ≥ Duo). *Tasks v3 (spec ready, building locally):* References (link · chip · card · hover preview; "Private item"; "Deleted …"), the one capture (⌘⇧K, ⌘7 switches it to Message, a removable "From: …" chip), the `@ # /` grammar (`@` people then things, `#` tags, `/` commands), Teams ("For Design · 2 unclaimed", `@Design` sends one notice per member), the notification table (§13), reminders delivered as OS/browser notifications, agents as delegates ("Alex · via Claude Desktop"), Time & region, Waiting on…, comments with six fixed reactions, attachments (AT-1 pipeline, polymorphic, live). *Moduo Meet:* specced and Ready, no block built; calls are out of this plan's scope.

---

## 0. Chat v1 at a glance (the "v1" column of the gap map)

| Has | Partly | Doesn't have |
| --- | --- | --- |
| Channels (public, private), DMs, group DMs, notes-to-self · threads · pins · reactions (≤20) · edit, soft delete · Mark unread · notify levels · `@channel` · managers-only channels, channel managers, role × capability grid · `#` entity chips · Create task from message · search inside Chat · agent posting (public channels, `scopes.chat`) · Home widget · optimistic send with retry | Catch-up (per-channel divider, ⌥⇧↑/↓ jumps unread, the Home widget; no "all unreads" view) · presence (online/offline only, no status text) · drafts (per device, localStorage) · onboarding (`#general` auto-joined; invites one email at a time; sign-ups are invite-only) · moderation (admins delete others' messages and remove people; no report) · decisions (pins only) | Files and screenshots · notifications that leave the app (only a Tauri notification stub exists; DMs reach only the tab badge) · mobile · guests · cross-workspace anything · saved for later · reminders on messages · scheduled send · do-not-disturb hours · status/away · link previews for outside URLs · polls · read receipts · calls · incoming integrations (webhooks) · forwarding · message search in ⌘K |

`#` in v1 links an item; Tasks v3 makes `#` a tag and `@` the way to link a thing (REPLAN §1.4). Slack and Discord users type `#channel` to link a channel, so the grammar switch touches every role that comes from those tools.

---

## 1. The seven roles

### 1.1 Hackathon organizer (3–8 organizers, plus mentors, judges, sponsors; 10–60 teams; a 24–48 h event)

**Uses today.** Discord, which MLH's organizer guide recommends over Slack mainly for its free voice; its minimum server is Team-Formation, Carpool-Search, Ask-Organizers, Introductions, Random, Ask-Mentors, Mentors-Internal and Admin (with an admin voice room), plus sponsor channels, and roles that show who is an organizer, hacker, sponsor or mentor [V] ([MLH guide](https://guide.mlh.com/general-information/event-logistics/hackathon-communication-platform)). A staffed help desk that also posts reminders and highlights to the chat [V] ([MLH help desk](https://guide.mlh.io/general-information/day-of-logistics-and-hacker-experience/help-desk-recommendations)). A mentor **ticket queue**: a slash command files a request with location and a short message, tickets land in a private mentor channel, mentors claim them (HackKU's Helper Duck / Helper Fox bots, the HELPq web app, where mentors take whatever they're qualified for) [F] ([Helper Fox](https://flashy-muskmelon-a4d.notion.site/Helper-Fox-344e24251b8d80d5ad47dcb1bd801f68), [HELPq](https://ithub.global.ssl.fastly.net/hackCBS/HELPq)). Rules, FAQ and the Devpost guide as Notion pages; Devpost for team registration and submissions (one submitter, teammates as collaborators, editable until the deadline) [F] ([HackUTD Devpost guide](https://hackutd.notion.site/Devpost-Guide-7775720c1f0d4dbd9dd9d4127cb0a16d)). A server template reused year to year [F] ([campus-experts template](https://github.com/campus-experts/discord-hackathon-template)). A WhatsApp group for the organizing crew and email for pre-event logistics [M].

**The week.**

| When | Moment (how often) | In Moduo today | Gap |
| --- | --- | --- | --- |
| T−4 to T−1 weeks | Build the space: channels, who sees what, pinned rules (once, 1–2 h; reused next year) | v1: channels, managers-only, channel managers, role × capability grid. Template workspace = hackathon plan | Channel sets per audience (mentors, judges, sponsors see theirs on join). Workspace roles are only owner · admin · member · viewer; Tasks v3 **Teams** are the nearest "group" but don't drive channel membership |
| T−3 weeks → T−0 | Get 50–300 people in (one bulk wave plus stragglers) | v1: per-email invites; sign-ups are invite-only (decisions 2026-10-02); invites can carry "Give access to… channels" (`share_payload`) | A join link into a prepared workspace (hackathon plan). Chat needs: every channel ready on first open, no empty state |
| T−3 weeks → T−0 | Pre-event announcements: dates, venue, what to bring, rules (3–6 posts) | v1: managers-only channel + `@channel` → bell | (a) Reach: with one workspace per team, one post reaches one team. (b) People who haven't opened Moduo yet see nothing; no email or OS fallback |
| T−2 weeks → end | The same ten questions (wifi, submission format, deadline, food, team size, can I come solo) asked again and again ("the same question 40 times", the brief's phrase; no source counted it) [I] | v1: threads, pins, search. Notes: an FAQ note, linkable as a card | Answer once, reuse the answer: reply with the FAQ entry as a card; "add this answer to the FAQ"; the organizer's own agent answering through MCP as "Org · via key" [I] |
| Last week | Coordinate mentors, judges, sponsors: shifts, judging criteria, rooms (daily) | v1: private channels | These people may never be Moduo users → members of an organizer workspace, or guests (not in v1; permissions §Out of scope) |
| Hour 0 | Opening: schedule, links, where help is (1 post + pins) | v1: managers-only + pins | Seen count ("read by 38 of 41 teams") for managers only, a quiet stand-in for read receipts [I] |
| Hours 0–48 | Schedule changes ("workshop moved to room B", "food at 19:00"): 10–20 announcements that must land within a minute | v1: `@channel` → the bell, inside the app only | Out-of-app delivery: desktop OS notification, browser notification, phone. Organizers walk the venue on a phone |
| Hours 0–48 | Help desk: questions to organizers, continuous | v1: a channel + threads | "Answered" state on a question; a private line from any team to the organizers |
| Hours 0–48 | Mentor requests: dozens per event, claimable, often by skill (React, hardware, pitch) | v1: an Ask-Mentors channel, no claim. Tasks v3 Teams = the exact mechanic for tasks ("For Mentors · 2 unclaimed", claim with a click), but per workspace | A request → claim → resolved flow across teams. Could be a Tasks v3 Team-routed task created from a message, if teams and mentors share a workspace [I] |
| Hours 0–48 | Code-of-conduct report (0–3, high stakes) | v1: admins delete others' messages; remove from channel | Report a message; a moderation log; remove a person from the event |
| Last 6 h | Countdown: T−6 h, T−1 h, T−15 min | v1: post by hand | Scheduled send (organizers pre-write these the night before) |
| End | Collect submissions (1 per team: repo, video, deck links) | Tasks: a "Submit" milestone task per team workspace with links and files | Organizers see every team's submission in one place (cross-workspace roll-up: hackathon plan, not Chat) |
| Judging | Judging slots ("Team 12 → room B at 14:20"), one per team | Calendar is out for the hackathon | One DM per team, N times; or the organizer's agent fanning one message out per team through MCP [I] |
| After (1–2 weeks) | Winners, thank-you, feedback survey, prize logistics with winners (2–3 posts + N DMs) | v1: post + DMs | Polls for feedback (or a form elsewhere); what happens to the team workspaces (hackathon plan) |

**What keeps them on Discord.** It's free, it's already on every participant's phone with push, voice rooms are free, announcement channels can be **followed** by other servers (an organizer channel republished into many servers) [F] ([mava](https://www.mava.app/blog/discord-server-best-practices), [peakbot](https://peakbot.pro/blog/how-to-set-up-discord-server-for-saas-startup)), ticket bots exist, and last year's server is a template. Gated onboarding is routine: new members see a few channels and unlock the rest from a start-here channel or a registration bot [F] ([PyCon TW](https://tw.pycon.org/2020/en-us/ext/discord/)).

**Chat v1 covers:** announcements inside one workspace (managers-only + `@channel`), channel managers, admin moderation, threads, pins, search, agent posting.
**Tasks v3 + the rest of Moduo covers:** the organizer's info as notes linkable as cards; milestones as tasks; Teams routing as a claim mechanic; capture with a "From:" chip, so a mentor request can become a task linked to its message; the organizer's agent through MCP.

**The gaps (organizer).** (1) Reach across team workspaces: announcements, help desk and mentor queue are all cross-team. (2) Delivery outside the app (OS, browser, phone, an email fallback for people not yet active). (3) A help desk with claimable requests and an "answered" state. (4) FAQ reuse. (5) Moderation: report, log, remove from the event. (6) Scheduled announcements. (7) Audiences: mentor, judge and sponsor channel sets.

**Proposals for the hackathon plan, not decided here.** The structure decides which chat gaps are real:
- **(a) One workspace per team only** (today's plan): cross-workspace announcements (an organizer channel *followed* into every team workspace, Discord's pattern) and a cross-workspace help desk become musts for Chat.
- **(b) Per-team workspaces plus one shared event workspace everyone joins** (MLH's Discord shape): announcements, help desk, mentors and team formation live in the event workspace with what v1 already has; the gap shrinks to **unread and notifications across workspaces** (see both without switching) and a team ↔ organizer private line.
- **(c) One event workspace, each team a private channel + a project + a Team:** no cross-workspace work at all, but it breaks "every team gets its own workspace" and puts every team's notes in one place.

**Needs a call:** the organizer's admin voice room and mentor screen-share sessions (MLH recommends both) [V]. Meet is out of scope; at an in-person event a room replaces it.

**One great moment.** A mentor request becomes a claimed task linked to the team's milestone and the message it came from; when it's done, the request closes itself, and the FAQ answer that solved it is a card the next team gets in one click.

### 1.2 Hackathon team (3–5 participants, some strangers; one prepared workspace)

**Uses today.** The event's Discord (help channels, announcements), a Discord group DM or a WhatsApp group for the team, GitHub, a shared Google Doc or Figma, Devpost to submit [F/M]. Voice and screen share in Discord for remote teams [F].

**The event.**

| When | Moment (how often) | In Moduo today | Gap |
| --- | --- | --- | --- |
| Join (once, first 10 min) | Click the invite, land in the team's workspace: rules, schedule, judging criteria (notes), milestones (tasks), `#general` | v1: `#general` exists and is joined on first visit; Home Conversations widget | A welcome in the conversation itself: who's here, the pinned rules note as a card, where to ask for help |
| First hour (once each) | Strangers introduce themselves: name, skills, at the venue or remote | v1: name + avatar + online dot | A one-line "what I do / where I am" status; nice |
| First 2 h | Pick an idea: brainstorm, vote (once) | v1: threads, reactions as votes | Polls are nice; reactions carry it |
| First 2 h, then hourly | Split the work: who does what by when | v1: Create task from message. Tasks v3: capture with "From:", `@person` assigns | None big: this is where Moduo already beats Discord |
| Continuous | Share links, code, errors (dozens an hour) | v1: autolinks, code blocks | Previews for GitHub / Figma / deploy links; nice |
| Continuous | Share screenshots, mockups, the demo video, the deck (dozens) | v1: nothing | **Files** (AT-1 is ready to be reused) |
| 2–6 per team | Ask a mentor | Depends on the hackathon structure (§1.1 a–c) | A way to ask the mentor desk from inside the team's space and get the answer back there |
| 1–2 nights | Sleep in shifts | v1: online dot | "Sleeping until 6" status + DND; should |
| Remote teams, several | Pair on a bug, rehearse the pitch | Meet (out of scope) | A call from the conversation header (later) |
| Last 3 h | Crunch: organizer countdown must land; "who's submitting?" | v1: announcements only if the team workspace receives them | Out-of-app notifications; the countdown reaching the team |
| End (once) | Submit: repo, video, deck to the organizers | Tasks: the "Submit" milestone task with links and files | Handing it to the organizers is the hackathon plan's |
| After | Keep going, or leave | Workspace stays (hackathon plan) | Export, or convert to a paid plan: the hackathon as the top of the funnel [I] |

**What keeps them on Discord / WhatsApp.** Everyone already has it on their phone; the event lives there; free voice; for strangers, a group DM costs nothing to set up.

**Chat v1 covers:** the team's conversation, threads, reactions, code, Create task from message, `#` chips to the prepared notes and milestones.
**Tasks v3 + Moduo covers:** milestones as tasks with assignees, capture from a message, notes for the rules, References showing live task status in the chat.

**The gaps (team).** Files; announcements and the mentor desk reaching them (structure-dependent); out-of-app notifications; sleep status/DND; a call for remote teams (later).

**One great moment.** The idea thread turns into five assigned tasks in two minutes, each linked back to the message it came from, and the chat shows their live status as the night goes on: the team never keeps a separate to-do list.

### 1.3 Duo founder pair (two co-founders, Duo plan)

**Uses today.** WhatsApp, iMessage or Signal for the quick back-and-forth [M]; sometimes a free Slack workspace for two, where the free plan shows only the last ~90 days of messages and deletes content older than a year [F] ([pebb](https://pebb.io/blog/slack-s-90-day-message-history-restriction-what-you-can-do-about-it), [CNCF](https://www.cncf.io/blog/2025/06/16/cncf-slack-workspace-changes-coming-on-friday-june-20/)); Google Meet or FaceTime; shared Notion or Google Docs; email for investors and customers.

**The week.**

| Moment (how often) | In Moduo today | Gap |
| --- | --- | --- |
| Quick pings: "did you reply to Anna?", "pushed the fix", a link (10–30 a day) | v1: DM, notes-to-self | Phone: most of these happen away from the desk |
| A decision: "we go with Stripe", "price at $20" (3–10 a week) | v1: pin | Mark a message as a decision and have it land on the project or contact; Slack "buries decisions" is the founder's complaint in the Tasks lane |
| Talking about an investor or a customer (daily) | v1: `#` chip to the contact | The conversation shows on the contact's hub ("Discussed in", already in specs/chat.md *Next*) |
| "Remind me about this tonight" (daily) | Tasks v3: reminders as OS/browser notifications, for tasks | A reminder on a message, riding the same delivery |
| Weekly sync on a call (1 a week) | Meet (out of scope) | An agenda built from saved messages: saved for later, should |
| Different rhythms: one works at night (always) | — | Do-not-disturb hours in Time & region's zone |
| Deck versions, screenshots, contracts (daily) | v1: nothing in chat; files exist on tasks (AT-1) | Files |
| Voice notes (the WhatsApp habit) | — | Nice; probably never |

**What keeps them on WhatsApp.** The phone; voice notes; it's where investors, friends and family already are; zero setup.

**Chat v1 covers:** the DM, notes-to-self, Create task from message, `#` chips. **Tasks v3 + Moduo covers:** comments on tasks with reactions (much of a duo's "talk about the work" belongs there), Waiting on…, the contact hub, reminders, capture with "From:". At two people channels mostly don't matter; what matters is that **talk about a thing ends up attached to the thing**.

**The gaps (duo).** Phone; out-of-app notifications for DMs; decisions captured; conversation ↔ contact/project; reminders and saved for later; files; DND hours.

**One great moment.** Open Anna (the investor) and see the email thread, the follow-up task *and* the three chat messages where the two of you decided what to tell her.

### 1.4 Developer team of 3–5

**Uses today.** Slack (paid, or free with its limits: 90-day history, 10 app integrations, huddles capped at two people on the free plan [V] ([Slack huddles](https://slack.com/help/articles/4402059023635))) or Discord for indie teams, which some startups choose for unlimited history and free voice and leave Slack partly over the history limit, while missing Slack's threads [F] ([Qovery](https://www.qovery.com/blog/a-month-after-switching-from-slack-to-discord-in-a-tech-startup)). GitHub, Linear, Sentry and CI bots posting into channels; PR-reminder apps (Axolo, PullNotifier), which reviewers call noisy [F] ([dev.to roundup](https://dev.to/gabrielpineda/top-6-github-slack-integrations-to-try-in-2024-2ecj)); async standups in Slack through Geekbot when time zones make a live standup impossible [F, vendor] ([Geekbot × GitHub](https://geekbot.com/customer-story/why-githubs-distributed-team-prefers-slack-based-standups/)).

**The week.**

| Moment (how often) | In Moduo today | Gap |
| --- | --- | --- |
| Async standup (1 a day per person) | v1: a channel; an agent can post the prompt through MCP. Tasks v3: team-load widget, "Done this week", agent session lines | A standup that writes itself from the work (done · in progress · waiting) instead of a form; the agent route works today [I] |
| PR review requests (5–15 a day) | Tasks v3: handles `MOD-142`, the PR link on the agent session line, "ready for review" notifies whoever started the agent | Incoming GitHub events; a review request as a Waiting on… on the task |
| CI, deploys, alerts (dozens a day) | v1: agents post to public channels | Incoming webhooks into a muted-by-default channel; with MCP-only AI, a plain webhook isn't AI, but the "MCP is the integration surface" line from the Tasks lane needs a call |
| An incident (0–2 a month) | v1: a channel, `@here`, threads | A call from the channel (Meet, later); "turn this thread into a note" for the postmortem |
| Decisions / ADRs (1–3 a week) | v1: pins | Decision capture into a note or the project |
| Time zones (always) | Tasks v3: Time & region | DND hours, status ("back Mon"), scheduled send "at their 9:00" |
| Pairing (daily) | — | Huddle (Meet, later) |
| Snippets and stack traces (daily) | v1: block code | Syntax highlighting and folding long blocks; nice |
| GitHub / Figma / Vercel links (daily) | v1: autolinks; References cover only Moduo items | Previews for outside links; should |
| Catching up after a day off (weekly per person) | v1: per-channel divider, ⌥⇧↑/↓ | One catch-up view across conversations, a must when time zones split the team |
| Typing `#channel` (habit) | Tasks v3: `#` = tag, `@` links things | The grammar call (§0) |

**What keeps them in Slack.** Integrations (GitHub, Linear, Sentry, CI), huddles, Slack Connect with vendors and customers, keyboard speed, years of searchable history.

**Chat v1 covers:** threads, code blocks, search, notify levels, agent posting, Create task from message. **Tasks v3 + Moduo covers:** handles, agents as delegates with "Claude · working", Waiting on…, team load, the `/` command grammar.

**The gaps (dev).** Incoming integrations; catch-up view; DND/status/scheduled send for time zones; huddles (Meet); decision capture; outside link previews; files (screenshots of bugs).

**One great moment.** `MOD-142` in a message is a live chip: status, assignee, "Claude · writing tests · step 3 of 5". Nobody asks "is this done?" in the channel any more.

### 1.5 PM coordinating developers, a designer and a stakeholder

**Uses today.** Slack + Linear or Jira + Figma + Google Docs, email for the stakeholder; Microsoft Teams when the stakeholder's company runs on Microsoft [M]. Slack's *Later* tab holds saved messages and reminders together, private to you, and scheduled send is on desktop and mobile [V] ([Slack Later](https://slack.com/help/articles/360042650274)).

**The week.**

| Moment (how often) | In Moduo today | Gap |
| --- | --- | --- |
| Morning catch-up (1 a day) | v1: dividers, Home widget. Tasks v3: My tasks, team load | One catch-up view |
| Chase a blocker (several a day) | v1: DM with a `#` chip. Tasks v3: References show live status; Waiting on… | "Waiting on…" set from a message; small |
| Design feedback round with the designer (2–3 a week) | v1: threads | Files, Figma previews |
| Decisions (several a week) | v1: pins | Decisions captured on the project |
| Weekly stakeholder update (1 a week) | Tasks v3: project overview ("Done this month"), time report | Post it to someone outside the workspace: a guest, or the email module |
| Find a meeting time (weekly) | Calendar booking links | Polls; should |
| Meeting → action items (several a week) | Meet's recap (later); MCP "extract actions" | — |
| Follow-ups ("ping me Thursday") (daily) | Tasks v3: reminders for tasks | Reminders on messages; saved for later |
| Release notes to the team (every 1–2 weeks) | v1: managers-only channel | Scheduled send |
| "Did they read it?" (the temptation) | — | Read receipts: a §7 risk (see §3) |
| Where does the talk about project X live? (always) | v1: by naming convention only | A conversation linked to the project, shown in its overview |

**What keeps them in Slack or Teams.** The stakeholder and the designer are there; guests; Linear/Jira/Figma notifications; huddles.

**Chat v1 covers:** channels per topic, DMs, threads, chips, Create task. **Tasks v3 + Moduo covers:** project overview and status, Teams, Waiting on…, the time report, References.

**The gaps (PM).** Conversation ↔ project; decisions; reminders and saved for later; catch-up; guests for the stakeholder; scheduled send; files; polls.

**One great moment.** The project's overview shows its open questions and decisions straight from the conversations, next to progress and what's waiting on whom: the Friday update writes itself.

### 1.6 Agency of 2–4 working with 2–3 clients (plus contractors)

**Uses today.** Internally Slack or a WhatsApp group. Per client: a WhatsApp group (common outside the US) [M]; Slack Connect when the client is on Slack, or the client as a guest in the agency's workspace [F] ([ClearFeed](https://clearfeed.ai/blogs/slack-for-client-communication-guide)). Slack bills multi-channel guests like members; single-channel guests are free, up to five per paid member [V] ([Slack guest roles](https://slack.com/help/articles/202518103)). Whether a client on a free Slack plan can join a Slack Connect channel depends on the plan; sources disagree outside Enterprise [V/F] ([Slack: free teams](https://slack.com/help/articles/4409350616467), [ClearFeed](https://clearfeed.ai/blogs/a-short-guide-to-using-slack-connect-with-customers-and-partners)). Email for approvals and anything contractual; a PR-agency partner advises against WhatsApp for client communication on professionalism and security grounds [F] ([PRmoment](https://prmoment.com/pr-insight/how-to-use-whatsapp-at-work)). Contractors as Slack guests or on WhatsApp [M].

**The week.**

| Moment (how often) | In Moduo today | Gap |
| --- | --- | --- |
| A client asks something (2–10 a day per client, any hour) | Email module (desktop-first), linked to the contact | The client in a chat: a guest with access to one conversation, at no seat cost; on a phone |
| Feedback round on a deliverable (weekly per client) | Files on tasks (AT-1); Meet's guest join (later) | Files in chat; an **approval** captured with who and when, on the project and the contact |
| Internal talk about a client (daily) | v1: a private channel by naming convention | The conversation linked to the client's project and contact; "Discussed in" on the hub |
| A contractor joins for one project (monthly) | Workspace member = sees everything shared with everyone | A limited guest; removal hands their tasks back (Tasks v3 §15) |
| After-hours client messages (weekly) | — | DND hours; the client sees the agency's hours |
| Client calls (weekly) | Meet: guests join with no account (specced, not built) | — (Meet track) |
| Status to the client (weekly) | Tasks v3: overview + time report PDF; the no-login client link is parked | — |

**What keeps them on WhatsApp / Slack Connect.** The client picks the channel, and the client won't log into another tool. WhatsApp is on every phone. Slack Connect can cost the client nothing when the agency pays (sources disagree outside Enterprise, see above). Guests are expected to be free.

**Chat v1 covers:** internal agency conversations only. **Tasks v3 + Moduo covers:** projects with a client link, the contact hub, the time report by client, email to the client, Meet guests (later).

**The gaps (agency).** Client guests (free, one conversation, phone-friendly); conversation ↔ client/project; approvals as decisions; files; DND hours; mobile.

**Honest verdict.** The agency's **internal** chat is replaceable. **Client-facing** chat isn't credible without free, limited guests and a phone, and permissions put guests out of scope for v1. The honest substitute today is email inside Moduo linked to the contact, Meet with guests, and (later) the no-login client status link.

**One great moment.** Open the client: the email threads, the internal chat about them, the approvals with dates, the tasks and the hours, in one place, with no logging.

### 1.7 Solo founder with one or two contractors (the edge of the target)

**Uses today.** WhatsApp or Telegram, Upwork/Fiverr messages, email, Loom; sometimes a free Slack workspace [M].

**The week.**

| Moment (how often) | In Moduo today | Gap |
| --- | --- | --- |
| Brief a piece of work (2–5 a week) | Tasks v3: assign, description, References, files | None: the brief is a task |
| The contractor's questions (daily) | Tasks v3: comments on the task (per item, six reactions) | A DM only if the workspace has chat |
| Review a deliverable (weekly) | Files on the task (AT-1) | — |
| Time-zone gap (always) | Time & region | DND hours, scheduled send; nice |
| The engagement ends (per contractor) | Tasks v3 §15: member removal hands tasks back | — |

**The gate.** Chat needs the owner on Duo or above. Pro is one seat and has no chat; Duo is two seats, so founder + one contractor fits, and a second contractor means Team. The contractor joins as a full member, and new notes default to "Workspace · Can edit" (permissions, resolved call 2), so they see the founder's shared notes unless the founder changes it. A guest would fit better than a member.

**Does chat make sense at 1+1?** Barely. Comments on the task cover the work talk; email and Meet cover the rest. Chat earns its place only with an ongoing contractor *and* if the founder wants the conversation next to the work. Need level: nice. If guests exist, it becomes "should".

**One great moment.** None that comments on the task don't already give. That's the finding: at this size, Chat shouldn't be what convinces anyone.

---

## 2. Gap map

### 2.1 Capabilities × roles

Need: **must** (they keep the old tool open without it) · **should** (they switch but grumble) · **nice** · **no**. v1: **yes** · **part** · **no** (see §0). Roles: **Org** organizer · **Hack** hackathon team · **Duo** founder pair · **Dev** developer team · **PM** · **Agcy** agency · **Solo** solo founder + contractors.

| # | Capability | v1 | Org | Hack | Duo | Dev | PM | Agcy | Solo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Announcements (managers-only, reach everyone) | yes, one workspace | must | must (to receive) | no | nice | should | nice | no |
| 2 | Notifications that leave the app (desktop OS, browser) | no (bell + tab badge, in-app) | must | must | must | must | must | must | should |
| 3 | Mobile push | no (mobile out of scope) | must | should | must | should | should | must | should |
| 4 | Unread catch-up across conversations | part | should | should | nice | must | must | should | nice |
| 5 | Saved for later | no | should | nice | should | should | should | should | nice |
| 6 | Reminders on messages | no | should | nice | should | should | must | should | nice |
| 7 | Scheduled send | no | should | no | nice | should | should | should | nice |
| 8 | Message → task | yes | should | must | should | must | must | must | should |
| 9 | Conversation linked to a project or client ("Discussed in" on the item) | no (`#` chips in text only) | nice | nice | should | should | must | must | nice |
| 10 | Decisions (and client approvals) captured | part (pins) | nice | nice | should | should | must | must | nice |
| 11 | Files and screenshots | no (AT-1 ready to reuse) | must | must | must | must | must | must | should |
| 12 | Previews for outside links (GitHub, Figma) | no | nice | nice | nice | should | should | nice | nice |
| 13 | Search | yes (inside Chat, not ⌘K) | should | should | should | must | must | must | nice |
| 14 | Threads | yes | must | should | nice | must | should | should | nice |
| 15 | Status / away ("sleeping until 6", "back Mon") | part (online dot) | should | should | nice | should | nice | nice | nice |
| 16 | Do-not-disturb hours | no | nice | should | should | must | should | must | nice |
| 17 | Huddle / call | no (Meet track) | should | should (must if remote) | should | must | should | should | nice |
| 18 | Incoming integrations (GitHub, CI, alerts) | part (agents post via MCP) | nice | nice | no | must | should | nice | no |
| 19 | Agent / MCP posting | yes (public channels) | should | nice | nice | should | should | nice | no |
| 20 | Read receipts | no (by design) | nice (seen count) | no | no | no | nice | nice | no |
| 21 | Polls | no | should | nice | no | nice | should | nice | no |
| 22 | Help desk: claimable requests + FAQ reuse | no | must | must (to ask) | no | nice | no | should | no |
| 23 | Moderation: report, log, remove from the event | part (admins delete others' messages, remove from channel) | must | no | no | no | no | no | no |
| 24 | Onboarding at scale (join link, channels ready on first open, audiences) | part | must | must | no | no | no | no | no |
| 25 | Guests (one conversation, no seat) | no (out of scope, permissions) | should (judges, sponsors) | nice | nice | nice | should | must | should |
| 26 | Cross-workspace (post into many; unread across them) | no | must* | must* | no | no | nice | nice | no |

\* Depends on the hackathon structure (§1.1 a–c): a must under (a), shrinks to "unread and notifications across workspaces" under (b), disappears under (c).

### 2.2 The must-gaps: hackathon cut vs teams of 2–5

"Outside its group" applies principle 48a (Tasks REPLAN: a solution built for one group has to serve the others too, not work as a trade): would people outside the group that needs it most still want it? "§7" = PRODUCT_BRIEF §7's quiet, grouped, digest-by-default notification bar.

| Gap | Hackathon must | Teams of 2–5 must | Already given by Tasks v3 / Moduo | Outside its group (48a) | §7 quiet bar |
| --- | --- | --- | --- | --- | --- |
| **G1 Notifications that leave the app** (DMs, `@you`, announcements, replies in your threads) | yes | yes (all) | Tasks v3 §13 delivers reminders as OS/browser notifications; the desktop app keeps running in the menu bar | Everyone; it's the baseline of every chat tool | **Risk.** Keep it to DMs, `@you`, announcements and replies in your threads; a burst in one DM = one notice; "Every new message" channels never reach the OS by default [I] |
| **G2 Files and screenshots** | yes | yes (all) | AT-1 storage (polymorphic, 50 MB per file), file chips on tasks | Everyone | None |
| **G3 Cross-workspace reach** (an organizer channel followed into every team workspace; unread across workspaces) | yes under (a); "unread across" under (b) | no | The workspace switcher | Weakly: a founder in their own workspace plus a client's wants unread across both; Discord's followed channels show the pattern exists | **Risk.** One followed post = N workspaces × members; must be a low-volume, managers-only class |
| **G4 Onboarding at scale** | yes | no | Invites carry "Give access to…" (`share_payload`) | Classes and communities (the student funnel), larger teams later; weak at 2–5 | None |
| **G5 Help desk** (claimable requests, "answered", FAQ reuse) | yes | no (agency: should) | Tasks v3 Teams routing + claim; capture with "From:"; FAQ note as a card; the organizer's agent through MCP | Yes **if** built as "message → Team-routed task" (agencies' client requests, a dev team's support rotation). A chat-only ticket system would be a hackathon-only trade | **Watch.** Tasks v3 groups team notices by the hour; a mentor desk needs minutes. An event exception, or not routed through the bell [I] |
| **G6 Moderation** (report, log, remove from the event) | yes (code of conduct, MLH [V]) | no | Admins delete others' messages; remove from channel; member removal (Tasks v3 §15) | Anyone with guests or a big workspace; minor at 2–5 | None |
| **G7 Mobile push** | yes in practice (organizers on the floor, participants at meals and asleep) | yes (duo, agency) | Nothing; Meet's guest page is the only phone surface | Everyone | **Risk.** Per-message push is the incumbents' most-cited noise; if it ever comes, G1's rules apply. Out of scope now: mitigate with browser notifications and an email fallback for announcements [I] |
| **G8 Guests** (one conversation, no seat) | should (judges, sponsors), if mentors and judges join as members | yes (agency); should (PM, solo) | Meet guests (later); the parked no-login client link | Notes and Tasks sharing would want the same guest: one model, not a chat-only one | Guests hear only their conversation |
| **G9 Conversation ↔ project / client** ("Discussed in" on the item, the conversation in the project overview) | no | yes (PM, agency) | References, `entity_links`, the contact hub roll-up | Everyone using the spine: this is the moat applied to chat | None, if "Discussed in" is a quiet line, not a notice |
| **G10 Decisions and approvals captured** | no | yes (PM, agency) | Notes, References, pins | Duo and dev teams lose decisions in chat too | None |
| **G11 Reminders on messages** (+ saved for later) | no (should) | yes (PM) | Tasks v3 §13's reminder row (precise, your own) | Everyone | Fine: same precise class as a task reminder |
| **G12 Unread catch-up** | no (should) | yes (dev, PM) | Home Conversations widget; per-channel dividers | Everyone | **Helps**: one pull view instead of pings |
| **G13 Do-not-disturb hours** (+ status) | no (should: sleep shifts) | yes (dev, agency) | Time & region (zone, 12/24 h); a running Focus session (the top-bar timer, Tasks v3 §7, §18) is a ready trigger for an automatic "In focus until 15:00" status with DND [I] | Everyone | **Helps**: the bar's own tool |
| **G14 Huddle / call** | no at a venue; must for remote events | yes (dev) | Meet (specced, no block built) | Everyone | **Risk.** A ringing call is the loudest notice there is; Meet's "one quiet notification" rule should carry over |
| **G15 Incoming integrations** | no | yes (dev) | MCP agent posting into public channels | Mostly developers | **Risk.** Bot feeds are the noisiest part of Slack: a feed channel starts muted [I] |

**The hackathon MVP cut** (must, beyond what v1 has): G1 · G2 · G3 (shape set by the hackathon plan) · G4 (mostly the hackathon plan's) · G5 · G6, plus a mitigation for G7. v1 already supplies the rest of the hackathon musts: managers-only announcements, threads, search, Create task from message, channel managers. Should for the event: scheduled send, status/DND for sleep shifts, a seen count on announcements, polls.

**The teams-of-2–5 cut:** G1 · G2 · G9 · G10 · G11 · G12 · G13, then G14 (Meet) and G15 for developers, and G8 for agencies. G7 is the one gap no Chat change closes.

---

## 3. What would break the quiet bar (PRODUCT_BRIEF §7)

- **Read receipts per person.** "Seen by Anna at 14:02" creates reply pressure, the exact anxiety §7 exists to prevent. The quiet substitute: an aggregate seen count on announcements, visible only to the channel's managers [I].
- **`@channel` / `@everyone` volume at event scale.** 300 people × 20 announcements = 6,000 notices. Announcements should be their own low-volume class (one notice per post), and `mention_everyone` stays a manager capability during events (it's already in the role × capability grid).
- **Followed announcements across workspaces (G3)** multiply that reach by the number of workspaces.
- **"Every new message" as a default.** Fine in the tab badge; never as OS notifications per message. DMs need a burst rule (one notice per conversation per burst) [I].
- **Per-message mobile push** (G7), if it ever comes.
- **Integration feeds** (G15): muted by default.
- **Mentor requests through Teams' hourly grouping** (G5): too slow for the event; too loud if it pings every mentor per request. One notice to the mentors' Team, claimed by one, cleared for the others.
- **Polls:** one notice when a poll closes, never per vote. **Reactions** never notify (Tasks v3's rule; v1 already behaves this way).
- **Calls** (G14): one quiet notice ("Mike started a call in #design"), never a ringtone by default.
- **The tension to reconcile:** §7 says digest-by-default, and Tasks v3 §13 groups most notices by the hour; chat is the deliberate real-time exception (PRODUCT_BRIEF §9). DMs and `@you` have to arrive promptly; everything else stays a badge, a divider or a digest.

---

## 4. The gaps ranked (what most increases "can run a normal week without the old tool")

| Rank | Gap | Roles it unblocks | Note |
| --- | --- | --- | --- |
| 1 | G1 Notifications that leave the app | all | Without it, a DM in Moduo reaches you only if you're looking at the Chat tab |
| 2 | G2 Files and screenshots | all | AT-1 is built and polymorphic; Chat is a named later consumer in `specs/attachments.md` |
| 3 | G3 Cross-workspace reach / unread across workspaces | Org, Hack | Shape set by the hackathon plan's structure choice |
| 4 | G5 Help desk (claimable requests + FAQ reuse) | Org, Hack, Agcy | Built on Tasks v3 Teams routing, it serves everyone (48a) |
| 5 | G4 Onboarding at scale | Org, Hack | Mostly the hackathon plan's; Chat's part is channels ready on first open |
| 6 | G9 Conversation ↔ project / client | PM, Agcy, Duo, Dev | The spine applied to chat: the reason to switch that Slack can't copy |
| 7 | G8 Guests | Agcy, PM, Solo, Org | Out of scope in permissions v1; one model across modules |
| 8 | G12 Unread catch-up | Dev, PM | Helps the quiet bar |
| 9 | G11 Reminders on messages + saved for later + scheduled send | PM, Dev, Duo, Org | One "later" family; reminders ride Tasks v3 §13 |
| 10 | G13 DND hours + status | Dev, Agcy, Hack | Reads Time & region |
| 11 | G10 Decisions and approvals captured | PM, Agcy, Duo | |
| 12 | G6 Moderation | Org | |
| 13 | G15 Incoming integrations | Dev | Needs a call on "MCP is the integration surface" |
| 14 | G14 Huddle / call | Dev, remote hackathons | Meet track |
| 15 | G7 Mobile push | Duo, Agcy, Org | Out of scope; the one gap no Chat change closes |

---

## 5. Where Chat in Moduo can't credibly replace the old tool (yet)

| Role | Verdict | Why | What would change it |
| --- | --- | --- | --- |
| Hackathon organizer | **Replaces the during-event team side; not the open pre-event community** | Discord is free, already on phones with push, has free voice, and is where 300 registrants form teams before anyone has a Moduo account | Structure (b) (an event workspace) + G1/G3/G4/G5, and a phone fallback for announcements |
| Hackathon team | **Credible inside the event** | Laptops are open during the event; the prepared workspace gives them something Discord doesn't (tasks, notes, live chips) | G2 files, G1 notifications and G3 (shaped by §1.1 a–c, so announcements and the mentor desk reach the team) make it the team's home for 48 h |
| Duo founders | **Replaces the at-desk work talk; not the phone layer** | The quick DMs happen on WhatsApp/iMessage, on phones, next to investors and friends | Mobile (out of scope) |
| Developer team | **Credible once integrations, huddles and catch-up exist** | Slack's GitHub/CI feeds and huddles are daily habits | G15 + G14 + G12 + G13 |
| PM | **Credible inside the team; not toward a stakeholder who lives in Slack or Teams** | The stakeholder won't join another tool | G8 guests, or the email module for the stakeholder |
| Agency | **Internal chat yes; client chat no** | Clients pick the channel, won't log in, live on WhatsApp; guests are out of scope | Free, limited guests + a phone surface; until then email in Moduo + Meet guests + the client status link |
| Solo + contractors | **Chat isn't the right tool at 1+1** | Comments on tasks, email and Meet cover it; chat sits behind the Duo gate; a contractor would join as a full member | Guests; even then "nice" |

---

## 6. Where a journey needs a call (Meet track, out of scope here)

Organizer: the admin voice room and mentor screen-share sessions. Remote hackathon teams: pairing and pitch rehearsal. Duo: the weekly sync. Dev: pairing and incidents. PM: design reviews. Agency: client calls (Meet's guest join covers it). Chat's only job here is the door: "Start a call" from a conversation's header, through `startCall({ source: "chat" })` in `specs/moduo-meet.md`.

---

## Sources

Official docs [V]: [MLH: hackathon communication platform](https://guide.mlh.com/general-information/event-logistics/hackathon-communication-platform) (fetched) · [MLH: help desk recommendations](https://guide.mlh.io/general-information/day-of-logistics-and-hacker-experience/help-desk-recommendations) and [MLH: mentorship](https://guide.mlh.io/general-information/mentorship) (via search summary) · [Slack: guest roles](https://slack.com/help/articles/202518103) · [Slack: save for later](https://slack.com/help/articles/360042650274) · [Slack: huddles](https://slack.com/help/articles/4402059023635) · [Slack: Slack Connect with free teams](https://slack.com/help/articles/4409350616467) (all Slack pages via search summaries).
Forums, vendor blogs, event pages [F]: [HackKU Helper Duck](https://hackku.notion.site/Helper-Duck-d747497ddbc24a2f8f27b3bee1f7f4e2) · [Helper Fox](https://flashy-muskmelon-a4d.notion.site/Helper-Fox-344e24251b8d80d5ad47dcb1bd801f68) · [HELPq](https://ithub.global.ssl.fastly.net/hackCBS/HELPq) · [campus-experts Discord hackathon template](https://github.com/campus-experts/discord-hackathon-template) · [HackUTD Devpost guide](https://hackutd.notion.site/Devpost-Guide-7775720c1f0d4dbd9dd9d4127cb0a16d) · [PyCon TW Discord guideline](https://tw.pycon.org/2020/en-us/ext/discord/) · [mava: Discord server practices](https://www.mava.app/blog/discord-server-best-practices) · [peakbot: Discord for a SaaS startup](https://peakbot.pro/blog/how-to-set-up-discord-server-for-saas-startup) · [pebb: Slack's 90-day history](https://pebb.io/blog/slack-s-90-day-message-history-restriction-what-you-can-do-about-it) · [CNCF Slack changes](https://www.cncf.io/blog/2025/06/16/cncf-slack-workspace-changes-coming-on-friday-june-20/) · [Qovery: a month after Slack → Discord](https://www.qovery.com/blog/a-month-after-switching-from-slack-to-discord-in-a-tech-startup) · [Geekbot × GitHub](https://geekbot.com/customer-story/why-githubs-distributed-team-prefers-slack-based-standups/) · [dev.to: GitHub × Slack integrations](https://dev.to/gabrielpineda/top-6-github-slack-integrations-to-try-in-2024-2ecj) · [ClearFeed: Slack for client communication](https://clearfeed.ai/blogs/slack-for-client-communication-guide) · [ClearFeed: Slack Connect](https://clearfeed.ai/blogs/a-short-guide-to-using-slack-connect-with-customers-and-partners) · [PRmoment: WhatsApp at work](https://prmoment.com/pr-insight/how-to-use-whatsapp-at-work).
Not verified this session [M]: WhatsApp as the default client channel outside the US; founders' WhatsApp/iMessage habit; Teams for stakeholders on Microsoft; contractor channels; all frequencies (estimates [I]).
Repo evidence: `docs/PRODUCT_BRIEF.md` (§2, §4, §7, §9), `specs/chat.md`, `specs/tasks-v3.md` (§1, §7, §10–13, §15, §18), `specs/permissions.md` (§1, §7, §8, out of scope, resolved calls), `specs/moduo-meet.md` (scope, out of scope), `specs/attachments.md`, `docs/decisions/billing.md` (Duo gate, seat caps), `.design/chat-v2/REPLAN.md` (§1.4, §1.5), `.design/tasks-v3/REPLAN.md` (48a), `src/features/chat/{model.ts, markup.ts, hooks/use-chat-badge.ts, hooks/use-chat-module.ts, ui/chat-dialogs.tsx, ui/message-item.tsx, ui/composer.tsx}`, `supabase/migrations/20261006150000_chat_module.sql`, `20261006210000_perm_sharing.sql` (`workspace_chat_caps`, `managers_only`, `chat_channel_managers`), `src/lib/runtime.web.ts` (invite `share_payload`).
