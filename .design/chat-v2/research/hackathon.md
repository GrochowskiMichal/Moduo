# Research: Chat for a Moduo-run hackathon

> Raw research report from the Chat re-plan, 2026-10-13. Nothing here is decided.

**Scope.** A separate "[Hackathon] readiness plan" (branch `t/maciej/hackathon-plan`, output `specs/hackathon.md`) owns the cross-module layer: web access, invites at scale, template workspace → N team workspaces, organizer and judge access, plan gates, and data after the event. This file covers **what Chat itself must do** inside whichever structure that plan picks. The structural options (A–D) and the plan gate are listed here **as inputs for that plan**, not as Chat decisions. The date, team count and team size are unknown and are not assumed.

**Marks.** [V] = I read the primary source myself (linked). [U] = search summary, secondary source, old data, or my own inference. [repo] = read in this repository on 2026-10-13.

## Key findings

1. **Discord is the default hub.** MLH recommends it for its free voice chat. ETHGlobal calls it "where all official communications will happen". Moduo would be up against a free, familiar tool that has voice and a phone app. [V]
2. **The channel set is small and the same everywhere:**
   - announcements (organizers only)
   - ask-organizers
   - ask-mentors / help
   - team-formation
   - introductions
   - random
   - sponsor channels
   - staff-only

   Moduo could ship it as a template. [V]
3. **Help desks work best as a pull queue.**
   - HELPq: "Mentors should not receive any type of push notifications"; mentors claim tickets instead.
   - Average response was 5–10 minutes at most events and 56 minutes when the queue backed up (2015–16 data). [V]
   - Moduo's "Create task from message" plus Tasks v3 claims could be this queue.
4. **Missed announcements are a timing problem.** Too little and people feel lost; too much and they tune out. Announce at breaks, both spoken and written. Answer in public, then pin a FAQ. Aim for about a 30-minute answer. [V]
5. **Typical teams are 2–5 people.** MLH recommends at most 4, ETHGlobal allows up to 5 (about 2.5 hackers per project), HackYeah allows 1–6. That matches Moduo's target team size. Events range from about 12 teams (local) to 400+ projects (HackYeah). [V]/[U]
6. **The current blockers sit in the event layer, not in team chat.**
   - Invites are tied to one email address each. There is no join link, and I found no bulk-invite input. A pending workspace invite does pass the invite-only gate, so a bulk email invite would work.
   - The automatic trial is Pro: 1 seat, no chat.
   - The chat gate depends on the owner's plan.
   - There is no cross-workspace channel, and the bell is per workspace.
   - Chat has no files and no voice, and Moduo has no mobile layout. [repo]
7. **The Free plan caps owning one workspace, not membership.** A Free participant can belong to an event workspace and a team workspace. [repo]
8. **Privacy between competing teams rules out one shared workspace (A).** Moduo's sharing defaults to workspace-wide, and Tasks v3 "Teams" are routing groups, not walls. Notion keeps hidden private teamspaces for its Enterprise plan only. [repo]/[V]

---

## Part 1: How hackathons communicate today

### 1.1 Formats

