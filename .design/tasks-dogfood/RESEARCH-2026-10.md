# Tasks — research round: who it's for, what to show, what to add

> **Status: research and proposals. Calls 1–8, 11 and 12 were answered on 2026-10-09 (marked under each); 9 and 10 are open.** A deeper re-plan (structure, views, visuals, roles) started the same day: [../tasks-v3/REPLAN.md](../tasks-v3/REPLAN.md). [`specs/tasks-v2.md`](../../specs/tasks-v2.md) stays the source of truth until Maciej answers the ❓ calls in §7. Answered calls go to `/s1`, which updates the spec, BUILD_ORDER and `docs/decisions/tasks.md`.
>
> _2026-10-09 · five research lanes run in parallel (competitors, ADHD and productivity science, AI agents and MCP, audience segments, a code inventory) plus a live click-through of [gr8r](https://gr8r-taskmanagement.vercel.app/). Raw reports with every source: [`research-2026-10/`](./research-2026-10/). Based on `maciej` @ `95d988b0`._

## TL;DR

1. **"Quiet vs information-rich" is the wrong axis.**
   - The evidence separates three kinds of load:
     - *relevant* information helps, or at worst is neutral, including for ADHD;
     - *irrelevant* chrome hurts, and hurts ADHD users more;
     - *emotional* load (red walls, debt-framed counts, broken streaks) hurts a group with large emotion dysregulation.
   - So "quiet" should mean **low visual weight and no alarm**, not fewer facts.
   - The complaints that drive people to switch tools point the same way. People leave minimal tools because they can't see who's on what or what's waiting. They leave rich tools because of setup work and the sheer number of features, not because rows are dense.
2. **The module isn't wrong for most groups.** Tasks v2 already covers most of what 1–5-person teams need. The real gaps:
   - a lasting **"waiting on…"** state;
   - a **task ↔ client** loop;
   - **checklist templates** for repeat work;
   - a **denser display option** for people who want it.
3. **Task handles are worth doing, but not as `TB-001`.**
   - A bucket prefix changes whenever a task moves. In Moduo every captured task starts in Inbox and moves at triage, so most tasks would be renamed once.
   - Use one **workspace-wide, permanent number** instead (`MOD-142`): no zero-padding, free on every plan.
   - Agents benefit too. Anthropic's tool-design guidance says swapping UUIDs for meaningful IDs "significantly improves" precision.
4. **The biggest agent gap is basic: an AI can't create or edit a task through Moduo's MCP today.**
   - It can queue, reschedule, assign and set status, but not capture, rename, describe or add subtasks.
   - Every agent use case people actually use (meeting notes → tasks, email → tasks, syllabus → tasks, "break this down") starts with creating tasks.
5. **Agents should be delegates, not assignees.**
   - Linear, GitHub and Jira all converged on this: a named human stays accountable and the agent's work is a visible, separate session.
   - Moduo's planned "In flight" is already that shape. It only needs to live outside a Focus run so agents can write to it.
6. **Segments differ in views, templates and display presets, not in data model or feature "packs".** ClickUp proves that switchable feature packs still read as overwhelming.
7. **gr8r is a seeded UI demo, not a product with users.**
   - Treat it as a pattern reference, not market evidence.
   - Worth taking: ⌘K resolving handles, a column-header table mode, a project overview page, workload per person.
   - Not for Moduo's scale: teams, a role matrix, portfolio "at risk" alarms.

---

## 0. How to read this

**Evidence tags**, shared by all five lanes:

| Tag | Meaning |
| --- | --- |
| **Strong** | Meta-analysis or several RCTs |
| **Moderate** | Several studies, or one solid multi-study paper |
| **Weak** | One small study, qualitative work, or extrapolated from another population |
| **Folk** | Popular claim, never tested |
| **[V]** | Read in official docs this session |
| **[F]** | User forum |
| **[I]** | Inference |

Vendor surveys (Hubstaff, Atlassian, Cronofy) have a stake in their findings and are marked as such.

**Limits:**
- Every lane hit the shared search cap, so some claims are from memory (marked † in the raw reports).
- Reddit was unreachable; "Reddit users say" claims are second-hand.
- No study directly compares a sparse with a dense task list for ADHD adults. §1 is an inference from adjacent evidence, and it says so.

**Where Tasks stands today (`maciej`, 2026-10-09):**
- **Landed:** TV-Q1, TV-F1, TV-D1–D4, TV-T1, TV-U1, TV-U3, AT-1, DS-1–4.
- **Open:** TV-D5, TV-F2–F5, TV-U2, TV-U4–U8, AT-2/3, DS-5, GR-0, TV-D7.
- **MCP-1** is still open, and task creation sits inside it.
- **Statuses are fixed:** `todo · in_progress · done · archived` (a contract + CHECK).
- The spec rules out "workflow-status customization, cycles, estimates-as-points" (`tasks-v2.md` §Out of scope).

---

## 1. The headline: complete but calm

| Finding | Strength | What it means for Tasks |
| --- | --- | --- |
| Adults with ADHD are more distracted by irrelevant items, but extra *relevant* task load protected them as much as controls (Forster et al. 2014, Lavie's load theory) | Weak–moderate | Task facts aren't the enemy; decoration and visual noise are |
| Search time follows **grouping**, not raw density (Tullis, 520 displays, r = .80 on new ones); clutter is colour/shape variety ("feature congestion", Rosenholtz 2007), not item count | Moderate | Group strongly (Next / Waiting / Later) before hiding fields; keep strong colour for one or two meanings |
| ADHD impairs remembering to act *at a time*; remembering to act *on a cue* is largely spared (Altgassen 2014). Offloading intentions to external tools works (Gilbert 2022) | Moderate | "Out of sight, out of mind" is real (the "object permanence" explanation isn't). What's needed must be visible where you act, so a default that hides it fails this group |
| Defaults stick (d = 0.68 across 58 studies). Most people never customise; heavy users do (Mackay 1991; Page 1996) | Strong / weak–moderate | The default must serve the people who never touch Display. Offering a toggle isn't enough |
| A layered "minimal" interface helps beginners but hides advanced features from them (Findlater & McGrenere 2007) | Moderate | A quiet mode must **show what it hides** (counts, "+3 fields"), on rows as well as in the panel |
| ADHD sensory profiles split both ways: more avoiding *and* more seeking (Bijlenga 2017) | Weak–moderate | No single correct density, so let people choose |
| Users prefer adaptations they control. Static layouts are fastest (Findlater & McGrenere 2004) | Moderate | Named presets the user picks, never automatic adapting |
| Switching complaints: **too sparse after redesigns**. Asana My Tasks cut 18 → 11 visible rows: "designed for somebody who is nearly blind"; ClickUp's "true compact mode" request has been open since 2019. **Too cluttered** complaints are about setup and feature count (ClickUp, Notion, Marvin), not rows | [F] / [S] | Density lost is a churn reason; dense rows aren't |
| Linear's March 2026 refresh lowered visual weight but kept density: "not every element should carry equal visual weight" | [V] | The working model for "quiet" |

**Conclusion:**
- Keep the paper-calm *feel*: few colours, no red, no streaks, gentle drift.
- Show **everything needed for the next decision** without clicks:
  - what's next;
  - what's waiting, and on whom;
  - what's due this week;
  - how much is lined up.
- Let people who want more turn it up in one step.

This is call **❓1** (the principle) and **❓2** (the presets).

---

## 2. Who Tasks is for

| Segment | Must-haves Tasks lacks today | Density | Notes |
| --- | --- | --- | --- |
| **Freelancers** (designers, devs, writers) | Waiting-on-client state; task ↔ client link; time per client | Calm list + board | Leave tools that can't be shown to clients or that split time tracking into another app. Freelancers bill ~65% of hours worked [A] |
| **Consultants / coaches / solopreneurs** | Checklist templates with relative dates; follow-ups tied to a contact | Calm | "Notion is a second job"; follow-ups lost between inbox and task app |
| **Agencies / studios of 2–5** | In-review / waiting states; templates per deliverable; time per client; who's-on-what | Denser | Vendor data: 53% call time tracking a top problem, 26% can't get status updates, 46% outsource [D-vendor] |
| **Indie hackers / small dev teams** | Short IDs; PR links; handing issues to coding agents | Linear-dense | Don't fight Linear on dev workflow. Win the founder whose dev tasks sit next to sales email and investor contacts |
| **Creators** | Stage board (idea → draft → edit → publish); template per episode | Medium | Content calendars are among Notion's most-used templates, the database-building Moduo avoids |
| **Students** (free) | Deadlines in without typing (syllabus import); course = bucket | Calm, calendar-first | Syllabus-import apps multiplied in 2025–26 [A]. With an MCP create tool, "paste the syllabus into your AI" does this with zero new UI |
| **Households / couples** | Shared lists, recurrence | Very calm | Spillover from founder pairs, not a target |
| **ADHD** (a lens across all of the above) | Visible state; gentle overdue; one next action | Splits both ways | ~6% of US adults have a diagnosis, ~5% of UK freelancers [D]. Over-representation among Moduo's targets is modest. A 2026 interview study found tools fail "when isolated from relationships": visible shared state *helps* |

**What every segment needs:**
- capture;
- dates and reminders;
- simple recurrence;
- subtasks;
- buckets;
- a Queue;
- calendar placement;
- search;
- quiet notifications;
- and, once a workspace has two or more people, assignee, comments and live updates.

Tasks v2 covers almost all of this.

**What differs, and how to deliver it:**

| What differs | How to deliver it | Why |
| --- | --- | --- |
| Workflow stages | A **waiting** concept (❓5) | Not custom statuses |
| Client work | The **spine** (❓8) | Not a switch-on pack |
| Repeat procedures | **Templates** (❓9) | — |
| Board vs list vs calendar | **Views** | Already built |
| How much shows on a row | **Presets** (❓2) | — |

Feature packs are rejected. ClickUp lets teams switch features off and is still called overwhelming. Packs also split onboarding and multiply the setups to test.

---

## 3. gr8r — what it is and what to take

**What it is:** a front-end-only demo.
- Fixed persona "Tanjim Islam" at "Gr8r Studio", an 8-person design studio, with seeded data.
- Some tabs render empty until clicked twice, and the settings gear does nothing.
- In effect a Linear × Asana hybrid for a studio with teams.
- It shows which defaults one designer picked, not what users want.

The full walkthrough is in [`research-2026-10/gr8r-walkthrough.md`](./research-2026-10/gr8r-walkthrough.md).

**Its defaults:**
- **Every row shows** ID (`WEB-130`), title, subtask and comment counts, status, assignee (avatar and name), priority (bars and word), due date and project.
- **Statuses:** Backlog / To Do / In Progress / Review / Done.
- **Priority:** Low / Medium / High / Urgent.
- **Density:** Appearance → *Sidebar density* and *Task display*, each Comfortable / Compact.
- **Table layout:** resizable columns and a column picker (status, priority, assignee, due, start, labels, dependencies, estimate, created, project).
- **⌘K:** typing `WEB-1` lists the matching tasks with their IDs.

| Take | How it fits Moduo |
| --- | --- |
| Handles + ⌘K that resolves them | ❓3, ❓4 |
| Column headers in a dense mode; click a header to sort | Part of the Detailed preset (❓2), not a fourth view |
| **Project overview**: about, "4 of 18 done · 24 days until Nov 2 · 1 overdue", status bar, coming up, members, milestones, recent activity | A bucket overview as a right-panel view, plus the client link (❓8) |
| **Workload**: open tasks per person, bar split by status | A Home widget for teams (❓12) |
| **Files tab per project**: every file across its tasks, filter by type | Fold into AT-3 ("attachments everywhere") or the bucket overview |
| Subtasks typed inline in the New task dialog | Fold into TV-U7 (capture v2) |
| Inbox tabs (Mentions / Assignments / Comments / Updates) with reply in place | Compare with the Universal Inbox (DF-21) when it's next touched; no new call |

**Skip:**
- **Teams layer and role matrix:** beyond the ≤5-person scope; PERM covers sharing.
- **Portfolio "At Risk" statuses and red "need attention" counts:** alarm framing.
- **An Urgent priority level:** the mere-urgency effect shows urgency cues pull attention toward the wrong work (Zhu, Yang & Hsee 2018, Moderate).
- **Backlog as a status:** Inbox plus no-date already covers it.
- **Milestone diamonds:** ~~a task with only a due date already renders that way on the Timeline.~~ *Corrected 2026-10-10:* today it renders as a faded bar ([code audit](../tasks-v3/research/current-state-board-timeline-dnd.md)). The re-plan draws tasks as circles and dated sections as diamonds (REPLAN ❓68).

---

## 4. Competitors — what matters for these calls

**Task IDs: who shows them**

| Tool | How |
| --- | --- |
| Linear, Jira, GitHub, Plane, Fizzy | Always shown |
| ClickUp | Opt-in, per Space |
| Notion | Opt-in, per database |
| Asana | Opt-in, ID field, **paid tiers only** |
| monday | Opt-in |
| Trello | Card numbers exist but are hidden; an extension that shows them has 50k+ users |
| Todoist, Things, TickTick, Sunsama, Akiflow, Basecamp, Tiimo | No IDs |

Non-developers *do* ask for IDs:
- Asana's "task numbering" thread ran 2017–2024, with use cases like saying "task 123" aloud and emailing a reference.
- ClickUp's own launch note admits its default IDs are "random and tough to remember".

**What happens to the ID when a task moves** is the key design fact (full table with links in Appendix A):

| Tool | On move | Old references |
| --- | --- | --- |
| Linear | New `TEAM-n` | Old URL redirects; inline text stays stale |
| Jira | New key | Old keys kept as aliases |
| GitHub | New number | Redirect |
| Notion | Never changes | Per database |
| OpenProject (June 2026) | Dual model: a new project ID | Old ones keep resolving |
| Plane | — | Renaming a project key orphaned items (Aug 2026 forum bug) |

**Density:**

| Tool | What it offers |
| --- | --- |
| Linear | ~20 per-view property toggles, saved per user or as the workspace default; no density setting |
| Asana | Compact mode. Removed its inbox compact option, then restored it in Nov 2025 after complaints |
| ClickUp | Compact mode that users call insufficient |
| Gmail | Default / Comfortable / Compact |
| Moduo | Already has Comfortable / Compact / Dense row height under Appearance |

**Top reasons people switch (2025–26):**
1. Price rises and seat minimums.
2. Slowness and bloat.
3. Setup burden.
4. Unwanted AI and pivots.
5. Shutdowns (Height, Clockwise).
6. Density lost in redesigns.
7. Notification overload.
8. Walls of red overdue tasks shaming ADHD users.
9. Auto-schedulers taking control.
10. Minimal apps lacking collaboration / developer jargon putting off everyone else.

**Gaps nobody fills:**
- A client work loop: task + contact + email thread + time + a status the client can see.
- One MCP that returns a task *with* its linked email, contact and note.
- Free, stable IDs for non-developers.
- A calm interface that can be made dense.
- Email → task that stays linked to the thread and the sender.
- Shame-free time models in a tool that also does teams.

**Closest all-in-one rival:** **Routine** (tasks, calendar, notes, inbox, agents, MCP, "custom types/objects"). Those custom types are heading toward Notion-style databases, which Moduo's brief rules out. Being opinionated is the counter.

---

## 5. ADHD and productivity science — what to build on

These are the ten best-backed design implications (full review with citations: [`research-2026-10/adhd-productivity-evidence.md`](./research-2026-10/adhd-productivity-evidence.md)).

| # | Implication | Evidence | Strength | Status in Moduo |
| --- | --- | --- | --- | --- |
| 1 | Show the relevant; strip the irrelevant | Forster 2014; Rosenholtz 2007; Altgassen 2014 | Moderate | ❓1 |
| 2 | Group strongly before cutting fields | Tullis | Moderate | ❓2 |
| 3 | Anchor reminders to events and to the place you act, not only to dates | Altgassen 2014; Gilbert 2022 | Moderate | In-flight check-backs and linked waits already do this; extend in ❓5 |
| 4 | Let a task carry an optional "when / after X" trigger. If-then plans: d ≈ .27–.66 over 642 tests | Sheeran, Listrom & Gollwitzer 2025 | Strong | `scheduled_at` is the time form; event anchors in ❓5 |
| 5 | Visible progress and a done list (d = .40 across 138 studies; larger when recorded) | Harkin 2016 | Strong | Run summary, "N completed · show"; N2 below |
| 6 | Estimates calibrated against your own actuals; "break it down" as a first-class action | Buehler (planning fallacy); Kruger & Evans | Strong / Moderate | ❓10, N1 |
| 7 | Gentle overdue and drift states that always offer a fix; no consecutive-day streaks (a broken streak lowers later engagement) | Silverman & Barasch 2023 | Moderate | Already the design. Keep it |
| 8 | Notifications as a digest about 3×/day at breakpoints, with a few precise event-based exceptions. Zero notifications made people *more* anxious; hourly batching did nothing | Fitz et al. 2019 | Moderate | Check DF-9 (N5) |
| 9 | A good default, one active choice, and 2–3 named presets; the quiet mode shows what it hides | Jachimowicz 2019; Findlater & McGrenere | Strong / Moderate | ❓2 |
| 10 | A "where I left off" note on hand-off | Leroy & Glomb 2018; Ghibellini & Meier 2025 (people resume interrupted tasks ~67% of the time) | Moderate | Already in TV-F4 |

**For teams:** show *ownership* (who's on what, what's waiting), not live activity. Identifiable contributions reduce social loafing (Karau & Williams 1993, Strong), but full observation suppressed productive improvisation (Bernstein 2012). Moduo's private runs and visible claims already match this.

**Weak or no evidence:**
- single-task Focus views;
- visual timers for adults;
- per-task energy tags;
- the Eisenhower matrix;
- GTD weekly review;
- "25-minute" pomodoros (Biwer 2023 tested scheduled breaks, not 25 minutes).

These are fine to ship as tools; don't sell them as science, and measure them (behind the PostHog opt-in).

**Keep out of product copy** (N6):
- "object permanence";
- "interest-based nervous system" / "dopamine menu";
- RSD as an established ADHD trait;
- "unfinished tasks haunt you" (Zeigarnik fails replication: ratio 0.99);
- decision fatigue / ego depletion;
- "too many choices paralyse" (average effect ≈ 0);
- "gamification works for ADHD";
- "23 minutes to refocus";
- "Pomodoro / GTD / Eisenhower is proven";
- "21 days to form a habit" (the median is 66);
- "wall of awful";
- the "Harvard / Yale written-goals study".

---

## 6. Agents and MCP — where Tasks stands

Full report: [`research-2026-10/agents-mcp.md`](./research-2026-10/agents-mcp.md).

**Today:**
- **23 task tools.**
  - Reads: buckets, list, queue, drift, tags, search, get, attachments, activity, assignees.
  - Writes: queue, status, reschedule, assign, skip occurrence.
- **Every argument is a UUID.**
- **What agents can't do:**
  - create a task;
  - edit title, description, priority, estimate, tags or due date;
  - add subtasks or dependencies.
- **Commenting needs the Links scope**, so a key with Tasks = Edit but Links = None can't comment on a task.
- **Server shape:** results are plain JSON text, with no output schema and no tool annotations.

**How the products that thought hardest about agents do it:**

| Product | How it works |
| --- | --- |
| Linear | **Delegate** field (issues are assigned to humans, only delegated to agents); agent sessions with states `pending / active / awaitingInput / error / complete / stale`; ephemeral progress lines; one external link (PR) |
| GitHub Copilot | Commits co-authored by the person who asked; one notification, "review requested" |
| Jira Rovo | Agent output is private until the person who triggered it hits Publish |
| All three | A named human stays accountable. Progress goes to a session surface, not the comment thread. There's **one** loud moment (needs input / ready for review) |

**Moduo-specific constraint:**
- MCP-only means Moduo can't *push* work to someone's Claude or ChatGPT.
- "Hand this to an agent" therefore means one of two things:
  - you tell your agent "take MOD-142";
  - a scheduled agent polls a "ready" list.
- Either way, the **agent** must be able to write the waiting/in-flight state, a link and a heartbeat. Moduo keeps the check-back clock.

**Agents in personal productivity — what people actually use:**
- Used: **capture** (meeting notes / email / voice → tasks) and **"plan my day"**.
- "Break this down" helps when the result is short, editable and optional (Goblin Tools threads are mixed).
- Treat AI estimates as suggestions, never stored as fact.

**Hardening to plan for** (generic, no known issue):
- per-key bucket allow-list;
- a separate destructive level, off by default;
- tool annotations;
- labels for where text came from (email sender, guest, agent);
- strip invisible Unicode;
- a structural test that every connector read is workspace-scoped (Asana's MCP leaked across organisations in 2025).

---

## 7. Proposals and calls

Each item lists what it is, why, what it collides with, and where it would land. Collision classes:
- **(a)** folds into an open block (cheap now);
- **(b)** new block after Tasks v2;
- **(c)** re-decides something ratified.

### 1 · "Complete but calm" replaces "quiet and minimal"

- **What:** amend PRODUCT_BRIEF §7 and the feature spec's principle 1. Quiet = low visual weight, no alarm colours, no debt framing. *Not* fewer facts.
  - The default shows everything needed for the next decision.
  - Nothing is hidden without a count.
  - Grouping does the calming.
- **Why:** §1. Relevant load helps (including ADHD), clutter is visual variety not item count, defaults stick, and "too sparse" is a documented switching reason.
- **Collides with:** (c), the wording of a load-bearing principle. In practice TV-U1's rows already follow it; this makes it the rule for every future surface.
- **Lands:** a doc edit, then every block.

❓ **Adopt "complete but calm" as the principle?** *Recommend: yes.*

**Decided 2026-10-09 (Maciej):** yes. PRODUCT_BRIEF §7 and the feature spec's principle 1 get the new wording when the re-plan's spec lands.

### 2 · Row detail presets: Standard and Detailed

- **What:** one preset that controls **which properties show on rows**.
  - Row *height* stays Appearance → Density (comfortable / compact / dense).
  - Two density settings would be a mistake, so they stay separate.
- **Standard** = TV-U1's comp:
  - quiet counts after the title;
  - priority, date, assignee and queue columns that collapse when empty;
  - a quiet waiting mark (❓5).
- **Detailed** adds:
  - handle;
  - bucket;
  - tag names;
  - estimate / time;
  - created / updated;
  - a header row whose column titles sort on click (gr8r's Table, without a fourth view).
- **Defaults and overrides:**
  - The preset is a **user-level default** set next to Appearance → Density.
  - Display (TV-U2) can override it per scope, and Display's property toggles stay available underneath.
  - The active choice is offered the first time someone opens Display ("How much do you want on each row?"), because progressive onboarding isn't built yet. Onboarding can ask later.
- **Rules:**
  - The quiet end must show what it hides on rows (counts, not silence).
  - Presets are picked by the user and never switch on their own.
- **A third, Calm preset** (title + date only) only if dogfooding asks. No segment evidence called for less than TV-U1.
- **Why:** §1. Asana, ClickUp and Akiflow users ask for exactly this pair. Findlater & McGrenere: user-controlled, static presets beat adaptive ones.
- **Collides with:** (a), folds into TV-U2 (Display), plus a small Appearance addition.

❓ **Two presets (Standard default + Detailed), set next to Density and overridable per view?** *Recommend: yes. Add Calm only if asked.*

**Decided 2026-10-09 (Maciej):** yes.

### 3 · Task handles — the shape

- **What:** every task gets a permanent number, unique in its workspace, shown with a short **workspace key**: `MOD-142`.
  - **The key:** derived from the workspace name, editable in workspace settings. Renaming it keeps the old key as an alias, so old text still resolves (the Plane bug).
  - **No zero-padding:** `MOD-7`, not `MOD-007`. Padding implies a cap and sorts badly after 999; no precedent pads.
  - **Subtasks** get their own handles (they're full tasks).
  - **Numbers are never reused:** deleted tasks burn theirs.
  - **Moving a task between buckets never changes its handle.**
  - **Free on every plan:** Asana gates IDs behind paid tiers; free IDs matter for students.
  - **A handle never grants access;** every lookup still checks permissions.
- **Why not `TB-001` per bucket:**
  - Every capture lands in Inbox and moves at triage, so per-bucket prefixes would rename most tasks once, leaving stale references in notes, emails and chat.
  - Linear lives with this ("inline references won't update"); Jira keeps alias chains.
  - Neither cost is worth it here.
- **Alternative (hybrid):** a global number shown with the *current* bucket's short prefix (`ACME-142` → moved → `WEB-142`), any prefix resolving by number.
  - Nice for "re: ACME-14" emails to a client.
  - But the same task shows different labels over time.
  - Possible later as a display option on top of the workspace number.
- **Why at all:**
  - **People:** say it, email it, search it, tell similar titles apart.
  - **Agents:** fewer tokens than a UUID; fewer mixed-up and hallucinated IDs (Anthropic, "Writing effective tools for agents", 2025).
  - **Developers:** PR titles and branch names.
- **Collides with:** (b), a new block — migration (per-workspace atomic counter, backfill by `created_at`), contracts, UI, MCP.

❓ **Workspace key + permanent number (`MOD-142`), not per-bucket?** *Recommend: yes. Keep the hybrid as a possible later display option.*

**Decided 2026-10-09 (Maciej):** yes.

### 4 · Handles — where they show and resolve

- **Rows:**
  - off in Standard;
  - on in Detailed;
  - any view can switch them on in Display.
- **Always shown:**
  - in the detail header, next to copy link (click to copy the handle);
  - in ⌘K and `/` search (typing `MOD-14` finds it);
  - in deep links (`/tasks?id=MOD-142` resolves; no new route).
- **MCP:**
  - Every tool that takes a task accepts the handle **or** the UUID. This is resolved once in the shared argument layer, so cross-module tools (comments, links, calendar) get it too.
  - Results lead with `handle` + `title`.
  - UUIDs leave the concise output only after every tool resolves handles.
- **In text** — **input to GR-0** (the reference-grammar spec), not a separate decision:
  - a typed handle in a description, note, comment or chat auto-links like an `@` reference, without a fourth glyph;
  - the `@` picker matches handles;
  - email subjects like "re: MOD-142" could later suggest a link to the task.
- **Collides with:** (b), same block as ❓3. GR-0 owns the text behaviour.

❓ **Hidden on rows by default, everywhere else always?** *Recommend: yes.*

**Decided 2026-10-09 (Maciej):** yes.

### 5 · "Waiting on…" — a real state, outside Focus

- **What:** a task can be **waiting on** something, with an optional **check-back** time. The something is:
  - a person;
  - a contact;
  - an email thread;
  - an agent;
  - a link (PR, deploy);
  - or just a note.

  The mark is visible everywhere:
  - rows and cards (quiet mark + "on Anna · 2d");
  - a Filter dimension and a Group-by in Display;
  - the contact's hub ("waiting on you: 3");
  - MCP.

  It clears itself where it can:
  - the email reply arrives;
  - the blocker task is done;
  - the agent marks it ready.

  A check-back that falls due brightens the task (hairline, never red) and sends one notification, as TV-F4 already specifies.
- **Effect on TV-F4:** TV-F4's "In flight" becomes *the Focus run's view of tasks you handed off*: hand-off sets waiting + note + check-back. TV-F4 isn't built yet, so this is the cheap moment.
- **Why:**
  - Every client-work segment lists "waiting on client / in review" as a must.
  - Tasks that depend on other people are the hardest case for email-as-task-manager (Bellotti 2003).
  - Reminders tied to a cue beat reminders tied to a time for ADHD (Altgassen 2014).
  - Agents need it (❓6).
  - Today waiting exists only inside a run, so nobody else can see it.
- **The fork** (decide this one):

  | | **Field route** (recommended) | **Status route** |
  | --- | --- | --- |
  | Shape | "Waiting on…" extends the existing **Blocked by** collection: blocked by a task (today), *or* waiting on a person, contact, email, agent or link. Works with any status | Add `waiting` to `TASK_STATUSES` (5 values) |
  | Board | Shows a mark; Group by "Waiting on" gives the columns | Gets a native **Waiting** column |
  | Cost | No change to the status vocabulary, but it still needs a small waiting-target schema (a `waiting-on` link kind for spine targets, plus a small kind enum for agent / link / note targets); old desktop builds just don't show the mark | Contract + CHECK change, `tasks_set_status` change; old desktop builds don't know the value during the TV-D7 adoption window; waiting tasks must be excluded from drift |
  | Mental model | Reuses "Blocked by" | Matches the agency word |

  The discriminating question: **do you want a Waiting *column* on the default Board, or is a mark plus Group by "Waiting on" enough?**
- **A separate "In review" status:** not recommended. "Waiting on Mike" covers internal review, and fewer states is the Moduo way.
- **Collides with:** (a)/(c). It reshapes TV-F4 before it's built. The status route re-decides the fixed status set.

❓ **Waiting as a field extending Blocked by (recommended), or as a fifth status?** *Recommend: the field route.*

**Decided 2026-10-09 (Maciej):** the field route (recommendation accepted).

### 6 · Agents are delegates; a human stays accountable

- **What:**
  - The assignee stays human-only (the single-assignee decision stands).
  - An agent working on a task shows as **Waiting on Claude** (or whatever the key is named), with a session state:
    - working;
    - needs input (the question shown on the task; your reply is read on the agent's next poll);
    - ready for review;
    - failed;
    - stopped.
  - The session also carries an external link (PR, agent session) and a heartbeat, going stale after ~30 min of silence.
- **Where it shows:**
  - progress goes into the activity trail as collapsible entries, never as comments;
  - **one** notification, at needs input / ready for review / failed;
  - attribution reads "Claude, via Maciej's key".
- **New MCP tools:**
  - `tasks_ready`: open, unblocked, mine or in my queue;
  - an atomic **claim** (sets waiting-on-agent + in progress);
  - `tasks_session_update` / `resolve`.
- **Why:** Linear's delegate model, GitHub co-authorship and Jira's private-until-publish all keep a human accountable and make exactly one loud moment. That matches Moduo's quiet-notification rule.
- **Collides with:** (a), designed together with ❓5 in the TV-F4 reshape. The `agent` actor type is CHECK-reserved; keep using `api_key` + the key's name.

❓ **Delegate model with "needs input" and one notification?** *Recommend: yes.*

**Decided 2026-10-09 (Maciej):** yes.

### 7 · Let agents write tasks — pull it ahead in MCP-1

- **What:**
  - a server-side create op (email → task is orchestrated by the client today), then the tools:
    - `tasks_capture` (up to ~25 at once, lands in Inbox, optional parent);
    - `tasks_update` (title, description, priority, energy, estimate, tags, due);
    - subtasks;
    - dependencies;
  - `tasks_comment` on the Tasks scope;
  - then hygiene:
    - output schemas;
    - tool annotations;
    - concise / detailed output;
    - richer server instructions;
    - read-only key preset;
    - bucket allow-list;
    - destructive level off by default;
  - three MCP **prompts**:
    - *Plan my day* (queue + calendar);
    - *Weekly review* (drift, done, stale);
    - *Break this down* (3–7 editable subtasks, estimates labelled as suggestions).
- **Why:** every used agent workflow starts with creating tasks.
  - **Students:** "paste your syllabus into Claude" becomes dated tasks with zero new UI.
  - **Consultants:** meeting notes → tasks.
- **Collides with:** (a). Already open inside MCP-1 ("a task-create tool"). This is a sequencing call, not a product one.

❓ **Pull the task-write slice of MCP-1 forward, right after the current Tasks lane?** *Recommend: yes.*

**Decided 2026-10-09 (Maciej):** yes.

### 8 · The client loop: bucket ↔ client, bucket overview, time by client

- **What:**
  - **Link a bucket to a client** (contact or company) in one gesture. The link model already allows it; what's missing is the affordance and the roll-up.
  - **Bucket overview**, a new **right-panel view** (no route):
    - description;
    - progress ("4 of 18 done");
    - what's waiting and on whom;
    - due this week;
    - time spent (from time entries);
    - files;
    - linked client;
    - recent activity.

    All of it is factual, with no "at risk" alarms.
  - **The client's hub** shows their buckets, open tasks, waiting items and time.
  - **Time by client** export (CSV) for invoicing elsewhere. There's no finance module.
- **Why:** client work is where Moduo's spine is structurally ahead. No task tool links task + contact + email + time.
  - Freelancers lose billable time to tool switching.
  - 53% of agencies call time tracking a top problem.
  - HoneyBook and Dubsado users rebuild projects in a second tool.
- **Collides with:** (b), a new block after v2. It touches the Contacts hub; per the module contract, the hub is shared spine, so that's fine.

❓ **Build the client loop after Tasks v2?** *Recommend: yes. The bucket overview could come first, as the Files/overview view.*

**Decided 2026-10-09 (Maciej):** yes. (The structure round may rename "bucket"; the decision carries over to whatever the container becomes.)

### 9 · Checklist templates

- **What:**
  - A template is a saved task with subtasks, optional relative due offsets ("+2 days after start"), tags and an assignee.
  - Templates are shared with the workspace.
  - Start one from capture ("from template"), from a bucket's +, or from a contact ("Client onboarding for Anna").
  - Seed two or three per segment only if onboarding asks which kind of work you do.
- **Recurrence is untouched:** "one cycling row, never a template spawning instances" still holds. A template is only ever started by hand.
- **Why:** a must for consultants, agencies and creators. Todoist's personal-only templates are a named team pain. Notion's templates turn into databases that need upkeep; these are just checklists.
- **Collides with:** (b), a new block. "No template hunt" in the brief is about *system-building* templates. These are your own procedures.

❓ **Workspace checklist templates, started by hand?** *Recommend: yes, after v2.*

**2026-10-09:** Maciej asked what this means. Re-explained with examples (and widened to project templates) as ❓9 in [../tasks-v3/REPLAN.md](../tasks-v3/REPLAN.md); still open.

### 10 · Calibrated estimates in the capacity mirror

- **What:** once there's enough history (say 10 tasks with both an estimate and tracked time), the Queue header adds your own ratio, factually:
  - "7 · ~5h 20m lined up · usually ~1.4× → ~7h 30m";
  - the same line in the run summary.
- **Why:** the planning fallacy is among the most replicated findings (Strong). Time entries (TV-D3) now make actuals available. It's a mirror, not a wall.
- **Collides with:** (a), folds into TV-F2/F3, where the capacity mirror lives.

❓ **Add it to TV-F2/F3?** *Recommend: yes.*

**2026-10-09:** Maciej asked for more detail. Expanded as ❓10 in [../tasks-v3/REPLAN.md](../tasks-v3/REPLAN.md); still open.

### 11 · A client status link (no login)

- **What:** a read-only page for one bucket that a client opens without an account, with approve / request changes as a later step.
  - The sharing schema already has a public-link subject with no UI.
- **Why:** the most-asked freelancer and agency feature after time tracking. Clients won't log in.
- **Collides with:** (b), and it's a risky path. It needs a PERM review, a Tier-2 security review, and the waiting state (❓5) first, or the page has nothing honest to say.

❓ **Park until ❓5 and ❓8 have landed?** *Recommend: park.*

**Decided 2026-10-09 (Maciej):** park.

### 12 · Team load widget (Home)

- **What:** for workspaces of two or more people, a Home widget listing one row per person:
  - queue size and lined-up time;
  - in progress;
  - waiting;
  - due this week.

  Nothing about runs or time spent per person (those stay private).
- **Privacy:** claims already make queues visible, so it adds no new exposure.
- **Why:** 26% of agencies struggle to get status updates. The evidence says show ownership, not surveillance. gr8r's workload bars are the pattern.
- **Collides with:** (b), a dashboard widget under the module contract.

❓ **Yes, after the waiting state exists?** *Recommend: yes.*

**Decided 2026-10-09 (Maciej):** yes.

### No call needed — folded in unless you object

- **N1 · "Break it down" as a drift fix:**
  - the drift triage gets **Break down** next to Reschedule / Archive, adding 2–3 subtasks inline;
  - the MCP *Break this down* prompt is the AI version.
  - Evidence: unpacking a task improves estimates and helps getting started (Moderate).
- **N2 · A visible done list:**
  - "Done this week" as a quiet line or group in the Queue view, alongside the run summary;
  - cumulative, never streaks (Harkin 2016, Strong; Silverman & Barasch 2023).
- **N3 · Fresh-start re-plan:**
  - a Monday or month-start "clear the drift and start over" offer, which research on fresh starts at temporal landmarks supports (Moderate).
  - It belongs to the parked planning ritual (T27), so it stays parked with it.
- **N4 · No Urgent priority level.** The mere-urgency effect argues against it.
- **N5 · Check notification digests against Fitz 2019:**
  - about 3 per day, delivered at breakpoints (end of a focus block);
  - precise exceptions for check-backs and needs-input;
  - never zero by default.
- **N6 · Copy rules:** keep the myths list in §5 out of marketing and in-app copy.
- **N7 · Subtasks inline in the capture dialog** (from gr8r): fold into TV-U7.
- **N8 · A per-bucket Files view:** fold into AT-3 or the bucket overview (❓8).
- **N9 · Event-based "remind me when…" anchors:**
  - after a calendar event ends;
  - when a blocker is done;
  - when the reply arrives.

  These ride on the check-back from ❓5.
- **N10 · Measure:** ship the ADHD-motivated features behind the analytics opt-in and look at completion, not opinions. The evidence for several of them is weak.

---

## 8. Suggested order

| When | What |
| --- | --- |
| **Now, inside open blocks** | ❓2 → TV-U2 · ❓5 + ❓6 → reshape TV-F4 before it's built (it sits late in the focus lane, after F2/F3) · ❓10 → TV-F2/F3 · N7 → TV-U7 · N1 → small, any time |
| **Next** | ❓7 (MCP task writes, from MCP-1) · ❓3 + ❓4 (handles: one block; GR-0 picks up the text behaviour) |
| **After Tasks v2** | ❓8 (client loop, bucket overview first) · ❓9 (templates) · ❓12 (team load widget) |
| **Later** | ❓11 (client status link) · N3 with T27 |
| **Doc edit, once ❓1 is answered** | PRODUCT_BRIEF §7 and the feature spec's principles |

---

## Appendix A — sources for the key claims

**IDs and moving tasks:**
- [Linear editing issues](https://linear.app/docs/editing-issues)
- [Linear move to team](https://linear.app/docs/move-to-new-team)
- [Jira moved-issue redirects](https://support.atlassian.com/jira/kb/moved-issues-no-longer-redirect-from-previous-issue-key-or-url-in-jira/)
- [GitHub transfer](https://docs.github.com/en/enterprise-server@3.19/issues/tracking-your-work-with-issues/administering-issues/transferring-an-issue-to-another-repository)
- [Notion unique ID](https://www.notion.com/help/unique-id)
- [OpenProject 17.5 identifiers](https://www.openproject.org/docs/system-admin-guide/manage-work-packages/work-package-identifiers/)
- [Plane orphaned items](https://forum.plane.so/t/missing-work-items-after-changing-project-id/295)
- [Asana task numbering thread](https://forum.asana.com/t/feature-request-task-numbering/8102)
- [Asana ID field](https://forum.asana.com/t/introducing-id-custom-field/684025)
- [ClickUp custom IDs](https://feedback.clickup.com/changelog/custom-task-ids-clickapp)
- [Linear API: id or `BLA-123`](https://linear.app/developers/graphql)

**Agents and tools:**
- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Linear agents](https://linear.app/developers/agents.md)
- [Linear agent interaction guidelines](https://linear.app/developers/aig.md)
- [GitHub cloud agent risks](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)
- [Jira agents](https://support.atlassian.com/jira-software-cloud/docs/collaborate-on-work-items-with-ai-agents/)
- [Todoist MCP](https://github.com/Doist/todoist-ai)
- [Asana MCP v2](https://forum.asana.com/t/new-v2-mcp-server-now-generally-available/1122647)
- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)

**Density:**
- [Linear display options](https://linear.app/docs/display-options)
- [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh)
- [Asana mobile density thread](https://forum.asana.com/t/ability-to-have-a-compact-mode-on-the-new-my-tasks-view-on-mobile/631568)
- [Asana inbox compact](https://forum.asana.com/t/bring-back-density-compact-option-to-inbox-view/1100822)
- [ClickUp true compact mode](https://feedback.clickup.com/feature-requests/p/true-compact-mode-ultra-compact-mode)

**Science:**
- Forster et al. 2014, *Neuropsychology* — [UCL](https://discovery.ucl.ac.uk/id/eprint/1425379/)
- Tullis 1983 — [CORE](https://core.ac.uk/display/4438915)
- Rosenholtz et al. 2007 — [MIT](https://dspace.mit.edu/handle/1721.1/37287)
- Altgassen et al. 2014 — [doi](https://doi.org/10.1177/1087054712445484)
- Gilbert et al. 2022 — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9971128/)
- Jachimowicz et al. 2019 — [RePEc](https://ideas.repec.org/a/cup/bpubpo/v3y2019i02p159-186_00.html)
- Findlater & McGrenere 2004 — [pdf](https://www.cs.ubc.ca/labs/edapt/papers/findlater2004.pdf)
- Findlater & McGrenere 2007 — [pdf](https://faculty.washington.edu/leahkf/pubs/Interact2007-findlater.pdf)
- Sheeran, Listrom & Gollwitzer 2025 — [KOPS](https://kops.uni-konstanz.de/handle/123456789/69905)
- Harkin et al. 2016 — [WRRO](https://eprints.whiterose.ac.uk/91437/)
- Silverman & Barasch 2023 — [UDSpace](https://udspace.udel.edu/handle/19716/34160)
- Fitz et al. 2019 — [doi](https://doi.org/10.1016/j.chb.2019.07.016)
- Zhu, Yang & Hsee 2018 — [EconBiz](https://econbiz.de/Record/the-mere-urgency-effect-zhu-meng/10011929694)
- Beheshti et al. 2020 — [BMC](https://bmcpsychiatry.biomedcentral.com/articles/10.1186/s12888-020-2442-7)
- Ghibellini & Meier 2025 — [RePEc](https://ideas.repec.org/a/pal/palcom/v12y2025i1d10.1057_s41599-025-05000-w.html)
- Chen, Meng & Nie, CSCW 2026 — [arXiv](https://arxiv.org/abs/2603.17258)

**Segments:**
- [Upwork 2025](https://investors.upwork.com/news-releases/news-release-details/upwork-study-finds-1-4-us-skilled-knowledge-workers-now-work)
- [Hubstaff agencies](https://hubstaff.com/workforce-management/state-of-agencies) (vendor)
- [Todoist on its team gaps](https://www.todoist.com/inspiration/todoist-team) (vendor)
- [CDC MMWR 2024 ADHD](https://cdc.gov/mmwr/volumes/73/wr/pdfs/mm7340-H.pdf)
- [IPSE neurodiverse self-employed](https://ipse.co.uk/articles/self-employment-neurodiverse-stats)
- [Bellotti et al. CHI 2003](https://faculty.cc.gatech.edu/~beki/j9.pdf)

Everything else is in the raw reports in [`research-2026-10/`](./research-2026-10/):
- ADHD and productivity evidence;
- segments;
- agents and MCP;
- the gr8r walkthrough.
