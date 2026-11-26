# Moduo — Product Brief

> **Status:** Canonical product definition. Written 2026-06-24 from a market and user research sweep (Reddit, YouTube, G2/Capterra, HN, ProductHunt) with adversarial fact-checking. **Brought up to date on 2026-11-26** against the code at v1.8.1, the decision log and the work in flight; §13 says what is landing next.
> **Pairs with:** [data-layers.md](./data-layers.md) (how it's wired), [moduo-architecture-vocabulary.md](./moduo-architecture-vocabulary.md) (terminology), [agents/designer-brief.md](./agents/designer-brief.md) (who decides what, and the product direction of 2026-10-21).
> **For agents:** this is the "why" and the guardrails. Read it before designing any module. When a decision here changes, edit this file first, then code.

---

## 1. What Moduo is

**Moduo is a lightweight, all-in-one workspace that brings tasks, notes, calendar, contacts, email and team chat into one fast app, and links them all together.** It competes with Notion and ClickUp on breadth, but deliberately *without* their heaviness (no Notion-style databases to build, no setup project). The bet is not "another notes app" or "another task app". It is the **one place a solo operator or a small team runs their whole working life**, where an email becomes a task, linked to the client it came from, scheduled on your calendar, with the notes from the call beside it.

**The thesis is validated, not speculative.** Users articulate this exact product unprompted and repeatedly:

> *"My goal is to use only one app for my personal organization. Is there such an app?"*
> *"Recommendations for a single app… to manage customer contacts, projects and tasks, and notes and documents for a solopreneur."*
> *"I often find it hard to find the information I need quickly because the context is split across all these different apps."*

The market is asking for Moduo by name. **The work is execution and trust, not market education.**

**Where it stands (2026-11-26).** Version 1.8.1 is in production: a web app, and desktop apps for macOS 14 or later and Windows x64 that update themselves. Access is invite-only through a waitlist on [moduo.app](https://moduo.app), which describes Moduo as "Email, tasks, notes, calendar, contacts and chat in one window. Nothing lives in two places." and its state as a private beta.

---

## 2. Who it's for

| Segment | Why Moduo | Priority |
| --- | --- | --- |
| **Small agencies and studios (2–5 people)** | One shared workspace for client work: tasks, notes, calendar, mail, contacts and chat that link to each other. The first user since the 2026-10-21 product direction. | **First user** |
| **Solo business owners and freelancers** | Run the whole business in one app; replace a duct-taped stack (Spark + Morgen + Notion + Linear + a spreadsheet CRM). The dogfood persona, and they must still get the best experience. | **Primary** |
| **Individuals on the Free plan** | Tasks, notes and calendar for one person, free, in one workspace. Top of the funnel and goodwill. Students are one of these people, not a tier of their own. | **Free plan** |

Moduo is **modular enough to serve several groups** (each member sees the modules they have access to), but the product is tuned for the small team and the solo operator.

**Not targeted now:** phones and tablets (the desktop and web apps come first; until then, capture from a phone goes through your own AI assistant and the Moduo connector), large teams and enterprise. A client is not a workspace member: the planned answer is a shared client page per project, reached by a link (direction of 2026-10-21, not built).

---

## 3. Why now (the core insight)

Three pains converge, and every incumbent only solves one:

1. **App-switching + context fragmentation.** Information is split across 5–10 tools; nothing links. (Independently documented: knowledge workers toggle apps ~1,200×/day, ~4 hrs/week reorienting — HBR 2022.)
2. **Subscription fatigue**, sharpest among solo founders and teams of five or fewer. Per-seat and seat-minimum pricing draw the angriest complaints in the category.
3. **The execution gap** — the "feels like Motion but isn't built for *completing* tasks" pattern. The whole time-blocking field (Motion, Morgen, Sunsama, Akiflow, Routine) makes the day *look* organized but abandons the user at the moment of doing.

Moduo answers all three *at once*, and that intersection is uncontested.

---

## 4. The moat: the connective tissue (the "spine")

**Moduo's defensibility is not any single module. It is the layer that lets any entity link or attach to any other**, and that surfaces as felt value, not abstraction. Three research findings make this the strategic center of gravity:

- **No competitor reaches the full graph.** Motion, Sunsama, and Akiflow all proved the consolidation thesis, but their graphs stop at work-execution entities (tasks, projects, docs, people). **None has contacts or a real email entity in the graph.** Moduo's `email→task`, `note→task`, `event→contact` and `message→task` links across *all* modules are the territory they structurally cannot reach.
- **Auto-rollup is the fix for "data no one trusts."** The #1 reason light CRMs and DIY systems die is that manual upkeep rots. A contact page that **rolls up every linked email, task, note and event with zero manual logging** is the only way to keep an all-in-one's data trustworthy at small-team scale. *Today:* the contact and company pages build themselves from links, and links are made by converting, dragging, mentioning and accepting suggestions. Mail does not yet link itself to a contact as it syncs; that is the gap between the claim and the build.
- **It must never look like a graph.** The moat fails the moment "link anything to anything" surfaces as a generic-entity/relation-schema paradigm (the Anytype trap — a steep, widely-cited learning curve where the overloaded word "Relations" confuses new users). Keep email, task, note and contact as **familiar, visibly distinct objects**; expose linking as **drag-onto, @-mention, /ref**, with **auto-suggested** links — never a "define your object type" step. Links carry **type + context** (`email→task` = "spawned from"), and rollups are **grouped by relationship with inline snippets**, not Obsidian's flat backlink pile. *Deliver Anytype's connectedness with Linear's immediacy.*

The test for any new feature (2026-10-21): **own** it when its value comes from links to the rest of Moduo, **connect** to an outside tool when the hard part is the thing itself, **skip** it when it links to nothing.

See [data-layers.md §5](./data-layers.md) for the spine systems and their data shapes.

---

## 5. Positioning pillars

Four claims Moduo can make that incumbents structurally cannot:

1. **"The only place these connect."** Email, contacts, tasks, notes, calendar and chat in one relationship graph. Lead with the connective payoff, not "fewer subscriptions" (the savings story is the honest *justification*; the tissue is the *reason to believe*).
2. **"Instant, native, never lags."** Tauri (native webview, not Electron) is a real, marketable structural advantage, and the same app runs in a browser. Heavy incumbents visibly lose on speed (ClickUp users report ~30s loads on large lists/views; Notion is slow on mobile and large databases). *Caveat (verified): frame as "instant interactions, no waiting on big lists/large workspaces," not "ClickUp always takes 30s to open one task."* Benchmark against Todoist and Linear, never Notion. Speed is a launch-blocking quality bar (see §8).
3. **"Works the day you sign up — you don't build it, you use it."** No databases to design, no template hunt, no maintenance tax. Configurability is a liability to hide, not a selling point. Home ships **pre-populated and useful** (your tasks, your calendar, quick capture and a clock), never an empty canvas.
4. **"Fair pricing, and your data is yours."** You pay for the people you have: one person is Pro, two people are Duo at a flat price, and Team starts at three seats. There is a **Free plan that is a real tier**, not a trial. Your data leaves with you: an export of the whole workspace, and account deletion that erases it. AI comes only through your own assistant; Moduo has no built-in model and never trains on your data.

**The plans** (the launch prices published on moduo.app; chat is on Duo and Team):

| Plan | For | Monthly | Yearly, per month | Founding price |
| --- | --- | --- | --- | --- |
| **Free** | one person, one workspace, 2 GB | $0 | $0 | none |
| **Pro** | one person, 50 GB | $12 | $10 | $8 |
| **Duo** | exactly two people, flat, 100 GB | $20 | $16 | $13 |
| **Team** | three or more, per seat, 50 GB a seat | $15 | $12 | $10 a seat for the first year |

A new account gets Pro for 14 days with no card, or 30 days with one; a trial that ends without a card lands on Free.

*Two claims this brief used to make are not true today.* "No seat minimums": Team has a three-seat minimum, by design (two people are Duo). "A free student tier": there is one Free plan for everyone and no student plan. And "lossless export" is a target, not yet met: the export leaves out file contents (it lists them) and mail.

---

## 6. Modules & depth ceilings (deliberately light, never mediocre)

The existential risk (see §11) is the **weakest-leg trap**: if one module is mediocre, users bolt on a separate app and the unification collapses. So "light" has a floor: **every module must clear a credible per-category bar and have at least one "this is actually great" moment.**

| Module | Depth ceiling ("as good as, no further") | What is built (v1.8.1) | The "one great moment" |
| --- | --- | --- | --- |
| **Home** | iPadOS-style live, interactive, cross-module widgets | A fixed 8×4 grid with pages, an edit mode, a gallery and 20 widget types; filled on first open | Useful the moment you open it; cross-module tiles |
| **Tasks** | Linear-light, plus a place to do the work | List, Board and Timeline views (dependency lines, drag to reschedule); Focus as a place in the sidebar; quick capture (⌘⇧K) into an Inbox; projects, sections, templates, time tracking; importers from Todoist, Linear, Asana, Jira, Trello and CSV; opens offline, and captures and check-offs wait until you are back online | Focus, and the schedule-to-completion loop |
| **Notes** | Notion-ease minus databases (Markdown, nested pages, references) | Nested pages; Markdown in and out; `/task`, `/note`, `/contact`, `/company` and `/event` references; comments; full-text search; people editing the same note at once (no live cursors); publish a note and its subpages to the web; Notion import | A line in a note that *is* a real, schedulable task (a plain checkbox stays a checkbox) |
| **Calendar** | Morgen-lite (time-blocking + drag-to-schedule) + Calendly-like booking links | Week and Month; type an event and watch it land; drag a task onto the day; two-way Google sync, Outlook, CalDAV and ICS; teammate lanes and private events; booking links and offers | **Close the loop**: tick a task off from inside its time block; when a block has passed, choose Done, Later today, Took longer or Remove |
| **Contacts** | Folk-lite (people and companies as hubs) | People and company pages that build themselves from links | Click a contact → see *everything* linked, with zero logging |
| **Email** | Spark replacement on the desktop | A Rust mail engine in the desktop app (Gmail, Google Workspace, iCloud, Outlook, any IMAP); mail stays on your device and the cloud keeps only a reference to a thread you act on; the web app shows the threads linked to your work | Turn an email into a task without leaving the inbox, linked to the sender when they are a contact |
| **Chat** *(Duo and Team)* | What every chat tool has (the 2026-10-02 call: compete with Slack on features), inside the quiet-notification bar of §7 | Channels, direct messages, reply chains with a wrap-up, files, search, decisions; typing and presence | **The conversation knows the work**: live references, a message becomes a task with the link both ways, a channel one click from its project or client |
| ~~**Calls**~~ | **Not built.** Direction (2026-10-21): huddles first (audio and screen share from a channel or a direct message) on a vendor such as LiveKit or Daily, never self-built media; guest links later | — | — |
| ~~**Finance**~~ | **Not planned** (2026-10-07). Old brief kept for reference: `.design/finance/BRIEF.md` | — | — |
| ~~**Mindmap, whiteboard**~~ | **Removed from the product** (2026-10-21): people already use Excalidraw, Figma or Miro, so outside boards are linked, not rebuilt | — | — |

**Across every module:** search with ⌘K (tasks, notes, contacts, events, chat and mail); one notification center (⌘/); one sharing model with roles, teams, per-item grants and private items; and the **Moduo connector** at `mcp.moduo.app`, which lets a person's own AI assistant read and change their workspace (more than 110 tools across tasks, notes, calendar, contacts, chat, email, links and search; connect by signing in or with a key; each connection gets none, view or edit per module and never more than its person has). What an assistant does is shown as its person's, by name ("Alex · via" and the connection's name), and its newest edit to a note can be undone.

Direction of 2026-10-21, not a description of the build: files are a view of a project, not a module; notes are the only native writing surface, and Drive or OneDrive files are linked as pointers.

---

## 7. Design principles (load-bearing)

Carried from the original brief, sharpened by research:

- **Quiet and minimal until the user decides otherwise.** Breadth must *default* to feeling minimal (paper-calm), or users go back to pen and paper. Density and text size are a customization axis (densest end = Linear-level), not a fixed target.
- **Decisions live with the designer, not the user.** Opinionated defaults; hide configurability. (This is the direct antidote to "system-building as procrastination," the #1 behavioral failure mode of flexible all-in-ones.)
- **Design for graceful slippage, not robotic adherence.** Falling behind is the *normal* case. One-tap "reflow my day," a gentle overdue queue (never a wall of red), a simple "day-fullness" signal. *Built so far:* a late date reads as late in words, never in red, and a passed block asks what happened. The category's biggest *emotional* pain is guilt.
- **Links feel like a side-effect of work, never a schema task.** (See §4.) Link by default, and make the link easy to remove.
- **Notifications: quiet, grouped-by-entity, digest-by-default.** Cross-module notifications are central to the moat, and uncurated notifications are a top incumbent complaint. Get curation right or the moat poisons itself. The bell groups events into one card per item; a scheduled digest email is not built. Chat is the deliberate real-time exception and keeps to the same bar: sound off by default, quiet hours and do-not-disturb, and one email after an hour away, at most once an hour per conversation. On the work itself, coordination stays async: comments, @mentions, notifications and ambient state.
- **AI stays quiet and connective.** Only through the connector, no built-in model; never sprinkle AI styling across modules. There is no AI colour, badge or "AI disc" (brand decision 40a: [.design/brand/DECISIONS.md](../.design/brand/DECISIONS.md)); the copy says "your assistant" or the tool's name, never "Moduo AI". Market "bring your own AI, we never train on your data" as a **trust** feature. (AI-everywhere currently reads as a data-harvesting tell.)
- **Capture is frictionless and destination-free.** A bare title is a complete task; metadata is optional enrichment, never a gate. ⌘⇧K captures from anywhere in the app into the Inbox; route and link later. (It is not yet a system-wide shortcut outside the app.)

---

## 8. The bar, and where the release stands

**Full-suite alpha** (decision of 2026-06-24, still current): every module reaches tasks-level completion before the public alpha. This is effectively a 1.0-scoped alpha with a long runway, so:

- **Dogfood each module the moment it hits the bar**, rather than waiting for the whole suite.
- **Speed and reliability are launch-blocking.** The budget is about 200 ms to open a task, search or switch views with 10,000 tasks in the workspace, held by a performance spec that runs on a developer's machine (not yet in CI); search answers in about 60 ms at that size; the first load is capped at 1,050 KB compressed. Sync has to be conflict-free, because a single sync bug corrupts *several* linked modules' trust at once.

**Release state (2026-11-26).** Releases ship from version tags: 1.3 brought the connector, 1.4 Notes search and comments, 1.5 to 1.7 the Calendar rework, 1.8 the rebuilt Mail. Sign-up is invite-only: the waitlist and the gate that admits only invited addresses are built. The work queue is grouped into Closed alpha, Open alpha and Beta; the dates first set for the two alphas (2 and 16 November) have passed, and no decision records that either has started.

---

## 9. Non-goals & anti-patterns (what Moduo deliberately is NOT)

- **No Notion-style databases / relation schemas.** "Nothing to over-engineer" is a feature.
- **No abstract "generic entity" / graph view** the user must learn. (Anytype trap.)
- **No finance module, no mindmap, no whiteboard.** (§6.) Plugins and a marketplace are not planned for now.
- **No built-in AI and no AI-everywhere sparkle.** The connector only.
- **Chat is not a way around the quiet bar.** "No chat module, keep Slack" was reversed on 2026-10-02: Chat shipped on 2026-10-16 for Duo and Team, built to solve Slack's and Discord's problems. What still holds: coordination *on the work* stays async, and chat keeps inside the notification rules of §7.
- **No auto-seizing scheduler.** If scheduling assistance ships, it's suggestion-based, reversible, and reason-annotated ("moved because your 2pm ran over") — "we schedule *with* you, not *at* you." (Motion's opaque auto-reshuffle is its #1 churn cause.)
- **No fake integration.** Email and calendar are first-class in-app panes, never iframes or "opens in a new tab" (Notion's current failure), never oversold one-way sync marketed as two-way (Akiflow complaint).
- **No all-or-nothing onboarding, and no feature gates by role.** One question about what you do sets defaults and nothing else; each module greets you the first time you open it.
- **No phone app yet.** (§2.)

---

## 10. Differentiation summary (the uncontested ground)

The crowded center is **tasks + calendar + notes**. Moduo's open seams, from the landscape analysis:

1. **The schedule-to-completion loop** — bridge a scheduled block to actual completion (only possible because tasks and calendar share one app).
2. **The full cross-module entity graph** — including email, contacts and chat (the pack can't reach this).
3. **Native speed** (Tauri vs Electron).
4. **A real Free plan and a flat price for two.**

That intersection is Moduo's territory.

---

## 11. Top risks

- **Weakest-leg trap** — one mediocre module sinks the thesis. *Mitigation: per-module quality bar + the "one great moment"; harden the weakest leg before adding the next; lean on the tissue and the export so value is "the only place these connect," not "best notes app."*
- **Re-creating the maintenance tax** — too many empty configurable surfaces. *Mitigation: opinionated defaults, seeded entities, a pre-populated Home, progressive disclosure.*
- **Surfacing the moat as an abstraction** (Anytype). *Mitigation: familiar objects, one-gesture and suggested links, no graph view.*
- **Cloud-first vs the privacy/PKM crowd.** *Mitigation: mail never leaves the device; a full export (close its gaps: file contents and mail); account deletion that erases everything; the no-training framing; price below the resentment line.*
- **Performance regression as the workspace grows.** *Mitigation: a copy of the data on the device with optimistic writes (Tasks and Chat today, Notes on the same base), perf budgets as P0.*
- **Notification overload poisoning the moat**, now with chat in the product. *Mitigation: grouped by item, quiet defaults, one-click mute, chat's own limits.*
- **Dependence on Google's review.** Mail signs in with Moduo's own Google client; until Google verifies it, people see an unverified-app screen and the client is capped at 100 users. That has to be lifted before an open alpha.

---

## 12. Delta from the 2026-06 *Moduo Briefing* note (Tasks+Calendar discussion with Mike)

That note remains valid for its Tasks/Calendar mechanics (buckets, capture, drift, commit-not-schedule) and is **left untouched**. Several of its product and business assumptions were **deliberately revised**; the right-hand column is where each stands today:

| Old note said | Now |
| --- | --- |
| **Solo only for v1; team/collab out of scope** | **Shared workspaces from the start**: roles, teams, per-item sharing, and Chat for Duo and Team |
| **Free product is the full product for v1** | **Four plans**: Free, Pro, Duo and Team (§5) |
| **No AI in v1** | **AI through the connector only** (no built-in model): the app is *accessible by* a person's assistant |
| **Gantt deferred entirely** | **A lightweight Timeline view is built** (bars on a date axis, dependency lines, drag to reschedule; not MS Project) |
| **Tasks & Calendar are separate modules** | **Still separate**, but tightly looped: the schedule-to-completion loop is the flagship differentiator |
| **Plan and Execute modes** | **One Tasks screen** with Focus as a place in it; the separate Execute view is gone |
| Scope ≈ Tasks + Calendar | **Seven modules + the connective-tissue spine** (Home, Tasks, Notes, Calendar, Contacts, Email, Chat) |

---

## 13. What is landing next (as of 2026-11-26)

Nothing large is waiting to merge. In order of nearness:

- **Open pull requests, desktop connections:** Mail signs in with Moduo's Google client in installed apps (it failed there before); a mail account whose sign-in ended is parked for Reconnect; a revoked calendar login shows in Settings and can be repaired.
- **On `develop`, not yet released:** small polish to Notes, Tasks and Home.
- **Ready in the queue:** Home's first-run composition, connector hardening, the macOS updater, permission gaps (contact groups, collective booking links), privacy wording, and the remaining Notes refresh blocks. The welcome and trial emails and the account-deleted email sit in pull requests open since October.
- **In design only, no code:** a Mail re-plan (v4) and a Calendar re-plan (v2), both waiting on design answers; the Contacts v4 direction is proposed, not ratified.
- **Specified, not started:** Calls and the GitHub integration.

---

*Evidence for the research claims lives in the research corpus (Notion: Projects → Moduo → Alpha Plan → Research Insights). Where a competitor weakness is cited, it has been adversarially fact-checked: use the verified framing, not the marketing hype. Statements about what is built were checked against the code and the decision log on 2026-11-26.*
