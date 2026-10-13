# Tasks module: who it's for and what each group needs (research, 2026-10-09)

> Raw research report, 2026-10-09, kept for its sources. The synthesis and the open calls are in [../RESEARCH-2026-10.md](../RESEARCH-2026-10.md). Nothing here is decided.

**Confidence tags:** **[D]** = survey or study with a stated sample, or a primary pricing/product page · **[A]** = reviews, forum posts, vendor blogs, small polls (anecdote) · **[I]** = my inference.
**Limits:** Reddit was blocked for this crawler, so every "r/… users say" claim below comes second-hand through blogs or mirrors and is tagged [A]. Several "statistics" sites (jobbers.io, speakwise, stealthagents and similar) have weak sourcing. I cite them only as [A] or not at all. Vendor surveys (Hubstaff, Cronofy, Asana, Atlassian) are tagged [D] but have a stake in the answer. The web-search budget ran out before I could check recurring-task pain directly, so that row is mostly [I].

---

## Bottom line

1. **Quiet vs rich isn't really a split between groups. It's a curve that people move along as their team grows.** Users leave minimal tools when *collaboration basics* are missing: who's on what, a waiting state, comments, shared templates, a safe way to show a client. They don't leave for dashboards. Users leave rich tools because of overwhelm and upkeep. Moduo's scope (solo to 5 people) sits *below* the point where reporting and portfolio views become must-haves. **[I, grounded in the evidence in §4]**
2. **Much of the founder's worry is already answered by `specs/tasks-v2.md`.** Single assignee, claims, a personal Queue, live updates, time entries, board, filters and saved views cover most of what 2–5-person teams need. **[I]**
3. **The real gaps are four "client-work" basics plus one spine feature:**
   - a durable **Waiting-on / In-review** state (today `TASK_STATUSES` = todo · in_progress · done · archived; "In flight" exists only inside a Focus run);
   - **task → client link with rollup**;
   - **checklist templates** for repeatable work;
   - **time rolled up by client**;
   - a **no-login status link** to show clients.
4. **The evidence favours templates, views and density presets. It argues against optional feature "packs".** **[A/I]**
5. **ADHD is a design lens, not a segment.** It's present in every segment at roughly population rates or a little above. Evidence says ADHD users do *better* when a tool shows other people (shared, relational visibility), so team features don't conflict with the quiet-planner origin. **[D/I]**

---

## 1. Segment profiles

### 1a. Freelance designers, developers and writers