- **24 hours on site.** HackYeah 2026 (Kraków, TAURON Arena): tasks unlock 11:00 Saturday 3 October, a first project draft is due 20:00 Saturday, final submission 11:00 Sunday, finalists 15:00, pitches 16:00, winners 17:45. [V] [hackyeah.pl](https://hackyeah.pl)
- **Weekend on site.** Junction runs from Friday afternoon to Sunday morning. [U] [Wikipedia](https://en.wikipedia.org/wiki/Junction_(hackathon)). Junction 2025 added online regional qualifiers before the Espoo final. [U]
- **Digital.** MLH lists in-person, digital and hybrid. In a digital event, judging happens by video or "in a per-team Discord room". MLH says it "will not be working with hybrid events" and calls hybrid worse for organizers and hackers. [V] [MLH guide: event types](https://guide.mlh.com/overview/event-types)
- **Minimum length.** MLH member events must run at least 24 hours with the venue open overnight. [U] (search summary of MLH community values)
- **Small local events.** Kraków examples: a 2-day "Hackathon dla Małopolski" run by Kraków Technology Park for the region [U]; a student "AI in Pharma" hackathon at AGH on 25 October 2026, run in English [U]; a HERE Technologies geospatial student hackathon with AGH where 12 teams took part [U]. These are the size a first Moduo event is most likely to have.

### 1.2 Sizes

| Event | People | Teams / projects | Team size | Source |
| --- | --- | --- | --- | --- |
| HackYeah 2025 (Kraków) | ~3,000 registered, 2,000+ on site, ~200 mentors | 400+ projects | 1–6 | [V] [hackyeah.pl](https://hackyeah.pl) |
| ETHGlobal Cannes 2025 | 835 hackers | 334 projects | up to 5, solo allowed | team size [V] [ETHGlobal Cannes start](https://ethglobal.com/events/cannes/info/start); counts [U] (organizer-written POAP badge text) |
| ETHGlobal Prague / New York 2025 | 520 / 687 hackers | 217 / 275 projects | up to 5 | [U] (POAP badge text) |
| Junction 2025 (Espoo) | 1,500+ | n/a | 1–5 (2024 platform guide) | [U] |
| MLH rules template | n/a | n/a | "Teams can be 1-4 people"; "most success with teams of a maximum size of 4" | [V] [MLH guide: rules](https://guide.mlh.com/general-information/judging-and-submissions/rules-for-your-hackathon) |
| HackMIT 2015 | 425 users, 242 mentors | 502 help tickets | n/a | [V] [HELPq README](https://github.com/techx/hackmit-hackq) (2015 data) |
| HERE student hackathon, Kraków | n/a | 12 teams | n/a | [U] |

- ETHGlobal works out to about 2.5 hackers per project (835/334, 520/217, 687/275). Many teams are 2–3 people. [U] (derived from POAP numbers)
- **For Moduo:** the usual team (2–5) is exactly the product's target team size. Event sizes range from about 12 teams (local student event) to 400+ teams (HackYeah). "~20 teams" and "~100 teams" are both realistic.

### 1.3 Roles

- **Organizers / staff**: run the event, post announcements, moderate. The campus-experts Discord template gives them a moderator role and staff-only channels (staff-chat, judging, mod-log). [V] [template](https://github.com/campus-experts/discord-hackathon-template)
- **Volunteers**: handle common questions; mentors take technical ones; the event director handles code-of-conduct issues and emergencies. [V] [BuilderBase playbook ch. 13](https://intercom.help/builderbase/en/articles/14831450-hackathon-playbook-ch-13-participant-communication)
- **Mentors**: work in assigned time slots, signed up through a form; have an `@mentor` role. [V] [MLH guide: mentorship](https://guide.mlh.com/general-information/mentorship). At ETHGlobal they have a Discord role and wear high-visibility jackets on site. [V] [ETHGlobal](https://ethglobal.com/events/cannes/info/start)
- **Judges**: score projects. The template tells judges not to answer attendee DMs unless the team agreed to get feedback that way. [V] [template](https://github.com/campus-experts/discord-hackathon-template)
- **Sponsors / partners**: get their own channels for their APIs and workshops (MLH's example event had two). [V] [MLH guide: communication platform](https://guide.mlh.com/general-information/event-logistics/hackathon-communication-platform). Sponsors can open their own support voice channels. [V] [template](https://github.com/campus-experts/discord-hackathon-template)
- **Speakers / workshop hosts**: a role in the template. [V]
- **Participants**: in teams. **Solo hackers** look for a team in a team-formation channel (MLH "Team-Formation", ETHGlobal "#find-a-team"). [V] HackYeah also runs an on-site team-building space. [V] [hackyeah.pl](https://hackyeah.pl)

### 1.4 Tools in use

**Discord is the default hub.**
- MLH: pick one platform and make sure hackers join it. "We recommend Discord for your event because of their free voice chat capabilities." [V] [MLH guide: communication platform](https://guide.mlh.com/general-information/event-logistics/hackathon-communication-platform)
- MLH's minimum channels: Team-Formation, Carpool-Search, Ask-Organizers, Introductions, Random, Ask-Mentors, Mentors-Internal, Admin (+ an admin voice channel), plus sponsor channels. [V] (same page)
- ETHGlobal: Discord is "where all official communications will happen". Help goes to `#mentorship-help`, teammates to `#find-a-team`. Email is the fallback when someone can't get into the event channels. [V] [ETHGlobal Cannes start](https://ethglobal.com/events/cannes/info/start)
- HackYeah: a Discord community for networking before the event; mentors are on site and on Discord for remote questions. Registration runs on eventory.cc; 2025 submissions ran on Challenge Rocket. [V] [hackyeah.pl](https://hackyeah.pl)
- Template bots: Zira.gg (pick roles by reacting), Ticket Tool (private support channels between staff and one user), GearBot and Skyra (moderation), Modmail (shared staff inbox), Apollo (calendar and reminders). [V] [template](https://github.com/campus-experts/discord-hackathon-template)
- Discord features organizers lean on: Community Onboarding (default channels plus questions that hand out roles; Discord says it can replace bot verification, which "can confuse newer members") [U]; announcement channels that other servers can **follow**, with a Publish button that copies a post into every following server, where `@everyone` doesn't carry over [U] (official article returned 403 to me); forum channels for Q&A threads [U].

**Around the chat tool.**
- **Registration and submission**: Devpost (asks solo vs team; teammates are added at submission) [U]; ETHGlobal's own Hacker Dashboard, where you join a team with a token from the team leader [V]; Junction's own platform, where you join a team with a code [U]; Challenge Rocket at HackYeah [V].
- **Info hubs**: Notion pages with the agenda, team assignments, roster, resources, code of conduct and mentor bios [U]; a pinned FAQ document in the help channel [V] [BuilderBase](https://intercom.help/builderbase/en/articles/14831450-hackathon-playbook-ch-13-participant-communication).
- **Live schedule**: ETHGlobal lists feedback sessions and team-formation calls on the event website's schedule and announces them on Discord. [V] [ETHGlobal Cannes start](https://ethglobal.com/events/cannes/info/start)
- **Forms**: mentor shift sign-up [V] [MLH mentorship](https://guide.mlh.com/general-information/mentorship); registration forms (Google Forms, Typeform, Tally) [U].
- **Email** for milestones: 10 days before, 3 days before, 1 day before, and 48 hours after (winners, photos, feedback survey). [V] [BuilderBase](https://intercom.help/builderbase/en/articles/14831450-hackathon-playbook-ch-13-participant-communication)
- **Slack** shows up at company hackathons. Slack's own internal-comms advice: announcement channels read-only, with replies only in threads. [U]. A Slack invite link "is active for 30 days, and can be used by up to 400 people". [V] [Slack help](https://slack.com/help/articles/201330256). On Slack's free plan, only the last 90 days of messages and files are visible. [U]
- A typical event therefore runs 5–7 tools: registration, chat, info hub, forms, email, submission platform, schedule page. [U] (my count from the sources above)

### 1.5 How help desks work

1. **Ping a channel.** A `#mentorship` / `#ask-mentors` channel plus an `@mentor` role. [V] [MLH mentorship](https://guide.mlh.com/general-information/mentorship), [V] [ETHGlobal](https://ethglobal.com/events/cannes/info/start)
2. **Ticket bot in Discord.** Ticket Tool opens a private channel per request. [V] HackKU's "Helper Duck" bot: tickets are visible to all mentors, mentors claim them in a private channel, and general questions go to an `#ask-a-mentor` channel instead. [U]. HackIllinois 2021 used "the queue bot for mentor help". [U]
3. **A dedicated queue app.** HELPq (built for HackMIT, used at several events): students submit a ticket with their problem and location; mentors claim it. Two stated principles: **"Pull, don't push"** ("Mentors should not receive any type of push notifications when tickets are requested") and in-person contact (the app has no messaging). Average response times in its 2015–16 table: 5–10 minutes at most events, but **56 minutes at HackIllinois 2016**. [V] [HELPq README](https://github.com/techx/hackmit-hackq)
4. **A physical desk.** MLH: "Have a help desk / organizer table setup at all times." [V] [MLH help desk](https://guide.mlh.com/general-information/day-of-logistics-and-hacker-experience/help-desk-recommendations)
5. **Tiers and targets.** Volunteers → mentors → event director. Aim for about a 30-minute answer during the event. Answer in public so everyone benefits, and move repeated questions into a pinned FAQ. [V] [BuilderBase](https://intercom.help/builderbase/en/articles/14831450-hackathon-playbook-ch-13-participant-communication)

### 1.6 What goes wrong

Backed by sources:
- **Too little or too much.** "Too little communication leaves participants feeling lost. Too much makes them tune out." Announce in both spoken and written form. Don't interrupt hacking; announce at natural breaks such as meals. Deadline countdowns at 3 h, 1 h, 30 min and 10 min. [V] [BuilderBase](https://intercom.help/builderbase/en/articles/14831450-hackathon-playbook-ch-13-participant-communication)
- **Announcements came too late, or in one place only.** Wikimedia Hackathon 2019 participants asked for sessions and social events to be announced earlier, and for information to go out through several channels, physical boards included. [V] [Wikimedia 2019 lessons learned](https://www.mediawiki.org/wiki/Wikimedia_Hackathon_2019/Lessons_Learned)
- **People don't know whom to ask.** At the same event, finding the right person was hard. Participants wanted "more visibility and clarity about how to reach out to mentors". The help desk was well liked, but one participant wrote "I didn't knew there was one". Late-evening support was thin. [V] (same page)
- **Queues back up.** HELPq's own numbers range from about 5 minutes to 56 minutes average response. [V] [HELPq](https://github.com/techx/hackmit-hackq)
- **Repeated questions.** The fix in the sources is a public answer plus a pinned FAQ. [V] [BuilderBase]. I found no source that counts the repeats (e.g. "40 times"). [U]
- **Pings get through mute.** Discord users report that role mentions still notify after you mute a server. [U] (Discord community feedback thread)
- **Locked out at the door.** Discord's highest verification level requires a verified phone, and temporary numbers are refused. [U] (official article 403'd; search summary). ETHGlobal keeps an email fallback for people who can't reach the event channels. [V]
- **Moderation.** MLH reminds organizers that the code of conduct applies online too, and that "Digital spaces can increase harassment". [V] [MLH communication platform](https://guide.mlh.com/general-information/event-logistics/hackathon-communication-platform)

My inference (no direct source):
- **Tool sprawl** (5–7 tools, see 1.4) means links and files end up scattered: Discord scrollback, personal Drives, GitHub, the submission platform. [U]
- **Work outlives the tool.** On Slack's free plan, messages older than 90 days are hidden [U]. Discord servers are usually abandoned after the event. Teams lose the conversation that explains their project. [U]
- **Phones matter at the venue.** People walk around (food, workshops, sleep) and read announcements on their phones. Discord's mobile app covers this. [U]

---

## Part 2: What a Moduo hackathon needs from Chat

### 2.0 Where Moduo stands today [repo]

These facts constrain every option below. All were read in the repo on 2026-10-13.

- **Chat is per workspace.** The gate is the **workspace owner's** plan at Duo or above (Duo, Team, Founder). Members inherit it. There are no cross-workspace channels and no guest accounts. → `specs/chat.md`
- **Announcement mode exists.** Channels have a `managers_only` flag ("Only managers can post"), switched by a channel manager through `share_op_announce`. → `supabase/migrations/20261006210000_perm_sharing.sql`, `src/features/chat/ui/chat-dialogs.tsx`
- **Not in Chat v1:** file attachments, link previews, scheduled messages, forwarding, guest accounts, voice and video (calls are the separate Moduo Meet track). → `specs/chat.md`
- **Quiet notifications:** only @you, @channel and replies in your threads notify. Each conversation can be set to Every message / Mentions only / Mute. → `specs/chat.md`
- **Apps can post.** An API key with chat scope can post into public channels (`chat_post`), shown with an "App" badge. A schedule-reminder bot could use this. → `specs/chat.md`
- **Links to work exist.** Typing `#` links a task, note, contact or event as a live chip; "Create task from message" exists. → `specs/chat.md`
- **The bell is per workspace.** The notification center reads the selected workspace (`src/components/notification-center.tsx`, `selectedWorkspaceId`). So a post in workspace X doesn't reach you while you work in workspace Y. (Quick read; not traced end to end.)
- **Seats:** Free and Pro 1, Duo 2, Team = paid seats (minimum 3), Founder unlimited. → `supabase/migrations/20261006121000_plan_seat_limits.sql`
- **Free users can *own* one workspace** (`free_users_max_one_workspace` is a policy on creating workspaces). **Membership isn't capped by this policy**, so a Free participant could belong to an event workspace and a team workspace. → `supabase/migrations/20260512130000_fix_rls_profiles_workspaces_recursion.sql`
- **The automatic trial is Pro** (`start-trial` uses `pro_monthly`): 1 seat, no chat. One trial per Stripe customer, ever. → `supabase/functions/start-trial/index.ts`, `docs/decisions/billing.md`
- **Invite-only sign-up.** An address can create an account only if its waitlist row is invited, it has a **pending, unexpired workspace invite**, or it is a founder address. So an emailed workspace invite also unlocks sign-up. A shared join link isn't an allow source. → `docs/decisions/product.md` (TX-4)
- **Invites are per email.** If someone forwards an invite link, the recipient gets a mismatch message and must be invited themselves. → `specs/transactional-email.md`
- **Comp grants (`plan_grants`) don't exist yet.** They come with TX-9b. → `docs/decisions/product.md` (TX-4)
- **"Teams" in Tasks v3 (TV-D13) are groups inside a workspace** used for routing, marks, filters and `@Team`. They are not private spaces. In Tasks, "privacy lives on projects": a project is shared with the workspace or kept to chosen people (`.design/tasks-v3/REPLAN.md`, "Where privacy lives"). Elsewhere, `specs/permissions.md` describes notes as workspace-readable by default. So in one shared workspace, privacy between teams would have to be set container by container.
- **Desktop only.** Mobile and tablet layouts are out of scope (minimum window 1024×700). → `AGENTS.md`
- **English only.** I found no i18n library in `src/`.

### 2.1 What Chat must do, whatever the structure

Each item: the need, what exists today, and the gap. Wording is product-level. "Candidate" means a suggestion from this research, not a decision.

**1. Announcements every team sees, without noise**
- *Need:* organizers post once and every participant gets it. Posts come rarely (at breaks, plus deadline countdowns), are pinned, and are easy to find later. Organizers can tell who hasn't seen it.
- *Today:* announcement channels exist (`managers_only`). `@channel` notifies.
- *Gaps:*
  - People who set the channel to "Mentions only" or Mute might miss it. Candidate: an announcement level that always notifies once and never repeats, and that people can't mute during the event.
  - No "seen by N of M" count for the organizer.
  - No scheduled posts, so the 3 h / 1 h / 30 min / 10 min countdowns are manual. The API-key app could post them.
  - Across workspaces, the bell doesn't carry a post (see 2.0).

**2. A help desk with answers others can see**
- *Need:* a participant asks the organizers or mentors and sees that someone is on it. Mentors pick from a queue instead of being pinged ("pull, don't push", HELPq). Organizers see every open request in one place. Good answers become a FAQ.
- *Today:* channels, threads, pins and search exist. "Create task from message" plus Tasks v3's single assignee and claims could act as the queue.
- *Candidate:* a help channel where each request is a thread with a state (open → someone's on it → answered), claimed by a mentor, shown to the asker, with an "Add to FAQ" step that collects answers in a pinned note.
- *Open question:* public by default (others learn; matches BuilderBase's "answer publicly") vs "only organizers see this" for team-specific code questions. Teams compete, so a private option is likely needed.

**3. Team chat inside the team's space**
- *Need:* the team talks next to its tasks and notes and links them with one gesture.
- *Today:* channels, DMs, threads and `#` entity links exist.
- *Gaps:* no file sharing in chat (teams swap screenshots and files all the time); no voice.
  - On site, voice matters less. Online, it matters a lot: it is MLH's stated reason for choosing Discord.
  - File workaround: task attachments, or links.

**4. Finding a team**
- *Need:* solo hackers find a team before or at the start. Every large event has a channel for this (MLH, ETHGlobal).
- *Today:* any public channel can serve. It only needs to sit in the shared space, before teams exist.

**5. Schedule**
- *Need:* one place for the agenda, plus reminders.
- *Today:* Calendar is out for the hackathon. Candidate: a pinned schedule note in the announcements channel; reminders from the API-key app or from scheduled posts (not built).

**6. Getting dozens to hundreds of people in, fast**
- *Need:* people join from something they already have (an email from registration) and land in the right channels with the right role.
- *Today:* invites go one email at a time. A pending invite passes the invite-only gate. No join link exists.
- *Gap for the readiness plan:* a bulk invite from the registration list (CSV or paste) fits the gate without a join link. An open link (Slack's lasts 30 days and serves up to 400 people) would need a new allow source. Chat's part: an invited person lands in the right channels already (announcements, help, their team) with roles (participant / mentor / judge / sponsor / organizer) set by the invite, with no reaction-role setup and no phone checks.

**7. Moderation**
- *Need:* the code of conduct pinned; organizers can remove a message or a person fast; a way to report.
- *Today:* admins can delete anyone's message (assumption 7 in `specs/chat.md`). No report flow.
- *Gaps:* no report flow. Also, possibly no way to stop DMs to judges (the Discord template's judge rule).

**8. After the event**
- *Need:* the team keeps its conversation next to its work. The 90-day disappearance that Slack's free plan causes (see 1.4) should not happen.
- *Open:* what Chat shows when the plan gate closes. Candidate: history stays readable, posting locks, and the owner sees "continue on Duo/Team". Export of chat isn't specified anywhere I found.

**9. Phones at the venue**
- Moduo is desktop only. People at the venue read announcements on their phones. Candidate for the readiness plan: send announcements by email or web push too, or make one read-only mobile web view of the announcements channel. Flag, not a Chat decision.

### 2.2 Structural options (inputs for `specs/hackathon.md`)

**(A) One workspace for the whole hackathon; each team is a Team with private spaces**
- *Participants:* one workspace, one bell. They also see a big member list, big pickers and big search results (hundreds of people), unless the sidebar hides other teams' channels by default.
- *Organizers:* the least effort for chat. One announcements channel, one help desk, one member list, one place to see everything. But every team needs private containers (channels, notes, task projects) set up and kept right.
- *Privacy between teams:* the weak point. Teams compete. Moduo's sharing defaults to workspace-wide (`specs/permissions.md`), and TV-D13 Teams are routing groups, not walls. One wrong default leaks a team's idea to the others. Precedent: Notion keeps hidden private teamspaces for its Enterprise plan only ("Only members or owners can add other people to a private teamspace"). [V] [Notion help](https://www.notion.com/help/guides/teamspaces-give-teams-home-for-important-work)
- *Scale:* ~20 teams (~60–100 people) is fine. ~100 teams (~300–500 people) strains @channel, pickers, search and realtime in one workspace, and needs that many seats.
- *Fit with teams of 2–5:* poor. It turns Moduo into a big-organisation tool.
- *After the event:* hard. Each team's work sits inside the organizer's workspace and would need splitting or export per team.
- *Reuse beyond hackathons:* classes or bootcamps run as one org with groups. But that is exactly the big-org shape Moduo doesn't target.

**(B) One workspace per team; organizers are in every team workspace; announcements fanned out**
- *Participants:* the best fit. Their workspace is just their team, the shape Moduo is built for. Announcements arrive in their own `#announcements` channel.
- *Organizers:* heavy without new tools.
  - To post, they need "send to all event workspaces".
  - To answer, they need one help inbox across N workspaces. Otherwise they switch workspaces N times.
  - Past about 10 teams this is unworkable by hand.
  - Organizers and mentors also take seats in every workspace (e.g. 4 hackers + 2 organizers + 4 mentors = 10 seats per team).
- *Privacy:* strong by default (the workspace is the wall). Organizers see every team, which is normal at hackathons.
- *Help desk:* questions live inside each team's workspace, so other teams never see the answers. The FAQ needs a separate published place.
- *Scale:* 20 or 100 workspaces from a template (the readiness plan owns template → N workspaces).
- *After the event:* natural. The team keeps its workspace and the organizers leave.
- *Reuse:* high. Agencies with a workspace per client, accelerators with portfolio companies, and teachers with project groups would all want "post to all my workspaces" and "one inbox across my workspaces". People outside the hackathon would want this.
- *Precedents:* Discord's followable announcement channels (publish once, copied into following servers) [U]; Slack Enterprise Grid's organisation-wide default channels across workspaces [U].

**(C) Hybrid: one shared "event" workspace plus one workspace per team**
- *What goes where:* the event workspace holds announcements, help desk, FAQ, schedule, team finding and sponsor channels. Each team workspace holds the team's chat, tasks and notes.
- *Participants:* two workspaces. The risk is missing an event announcement while working in the team workspace, because the bell is per workspace today. Chat would need event announcements to reach people in any workspace (a cross-workspace bell, or a mirror in the team workspace).
- *Organizers:* one place to broadcast and one help desk, with public Q&A and a FAQ that every team can read. They don't have to join team workspaces, which saves seats and is more private. Judges could get read-only access at the end; the readiness plan owns that.
- *Privacy:* good. Public Q&A in the event workspace, private work in the team workspace. A team-specific question can still go to a private thread or DM in the event workspace.
- *Scale:* the event workspace is big but mostly read (all participants, mentors and sponsors in one place, similar to a Discord server). Team workspaces stay at 2–6 people.
- *Fit:* team workspaces fit 2–5 perfectly. The event workspace is a "community" shape Moduo doesn't target, but it is a simple one: a few channels, mostly announcements and help.
- *Plan rules:* a Free participant can be a member of both (the Free cap is on owning). Who owns the team workspaces decides who pays for chat there (see 2.3).
- *Reuse:* cohort plus project groups (bootcamps, courses, accelerators); conferences or communities whose members also run their own small-team workspaces.

**(D) What else I found**
- **D1: Linked event channels.** This is (B) with one new primitive: organizers post in their own workspace, and every linked team workspace shows the channel read-only ("Event · Announcements"). Help requests a team sends go back to one organizer queue; a request is visible to that team and the organizers, and to everyone once it is promoted to the FAQ.
  - Participants live in one workspace and organizers in one queue.
  - It's the Discord follow/publish model done natively.
  - Reusable for agencies and teachers (client workspaces subscribe to an agency's updates channel).
  - Cost: Moduo has no cross-workspace anything today, and `specs/permissions.md` lists "cross-workspace sharing" as out of scope.
- **D2: Announcements stay off Moduo.** Event-wide announcements and help stay in the organizers' existing Discord or email; Moduo serves only the team workspaces (B without fan-out).
  - Cheapest, and an honest fallback if the date is close or participants already live in a Discord.
  - Weakest brand moment, and the tool sprawl stays.

**Summary**

| | A: one workspace | B: per team, fan-out | C: event + per team | D1: linked channels |
| --- | --- | --- | --- | --- |
| Participant | one place, crowded | cleanest | two places, risk of missing posts | cleanest |
| Organizer effort | lowest for chat, highest for permissions | highest without new tools | low | low, after the build |
| Privacy between teams | weakest | strong | strong | strong |
| 20 → 100 teams | 100 strains one workspace | 100 needs fan-out + one inbox | scales | scales |
| Fit with 2–5 | poor | best | good | best |
| Reuse beyond events | low (big-org shape) | high (agencies, teachers) | medium–high (cohorts) | high |
| New Chat work | private channels per team, defaults | broadcast to N, one inbox across N | cross-workspace announcement reach | cross-workspace channels (new primitive) |

**Agent's lean (an input, not a decision):** C for a first event. Then promote its two pieces (cross-workspace announcement reach, plus one help queue across workspaces) toward D1 if they prove useful, because agencies and teachers would want the same thing. A is the worst match for a product built for 2–5 people and puts the competing teams' privacy at risk.

### 2.3 The plan gate (options for the readiness plan, listed neutrally)

Facts [repo]:
- Chat unlocks on the **owner's** plan at Duo or above.
- Duo has 2 seats. Team has paid seats (minimum 3). Founder is unlimited.
- The automatic trial is Pro (no chat, 1 seat) and can be used once per customer.
- `plan_grants` arrives with TX-9b.

1. **Organizers own every event workspace on a comped plan** (a founder-level or Team grant on the organizer account).
   - For: members inherit chat; no new billing product.
   - Against: after the event, a team that wants to keep its workspace needs an ownership transfer, and then the new owner's plan applies. It also uses the founder path, which isn't a product answer.
2. **A time-limited event grant on the workspace** (chat plus N seats until a date, with a grace period).
   - For: clean, and it ends by itself; reusable for classes and bootcamps.
   - Against: needs `plan_grants` (TX-9b), and needs a rule for what happens at expiry (see 2.1, item 8).
3. **An "Event" plan** (a new SKU, flat or per participant, bought by the organizer).
   - For: a revenue path, and organizers outside Moduo could use it.
   - Against: Stripe products, pricing and a policy to work out. Probably too much for a first event.
4. **A Team-level trial for invited participants** instead of the Pro trial.
   - For: it reuses the trial machinery and leads straight to conversion.
   - Against: it uses up the person's one lifetime trial on the event, and each team owner would have to start one.
5. **Chat ungated in workspaces flagged as event workspaces.**
   - For: the simplest to build.
   - Against: a loophole unless the flag can only be set by Moduo staff and expires.

Agent note: options 1 and 2 keep participants away from billing during the event, which matters for the first impression. Which one is the readiness plan's call.

### 2.4 MVP cut (Chat's share)

**Must have for a credible event**
1. A way in with no friction: bulk invite from the registration list; invited people land in the right channels with the right role. (The readiness plan owns the invite; Chat owns where people land.)
2. Announcements: a managers-only channel (exists), posts that reach everyone once even with "Mentions only" set, pinned, and readable later. In C, event announcements must reach people working in their team workspace.
3. A help desk: a help channel with request state (open / someone's on it / answered), mentors claiming from a queue, every open request in one organizer view, and answers collected into a pinned FAQ.
4. Team chat with `#` links to tasks and notes (exists).
5. A team-finding channel in the shared space (any public channel works).
6. Roles that show on messages: organizer, mentor, judge, sponsor, participant.
7. Moderation basics: delete any message (exists), remove a person, the code of conduct pinned.
8. The plan gate solved for event workspaces (2.3).

**Can wait**
- Voice or huddles (less important on site; a real gap online).
- File attachments in chat (links and task attachments meanwhile).
- Scheduled posts (post by hand or through the API-key app).
- Link previews, polls, custom emoji.
- A sponsor booth feature.
- Judging and submission inside Moduo (keep Devpost or similar).
- "Seen by N of M" counts.
- A mobile view (big for on-site, but owned by the readiness plan).

**What would make participants say "better than Discord"** (candidates):
- **Everything in one place.** Info is a note, milestones are tasks, chat sits next to them. No hunt across 5–7 tools for the schedule, the FAQ and the team doc.
- **Announcements that don't ping all day,** come at breaks, and can't be missed.
- **Help requests that don't vanish.** You see "a mentor is on it". Mentors work a queue, not a ping storm. Answered questions become the FAQ, so nobody asks the 40th time.
- **Chat that links to the work:** `#` a task or note, or turn a message into a task.
- **No setup chores:** you join from the email you registered with and land in your team. No reaction roles, no phone verification, no bots.
- **The team's workspace survives the event,** with the conversation next to the project. Nothing hidden after 90 days.

### 2.5 Questions for the founder (each with why it matters)

1. **When is it?** This sets what can be built in time, and whether D2 (keep the event layer off Moduo) is the honest option.
2. **How many teams, and how many people per team?** 20 teams vs 100 changes which structure works (2.2) and how many seats and workspaces we need.
3. **On site, online, or both?** Online makes voice and calls a must. On site makes phones (announcements on the move) and a physical help desk matter more.
4. **Who are the organizers (company, university, community), and what is Moduo's role (tool partner, sponsor, co-organizer)?** This decides who owns the workspaces, who posts announcements, and how much Moduo branding is allowed.
5. **Do participants already live in the organizers' Discord? Does the organizer insist on it?** If yes, Moduo competes with a habit. D2 or "Discord for the crowd, Moduo for the team" may be the realistic first step.
6. **Polish, English, or both?** The Moduo UI is English only. Announcements and FAQ may need both languages.
7. **Where do participant emails come from (registration form, eventory, Devpost), and is there consent to invite them?** Bulk invites are the only way past the invite-only gate. GDPR consent and the privacy policy apply.
8. **Are teams formed before the event, or on the day (and can people switch, like HackYeah allows)?** Pre-formed teams allow pre-made team workspaces. Teams formed on the day need "create my team workspace" self-serve, plus a team-finding channel.
9. **How do judging and submission work, and do judges need to see team workspaces?** This decides judge access and the privacy promise to teams.
10. **How many mentors, on site or remote?** This sizes the help desk and decides whether a queue is needed or a channel is enough.
11. **Are there prizes, so teams compete?** If yes, privacy between teams is a hard requirement, which argues against A.
12. **Age of participants (18+ only, like HackYeah?)** Account terms and the privacy policy may not cover minors.
13. **What happens after the event: do teams keep their workspace, free for how long, and do we want them to convert?** This decides the gate option (2.3) and what Chat shows when it closes.
14. **What counts as success for Moduo:** teams still active after 30 days, feedback collected, brand mentions, bugs found? This decides what to measure (PostHog consent is opt-in) and what to build first.

