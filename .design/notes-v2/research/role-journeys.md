> Raw research report from the Notes re-plan, 2026-10-13. Nothing here is decided. The synthesis and the calls go in [../REPLAN.md](../REPLAN.md) §3.

# Lane 5: a normal week per role in Notes, and the gap map

> Research lane, 2026-10-13, read-only, on `t/maciej/notes-replan` @ `9a8887ae`. Same exercise as [Tasks v3's role journeys](../../tasks-v3/research/role-journeys.md) and Calendar v2's, for Notes, plus two hackathon roles. Evidence tags: **[R]** read in this repo today (file:line) · **[V]** official page read this session (through search summaries) · **[F]** forum or public example page · **[M]** from memory, not checked this session · **[I]** inference. Web budget: 4 searches, all spent on the hackathon. The other roles' tool loves and hates are [M] and lean on the Tasks and Calendar lanes.

**Reading frame.** "Complete" for a role = *they can run a normal Monday to Friday, plus their end-of-month, end-of-term or end-of-event moment, without opening Notion pages, Google Docs, Obsidian, Apple Notes or a team wiki*. "Pleasant" = the first week feels like the old tool's best moments, not its setup. For the two hackathon roles "complete" is stricter: **a person who has never seen Moduo finds the brief, the rules and the schedule, and knows what to do next, in under ten minutes, with nobody explaining it.**

Marks in the tables: ✅ works today (or a Tasks v3 piece already built on this branch) · ◐ partly · ✗ no. Something only *planned* (Tasks v3 blocks not built yet, the hackathon plan) is ✗, and the reason names the plan.

---

## 0. Headline

1. **Notes already covers the core of a normal week for most roles.** Nested pages, live co-editing with presence, markdown in and out, full-text search, quote-comments, publish-to-web with sub-pages, per-note sharing, task lines that *are* tasks, the Notion import, and an agent that can build a whole tree over MCP all exist. The gaps are mostly *around* the document: arriving, finding, knowing what changed, and handing work to the team.
2. **Four gaps hit almost every role and decide the hackathon:**
   - **"Inbox" swallows prepared pages.** Notes' Inbox isn't stored; it's *every top-level note with no sub-pages* ([R] `tree.ts:4-16`, `:104-112`). An organiser who adds Brief, Rules, Schedule and FAQ as six separate pages shows a first-timer six documents under the word "Inbox". It also means something different from Tasks v3's Inbox, which is private ("Only you see your Inbox", [R] `specs/tasks-v3.md:34`); Notes' Inbox is shared.
   - **Tasks written in a note land in one person's private tray.** `/task` and "Make task" file the new task into the Tasks Inbox ([R] `notes/tasks/task-line.ts:17-31`). Under Tasks v3 that Inbox is personal, so a team splitting its idea doc into tasks gets them in whoever typed: absent from teammates' Tasks views, and the task line in the shared note may itself read "Private item" for them [I].
   - **Nobody can tell what changed, or who changed it.** A note stores who created it but not who last edited it ([R] `notes/model.ts:12-33`); body edits and renames write no activity ([R] `.design/notes/DESIGN_BRIEF.md:158`); there's no history and no "changed since you last looked". A change to a shared note notifies nobody (deferred, [R] `DESIGN_BRIEF.md:169`).
   - **First open shows no notes.** The default Home has Tasks, Calendar, Quick capture and Clock, no notes widget ([R] `dashboard/engine/default-layout.ts:22-28`); Notes itself opens on "Select a note on the left" ([R] `routes/pages/notes-page.tsx:730`). A first-timer has to know Notes exists and where to click.
3. **The hackathon's "update the FAQ and schedule live" can't survive "copy the workspace once per team".** Copies diverge the moment they're made. Today's honest answer already exists: keep the handbook in **one** place and **publish** it ([R] `notes/publish.ts:47-65`; public page at `/p/$token`). Published pages re-render from the note's saved text, so an organiser's edit shows on every team's link. Recorded as a proposal for the hackathon plan (§3).
4. **"My AI keeps the doc up to date" is broken for existing notes.** An agent can *create* notes and whole trees, but an MCP append or update to a note that has already been opened never reaches the editor, and the next keystroke overwrites it ([R] `docs/gotchas/notes.md:43`; `moduo-mcp/modules/notes.ts:255-326`). Already listed as a hard requirement for MCP-1 ([R] `specs/BUILD_ORDER.md:72`).
5. **No images or files in a note** ([R] `notes/editor/note-nodes.ts:22-38` registers no image node), although the attachments spec says inline images "belong in Notes" ([R] `specs/attachments.md:7`). Blocks creators, hurts students, organisers (venue map, sponsor logos) and anyone writing a spec.
6. **No templates and no "duplicate with sub-pages".** Templates and daily notes were cut ([R] `specs/notes.md:120`); Duplicate copies one note, not its sub-pages ([R] `supabase/migrations/20261008130000_definer_reads_item_visibility.sql:186-230`). Every role with a repeating document (lecture, meeting, client brief, episode script, discovery call, team space) rebuilds it by hand.
7. **What each role would happily do without** (§4): databases, a graph view, wiki permission matrices, slide mode, suggesting mode, page analytics. None of these is a gap.

---

## 0.1 What counts as covered

### Built today (Notes)

- **Pages:** any note can hold sub-pages to any depth; drag to reorder or nest; sidebar groups Pinned · Inbox · Workspace · Published · Archive · Trash ([R] `note-tree-sidebar.tsx:288-353`; `tree.ts:70-142`). Pins are workspace-wide ([R] `DESIGN_BRIEF.md:123`). Archive and a 30-day Trash ([R] `notes/model.ts:107-125`).
- **Writing:** first line = title; headings, lists, checkbox, quote, code block (highlighted), divider, table, links ([R] `editor/slash-commands.ts:42-120`; `note-nodes.ts:22-38`). **Not there:** images, files, toggles (cut, [R] `DESIGN_BRIEF.md:18`), callouts, embeds other than a mindmap, maths, date chips.
- **Linking:** `/page` (sub-page), `/note`, `/task`, `/contact`, `/company`, `/event` ([R] `slash-commands.ts:122-163`); `@` = workspace people only, and a mention notifies ([R] `DESIGN_BRIEF.md:99`). Task lines are live both ways; "Make task" on checkbox lines, one or many ([R] `DESIGN_BRIEF.md:75-84`). Other modules show linked notes with "New linked note": Contacts and Calendar ([R] `contacts-page.tsx`, `calendar-page-view.tsx:38`; `linked-notes-panel.tsx:56`), not Tasks projects.
- **Together:** live co-editing with presence avatars ([R] `notes-page.tsx:386`, `:649`); open notes update near-live, the sidebar list on refocus ([R] `notes/sync/engine-v2.ts:7-12`). Note-level comments with quote-comments ([R] `note-comments-panel.tsx:8-35`); no threads, resolve, edit, delete or reactions there today.
- **Sharing:** per-note sharing in the note header: Private · workspace Can view / Can edit · per person, sub-pages follow their parent ([R] `notes-page.tsx:661-672`; `sharing/share-menu.tsx:35-38`; `sharing/rules.ts:41-50`; migration `20261006210000_perm_sharing.sql`). New notes default to Workspace · Can edit; View includes commenting ([R] `docs/decisions/permissions.md:41`). Workspace members only: no guests ([R] `DESIGN_BRIEF.md:113`). *(`specs/notes.md:119` still says per-note permissions are deferred; that line is stale.)*
- **Publish:** a revocable read-only link with sub-pages, readable on a phone ([R] `publish.ts:47-65`; `public-render.ts:16-33`; DF-13 in `docs/decisions/notes.md`). In-app links (chips, task lines) are stripped on the public page ([R] `public-render.ts:42-44`).
- **Find:** the Notes sidebar searches titles and text with snippets; ⌘K finds note *titles* only, through the entity registry ([R] `global-command-palette.tsx:122-127`; `lib/palette-search.ts:22-27`). Right panel: Detail · Comments · Outline ([R] `notes/panel-views.ts:9-13`).
- **In and out:** markdown paste and copy, `.md` per note, a zip of a sub-tree, and the import wizard for markdown or a Notion export (zip inside a zip handled; images and CSV databases skipped and counted) ([R] `notes-page.tsx:515-560`; `import-zip.ts:1-27`; `import.ts:26-43`). Obsidian `[[wikilinks]]` stay plain text (no transformer, [R] `editor/markdown.ts`). No PDF.
- **Offline:** desktop fully offline, web survives dropouts ([R] `DESIGN_BRIEF.md:15`).
- **Agents:** `notes_list · get · search · create · append · update · move · archive · trash · link` ([R] `moduo-mcp/modules/notes.ts:135-390`). Create builds trees and works. Append and update don't reach an opened note (headline 4). Move can't set the order among siblings ([R] `:328-331`). No comment, publish, share or duplicate tools.
- **Capture:** ⌘⇧K then ⌘2 makes a one-line note ([R] `notes/capture-type.tsx:9-17`). ⌘N inside Notes, the palette's "New note".
- **First run:** one "Welcome to Notes" note, only in a workspace with no notes at all, and only for someone who can edit ([R] `hooks/use-notes-module.ts:216-247`). A prepared workspace never shows it.
- **Home:** a Recent notes widget exists ([R] `dashboard/ui/widgets/notes-widget.tsx`) but isn't on the default Home ([R] `default-layout.ts:22-28`).

### From Tasks v3 (built on this branch, so it counts)

The capture shell with ⌘1–7 types, the References primitive (link, chip, card, hover; "Private item", "Deleted …") and the `@ # /` grammar for prose, the right panel's title-row dropdown ([R] `specs/BUILD_ORDER.md:143`, `:158-159`). Notes hasn't adopted them yet; REPLAN §1.4 says it will.

### Planned, does not count here

Tasks v3's teams and `@Team` (TV-D13), templates and Duplicate project (TV-D15), the role question and module welcomes (TV-U17), the shared comment feed with reactions (TV-U13), task MCP writes (TV-D16) ([R] `BUILD_ORDER.md:157`, `:169-175`). The hackathon plan's invites at scale, workspace copying, organiser and judge access (`t/maciej/hackathon-plan`, nothing written yet). Chat (re-planned in parallel).

---

## 1. The ten journeys

Each role: the tool they'd use today · a normal week (what they write, read, find, share, link, and with whom) · the end-of-period moment · the one great moment · the fixes they need, and whether people outside the role want them (G-numbers point at §2).

### 1.1 Student (replacing Notion's free plan, Apple Notes, OneNote or GoodNotes; Google Docs for group work)

**Today [M]:** Notion student templates (a course page with lecture sub-pages and a deadlines table), Apple Notes for quick capture on the phone, Google Docs for group essays, a few on Obsidian. **Love:** free, nested course pages, screenshots and formulas, the phone. **Hate:** Notion's setup becomes the procrastination; group work happens in a different tool; searching last term's notes.

| Step | Cover | Why |
| --- | --- | --- |
| Mon: open "CS 201 › Lecture 5", type notes in class | ✅ | Sub-pages, headings, lists, code blocks ([R] `slash-commands.ts:42-120`). |
| Paste a slide screenshot or a whiteboard photo | ✗ | No image node ([R] `note-nodes.ts:22-38`). G8 |
| Write a formula | ✗ | No maths block. G16 |
| "Problem set due Fri" → make it a task with a date | ◐ | `/task` or "Make task" works, but it lands in the Tasks Inbox, not the course project, and needs a second step to date ([R] `task-line.ts:17-31`). G4 |
| Start each lecture from the same layout | ✗ | No templates; Duplicate copies one note ([R] `specs/notes.md:120`). G9 |
| Wed: group project doc with three classmates | ◐ | Live co-editing works once they're **members of the workspace**; no guest or link editing ([R] `DESIGN_BRIEF.md:113`). G13 |
| Read notes on the bus | ✗ | No phone app (out of scope); a *published* page is readable on a phone. G19 |
| Thu: find "that definition from week 2" | ◐ | Notes sidebar search finds the text; ⌘K only finds titles ([R] `palette-search.ts:22-27`). G14 |
| Fri: ask Claude for flashcards from this week's notes | ✅ | `notes_search` / `notes_get` over MCP ([R] `moduo-mcp/modules/notes.ts:158-189`). |

**End of term:** gather a course into a revision pack and print it (✗ no PDF, G17; ◐ zip of the course sub-tree), then archive the course (✅). **Switching:** Notion export ✅ (IM-1); Apple Notes, OneNote, GoodNotes ✗ (G18).
**Great moment:** the deadline written in the lecture note is the task on the course project, sitting on the calendar, and ticking it in the note ticks it everywhere.
**Fixes:** images (G8, everyone wants it) · lecture template (G9, everyone) · `/task` files where the note belongs (G4, every team) · maths (G16, mostly students and developers) · PDF (G17, everyone).

### 1.2 Developer (replacing Notion or Confluence for specs, Obsidian or repo markdown, HackMD)

**Today [M]:** specs and ADRs in Notion or Confluence, runbooks in the repo, personal notes in Obsidian, pairing notes in HackMD. **Love:** markdown, code blocks, keyboard-first, git-adjacent. **Hate:** Confluence's weight; specs rot away from the tickets; docs and tickets live in two tools.

| Step | Cover | Why |
| --- | --- | --- |
| Mon: write the spec for the export feature, in markdown | ✅ | Live markdown typing, paste and copy ([R] `docs/decisions/notes.md` DF-13). |
| Code blocks with highlighting | ✅ | `CodeHighlightNode` ([R] `note-nodes.ts:10`). |
| A sequence diagram | ✗ | No Mermaid or diagram block (the mindmap embed is not one). G16 |
| Turn the spec's checklist into tickets | ◐ | Batch "Make task" works; tickets land in the Inbox, private under Tasks v3. G4 |
| Reference `MOD-142` inside the spec | ◐ | Handles and references are Tasks v3; Notes' `/task` picker inserts a live line, but a typed handle isn't recognised in prose [I]. |
| Tue: Claude writes an ADR into "Engineering › Decisions" | ✅ | `notes_create` with a parent ([R] `moduo-mcp/modules/notes.ts:215-224`). |
| Wed: Claude updates the runbook after an incident | ✗ | Append/update to an opened note never shows and gets overwritten ([R] `gotchas/notes.md:43`). G7 |
| Review: "who changed the API section?" | ✗ | No last-edited-by, no history ([R] `model.ts:12-33`). G5 |
| Link to a heading from a ticket | ✗ | No heading anchors; the Outline panel only scrolls ([R] `panel-views.ts:12`). G22 |
| Keep notes on the plane | ✅ | Desktop offline ([R] `DESIGN_BRIEF.md:15`). |

**End of month:** release notes from what got done: ◐, an agent can read tasks and notes and *create* a new note, but can't append to the running changelog (G7). **Switching:** Obsidian vault ✅ as markdown and folders, `[[wikilinks]]` stay text (G18); Confluence ✗.
**Great moment:** the spec's task lines *are* the tickets, with live status in the doc, and the agent's ADR shows up filed and attributed.
**Fixes:** the MCP write path (G7, everyone using an agent) · history and attribution (G5, every team) · diagrams (G16, developers and PMs).

### 1.3 PM (replacing Notion or Confluence PRDs, Google Docs for review)

**Today [M]:** PRDs in Notion, review rounds in Google Docs because of its comments, status in Jira. **Love:** Google Docs' comment threads and resolve; Notion's linked pages. **Hate:** docs drift from the work; "is this the latest?"; chasing reviewers.

| Step | Cover | Why |
| --- | --- | --- |
| Mon: PRD from the usual outline | ✗ | No templates. G9 |
| Link the PRD to its project in Tasks | ◐ | A note can link to tasks, but a project shows no "Docs · 3" (proposed in REPLAN §1.5). G23 |
| Tue: ask design and engineering to review a section | ◐ | Quote-comments and `@` notifications work ([R] `note-comments-panel.tsx:8-35`); no threads, no resolve. G11 |
| Wed: stakeholder outside the workspace reads it | ◐ | Publish gives a read-only link; they can't comment. G13 |
| Thu: "what changed since Tuesday?" | ✗ | No history, no change marker. G5, G6 |
| Meeting notes from the planning event, with attendees | ◐ | "New linked note" on the event links it; it isn't titled, dated or filled with the people ([R] `linked-notes-panel.tsx:56`). G10 |
| Actions from the meeting → owners | ◐ | Task lines; filing and assigning happen after (G4). |
| Fri: weekly update to the team | ✅ | A note, shared, or published. |

**End of month:** roadmap review: the PRD with live task lines shows what's done ✅; a stakeholder pack as PDF ✗ (G17).
**Great moment:** a PRD whose task lines tell you what's done without a status meeting, with every decision in its comments.
**Fixes:** threads + resolve (G11, every reviewer) · history (G5) · project ↔ docs roll-up (G23) · meeting note from an event (G10, everyone who meets).

### 1.4 Founder / team of up to 5 (replacing Notion as the company wiki, Google Docs)

**Today [M]:** a Notion teamspace as handbook (how we work, pricing, onboarding), Google Docs for anything external. **Love:** one place, nested, searchable. **Hate:** "Notion becomes a second job"; nobody knows which page is current; private and shared get mixed up.

| Step | Cover | Why |
| --- | --- | --- |
| Mon: update "How we price" | ✅ | Shared by default ([R] `permissions.md:41`). |
| Keep "Investor notes" private | ✅ | Per-note Private; moving a page warns before it changes who sees it ([R] `notes-page.tsx:354-373`). |
| Tue: a new hire finds "Start here" on day one | ✗ | Nothing opens on a note; no notes on the default Home. G3 |
| A loose top-level page ("Holiday policy") | ◐ | It sits in "Inbox" forever unless nested ([R] `tree.ts:4-16`; flagged in `decisions/notes.md` 2026-07-03). G1 |
| Wed: weekly meeting note, actions to people | ◐ | Task lines land in the writer's Inbox; assigning needs a project. G4, G10 |
| Thu: "who changed the refund policy?" | ✗ | G5 |
| Hear about a change to a policy you rely on | ✗ | No change notification or follow. G6 |
| Fri: Claude drafts the investor update from the week's notes | ✅ | `notes_search` + `notes_create`. |

**End of month:** investor update from last month's (✗ G9), sent as a link (✅ publish).
**Great moment:** the handbook where every page says who changed it last and when, and the meeting note's actions are already the team's tasks.
**Fixes:** G1, G3, G4, G5, G6, G10. Every one of them is wanted outside this role.

### 1.5 Freelancer / agency of 2–5 (replacing Notion client portals, Google Docs proposals)

**Today [M]:** a Notion page per client (brief, meeting notes, deliverables) shared with the client; proposals in Google Docs. **Love:** a clean client-facing page. **Hate:** clients won't log in; rebuilding the same onboarding pages per client.

| Step | Cover | Why |
| --- | --- | --- |
| Mon: open the client's hub, read past call notes | ✅ | Contacts shows linked notes, "New linked note" ([R] `linked-notes-panel.tsx:56`). |
| Kick off a new client from the "Client space" pages | ✗ | No sub-tree duplicate or template ([R] migration `20261008130000:186-230`). G9 |
| Tue: share the brief with the client, read-only | ✅ | Publish with sub-pages. |
| …and let them comment | ✗ | No guests. G13 |
| Wed: call notes → tasks in the client's project | ◐ | Task lines land in the Inbox. G4 |
| Thu: send the proposal as a PDF | ✗ | G17 |
| Logo, moodboard, screenshot in the brief | ✗ | G8 |
| Fri: "what did we agree last month?" | ✅ | Hub roll-up + search. |

**End of project:** hand over the docs (✅ publish, ✅ zip, ✗ PDF), archive the client space (✅).
**Great moment:** the client's hub holds every call note in order, and the brief they read is the same page the team works in.
**Fixes:** G9 (everyone with repeat work), G13 (agencies, students, sales), G17, G8.

### 1.6 Creator (replacing Notion content pages, Google Docs for sponsor review, Apple Notes for ideas)

**Today [M]:** idea capture in Apple Notes, scripts in Notion or Google Docs, a content calendar database. **Love:** fast capture; a script next to its thumbnail; sharing a draft with a sponsor. **Hate:** maintaining the database; the calendar isn't their life calendar.

| Step | Cover | Why |
| --- | --- | --- |
| Capture an idea while out | ◐ | ⌘⇧K then ⌘2 makes a one-line note on desktop or web; no phone. G19 |
| Mon: write the script for episode 14 | ✅ | Headings, Outline panel. |
| Thumbnail references, B-roll stills in the script | ✗ | G8; this is the core of the job, so it **blocks**. |
| Link the script to the episode task and the sponsor | ✅ | `/task`, `/company`. |
| Tue: send the sponsor read to the sponsor for approval | ◐ | Publish read-only; no comments from them. G13 |
| Word count / read time for the script | ✗ | G21 |
| Embed the rough cut | ✗ | No video embeds. G16 |

**End of month:** look back at what shipped (Tasks); ideas archive ✅.
**Great moment:** the script, its episode task, the sponsor's hub and the publish date are one linked thread.
**Fixes:** images (G8, everyone) · embeds (G16, creators, PMs, developers) · word count (G21, creators, students).

### 1.7 Founder-led sales (replacing a CRM's notes field, Google Docs call notes, a pitch doc)

**Today [M]:** call notes typed into the CRM or a doc per account, a battlecard and pitch script in Notion. **Love:** opening an account and seeing the history. **Hate:** notes in the CRM are a text box; follow-ups get lost.

| Step | Cover | Why |
| --- | --- | --- |
| Before a call: open the company, read every past note | ✅ | Company hub roll-up ([R] Contacts). |
| Start the call note from the calendar event, with the attendees | ◐ | "New linked note" links it, without title, date or people. G10 |
| Same discovery-call outline each time | ✗ | G9 |
| Follow-ups as tasks, dated | ◐ | Task lines → Inbox; dating is a second step. G4 |
| Pitch script and objections page for the team | ✅ | Shared notes. |
| Quick capture between calls | ◐ | One-line note only ([R] `capture-type.tsx:9-17`). |

**End of quarter:** account review: hub roll-up ✅; "what changed in this account" ✗ (G5).
**Great moment:** open the company and every call note is there in order, with its follow-ups as live task lines.
**Fixes:** G10 and G9 (everyone who meets) · G4.

### 1.8 Hackathon organiser (replacing Notion public pages, HackMD book mode, Google Docs, Discord announcements)

**Today [F/V]:** participant guides are mostly Notion public pages with child pages: Participant's guide, Hackers checklist, FAQs, Submission requirements, Judging criteria, a TL;DR ([F] [hacksingapore 2024 guide](https://tribegroup.notion.site/hacksingapore-2024-Participant-s-Guide-e17f0e587dea45b7ae208de18d53ff88), [OnePiece Labs FAQs](https://onepiecelabs.notion.site/FAQs-cf3b2e8c450f4cccb8ec2851edc7e48d), [submission requirements](https://surf-dodo-27c.notion.site/Submission-Requirements-01cdefb59b904fd0a62bdc61e757da33), [TL;DR page with an extended deadline](https://bobaxmoonbeam.notion.site/TLDR-963fc6fab6984ec7a6f6a5a615c2dd13)). Questions and announcements go to Discord. HackMD's book mode turns a list of links into a navigable handbook ([V] [HackMD book example](https://hackmd.io/c/book-example/)). MLH's organiser guide covers rules, a judging plan, a run of show and a submission portal ([V] [MLH guide, judging and submissions](https://guide.mlh.io/digital-hackathons/judging-and-submissions)). Notion's own hackathon template is organiser-side planning ([V] [Notion template](https://www.notion.com/templates/hackathon)). **Love:** a public page anyone can open; edit once, everyone sees it. **Hate [I]:** the guide, the chat, the tasks and the submissions live in four tools; participants miss changes.

**Before the event**

| Step | Cover | Why |
| --- | --- | --- |
| Write brief, rules, schedule, judging criteria, resources, FAQ | ✅ | By hand, by Notion import ([R] `import-zip.ts:1-27`), or by Claude building the tree ([R] `moduo-mcp/modules/notes.ts:215-224`). |
| Schedule as a table | ✅ | `/table`. No date chips; times are text. G15 |
| Venue map, sponsor logos | ✗ | G8 |
| FAQ as collapsible questions | ✗ | Toggles were cut ([R] `DESIGN_BRIEF.md:18`); headings + Outline is the workaround. G12 |
| Make the rules read-only for participants | ✅ | Per-note "Can view", sub-pages follow ([R] `share-menu.tsx:35-38`). |
| Pin the brief, rules and schedule | ✅ | Pins are workspace-wide ([R] `DESIGN_BRIEF.md:123`), which is exactly right here. |
| Lay them out flat as six top-level pages | ✗ | They show under "Inbox" ([R] `tree.ts:104-112`). Workaround: nest under one "Hackathon" page. G1 |
| Prepare one team space per team (idea doc, research, pitch outline, submission) | ◐ | No sub-tree duplicate (G9). Claude can build N identical trees through `notes_create` ✅. Copying whole workspaces is the hackathon plan's job. |
| Milestones as tasks, linked from the schedule | ◐ | Task lines can link existing tasks; if the hackathon plan copies a workspace, every task line must point at *that copy's* task, not the template's [I]. Flagged in §3. |

**During the event**

| Step | Cover | Why |
| --- | --- | --- |
| Move the demo slot from 16:00 to 16:30 | ◐ | One edit, near-live for anyone with the note open ([R] `engine-v2.ts:7-12`); **but only in that one copy**: per-team copies don't change. G2 |
| …via Claude ("push every slot after lunch by 30 minutes") | ✗ | G7 |
| Tell everyone it changed | ✗ | No change notification; mentions are per person; no `@everyone` or `@Team` in notes. G6 |
| Show "Updated 15:42 · schedule" at the top | ◐ | Only by typing it; no automatic "edited at / by". G5 |
| Answer a question once, for everyone | ◐ | Add it to the FAQ (✅); a question asked as a comment works, viewers can comment ([R] `permissions.md:41`), with no threads or resolve (G11). Live Q&A belongs to Chat or Discord. |

**After the event**

| Step | Cover | Why |
| --- | --- | --- |
| Judges read each team's submission note | ◐ | Inside a team's workspace, or via the team's published link ✅. Judge access across N workspaces = the hackathon plan. |
| Judges score against the criteria | ◐ | A table per judge in a private note ✅; no score database, and that's deliberate (§4). |
| Publish results | ✅ | A note + publish. |
| Close the event: archive, export, decide what teams keep | ◐ | Archive ✅, zip export ✅; data lifetime = the hackathon plan. |

**Great moment:** move the demo slot once and every team's guide shows it within seconds, with "Updated 15:42" at the top. No Discord pin-chasing.
**Fixes:** a single live source (G2, mostly this role), "start here" (G3, everyone who onboards someone), the Inbox rule (G1, everyone), change visibility (G5, G6, everyone), the agent write path (G7), images (G8).

### 1.9 Hackathon participant who has never seen Moduo

**Today [F]:** a Notion public guide, a Discord server, a Google Doc for the team's idea, Slides or Figma for the pitch, Devpost for the submission.

**Minute 0–10**

| Minute | Step | Cover | Why |
| --- | --- | --- | --- |
| 0 | Open the invite link, make an account | ◐ | `/join?invite=` exists ([R] `app/router/route-tree.tsx:119-127`); invites at scale = the hackathon plan. |
| 1 | Land in the app | ✗ | Home has no notes ([R] `default-layout.ts:22-28`). A per-person landing preference exists ([R] `route-tree.tsx:134-146`) but nobody can set it for a whole event today. G3 |
| 2 | Find the brief, rules, schedule | ◐ | If the organiser pinned them, Notes shows them at the top ✅; if they were left flat, they read as "Inbox" (G1); Notes opens on "Select a note" (G3). |
| 3 | Read the rules on a phone | ✅ | The published page is phone-readable. |
| 4 | Understand what to do next | ◐ | Only if the organiser wrote a "Start here" page with steps; no welcome, because the workspace isn't empty ([R] `use-notes-module.ts:218`). G3 |
| 6 | See the schedule's next item and deadline | ◐ | The table, or the milestone task's due date in Tasks; nothing joins them. G15 |
| 8 | Find the team's own space | ✅ | If prepared (nested, shared, Can edit). |
| 10 | Know where to ask a question | ◐ | A comment on the FAQ works; most will look for a chat. |

**The rest of the event**

| Step | Cover | Why |
| --- | --- | --- |
| Write the idea doc together | ✅ | Live co-editing, presence avatars ([R] `notes-page.tsx:649`). |
| Research: paste links | ✅ | Links. Screenshots ✗ (G8). |
| Pitch outline | ✅ | Headings, Outline panel. |
| Split the work into tasks and owners | ✗ | Batch "Make task" puts every task in the typist's private Inbox (G4); assigning then asks for a project ([R] `specs/tasks-v3.md:34`). |
| See the milestones and the deadline | ◐ | Tasks (TV-D15 for the template; due dates exist). |
| Notice the organisers moved the demo slot | ✗ | G6 (and G2 if copied). |
| Submit: repo, video, slides | ◐ | A "Submission" note with links ✅; handing it to judges = publish ✅ or the plan's judge access. |

**Great moment:** within two minutes of the invite, the team is on "Start here": brief, rules, schedule, and its next three steps, and the idea doc's lines become the team's tasks.
**Fixes:** G3 and G1 first (they decide minute 0–4), G4 (blocks teamwork), G6.

### 1.10 The roles side by side

| | Student | Developer | PM | Founder / ≤5 | Agency | Creator | Sales | Organiser | Participant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Writes most | lecture notes | specs, ADRs, runbooks | PRDs, meeting notes | handbook, meeting notes | briefs, call notes | scripts, ideas | call notes | guide, FAQ, schedule | idea doc, pitch |
| Shares with | classmates | team, agent | team, stakeholders | team | team, client | sponsor, editor | team | all teams, judges | own team, judges |
| Biggest blocker today | images (G8) | agent edits (G7) | history (G5) | first open (G3) | templates (G9) | images (G8) | meeting notes (G10) | live source (G2) | first open (G3), tasks (G4) |
| Their great moment | deadline in the note = the task | spec lines = tickets | PRD with live status | handbook that says who changed it | the hub holds every call | the script, sponsor and date as one thread | the account's every call | edit once, all teams see it | "Start here" in two minutes |

---

## 2. The gap map

Severity: **blocks** (they keep the old tool open) · **hurts** (they switch but grumble) · **polish**. "Outsiders want it?" = would people outside the roles it hits still want the fix. Kind: **trust** (the note misleads about what's current, or an edit vanishes) · **no way in** (they can't arrive or reach it) · **friction** (possible, with extra steps) · **capability** (the thing doesn't exist). The trust cluster (G2, G5, G6, G7) is the one that makes people keep the old tool "just to be sure".

| # | Gap | Roles hit | Severity | Kind | Today's workaround | Outsiders want it? |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | **"Inbox" = every top-level page without sub-pages** ([R] `tree.ts:4-16`), shared, unlike Tasks' private Inbox; prepared or deliberately standalone pages live there forever | Organiser, participant, founder, PM, everyone with a wiki | blocks (event) · hurts (rest) | no way in | Nest everything under one parent page | Yes. Vocabulary clash with Tasks v3 too. |
| G2 | **No single live source across workspaces**: copied guides diverge | Organiser, participant | blocks (event) | trust | Publish the organiser's guide once; each team space links to it | Rarely (agencies with several workspaces). Mostly event-specific, so a hackathon-plan call. |
| G3 | **No way in**: no notes on the default Home, Notes opens on "Select a note", no "Start here" | Participant, founder onboarding a hire, agency onboarding a contractor, student group | blocks (participant) · hurts | no way in | Pin the page and tell people to open Notes | Yes |
| G4 | **Task lines file into the typist's Inbox**, private under Tasks v3 ([R] `task-line.ts:17-31`) | Participant, founder, PM, agency, developer, sales, student | blocks (teams) · hurts (solo) | friction | Open each task and file it | Yes, every team |
| G5 | **No edited-by, no history, no activity for edits** ([R] `model.ts:12-33`, `DESIGN_BRIEF.md:158`) | Organiser, PM, founder, agency, developer, sales | hurts | trust | Type "Updated …" by hand | Yes |
| G6 | **No notice when a note you rely on changes**; no follow; no `@everyone`/`@Team` in notes | Organiser, participant, PM, founder | hurts (blocks the event's announcements) | trust | Chat, Discord, email | Yes, if quiet (digest, follow-only) |
| G7 | **Agent edits to an opened note are lost** ([R] `gotchas/notes.md:43`) | Developer, organiser, founder, student, anyone with an agent | blocks (agent workflows) | trust | Have the agent create new notes instead of editing | Yes; already an MCP-1 must |
| G8 | **No images or files in a note** | Creator, student, organiser, agency, PM, developer | blocks (creator) · hurts | capability | Link to an image hosted elsewhere; attach it to a linked task | Yes |
| G9 | **No templates; Duplicate copies one note, not its sub-pages** | Agency, organiser, PM, sales, student, creator, founder | hurts | friction | Duplicate page by page; or Claude builds the tree | Yes |
| G10 | **Meeting note from an event isn't titled, dated or given its people** | PM, founder, sales, agency | hurts | friction | "New linked note", then type it | Yes (REPLAN §1.5 already proposes it) |
| G11 | **Comments: no threads, resolve, edit, delete or reactions** in Notes | PM, agency, organiser, founder | hurts | friction | One comment per point; delete by hand | Yes (REPLAN §1.5 has threads under review; Tasks' feed brings edit, delete, reactions) |
| G12 | **No collapsible sections** (toggles cut) | Organiser (FAQ), developer (runbooks), student | polish | capability | Headings + Outline panel | Some |
| G13 | **No outside collaborator**: published pages are read-only, sharing is members-only | Agency, student group, sales, creator, judges | hurts | no way in | Invite them into the workspace, or publish read-only | Yes; guests were deferred ([R] `DESIGN_BRIEF.md:113`) |
| G14 | **⌘K finds note titles, not their text** | Everyone | polish | friction | Search inside Notes' sidebar | Yes |
| G15 | **No dates in a note** (no `/today` date chips, no link between a schedule row and a due date) | Organiser, participant, student | polish | capability | Type the date; due dates live on tasks | Yes (REPLAN §1.5: `/` in prose is under review) |
| G16 | **No maths, diagrams or embeds** (video, Figma) | Student (maths), developer, PM (diagrams), creator (video) | hurts (per role) | capability | Code block; a link | Partly; each block serves one or two roles |
| G17 | **No PDF or print** | Student, agency, PM, organiser | hurts | capability | Publish link; `.md` export | Yes |
| G18 | **Imports beyond Notion and markdown**: Google Docs in bulk, Apple Notes, OneNote, Confluence; Obsidian wikilinks stay text | Every switcher | hurts (switching) | no way in | Export to markdown first | n/a (switching) |
| G19 | **No phone** (published pages excepted) | Student, creator, sales, participant on the move | blocks for phone-first people | no way in | Published page on the phone | Out of scope (mobile plan) |
| G20 | **Pins are only workspace-wide** | Team members | polish | friction | Agree on what gets pinned | Yes, small |
| G21 | **No word count or reading time** | Creator, student | polish | capability | Paste elsewhere | Small |
| G22 | **No link to a heading** ("see Rules § 3") | Organiser, developer, PM | polish | capability | Name the heading in words | Yes, small |
| G23 | **A project doesn't show its notes** (no "Notes · 3" on a project) | PM, agency, organiser (milestones ↔ brief), team | hurts | friction | Link both ways by hand | Yes (REPLAN §1.5 proposes the roll-up) |
| G24 | **Capture makes only a one-line note** | Sales, student, creator | polish | friction | Open Notes and write | Yes (REPLAN §1.5: Notes gives capture its own body) |

**Switching, one row per tool (mostly [M]):** Notion export ✅ (IM-1, zip in zip; databases and images skipped and counted) · Obsidian vault ✅ as markdown and folders, wikilinks stay text · HackMD ✅ (it's markdown) · Google Docs ◐ (one `.md` per doc, no bulk) · Apple Notes ✗ · Confluence ✗ · OneNote/GoodNotes ✗.

---

## 3. The hackathon in particular

### 3.1 The shape that works with what exists

Copying the guide into every team's workspace makes "update it live" impossible. The organiser's material should live **once**:

- **Option A (works today):** the organiser keeps the guide in their own workspace and **publishes** its root. Each team workspace gets one pinned "Start here" page that links to the guide and holds the team's own pages. Edits show on the published page on its next load ([R] `publish.ts`, `public-render.ts`); an open tab doesn't update by itself. Note the G7 trap made concrete: an agent's MCP append *does* reach the published page (it writes the saved text), never reaches the editor, and the organiser's next keystroke erases it from both. Costs: no comments, no search, no app chrome on the public page, and the schedule can't link to the team's tasks (in-app links are stripped, [R] `public-render.ts:42-44`).
- **Option B (needs the hackathon plan):** participants are also *viewers* in the organiser's workspace, so the guide is a normal read-only note they can comment on ([R] `permissions.md:41`: View includes commenting). Costs: a second workspace to switch to; a first-timer has two places.
- **Option C (rejected for live material):** copy the guide into every team. Fine for the team's own starter pages (idea doc, pitch outline), wrong for the brief, rules, schedule and FAQ.

*Proposal for the hackathon plan and for Maciej:* A for the alpha event; B only if participants must comment on the guide itself.

### 3.2 The minimum Notes must provide, ordered by necessity (the MVP cut)

| # | Must have | Exists? | What's missing | Necessity |
| --- | --- | --- | --- | --- |
| 1 | **One live guide** reachable from every team | ✅ Publish | Nothing in Notes for option A; the plan picks A or B | Blocks |
| 2 | **"Start here" opens first** for a first-timer | ✗ | Something that opens a chosen note on first visit to a workspace (a workspace start page, or the landing preference set per workspace by the organiser), and Notes opening on the top pinned note rather than "Select a note" (G3) | Blocks |
| 3 | **Prepared pages don't read as "Inbox"** | ◐ | Organisers can nest today; the real fix is a new Inbox rule or name (G1) | Blocks (workaround is cheap: put it in the organiser checklist) |
| 4 | **Read-only rules, editable team pages** | ✅ | Per-note Can view / Can edit with inheritance | Exists; verify in the live walkthrough |
| 5 | **Tasks from the idea doc land in the team's project** | ✗ | `/task` and "Make task" file into the project the note belongs to (or ask, like Tasks' capture, [R] `specs/tasks-v3.md:113`) (G4) | Blocks teamwork |
| 6 | **"Updated 15:42 by Ana"** on the note, automatically | ✗ | Last-edited time and person in the note header and on the published page (G5) | Hurts; without it, organisers type it |
| 7 | **The organiser's agent can edit the guide** | ✗ | The CRDT write path (G7; MCP-1) | Hurts; blocks if the organisers run the guide through Claude |
| 8 | **Images** (venue map, sponsor logos, team screenshots) | ✗ | An image block on the attachments pipeline (G8) | Hurts |
| 9 | **Team space from one template** | ◐ | Claude builds N trees via `notes_create` today; "Duplicate with sub-pages" or templates later (G9) | Hurts (workaround works) |
| 10 | **Announcements reach everyone** | ✗ | Not Notes' job if Chat ships for the event; otherwise one "Notify readers" on a note (G6) | Hurts; flagged for the Chat boundary |
| 11 | Comments with resolve for Q&A | ◐ | G11 | Polish |
| 12 | FAQ toggles, heading links, date chips | ✗ | G12, G22, G15 | Polish |

**Cut line for the event:** 1–5 are the MVP (only 2, 3 and 5 need building, and 3 has a workaround). 6–8 are the "pleasant" layer. 9–12 wait.

### 3.3 Proposals flagged for the hackathon plan (not Notes' to decide)

- Whether the guide is published (A) or shared read-only across workspaces (B).
- When a workspace is copied, task lines and references inside copied notes must point at the copy's tasks, not the template's [I].
- Who sets "Start here" and the landing view for every participant.
- Judges: published links per team, or viewer access to each workspace.
- **The role question (TV-U17)** needs an answer for events: "I'm joining an event" (participant: opens on Start here, skips module welcomes) and an organiser preset.

---

## 4. What each role would deliberately not need

Each line ties to a non-goal or an existing decision, so Notes stays light.

| Role | Doesn't need | Why it's still complete |
| --- | --- | --- |
| Everyone | Databases, properties, relation schemas, a graph view | Non-goal ([R] `docs/PRODUCT_BRIEF.md` §9; `specs/notes.md:117`). A course list is a page with sub-pages; a status is a task line. |
| Student | A handwriting canvas, PDF annotation, flashcard engine, spaced repetition | Their agent makes flashcards over MCP; GoodNotes-style ink is a phone/tablet product (out of scope). |
| Developer | Git sync of the notes, a docs-site generator, Mermaid rendering engine of its own *(if a diagram block lands, render existing syntax)* | Markdown out (`.md`, zip) feeds the repo; docs sites are a different product. |
| PM | Suggesting mode, approval workflows, document status fields, page analytics | Quote-comments (+ resolve, G11) and history (G5) answer "what changed"; status lives on tasks. |
| Founder / ≤5 | Confluence spaces, space-level permission matrices, page verification ("this page is current") | Per-note sharing with inheritance already covers a five-person team; "edited by / when" (G5) replaces verification. |
| Agency | A branded client portal with logins, e-signature, proposal pricing tables | Publish is the portal; guests (G13) are the only real ask, and they're already a deferred decision. |
| Creator | A built-in teleprompter, SEO tools, a CMS | Publish covers the draft-to-sponsor case; publishing to the web is their platform's job. |
| Sales | Sequences, call recording and transcripts in Notes | Meeting notes from the event (G10) plus the hub; transcription is an agent's job over MCP. |
| Organiser | A registration system, a submission portal with scoring, a live leaderboard | Submission = a note with links; scoring = a private table per judge; registration and invites = the hackathon plan. |
| Participant | Slides inside Notes (HackMD's slide mode), a whiteboard | They pitch from Slides or Figma and link it; the mindmap embed exists if they want a canvas. |

---

## Sources

Hackathon pages read through search summaries this session: [MLH organiser guide, judging and submissions](https://guide.mlh.io/digital-hackathons/judging-and-submissions) · [MLH organiser guide](https://guide.mlh.io) · [HackMD book mode example](https://hackmd.io/c/book-example/) · [Notion hackathon template](https://www.notion.com/templates/hackathon) · [hacksingapore 2024 participant guide](https://tribegroup.notion.site/hacksingapore-2024-Participant-s-Guide-e17f0e587dea45b7ae208de18d53ff88) · [OnePiece Labs FAQs](https://onepiecelabs.notion.site/FAQs-cf3b2e8c450f4cccb8ec2851edc7e48d) · [Surf submission requirements](https://surf-dodo-27c.notion.site/Submission-Requirements-01cdefb59b904fd0a62bdc61e757da33) · [TL;DR page with an extended deadline](https://bobaxmoonbeam.notion.site/TLDR-963fc6fab6984ec7a6f6a5a615c2dd13) · [Virtual hackathon hub template](https://glamorous-patio-de9.notion.site/Virtual-Hackathon-Website-c41088d4bcc948f59af4f19b1fbe2882).

Repo evidence: `src/features/notes/` (`tree.ts`, `model.ts`, `types.ts`, `panel-views.ts`, `publish.ts`, `public-render.ts`, `import.ts`, `import-zip.ts`, `capture-type.tsx`, `editor/slash-commands.ts`, `editor/note-nodes.ts`, `editor/markdown.ts`, `tasks/task-line.ts`, `hooks/use-notes-module.ts`, `sync/engine-v2.ts`, `ui/note-tree-sidebar.tsx`, `ui/note-comments-panel.tsx`, `ui/linked-notes-panel.tsx`, `recent.ts`, `widget.test.ts`), `src/routes/pages/notes-page.tsx`, `src/features/sharing/{rules.ts,share-menu.tsx}`, `src/components/app/global-command-palette.tsx`, `src/lib/palette-search.ts`, `src/features/dashboard/engine/default-layout.ts`, `src/app/router/route-tree.tsx`, `supabase/functions/moduo-mcp/modules/notes.ts`, `supabase/migrations/20261006210000_perm_sharing.sql`, `supabase/migrations/20261008130000_definer_reads_item_visibility.sql`, `docs/gotchas/notes.md`, `docs/decisions/{notes,permissions}.md`, `.design/notes/DESIGN_BRIEF.md`, `specs/notes.md`, `specs/tasks-v3.md`, `specs/attachments.md`, `specs/BUILD_ORDER.md`, `.design/tasks-v3/REPLAN.md` §3, `.design/tasks-v3/research/role-journeys.md`, `.design/notes-v2/REPLAN.md` §1.4–1.5.