- **Size:** 28% of US knowledge workers (20M+) work independently [D, [Upwork 2025](https://investors.upwork.com/news-releases/news-release-details/upwork-study-finds-1-4-us-skilled-knowledge-workers-now-work)]. MBO counts 72.9M US independents, 27.6M of them full-time [D, [MBO 2025](https://www.mbopartners.com/state-of-independence)].
- **Jobs to be done:** ship client deliverables on time; handle revision rounds; know what's waiting on the client; turn hours into invoices; answer "where are we?" without a meeting.
- **Must-haves:**
  - projects grouped by client;
  - due dates and reminders;
  - subtasks and checklists;
  - a **Waiting on client** state;
  - a timer that rolls up per client.
- **Nice-to-haves:** a client-visible status page; revision counters; a board view.
- **Why they abandon a tool:** it can't be shown to clients, or clients won't log in; time tracking lives in another app; the solo-only tool breaks once they bring in a subcontractor.
  - Things 3 has no sharing at all, and reviewers describe freelancers dropping it once they partner up [A, [DPM review](https://thedigitalprojectmanager.com/nl/tools/things-3-recensie/)].
  - Todoist's own marketing says Pro is "built for solo workflows". It names client sharing ("they see your whole workspace") and the lack of team-activity visibility as reasons to upgrade [D-vendor, [Todoist](https://www.todoist.com/inspiration/todoist-team)].
- **Billable time leaks** (both [A], self-published platform data from [Jobbers](https://www.jobbers.io/how-much-time-do-freelancers-waste-weekly-data-from-5000-jobbers-io-users/)):
  - freelancers spend about 38% of the week on non-billable work;
  - they bill about 65% of the hours they work.
- **Density preference:** a calm list by default; a board for pipeline-style work. **[I]**
- **Collaboration:** mostly with clients (one-way status plus approvals), sometimes with a subcontractor.
- **Willingness to pay:** high for things tied to revenue. Tool spend is reported at $150–400/month [A, low provenance]. Basecamp now sells a $25/month flat "Freelancer" plan [D, [Basecamp pricing](https://basecamp.com/pricing)].
- **Tools today:** Notion, Trello, Asana, ClickUp, Todoist, plus Toggl/Harvest, plus Bonsai/HoneyBook/Dubsado for contracts and invoices.
  - HoneyBook and Dubsado project management is described as a "flat checklist" with no time tracking, so users rebuild projects in a second tool [A, competitor comparison, [Plutio](https://www.plutio.com/compare/honeybook-vs-dubsado)].

### 1b. Consultants, coaches and solopreneurs

- **Jobs to be done:** move leads to clients; follow up after calls and emails; run recurring admin (invoicing, content, reporting); follow repeatable procedures (client onboarding, session prep).
- **Must-haves:**
  - recurring tasks;
  - **checklist templates with relative dates**;
  - follow-up reminders tied to a contact;
  - meeting → action items.
- **Nice-to-haves:** a pipeline board; a simple client share.
- **Why they abandon a tool:**
  - the system needs upkeep, like the "Notion is a second job" pattern. The [Fabric blog](https://fabric.so/blog/notion-is-a-second-job) is a competitor-written source;
  - follow-ups get lost between the inbox and the task app.
- **Supporting data:**
  - 52% of respondents say unclear follow-up actions are the top reason meetings fail [D-vendor, methodology not disclosed, [Cronofy 2026](https://www.cronofy.com/meeting-efficiency-report-2026)];
  - email has long served as a task manager, and it fails worst for tasks that depend on *other people* [D, academic, [Bellotti et al., CHI 2003](https://faculty.cc.gatech.edu/~beki/j9.pdf)].
- **Density preference:** calm. **[I]**
- **Collaboration:** with clients and the occasional virtual assistant.
- **Willingness to pay:** medium–high. They already pay for HoneyBook, Dubsado or a CRM. **[I]**
- **Tools today:** HoneyBook/Dubsado or a light CRM, Calendly, a notes app, and Todoist or Notion for tasks. **[A/I]**

### 1c. Small agencies and studios (2–5 people)

- **Jobs to be done:** see several clients × projects at once; know who has capacity; hand work between people; run review and approval steps; capture billable time; stop scope creep.
- **Pain points** [D-vendor, [Hubstaff State of Agencies](https://hubstaff.com/workforce-management/state-of-agencies), sample size not stated]:
  - 53% name time tracking as a top operational challenge;
  - 26% struggle to get status updates from teammates;
  - 25% struggle to estimate hours;
  - 21.5% of billable hours go unrecorded;
  - 46% outsource work, and 75% of those outsource to freelancers. So *outside contributors* are normal in this segment.
- **Scope creep:** 63% of agencies say it hurts profitability [D-vendor, SoDA, cited via [Teamwork](https://www.teamwork.com/glossary/scope-creep/)].
- **Must-haves:**
  - assignee and a who's-on-what view;
  - **In review / Waiting on client** states;
  - templates per deliverable type;
  - time per client;
  - a view across all projects.
- **Nice-to-haves:** a workload view; guest/client access; a simple hours-by-client report.
- **Why they abandon a tool:**
  - per-seat minimums: Monday's 3-seat floor costs $27–36/month and gets loud complaints [A, [Activepieces](https://www.activepieces.com/blog/monday-com-pricing-2026-plans-costs-automation-limits)];
  - the overwhelm of feature-heavy tools [A, ClickUp reviews on [Capterra](https://www.capterra.com/p/158833/ClickUp/reviews/)];
  - missing billing features: Basecamp users run Toggl or Harvest alongside it [A].
- **Density preference:** denser. A board plus a table-like list helps them. **[I]**
- **Collaboration:** with the internal team, with clients (commenting and approving) and with contractors.
- **Willingness to pay:** highest per workspace. Basecamp's $59/month flat Studio plan has unlimited users, so clients and contractors add no cost. That shows what flat team pricing is worth to this group [D, pricing page].
- **Tools today:** in Hubstaff's base, Trello 17%, Asana 15%, Basecamp 12% [D-vendor].

### 1d. Indie hackers and small software teams

- **Jobs to be done:** triage bugs vs features; link work to Git and pull requests; ship in short cycles; and now, **hand issues to AI coding agents**.
  - Linear lets teams assign issues to Cursor, Copilot, Codex, Devin and others "the same way you assign issues to teammates" [D-vendor, [Linear changelog](https://linear.app/changelog/2025-08-21-cursor-agent), [Linear agents](https://linear.app/integrations/agents)].
- **Must-haves:** short IDs, a bug/feature type, PR links, an In review state, keyboard speed, agent handoff.
- **Nice-to-haves:** cycles, a roadmap timeline.
- **Why they abandon a tool:** slowness; anything that isn't keyboard-first.
- **Density preference:** **dense** (Linear-level). **[A]**
- **Collaboration:** teammates plus agents.
- **Willingness to pay:** they already pay Linear $10–16 per user per month. Linear's free plan allows unlimited members but only 250 issues [D, [Linear pricing](https://linear.app/pricing)].
- **Moduo's edge:** Moduo should *not* try to beat Linear on dev workflow. Its angle is the founder whose dev tasks sit next to sales emails, investor contacts and notes. **[I]**

### 1e. Creators

- **Size:** Kit's survey of 1,000 creators found 28% self-employed and 18% earning over $100k [D-vendor, [Kit 2024](https://convertkit.com/reports/creator-economy-2024)].
- **Jobs to be done:** move content through idea → draft → edit → publish; run recurring series; track sponsor deliverables; keep a publishing calendar.
- **Must-haves:** a board by stage, a publish calendar, recurring tasks, templates per episode. **Nice-to-haves:** a sponsor link via contacts, a review state.
- **Tools today:** content calendars are one of the most common Notion template types [A, [2sync](https://2sync.com/blog/best-content-calendar-templates-notion)]. That's exactly the "build a database" pattern Moduo refuses to copy. Visual, medium density; willingness to pay is split between hobbyists and professionals. **[I]**

### 1f. Students (free tier)

- **Jobs to be done:** track assignments by course; see exam dates; get warned about crunch weeks; coordinate group projects; pay nothing.
- **Must-haves:**
  - course = project;
  - due dates on a calendar;
  - **getting deadlines in without typing them**.
- **Signal:** apps that import syllabi or Canvas data multiplied in 2025–26 (Deadliner, CourseLink, Syllabot, Dormway) [A, market signal, [Dormway](https://dormway.app/blog/how-to-import-syllabus-to-calendar-automatically-in-2026)].
- **Nice-to-haves:** a shared group-project list; study time blocks.
- **Tools today:**
  - paper and Google Calendar still lead: one campus poll found 52% use paper planners and 25% use Google Calendar [A, small sample];
  - Notion says "millions of students" use it every week and lists about 12,945 School templates [A-vendor, [Notion](https://www.notion.com/blog/back-to-school-notion-now-free-for-student-organizations)].
- **Why they abandon a tool:** setup work; anything that costs money.
- **Density preference:** calm, calendar-first. **[I]**
- **Willingness to pay:** near zero. Their value is the funnel and the habit they carry into work later. The undergraduate stats in popular listicles ("73% lower stress", "23% more on time") couldn't be traced to a primary source, so I've dropped them.

### 1g. Personal life, households and couples

- **Jobs to be done:** shared chores and shopping lists; recurring admin; a fair, visible split of who does what. A survey of about 4,250 UK couples found most disagree about who does what [D-vendor, Starling Bank, via [Scottish Financial News](https://scottishfinancialnews.com/articles/and-finally-clean-sweep)]. Single-purpose "mental load" apps are multiplying [A].
- **Needs:** shared lists, simple recurrence, an assignee; chore rotation is a nice-to-have. Very calm density. Low willingness to pay (Apple Reminders and Google Tasks are free).
- **Fit:** **spillover, not a target segment.** Founder pairs who are also couples will use one workspace for both. **[I]**

### 1h. ADHD and neurodivergent users (across all segments)

- **Prevalence:**
  - 6.0% of US adults (15.5M) report a current ADHD diagnosis, and about half were diagnosed as adults [D, [CDC MMWR 2024](https://cdc.gov/mmwr/volumes/73/wr/pdfs/mm7340-H.pdf)];
  - IPSE: 18% of UK self-employed identify as neurodiverse, and 28% of those report ADHD. That's about **5% of freelancers** [D, n=573, Oct 2024, [IPSE](https://ipse.co.uk/articles/self-employment-neurodiverse-stats)];
  - Stack Overflow 2022: 10.6% of about 70k developers report a "concentration and/or memory disorder (e.g., ADHD)" [D, analysed in [arXiv 2506.03840](https://arxiv.org/pdf/2506.03840)]. That's broader than an ADHD diagnosis;
  - a Swedish twin study (n=7,208) links *hyperactivity* symptoms, not inattention, with self-employment [D, Swedish Twin Registry study, Eur J Epidemiol 2016, [DOI](https://link.springer.com/doi/10.1007/s10654-016-0159-1)].
  - **Honest read:** the evidence that ADHD users are *over-represented* among Moduo's targets is modest. The evidence that they are a loud, tool-switching group in productivity communities is anecdotal but consistent [A].
- **Mainstream proof:** Tiimo, an ADHD-first visual planner, was Apple's iPhone App of the Year 2025 [D, [mjtsai](https://mjtsai.com/blog/2025/12/11/2025-app-store-awards/)].
- **The best qualitative study** (22 interviews plus a 20-person concept test, [arXiv 2603.17258](https://arxiv.org/html/2603.17258v1)) [D, qualitative] found:
  - tools fail "when isolated from relationships". One participant: "If it's only me reminding myself, it just becomes invisible after a few days";
  - tools are abandoned when they add mental load or bring shame;
  - participants preferred a "light fog" image over red overdue lists.
- **What this means for Moduo:** the guilt-free defaults Moduo already has are right. And *visible shared state* ("Mike is on this", claims) actually *helps* this group. **[I]**

---

## 2. Segment × need matrix

M = must · N = nice · — = irrelevant. The ADHD column is a lens that applies across segments.

| Need | Freelancer | Consultant | Agency 2–5 | Indie/dev | Creator | Student | Household | ADHD lens |
|---|---|---|---|---|---|---|---|---|
| Instant capture, bare title | M | M | M | M | M | M | M | M |
| Due dates and reminders | M | M | M | M | M | M | M | M (gentle) |
| Simple recurrence | M | M | N | N | M | N | M | M |
| Subtasks and checklists | M | M | M | N | M | N | N | M (breakdown) |
| Project/area grouping | M | M | M | M | M | M (course) | N | N |
| Task ↔ client/contact link + rollup | M | M | M | — | N (sponsor) | — | — | — |
| **Waiting on / In review state** | M | M | M | M | M | N | — | N |
| Board by stage | N | N | M | M | M | — | — | N |
| Checklist templates for repeat work | N | M | M | N | M | N | N | M |
| Assignee + who's on what | N | — | M | M | N | N (group) | M | N (relational) |
| Comments and @mentions | N | N | M | M | N | N | N | — |
| Time tracking rolled up by client | M | N | M | — | — | — | — | N |
| Workload/capacity view | — | — | M | N | — | N (crunch weeks) | — | N (capacity mirror) |
| View across all projects | N | M | M | N | N | M | — | — |
| Reports (hours by client) | N | N | N→M | — | — | — | — | — |
| Client view or no-login status link | N | N | M | — | N | — | — | — |
| Calendar placement / time-blocking | N | N | N | — | M | M | N | M |
| IDs, PR links, bug/feature type | — | — | — | M | — | — | — | — |
| Hand-off to an AI agent (MCP) | N | N | N | M | N | — | — | N |
| Syllabus/LMS import | — | — | — | — | — | M | — | — |
| Dense keyboard list | N | — | N | M | — | — | — | — (calm default) |
| Focus / single next action | N | N | N | N | N | N | — | M |

(Mostly [I], built from the profile evidence above.)

---

## 3. Common core vs what differs, and how to deliver the differences

### The common core (every segment)

- capture;
- dates and reminders;
- simple recurrence;
- subtasks and checklists;
- projects;
- a Today/Queue view;
- calendar placement;
- search;
- quiet notifications;
- and, once a workspace has 2 or more members, assignee + comments + live updates.

Tasks-v2 already covers almost all of this. **[I]**

### What differs, and the best way to deliver each

| What differs | Who | Best mechanism | Why |
|---|---|---|---|
| Workflow stages (waiting, review) | client work, creators, devs | **A small, fixed set of statuses** (e.g. todo · doing · waiting · review · done · archived), shown through *views*, not per-project custom statuses | Client-service tools ship "Awaiting review / Out to client / Awaiting client" as *standard* columns [A, [Business Fitness](https://support.businessfitness.com/en/support/solutions/articles/5000874951), [SuiteDash](https://help.suitedash.com/article/438-kanban-view)]. It fits AGENTS.md's closed-vocabulary rule. Tasks-v2 explicitly rules out status customization, and a fixed set keeps that. **[I]** |
| Client linkage, time by client, client view | freelancer, consultant, agency | **The spine plus contextual reveal**: client fields appear once a task or project links to a contact | That's where Moduo has a structural lead. A toggle-on "pack" would hide it. **[I]** |
| Repeatable procedures | consultant, agency, creator | **Templates**, as *checklists with relative dates*, shared across the workspace. Never schemas. | Todoist names personal-only templates as a team pain [D-vendor]. Notion templates are database schemas and carry the maintenance tax [A]. |
| Stage-based vs date-based seeing | creators, agencies (board); students (calendar); devs (dense list) | **Views + saved views** over the same data | Tasks-v2 already has List / Board / Timeline, group-by and saved views. Students and creators differ in *view and starter template*, not in data model. **[I]** |
| Density | devs vs ADHD/household | **Density presets** (calm default, Linear-dense at the far end) | Gmail ships Comfortable as default with Compact as an option [A]. Linear shows high density can still read as calm with a strict 4px rhythm and progressive disclosure [A, [925studios](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026)]. This matches the existing memory/brief rule that density is a setting. |
| Optional modules ("packs") | — | **Avoid** | ClickUp lets you switch features on and off, yet reviewers still call it overwhelming "out of the box" [A, Capterra]. Packs split onboarding and multiply the number of combinations to test. **[I]** |

**Underlying theory:** in a 2005 product study, 66% of buyers chose the most feature-loaded model, but after using it, 56% preferred a simpler one [D, [Thompson, Hamilton & Rust](https://msi.org/working-papers/feature-fatigue-when-product-capabilities-become-too-much-of-a-good-thing)]. Applying it to SaaS churn is my inference [I]. It explains why feature-rich tools win the trial and lose daily use. Moduo should be capable *underneath* and quiet *on the surface*.

---

## 4. Quiet vs information-rich: the evidence

### Why people leave minimal tools: missing *collaboration and visibility*, not dashboards

- **Todoist (its own words):** "no central place to see if someone moved a deadline, reassigned a task, or added a comment"; templates stay personal; a client you share with "sees your whole workspace" [D-vendor].
- **Things 3:** no sharing at all, and people abandon it once they form a partnership [A].
- **HoneyBook/Dubsado:** project management is a flat checklist, so users rebuild projects elsewhere while clients email asking for status [A].
- **Trello:** a single board breaks down at about 9 people. Teams move on for cross-board reporting and timelines [A, [Cotera](https://cotera.co/articles/asana-vs-trello-comparison)]. **This is above Moduo's 5-person ceiling.**
- **Agencies:** 26% can't get status updates and 53% struggle with time tracking [D-vendor]. These are *visibility* failures, and capture-level fixes (claims, timers) solve them without dashboards.

### Why people leave rich tools: clutter and upkeep

- **ClickUp:** reviews repeatedly call it "overwhelming". One solo founder moved to "a smaller, more simple" tool [A, Capterra].
- **Notion:** setups built in a weekend need constant property upkeep, and the pattern of a showcase followed by abandonment a month later is common [A, mostly competitor-written].
- **Feature fatigue** (above) [D→I].

### The reconciliation

What these groups want is a **calm surface with honest state**: each row shows *who*, *waiting on what* and *when* in one quiet meta line. Rows shouldn't show more fields. Reporting is a real must-have only for agencies, and for them it's narrow: **hours by client/project** and "what's late". Generic dashboards aren't the need. **[I]**

---

## 5. Top 10 unmet needs Moduo can uniquely meet (because email, contacts, notes and calendar are in the same app)

1. **Client hub rollup.** A contact or company page shows all its tasks, emails, notes, meetings and time, with no manual logging. *Evidence:*
   - a quarter of respondents spend about 25% of their work week searching for information, and "difficulty finding information" is the #1 barrier to moving fast [D-vendor, n=12,000, [Atlassian 2025](https://unleash.ai/artificial-intelligence/news/atlassian-ai-could-help-workers-stop-wasting-2-4-billion-hours-searching-for-information-every-year)];
   - HoneyBook users rebuild projects in other tools [A].
2. **Email → task with "Waiting on reply"** that resolves itself when the reply arrives, and resurfaces after N days with no answer. *Evidence:* Bellotti 2003, where tasks involving others were the hardest case in email [D].
3. **Meeting note → owned, dated tasks**, linked back to the event and the contacts who attended. *Evidence:* 52% cite unclear follow-ups [D-vendor].
4. **Timer → client rollup → invoice-ready export**, plus "added after kickoff" marks so scope creep becomes visible. *Evidence:*
   - Hubstaff: 53% and 21.5% figures above [D-vendor];
   - SoDA: 63% hit by scope creep [D-vendor];
   - freelancers bill about 65% of hours worked [A].
5. **Ambient "who's on what" without status meetings.** Claims, "X is on this" and an activity feed per client. *Evidence:*
   - 26% of agencies can't get updates [D-vendor];
   - Todoist's "no visibility into team activity" [D-vendor];
   - the ADHD study's finding that relational accountability helps [D-qual].
6. **No-login client status link and approve/request-changes**, scoped to one project. *Evidence:*
   - Basecamp has no per-user fees from the Studio plan up, so clients cost nothing extra [D, pricing];
   - several no-login portal startups pitch exactly "clients won't log in" [A, e.g. [ClearProgress](https://www.producthunt.com/products/clearprogress)];
   - Todoist's "client sees your whole workspace" leak [D-vendor].
7. **Shared checklist templates with relative dates** (client onboarding, monthly report, podcast episode, course setup), spawned from a contact, a project or on a recurrence. *Evidence:* Todoist personal-templates pain [D-vendor]; Notion maintenance tax [A].
8. **Follow-up resurfacing tied to people.** "Haven't heard from Anna in 14 days" comes from the contact and email graph, not from a manual reminder. *Evidence:* Bellotti [D]; the brief's own CRM-upkeep finding [I].
9. **Hand-off to AI agents through MCP, in the same "In flight" state** as human hand-offs, with a PR or other link back. *Evidence:* Linear's agent delegation is now standard in dev teams [D-vendor]. Moduo's MCP-only stance fits this. **[I]**
10. **Deadline import + commit to calendar.** Paste a syllabus, client brief or contract → dated tasks → time blocks with done/push when each block ends. *Evidence:*
    - syllabus-import apps multiplying [A];
    - the brief's "schedule-to-completion" gap [I];
    - ADHD users' "time as rhythm" design direction [D-qual].

---

## 6. What this means for the Tasks module (no new routes, no IA change)

- **Add `waiting` and `review` to `TASK_STATUSES`** (contract + Postgres CHECK). This fits tasks-v2's "Linear-light, no workflow-status customization" ceiling, because it's a fixed vocabulary, not customization. But it widens a spec that's still waiting for approval, so **it's a designer call**. `waiting` optionally carries *on whom or what*: a contact, an email thread or an agent. That lets the Focus "In flight" concept show up on rows, the board and the client hub, instead of living only inside a run. **[I]**
- **Client link on project/bucket and task**, using the existing spine links. Time totals then group by client automatically. **[I]**
- **Workspace checklist templates** (relative due offsets), started from capture, a contact or a recurrence. **[I]**
- **Density preset at "Linear-dense"**, plus a board grouped by status, for dev/agency workspaces. Calm stays the default. **[I]**
- **Later, the share link:** a read-only project status page plus approve/request-changes. It's a sharing feature, not a route in the app. **[I]**
- **Keep household and students cheap:** shared lists + recurrence; course templates + calendar import. Build no special data model for them. **[I]**
