# Notes v2 — the re-plan

> **Status (2026-10-13): round 1 sent. Waiting on Maciej's answers to N1–N23.**
>
> - **Open calls:** N1–N23, all ❓. Load-bearing: ★ N1 (the ceiling), ★ N2 (the hackathon cut, ranked until the date is known, and the guide published once; facts already answered in Chat CH20–CH22), ★ N3 (where notes live), ★ N4 (a way in), ★ N5 (the grammar), ★ N6 (task lines). N20–N23 are opening calls.
> - **Research lanes:** four landed and folded in (decisions audit, competitor structure, role journeys, connectivity). Two still running: current state (live walkthrough) and visual audit; they fold into §1.3 and §5 when they land, without changing the calls unless they find something that should.
> - **Received:** seven proposals from the Chat re-plan (§1.6), answered in N19.
> - **Research data in the shared local database:** none yet; the current-state lane lists what it seeds in `research/current-state.md`.
> - **Prototype:** [`prototypes/structure.html`](./prototypes/structure.html), keys 1–9 switch frames, V cycles variants.
> - **Waiting on Maciej, outside the calls:** one technical item, told in chat.
> - **Uncommitted:** nothing.
>
> **Numbering:** Notes calls are **N1, N2, …**, numbered once and never renumbered. Tasks v3 calls are cited as "Tasks 55", "Tasks default u"; Calendar v2 calls as "Calendar C3". Shipped Notes blocks keep their ids (`NO-1…NO-10`, `NO-9b`, `NO-7b`, `NOTE-FIX-1`, `IM-1`, `DF-13`); new blocks continue the `NO-` lane.
>
> Branch `t/maciej/notes-replan`, on top of `t/maciej/tasks-v3-build` @ 5c7c03c4 (2026-10-13). Local build mode (BUILD_ORDER's 🟠 box): local Supabase is prod, no pushes to `maciej`/`develop`, no PRs until Maciej says "release"; backing the branch up to origin is fine. Process: [`docs/agents/module-replan.md`](../../docs/agents/module-replan.md) (on `t/maciej/tasks-v3-build`). North star: [`specs/tasks-v3.md`](../../specs/tasks-v3.md), [`.design/tasks-v3/REPLAN.md`](../tasks-v3/REPLAN.md). Sibling plans: Calendar (`t/maciej/calendar-replan`, paused), Chat (`t/maciej/chat-replan`), the hackathon's cross-module plan (`t/maciej/hackathon-plan`).

## 0. How to read this

| § | What it covers |
| --- | --- |
| §1 | What's wrong, and why; what's strong; what Notes must adopt from Tasks v3 |
| §2 | The proposed shape of Notes |
| §3 | One product, every role (incl. the hackathon) |
| §4 | Each view, today and its target |
| §5 | The visual north star, applied to Notes |
| §6 | Technical decisions I'm taking, so the designer doesn't have to |
| §7 | What Notes waits on from the Tasks v3 build |
| §8 | The calls |
| §9 | What happens next |

**Goal (from Maciej, 2026-10-13):** make Notes complete and pleasant for hackathon organisers and participants (the first concrete use), and for students, developers, PMs, founders and teams of up to 5, freelancers and agencies, creators, and founder-led sales. Each should run a normal week without Notion pages, Google Docs, Obsidian or Apple Notes, or a Confluence-style team wiki. Not 1-to-1 copies; earlier decisions can be overturned with evidence. The module is done only when it wires into the spine, ships its MCP tools and defines its dashboard widgets.

**Known inputs:**
- **The hackathon.** Moduo may help organise one soon: an early chance for real user testing and brand recognition. Every team gets a Moduo workspace the organisers prepared: the brief, rules, schedule, judging criteria, resources and FAQ as notes; milestones and deliverables as tasks; a place for the team's own idea doc, research and pitch outline. Notes must make that prepared information easy to find and follow for someone who has never seen Moduo. The date sets an explicit MVP cut inside the plan.
- **What exists:** Notes was rebuilt and shipped in July (NO-1…NO-10, NO-9b, NO-7b, the DF-13 editor baseline, IM-1 Notion import): Lexical + Yjs collaboration, publishing, the MCP connector.
- **Chat** is being re-planned in parallel (`t/maciej/chat-replan`). The boundary: a discussion about a note lives on the note (comments, plus reactions as Tasks' TV-U13 built them); chat owns conversations; both link items through RF-1 references. Any cross-module rule beyond that is recorded here as a proposal and flagged for Maciej.
- **The hackathon's cross-module layer has its own plan** (`t/maciej/hackathon-plan`, → `specs/hackathon.md`): web access, invites at scale, one prepared workspace copied into N team workspaces, organiser and judge access, plan gates, what happens to the data afterwards. Notes decides only what Notes itself must provide for it; anything in that list is a proposal here, flagged for that plan. In the Tasks v3 build, TV-D13 (teams), TV-D15 (templates, Duplicate project) and TV-U17 (onboarding) were moved earlier for the hackathon. Calendar, Email and Contacts are out for it.

**Constraints:** desktop and web only (mobile gets its own plan later); no Notion-style databases (PRODUCT_BRIEF non-goal); the hackathon MVP cut is explicit in the spec's blocks; no new top-level routes without Maciej's explicit ask; AI only through MCP.

---

## 1. Diagnosis

*From the research lanes: [current state](./research/current-state.md) (code and the live local app), [visual audit](./research/visual-audit.md), [early-decisions audit](./research/early-decisions-audit.md), [competitor structure](./research/competitor-structure.md), [role journeys](./research/role-journeys.md), [connectivity](./research/connectivity.md).*

### 1.1 The root cause

Notes was planned on 2026-07-03 and built in two days (NO-1…NO-10). It was specified for **one writer and his agents, in a workspace of two** ([audit §1.1](./research/early-decisions-audit.md)):
- the job was "open, type, done": capture first, filing optional and later;
- agents were authors ("agents build whole doc trees");
- "per-user pins would need a new table; acceptable at ≤2-person alpha".

No product round touched Notes after that. Every later change came from outside it: the import fixes, the Lexical upgrade, October's sharing work, and Tasks v3's shell pieces.

Tasks' root cause was "a solo planner's assumption stored as a column"; Calendar's, "a solo planner's habit stored as the data model". **Notes' is: a solo writer's habits stored as the workspace's shared structure.** Things that belong to one person were stored as the shape of the tree, or as flags everyone shares:

| What Notes stores | The solo-writer assumption | What reverses it |
| --- | --- | --- |
| **The Inbox is worked out from the tree:** any top-level note with no notes inside it | Every loose top-level note is *my* unfiled thought | Tasks 20 made the Inbox personal. Today a quick note is posted to everyone's "Inbox", and an organiser's standalone "Rules" note sits in every participant's Inbox |
| **Pins are one flag on the note**, the same for everyone | Two people agree on what's pinned | Tasks pins follow the person (U6-6) |
| **The welcome note is seeded once per workspace** | The first person to open Notes is the only one to teach | Tasks 34: once per person |
| **A task written in a note goes to "the Inbox"** | The note's writer will do the task | Tasks 20 made that Inbox private, so the team sees "Private item" in its own idea doc |
| **Published · Archive · Trash are always in the sidebar** | The reader is the curator | Tasks 98: no permanent housekeeping rows |
| **Trash empties when someone opens Notes** | The writer opens Notes daily | Tasks, projects and files empty on a server clock; notes don't |

**What the root cause hides: the reader.** Every July decision is about writing (capture, grammar, sync, markdown in, agents writing). Nothing decided how someone who didn't write the notes finds and follows them. For the hackathon that person is the main user.

**A second, smaller cluster:** in July Notes was the first module with an editor, so it ratified its own conventions; Tasks v3 has since ratified app-wide ones (the `@ # /` grammar, the panel, the comment feed, references, the shared store, "Recently deleted"). None needs a reversal of data; each needs adoption.

### 1.2 What is genuinely strong (keep)

**Product:**
- **Notes nest to any depth**, with drag to reorder and nest. A real Notion export (350 pages, 9 levels) imports, zip inside a zip handled.
- **A checkbox stays a checkbox; a task line is the task.** `/task` and "Make task" turn a line into a real task; checking it, renaming it or rescheduling it in Tasks shows in the note.
- **Markdown at every door:** paste, copy, `.md` export, a zip of a whole branch, the import wizard, agents reading and writing markdown.
- **Writing offline:** desktop works with no network; the web keeps typing through dropouts and reloads; nothing ever shows a conflict.
- **Live co-editing** with "who's here" avatars.
- **Sharing per note, already built** (October): Private, the workspace (view or edit), or chosen people; notes inside follow their parent. The July docs still say "deferred"; that's out of date.
- **Publish to the web** with the notes inside, readable on a phone.
- **Agents create whole trees** through MCP.
- **Notes gave the app its reference chip**: RF-1 grew Notes' chip into the References node in place.

**Platform:** CRDT bodies with an idempotent outbox; one-time server materialisation of imported notes; every read through the same sharing rules as MCP.

**The ideas are right. What's missing is the reader, the team, and the app-wide rules that came after.**

### 1.3 What's broken, in five kinds

**A · Structure: one person's habits as everyone's tree.**
- The Inbox is derived and shared (§1.1).
- Pins are shared; the welcome is per workspace.
- Who can see a note never shows in the tree: a private note and a workspace note look the same.
- Notes built by an import or an agent don't list the notes inside them in their text (only the editor's own "+" writes that list).
- A task written in a shared note lands in the writer's private Inbox.

**B · Trust: things that make people keep the old tool open** (ranked; [current state](./research/current-state.md) adds what the live walkthrough found):
1. **A note's markdown loses formatting once it's edited.** The saved copy drops links, bold and tables, and that copy feeds the published page, export, search and agents. An organiser fixing a typo in the rules strips the links from the public rules page.
2. **An agent's edit to an existing note is overwritten** by the next keystroke. Creating works; appending and replacing don't.
3. **Tasks written in a shared note read "Private item" for teammates** (they're filed into the writer's Inbox).
4. **Nobody can tell who changed what.** No "edited by", no history, no "changed since you read".
5. **A teammate's new note, rename or move shows only when you come back to the window.**

**C · Capability gaps** ([role journeys §2](./research/role-journeys.md), 24 gaps):
- no images or files in a note;
- no templates, and Duplicate copies one note without the notes inside it;
- no date chips and no `#` in a note;
- comments can't be edited, deleted, resolved or reacted to;
- ⌘K finds note titles, not their text;
- a meeting note from an event isn't titled, dated or given its people;
- a project doesn't show its notes.

**D · Visual seams** (from the [visual audit](./research/visual-audit.md), §5).

**E · No way in.**
- No start page: Notes opens on "Select a note on the left".
- The default Home has no notes widget.
- A prepared workspace never shows the welcome note (it's skipped when any note exists).

### 1.4 What Notes adopts from Tasks v3 (binding unless Maciej agrees to change it)

| Piece | What it means in Notes |
| --- | --- |
| The 3×3 layout (Tasks 48b) | Left = the overview of notes (the tree and its groups), centre = the open note, right = context about it; the bottom bar holds the module's tools and each panel's toggle. No rails, strips or extra columns. |
| Visual rules 38–46a | Three readable text levels + one decorative; hover = fill; one selection tint, focus ring, drop target and drag preview; people's words never capitalised (note titles stay as typed); one date/time/duration grammar ("Edited 3:00 PM · Oct 16"), nothing truncates that carries meaning; two-initial avatars (presence, comments, "edited by"); density everywhere (tree rows, menus, the editor's block spacing); one chip and one count language; the accent budget (selection > today/now > done > queued); text never rotated. |
| The north-star kit (DS-6) | NavRow and GroupHeader for the tree, Toolbar grammar for the note's header, Chip and Card for references, Feed for comments and history, EmptyState, PropertyRow for Details, Avatar, DateField for `/date`. |
| The right panel (SH-1, Tasks 72a) | The title row is a dropdown of Notes' hand-picked views (about this · alongside); a reference opened inside the panel shows as "← item". Notes registered its old tabs unchanged (`notes/panel-views.ts`); the rebuild replaces them. |
| One capture (Tasks 90, 90b) | ⌘⇧K always opens as Task; **⌘2 inside the modal switches it to Note**. Notes' capture type is a provisional one-liner today (`notes/capture-type.tsx`); the rebuild gives it its own body. ⌘N inside Notes = a new note here. |
| References (RF-1, Tasks 55) | Notes defines the note's link, chip, card and hover preview, plus "Private item" and "Deleted note". The note card in call 55: title, excerpt, who edited it and when; the note chip was left undefined ("—"). Notes also *hosts* references in prose. |
| The `@ # /` grammar and `/today` date chips (Tasks 33, 33a, RF-1-8) | In a note: `@` mentions people first, then things (a person is notified; a thing is linked); `#` tags; `/` runs commands, and in prose `/today`-family inserts a date chip. |
| Comments (TV-U13, Tasks 88, default q) | One feed with "All · Comments", comments editable and deletable, reactions that never notify, no threads. (The reaction set itself changes app-wide by Chat's proposal Chat-1, §1.6.) |
| The bottom-bar mode pattern (Tasks 82b) | Selecting several notes in the tree shows a short action row with keys, then More. |
| The key map's conventions | ⏎ opens, `e` edits, ⌥⇧ arrows move, ⌘⌫ deletes one, bare ⌫ only with ≥2 selected; Notes adds its own table in round 2. |
| The notification table (Tasks 80) | Notes adds its rows in the same format (event · who hears · where · when · turned off by), inside the channels Tasks 73 allows: bell, desktop (menu bar) and browser. No email. |
| Time & region (Tasks 76) | Every "edited", "published", comment and history time follows it. |
| Motion tokens (Tasks 81) | Fast ~100 ms, base ~180 ms, slow ~280 ms; four patterns; reduced motion = opacity only; no blur. |
| The agent-session status pattern (Tasks 51, 52) | An agent's edits are attributed "Alex · via Claude Desktop" in the trail and history; an agent writing a note shows as status, not conversation. |
| The state rules | Loading = skeleton, never "nothing here"; empty teaches one gesture; filtered to nothing says so; offline per the store's rules; read-only hides edit affordances; very large stays fast. |
| The shared store (TV-D11a) | Synced data (the notes list, tree, metadata) goes through the one store per workspace: device cache, delta sync, Realtime, one-field rollback. |
| Templates (Tasks 9, 79) | The shape Tasks decided: "Save as template", the template is its own editor, yours until shared with the workspace. |
| Onboarding (Tasks 34, TV-U17) | One welcome per module, once per person, at most three steps, reopened from ⋯; the role question sets defaults only. |
| The decision-entry format | Who · what · why · rejected, in `docs/decisions/notes.md`. |

### 1.5 What Tasks already defines for Notes — honoured, or renegotiated here

| Tasks defines | Notes' position |
| --- | --- |
| ⌘2 in the capture modal = Note; "Note · Quick notes" as its default destination (Tasks 90a, 90b; SH-1 decision) | Honoured; the destination is your **Inbox** (N3, N11), one word app-wide. |
| Capturing a task while a note is open adds a "From:" chip, linked `spawned-from` (Tasks 93; U14-5; Notes already publishes its open item through `useCaptureSource`) | Honoured. |
| The note's reference card: title, excerpt, who edited it and when (Tasks 55) | Honoured. The chip is the research's "note icon · title" ([capture-references-teams.md](../tasks-v3/research/capture-references-teams.md)); the card's "Edited by Sam" needs the last-editor column (§6 #12). |
| "Deleted note" tombstone; "Private item" with no title, no preview, no leak into notifications or the trail (Tasks 55, RF-1-3) | Honoured. RF-1-9 left a gap: notes have no Realtime feed for live references; Notes v2 adds it (§6). |
| A Notes reference stores its label today (RF-1-2: "Notes (not rebuilt) keeps writing the label") | **Renegotiated (technical):** Notes v2 stores `{type, id, display}` only, like task descriptions; old labels are ignored at render (§6). |
| `/` in prose creates only tasks (RF-1-8) | **Renegotiated for notes (N5):** in a note `/` makes or inserts (task, note inside, contact, dates, files, templates, block types); `@` points at what exists. |
| No threads on comments (Tasks default q) | Honoured now; a notes-only exception asked for later (N7, step 2). |
| Archived and Recently deleted open from the sidebar's ⋯, never as permanent rows (Tasks 98); "Recently deleted" is the name (Tasks 78) | Honoured (N3): Published, Archive and Recently deleted move into the sidebar's ⋯. |
| Sidebar rules (Tasks 29, 29a–e): no glyphs on views, sentence-case headers, groups collapse, Pinned only once something is pinned | Honoured. |

### 1.6 Proposals received from other re-plans

**From the Chat re-plan** (2026-10-13, [`chat-v2/proposals.md`](../chat-v2/proposals.md) on `t/maciej/chat-replan`, "To the Notes re-plan"; decided on Chat's side, proposals for Notes):

| # | Proposal | Notes' position |
| --- | --- | --- |
| Chat-1 | **Reactions are no longer six fixed words** (CH16a, CH49): comments on notes, tasks and messages share one reaction component — your own quick row, any emoji, the workspace's custom emoji. Whether a reaction notifies stays each module's call (Chat: never). | Adopt the shared component (it replaces TV-U13's six fixed reactions); reactions on notes never notify, as in Tasks and Chat (N7). No schema change for Notes: the comment gate already has a `note` branch. |
| Chat-2 | **"Mentioned in" on a note** (CH11): a message mentioning a note leaves one quiet line in the note's Linked, "Mentioned in Acme · Oct 12", one per conversation, seen only by people who can read it. | N19: recommend yes, in Linked. |
| Chat-3 | **"Make a note" from selected messages** (CH30d): a note quoting the messages, with authors, times and a reference back, filed like any capture. | N19: lands in your Inbox, quoting the messages. |
| Chat-4 | **Decisions** (CH13, CH52): a decision message that mentions a note shows on it ("Decided with Mike · Oct 12: …"), only to people who can read the conversation. | N19: recommend yes, in Linked. |
| Chat-5 | **A note shared in chat is a reference card**; "Discuss in chat" stays out of both modules. | Already Notes' position (§1.5). |
| Chat-6 | **Past dates app-wide** (CH29c, rule 41): "Today · Yesterday · Mon · Oct 9 · Oct 9, 2025", never "2 hours ago". | Adopt for "Edited …", comments and history. |
| Chat-7 | **Quiet hours** (CH41) live in Time & region and hold every module's notices, note mentions included. | Adopt; Notes' notification rows respect them. |

**What Notes provides to other modules** (contracts for their rebuilds, not today's code):
- **References:** the note's link, chip, card and hover preview; "Deleted note"; "Private item".
- **Roll-ups:** "Notes · 3" on a project, a contact, a company and an event: notes that link to it, with excerpts (the spine's grouped roll-up, never a graph).
- **Meeting notes** for Calendar (proposal, flagged for the Calendar re-plan, which is paused): "New note from this event" creates a note linked to the event, titled and dated, with its people.
- **Chat** (proposal, flagged for the Chat re-plan): a note shared in a conversation shows as a reference card; a discussion about the note's content belongs on the note (comments), and "Discuss in chat" is not a Notes feature.
- **Home:** Notes' widgets (round 1 opens, round 2 details).
- **MCP:** the notes tools for agents as delegates.

## 2. The proposed shape

```
Top bar (global):   modules · Focus timer · Help · bell · you
Left · overview:    Inbox (yours) · Pinned (yours) │ Workspace · Shared · Private   ← one tree, sectioned by who sees it
Centre · the note:  where it is · who's here · Share · ⋯
                    Title
                    Edited Today 3:12 PM · Mike Chen
                    the text: task lines, references, dates, tables, images
Right · context:    the title-row dropdown: Details · Comments · Outline (about this note)
                    · the linked project's tasks (alongside); anything opened from the text stacks as "← item"
Bottom bar:         ◧ · Search · Capture · New · ◨   (selecting several notes swaps the centre for their action row)
```

**One name per concept** (N3):

| Concept | The word | Not |
| --- | --- | --- |
| The thing you write | **note** | page, doc, document |
| A note inside a note | **a note inside it** (the `/page` command keeps its name for Notion habits) | sub-page, child |
| Your tray for quick notes | **Inbox** (yours, as in Tasks) | Quick notes |
| Who sees a top-level note | **Workspace** (everyone) · **Shared** (some people) · **Private** (you) | Teamspace, space |
| A note's link to a project | **its project** (a dot, as in Tasks) | folder, container |
| Deleted notes | **Recently deleted** (as in Tasks) | Trash |
| A workspace's front door | **the start page** | home, welcome note |

**Principles** (each inherited or argued in the calls):
1. **Notes are for reading as much as writing.** The reader gets a front door, sees who changed what, and knows what changed since they last read (N4, N8).
2. **The tree shows who sees it.** The section a top-level note sits in *is* its sharing; notes inside follow their parent (N3).
3. **Mine stays mine until I file it.** Quick notes and pins belong to the person (N3, N11).
4. **A note links to the work it's about.** Its project, its tasks, the people and emails in its text: by default, easy to remove (N5, N6).
5. **One grammar, one panel, one feed, one reference** across the app (§1.4).
6. **No databases, no property schemas, no graph** (PRODUCT_BRIEF §9).

## 3. One product, every role

From the [role-journeys lane](./research/role-journeys.md) (a normal week per role, plus the hackathon's before, during and after).

| | Writes most | Shares with | Blocked today by | The great moment |
| --- | --- | --- | --- | --- |
| **Student** | lecture notes | classmates | images | a deadline written in the note is the task |
| **Developer** | specs, decision records, runbooks | team, their agent | agent edits lost | spec lines become tickets |
| **PM** | specs, meeting notes | team, stakeholders | no history | a spec whose tasks show their live status |
| **Founder / team of up to 5** | handbook, meeting notes | team | no way in | a handbook that says who changed it |
| **Freelancer / agency** | briefs, call notes | team, client (published) | no templates | one place holds every call with the client |
| **Creator** | scripts, ideas | sponsor, editor | images | script, sponsor and date as one thread |
| **Founder-led sales** | call notes | team | meeting notes from events | every call with an account, in one place |
| **Hackathon organiser** | the guide: brief, rules, schedule, judging, resources, FAQ | every team, judges | no single live source | edit once, every team sees it |
| **Hackathon participant** | idea, research, pitch outline, submission | own team, judges | no way in; team tasks go private | "Start here" read in two minutes |

**What each role would deliberately not need** (so Notes stays light): databases, properties, a graph view, page analytics, suggesting mode and approval flows, slides, a whiteboard, a handwriting canvas, a CMS, a submission portal with scoring. Each is either a PRODUCT_BRIEF non-goal or someone else's product ([role journeys §4](./research/role-journeys.md)).

**The hackathon, in particular** ([role journeys §3](./research/role-journeys.md), [competitor structure §3](./research/competitor-structure.md)):
- **Copying a prepared workspace per team freezes the rules.** Mid-event fixes to deadlines and rules are the normal case (Devpost's update feeds are full of them), and a copy never receives them.
- **Decided in Chat's round** (Chat CH20–CH22, 2026-10-13, Maciej): the date is unknown; at most about 100 people, so about 20–25 teams of 4–5; **no event workspace: each team gets its own workspace on a Team plan**; organisers' news goes out by email and venue screens for the first event (Chat CH69).
- **So the guide lives once, outside the team workspaces:** the organisers keep it in their own workspace and publish it; each team workspace starts with a prepared start page that links to the guide's sections, plus the team's own starting notes (idea, research, pitch outline, submission). The guide itself is never copied, so a fix reaches every team on their next look (N2).
- **The minimum Notes must provide** is in N2's MVP cut.

## 4. The views — today and their target

Round 2's work, view by view and state by state (empty, loading, error, read-only, offline, very large). The views: the sidebar and its sections · a note (reading and writing) · the start page · a note's Details, Comments, Outline and History · the capture's Note type · Share and the public page · Archive and Recently deleted · search and ⌘K · import and export · the references Notes defines (link, chip, card, hover; "Private item"; "Deleted note") · Home's widgets · the MCP tools.

## 5. The visual north star, applied to Notes

*(From the visual-audit lane.)*

## 6. Technical decisions I'm taking

Each: decision · why · rejected. Most come from the [connectivity lane](./research/connectivity.md) §1–2. They become decision entries in `docs/decisions/notes.md` at the spec step.

1. **Lexical and Yjs stay.** The editor, the CRDT bodies, the outbox and the materializer are sound. *Rejected:* another editor (a rewrite for no user-visible gain).
2. **Note metadata joins the shared store (TV-D11a); bodies stay on the Yjs engine.** The tree (id, parent, position, title, project, pinned-for-start, archived, sharing mode, published, created/edited, deleted) becomes a `notes` entry in the store with a meta-only column list. A trigger keeps a `meta_updated_at` stamp, so typing never re-reads metadata, and writes a thin `note_changes` feed that is published for live updates; the sharing feed widens to notes. The store starts for members with Notes or Tasks access, and reads Tasks' tables only with Tasks access. *Why:* one copy for the Notes page, Home, hubs, references and capture; a teammate's new note appears live. *Rejected:* publishing `notes` itself (every push would send the whole row, snapshot included, to every subscriber); a Notes-only metadata engine (one more per-screen read).
3. **The per-note live channel follows Chat's channel pattern**, and Notes' device copies follow the store's lifecycle rules (D11a-2). *Why:* one way for every live surface and every device copy in the app. *Rejected:* a per-module scheme.
4. **The Inbox is stored, not derived.** A captured note carries the person whose Inbox it's in and is private to them; filing it (moving it into a section or under a note) gives it that place's sharing. The derived rule is deleted. *Rejected:* keeping "a top-level note with nothing inside" as the Inbox.
5. **Sections are computed from a top-level note's sharing**: the workspace grant → Workspace; only people → Shared; none → Private. Moving a note between sections is a sharing change, with Undo. *Why:* the tree and the sharing can never disagree. *Rejected:* a stored section column.
6. **Pins live in each person's synced preferences** (Tasks U6-6), and **the start page is one setting on the workspace**, set by an owner or admin. The shared `is_pinned` flag is read once into the admin's start choice, then dropped. *Rejected:* keeping the shared flag.
7. **A note's project is a column on the note** (`project_id`), inherited from the nearest note above that has one, shown as the project's dot. It never changes who can see the note. *Rejected:* notes held inside projects (breaks for members without Tasks access; two sharing rules).
8. **Task lines are re-cut onto Tasks v3** before TV-D7: the status icon by category (Won't do has its own, never struck through), `due_on`, sessions, facts read from the shared store; a new task is made through `tasks_op_create` in the note's project, else in the writer's Inbox; the link is written task → note `spawned-from`, as capture does, with a one-off fix for old links that point the other way. *Rejected:* the July bridge (it breaks at TV-D7, and Won't do already shows as an open line).
9. **One `@ # /` grammar:** the spine's three menu plugins, with Notes' block commands fed into `/` through `candidatesFor`. References are stored as `{type, id, display}` with no title (old stored titles are ignored when shown). The date chip node is registered in notes. *Rejected:* keeping Notes' own slash plugin (two grammars, three meanings of `@` today).
10. **Lossless markdown.** The editor writes a note's markdown with its own transformers on save, and server paths (import, agents) build it with the same transformers headless; the lossy text extraction is retired from export, the published page, search and agents. *Why:* the editor is the only faithful serializer. *Rejected:* making the extraction lossless (two serializers drift).
11. **Agent edits are real CRDT writes.** The connector loads a note's document, applies the edit headless, and appends the update like any client, so open editors receive it live and nothing is overwritten. A spike comes first; until it lands, `notes_append` and `notes_update` refuse notes that already have a document instead of half-working. Agent writes are attributed "via <key name>". *Rejected:* writing the markdown copy directly (today's bug); queueing markdown for the next client to apply (a note nobody opens never updates).
12. **"Edited by" is stored:** `last_edited_by` / `last_edited_at` stamped by the body-push op; one activity line per person per editing session, not per push. *Rejected:* an activity row per push.
13. **Versions per editing session** (`note_versions`: a snapshot, its editors, when) power "changed since you read" now and History later; reading a note records when you last read it (`note_reads`). *Rejected:* diffing from the update log (compaction drops it).
14. **Comments on notes use the app's comment feed** (TV-U13; Chat-1's reaction component); a quote becomes a field on the comment. Passage discussions, later, anchor to marks stored in the document. *Rejected:* text-offset anchors (they break as the text changes).
15. **Images and files ride the attachments pipeline** (AT-1/AT-2): an image or file node stores the attachment's id; published notes serve their images through short-lived links. *Rejected:* images inside the document (size, erasure).
16. **Duplicate and templates copy a branch on the server** and return a source → copy map, so task lines in a copy point at copies of their tasks, never at the originals (TV-D15's apply does the same for tasks). *Rejected:* copies that point at the same tasks (two notes would tick one task).
17. **Search is one RPC** (`notes_search`, under the same sharing rules, with snippets) used by Notes, ⌘K and MCP. *Rejected:* each surface querying the text index itself.
18. **Recently deleted empties on the server clock** (`purge-deleted`, like tasks and files). *Rejected:* the client sweep.
19. **Every new table** (`note_reads`, `note_versions`, `note_changes`) joins account erasure and the full export in the block that creates it, with a test (Tasks Assumption #26).

## 7. What Notes waits on from the Tasks v3 build

Status from `specs/BUILD_ORDER.md` on the integration branch (`origin/t/maciej/tasks-v3-build` @ 5c7c03c4, 2026-10-13). ✅ landed · ○ not yet.

| Tasks v3 block | What Notes needs from it |
| --- | --- |
| SH-1 ✅ | The panel registry and the capture registry |
| DS-6 ✅ | The kit Notes is drawn with |
| RF-1 ✅ | References: the node Notes already stores, previews, "Private item", the `@ # /` grammar |
| TV-D8 ✅ | `tasks_op_create` / `_update`: task lines create and edit through them |
| TV-D9 ✅ · TV-D10 ✅ | Statuses by category, `due_on`, sessions, projects/areas/sections: what a task line shows and where a minted task is filed |
| TV-D11a ✅ · TV-D11b ✅ | The shared store and its sync feed, which notes' metadata joins |
| TV-U14 ✅ | The capture body the Note type follows |
| TV-U13 ✅ | Comments: edit, delete, six reactions, the All · Comments feed |
| TV-D12 ✅ | The notification generator and table; `@person` in prose notifying |
| TV-D14 ✅ | Time & region |
| TV-U12 ✅ | The bottom-bar mode pattern for multi-select |
| TV-D13 ✅ | Teams: `@Design` in a note or comment |
| TV-D15 ✅ | Templates: the shape Notes' templates follow |
| TV-D16 ○ | The v3 MCP surface and its attribution, which Notes' tools join |
| TV-U17 ✅ | The role question and the welcome pattern |
| AT-2 ✅ · AT-3 ○ | The attachments pipeline images and files ride (N10) |
| TV-U16 ○ | The project overview that would show a project's notes (N21) |
| TV-H1 ○ | Home's widget conventions (N23) |
| TV-D7 ○ | The contract cleanup: Notes' task-line re-cut must land before it (§6 #8) |

Round 3 reconciles in-flight work that touches Notes: MCP-1 (the connector's open item for agent edits), PERM-10's open gaps, AT-3, and anything on `maciej` or `develop` that changed Notes files since July.

## 8. The calls

**How to answer:** call numbers with ok / no / notes, as for Tasks. Every call has a recommendation, the alternative I'd reject, and whether people outside the target roles would still want it (Tasks 48a). Collision classes as in Tasks: (a) folds into open work, (b) new work, (c) re-decides something ratified.

Prototype: [`prototypes/structure.html`](./prototypes/structure.html), keys 1–9 switch frames, V cycles variants.

### Round 1 · the shape (2026-10-13)

| Status | Calls |
| --- | --- |
| ❓ Open, load-bearing | ★ N1, ★ N2, ★ N3, ★ N4, ★ N5, ★ N6 |
| ❓ Open | N7–N19 |
| ❓ Opening calls (details in round 2) | N20–N23 |

**★ N1 · The ceiling: Notes replaces Notion pages, Google Docs, Apple Notes and a small-team wiki, with a line**
- **The goal** is a normal week without those tools. The ratified ceiling was "Notion-ease minus databases, Obsidian minus local-first", with templates, daily notes and folding cut, and per-note sharing "deferred" (it has since been built).
- **In:** notes inside notes to any depth; sharing you can see in the tree; a front door for readers; who changed what, and what changed since you read; templates and duplicating a note with the notes inside it; images and files; task lines filed where the team sees them; one `@ # /` grammar; comments on the app's feed; publish with the notes inside; markdown in and out; Notion import; writing offline; agents as authors whose edits land.
- **Out, permanently:** databases, property schemas, relation columns; a graph view; synced blocks; a template gallery or marketplace; page analytics and view counts; permission matrices beyond "who sees this note"; suggesting mode and approval flows; slides; a whiteboard; AI in the interface (MCP only).
- **Out for now:** a phone app (its own plan); guests from outside the workspace (publishing covers reading; judges are the hackathon plan's call); daily notes (a template plus `/today` covers most of it); maths, diagrams and embedded video.
- *Recommend: yes, this line.* Rejected: keeping July's line (templates and folding cut, no reader features): teams keep Notion open for exactly those. Rejected: Notion parity (databases are the non-goal, and the competitor lane found small teams complain about findability, not missing power).
- *Outside the target roles?* Yes: this is what anyone who writes with others expects.
- (c) re-decides BRIEF §2's "templates-as-a-system" non-goal and DESIGN_BRIEF §1's cuts.

❓ OK?

**★ N2 · The hackathon: the cut, and the guide published once**
- **Already known** (your answers in Chat's round, CH20–CH22): the date is unknown; at most about 100 people, about 20–25 teams of 4–5; each team in its own workspace, no event workspace. I won't ask these again; the **date** is the one fact still open, and the cut below is ranked so it can be drawn as soon as you know it.
- **The cut, by how far away the hackathon is:**

  | If the hackathon is… | Notes ships before it |
  | --- | --- |
  | **4 weeks or less** | **Must:** the Inbox fix and the sections (N3) · the start page and a way in (N4) · task lines that land where the team sees them (N6) · published pages that keep their formatting and show "Updated …" (N14) · "Edited by" (N8, first part) · copying a prepared set of notes, with the notes inside, into each team's workspace (N9, first part; the hackathon plan runs the copy) · agent edits that land (N20, if organisers write with Claude) · one technical item, told in chat |
  | **5–8 weeks** | the above, plus **pleasant:** images (N10) · "Changed since you last read", in a team's own notes and on the published guide (N8, N14) · comments on the app's feed (N7) · the `@ # /` grammar (N5) · collapsible headings (N17) |
  | **more than 8 weeks** | the whole first wave in §9 |

- **The guide, published once** (a proposal for the hackathon plan, which owns the setup):
  - the organisers write Brief, Rules, Schedule, Judging criteria, Resources and FAQ in their own workspace and publish them as one site (frame 2, variant 2);
  - each team's workspace starts with a prepared **Start here** linking to the guide's sections, plus the team's own notes (Idea, Research, Pitch outline, Submission with Devpost's headings) and its milestone tasks;
  - the guide is never copied into team workspaces: copies would miss every mid-event fix.
- *Recommend: yes.* Rejected: copying the guide into each team workspace (stale by the first rule fix). Rejected: an event workspace (you decided against it in Chat CH22).
- *Outside the target roles?* The cut is event-specific; everything in it is wanted by every team. A published guide plus a prepared starting set is also how agencies onboard clients.
- Prototype frame 2 (variants: a team's first open · the published guide).

❓ OK with the ranked cut and the guide published once?

**★ N3 · Where notes live: one tree, sectioned by who sees it**
- **Today:** one tree; the "Inbox" is worked out from the tree (any top-level note with nothing inside it, shared with everyone); pins are shared; Published, Archive and Trash are always there; nothing shows who can see a note.
- **Recommend:**
  - **Inbox** (yours): quick notes you capture land here, **private until you file them**, newest on top, as in Tasks 20. A top-level note is never in an Inbox because of its shape.
  - **Pinned** (yours): appears once you pin something (Tasks 29b).
  - **The tree in three sections, by who sees each top-level note:** **Workspace** (everyone), **Shared** (some people), **Private** (you). Notes inside follow their parent (already true in the data). Dragging a note to another section changes who sees it, says so, and can be undone.
  - **A note can be linked to a project** (its project's dot): tasks written in it go to that project, and the project shows its notes (N21). Notes inside inherit the link. The link never changes who can see the note.
  - **Archive, Recently deleted and Published** open from the sidebar's ⋯ (Tasks 98); a published note carries a quiet mark in the tree.
  - **No per-note icons** in the tree (no user-picked icons, as in Tasks). An emoji typed at the start of a title stays as typed; the importer's job becomes putting a Notion page's icon at the start of its title, so nothing is lost.
  - **Nesting stays unlimited** (a real Notion import is 9 deep), and every row shows its count of notes inside.
- *Recommend: yes.* Rejected: **Tasks' projects hold notes** (frame 1, variant 2): one place per piece of work, but module permissions are per person, so a member without Tasks access would see no project notes, and Notes would carry two sharing rules. Rejected: today's derived Inbox.
- *Outside the target roles?* Yes: a calmer sidebar, and privacy you can see, help anyone who shares a workspace.
- (c) reverses NO-1's derived Inbox and DESIGN_BRIEF's workspace pins and fixed sections. Prototype frame 1 (variants: recommended · projects hold notes · today).

❓ OK?

**★ N4 · A way in: the start page, where Notes opens, and Home**
- **Today:** a newcomer finds Notes only if they know to look; it opens on "Select a note on the left"; the welcome note is seeded once per workspace and skipped if any note exists, so a prepared workspace never shows it.
- **Recommend:**
  - **The start page:** an owner or admin marks one note as the workspace's start page. It sits first under Workspace and opens the first time anyone opens Notes in that workspace. For the hackathon it's "Start here".
  - **Notes opens where you left it**; on a first visit, on the start page; with neither, on the most recently edited note you can see. Never on "Select a note".
  - **The default Home gets a Notes widget:** the start page, then "Recent for you" (notes you opened or edited). Round 2 details it (N23).
  - **The welcome** follows Tasks 34: once per person, at most three steps, "Learn more" or "Explore on my own", reopened from ⋯. In a workspace with a start page, the welcome's last step opens it.
- *Recommend: yes.* Rejected: a pinned-for-everyone list (pins are personal now; one front door is clearer than several). Rejected: keeping the seeded welcome note (it teaches one person once and sits in everyone's tree after).
- *Outside the target roles?* Yes: a new hire, a contractor, a classmate joining a group.
- (b). Prototype frames 2 and 9.

❓ OK?

**★ N5 · One grammar in notes: `@` links and mentions, `#` tags, `/` makes and inserts**
- **Today in notes:** `@` lists people only; things come through `/note`, `/task`, `/contact`, `/company`, `/event`; there's no `#` and no date chip. Elsewhere in the app `@` lists people first, then things (Tasks 33). So `@` means three different things in the app today.
- **Recommend:**
  - **`@`** lists people first (they're notified), then things (they're linked): notes, tasks, contacts, companies, events, emails, projects. Mentioning someone who can't open the note says "Sam can't see this note and won't be notified".
  - **`#tag`** in a note's text links the tag *and tags the note* (the Bear and Obsidian habit); removing the last one untags it. In task descriptions and comments `#` keeps only linking (Tasks 33).
  - **`/`** makes something new or inserts: Task (create or link), Note inside (`/page`), Contact, Today · Tomorrow · Date…, Image or file, Template…, then the block types (headings, lists, checklist, quote, code, table, divider). Simple rule: **`@` points at what exists; `/` makes or inserts.**
  - The old `/note`, `/contact`, `/company`, `/event` names keep working for a while and show "Use @ to link" in the menu.
- *Recommend: yes.* Rejected: keeping `@` people-only in notes (three meanings app-wide). Rejected: `/` creating only tasks, as in task descriptions (in a note, making a note inside or a contact is just as natural).
- *Outside the target roles?* Yes.
- (c) reverses DESIGN_BRIEF §3c's grammar. Prototype frame 3 (variants: `@` · `/`).

❓ OK? And `#` tagging the note itself?

**★ N6 · A task in a note: the line, and where the task goes**
- **The great moment stays:** a task line *is* the task.
- **Recommend:**
  - **The line is the task's form inside a note:** the same status icon as in Tasks (by category; click completes; Won't do has its own icon and is never struck through) · the title, editable in place · the assignee and the date in the app's words, on the right · on hover, Due, Assign and Open. "Show as: Line · Card" lets a deliverables list show cards instead.
  - **Where a new task goes:** into the note's project when it has one; otherwise into your Inbox, and the `/task` picker says so in its first row ("New tasks go to ● Acme rebrand", changeable there). Assigning it to someone follows Tasks 20a.
  - **A plain `[ ]` stays a plain checkbox.** "Make task" (hover, menu, ⌘⇧T, a selection) turns lines into tasks.
  - **Clicking a task line opens the task in the right panel** as "← item" (N12).
- *Recommend: yes.* Rejected: the RF-1 card as the only form (heavier, and the title can't be edited in place). Rejected: tasks always into the writer's Inbox (teammates see "Private item" in their own idea doc).
- *Outside the target roles?* Yes: anyone who writes action items in meeting notes.
- (c) re-decides NO-5's filing rule. Prototype frame 4 (variants: line · card · `/task`).

❓ OK?

**N7 · Comments: the app's feed now, discussions on a passage later**
- **Today:** quote-comments in one flat list: no edit, delete, resolve or reactions; nothing marks the passage in the text.
- **Recommend, in two steps:**
  1. **Now (in the hackathon cut):** notes use the app's comment feed: edit, delete, reactions (the shared component from Chat's proposal Chat-1; reactions never notify), `@` people and things, `/today`. Selecting text still offers "Comment", which quotes it.
  2. **Later:** **a discussion on a passage:** the text is marked, replies stay with it, and Resolve clears the mark. Comments on the whole note stay one flat feed, as in Tasks. This is the one place Notes would differ from Tasks' "no threads" (default q): reviewing a document happens passage by passage.
- *Recommend: yes, both steps.* Rejected: passage discussions in the hackathon cut (large, and quotes cover a weekend). Rejected: never (every doc tool the roles use has them; PMs and agencies review this way).
- *Outside the target roles?* Yes.
- (b); step 2 is (c) to Tasks default q, for notes only. Prototype frame 5.

❓ OK?

**N8 · Who changed what, and what changed since you read**
- **Recommend:**
  - **"Edited Today 3:12 PM · Mike Chen"** under every note's title, on its card and hover, and on the published page ("Updated …"). Agents read "Claude · via Alex's key".
  - **Changed since you read:** a note you've read before and someone else has changed since shows a quiet dot in the tree and, when opened, one line on top ("Changed since you last read · 2 changes by Ola · Mark as read") with a neutral bar beside what changed and old values struck through. No notification for edits (N22).
  - **History, later:** one row per editing session, "Show changes", "Restore this version" (restoring keeps the newer versions).
- *Recommend: yes; History after the hackathon cut.* Rejected: notifying followers of every edit (noise; the PRODUCT_BRIEF's quiet notifications). Rejected: "verified page" owners and expiry dates (Confluence/Notion verification; heavy for five people).
- *Outside the target roles?* Yes: stale pages are the top wiki complaint.
- (b). Prototype frames 2 (variant 2) and 7 (variant 3).

❓ OK?

**N9 · Templates, and duplicating a note with the notes inside it**
- **Recommend**, the shape Tasks 9 and 79 decided:
  - **Duplicate** copies a note *with the notes inside it*; task lines in the copy become new tasks, never links to the originals.
  - **"Save as template"** on any note (with the notes inside it). The template is its own note, marked *Template*; editing it never changes notes made from it. Yours until you share it with the workspace.
  - **"From template…"** in `/template`, in ⌘N's empty note ("Start from a template: …") and in capture's More. Never asked when you create a note.
  - A few starters by role from the onboarding question (TV-U17): meeting notes, client brief, weekly review, project write-up (with Devpost's headings, for hackathon teams).
- *Recommend: yes.* Rejected: July's "no templates" (every role repeats documents: lectures, meetings, briefs, episodes, discovery calls). Rejected: a gallery.
- *Outside the target roles?* Yes.
- (c) reverses BRIEF §2. Prototype frame 6 (variant 2 shows the starters).

❓ OK?

**N10 · Images and files in notes**
- **Recommend:** paste or drop an image or file into a note; images show inline with an optional caption; files show as a row (name · size · open). They ride the attachments pipeline (50 MB a file today), count toward storage, appear on published pages, and are erased with the note.
- *Recommend: yes.* Rejected: links to images hosted elsewhere (today's workaround).
- *Outside the target roles?* Yes: creators and students are blocked without it.
- (b).

❓ OK?

**N11 · New notes: ⌘N, ⌘⇧K then ⌘2, ⌘⇧N**
- **Recommend:**
  - **⌘N inside Notes** (and "+ New"): a new note opens straight in the editor, in the place you were (next to the open note, or inside the section), title first. No window.
  - **⌘⇧K then ⌘2** from anywhere: the app's capture as Note: a destination row ("Note in Inbox ▾"), a title, a body with the full grammar, Tags and Template pills, and the "From: …" chip when something was open (Tasks 93: linked by default, one key removes it). ⌘⏎ saves; ⌘⇧⏎ saves and opens it; Esc keeps a draft.
  - **⌘⇧N** opens that same capture already set to Note (one door, two keys).
- *Recommend: yes.* Rejected: ⌘N opening the capture window inside Notes (writing a document belongs in the editor). Rejected: ⌘⇧N making a full note directly (two different doors for a quick note).
- *Outside the target roles?* Yes.
- (a) to SH-1's provisional type. Prototype frame 6 (variants: ⌘⇧K then ⌘2 · ⌘N in Notes).

❓ OK?

**N12 · The right panel's views**
- **Recommend:** the title-row dropdown lists **Details** (where it is, its project, who sees it, tags, edited, Linked with "Mentioned in" lines, the activity line) · **Comments** (with a count) · **Outline** (headings, with changed ones marked) · **History** once it's built, all *about this note*; and *alongside*, **the linked project's tasks**. Anything clicked in the text (a task, a contact, an email) opens over the view as "← item"; Esc comes back.
- *Recommend: yes.* Rejected: today's tabs (four already crowd the panel, Tasks 72).
- *Outside the target roles?* Yes.
- (a) to SH-1. Prototype frame 7.

❓ OK?

**N13 · Several notes at once**
- **Recommend:** ⇧-click and ⌘-click select rows in the tree; the bottom bar's centre shows Move · Share · Duplicate · Delete · More · "3 selected · Esc" (Tasks 82b); one Undo.
- *Outside the target roles?* Yes (reorganising after an import).
- (b).

❓ OK?

**N14 · Share and publish**
- **Recommend:**
  - **Share** already offers Private · Can view · Can edit for the workspace and per person (October's sharing work), so an organiser can make the rules read-only today (view includes commenting). It gains one thing: it names where a note's sharing comes from ("Everyone in Moduo Studio · Can edit · from Workspace", or "· from Handbook").
  - **Publish to the web** sits in the same menu: a link, "Include the notes inside it" (on), "Let search engines find it" (off). The public page shows a contents column for the notes inside, "Updated …", and keeps the note's formatting.
  - **References on a public page:** a reference to another published note links to its public page; anything else shows only its kind ("a task", "a contact"), never its title.
  - **"Changed since your last visit" on public pages:** the visitor's browser remembers what it last saw, so a returning reader sees the same quiet line and bars as N8, with no account (the hackathon's guide; an agency's client page).
- *Recommend: yes.* Rejected: a public page that reveals referenced items' titles.
- *Outside the target roles?* Yes: agencies' client pages, creators' public notes.
- (a). Prototype frame 8 (variants: Share · the public page).

❓ OK?

**N15 · Offline: notes keep writing**
- **Recommend:** you keep writing offline (text merges safely); new notes and renames wait and go when you're back; moving, sharing, deleting and publishing say "Offline · This change needs a connection". One quiet line in the note's header while offline. This deliberately differs from Tasks, which is read-only offline apart from captures and check-offs.
- *Recommend: yes.* Rejected: Tasks' read-only rule for notes (offline writing is the reason some people choose Obsidian and Apple Notes; venue Wi-Fi at hackathons is famously bad).
- *Outside the target roles?* Yes.
- (a). Prototype frame 9 (variant 3).

❓ OK?

**N16 · Live cursors**
- **Today:** "who's here" avatars; cursors were a July stretch goal.
- **Recommend:** a thin caret in each person's colour, with their initials on hover, only while two or more people are typing in the same note. Off the moment one leaves.
- *Recommend: yes.* Rejected: no cursors (two people co-writing a pitch at 3 a.m. type over each other). Rejected: always-on name flags (noise).
- *Outside the target roles?* Yes.
- (b).

❓ OK?

**N17 · Folding: collapsible headings instead of toggle blocks**
- **Recommend:** any heading can fold the section under it, a reading aid remembered per person; exports and imports stay plain headings. FAQs and long rules read as a list of questions.
- *Recommend: yes.* Rejected: toggle blocks (no markdown equivalent; July cut them for that).
- *Outside the target roles?* Yes.
- (b).

❓ OK?

**N18 · Mindmaps in notes**
- **Recommend:** remove `/mindmap` from the menu; existing embeds stay visible and read-only until the Mindmap has its own plan (it left the alpha on 2026-07-29).
- *Outside the target roles?* Nobody loses anything they can reach today; the Mindmap module is hidden.
- (c) to DESIGN_BRIEF §1.

❓ OK?

**N19 · Chat's proposals for Notes** (§1.6)
- **Recommend:**
  - **Chat-2 "Mentioned in":** yes, one quiet line per conversation in Details → Linked, seen only by people who can read that conversation.
  - **Chat-3 "Make a note" from messages:** the note lands in your Inbox, quoting the messages with their authors and times, with a reference back to the conversation; its title is the conversation's name and the date.
  - **Chat-4 decisions:** yes, in Linked: "Decided with Mike · Oct 12: …", same visibility rule.
  - **Chat-1, Chat-6, Chat-7:** adopted (§1.6).
- *Outside the target roles?* Yes, for any team that uses Chat.

❓ OK?

**N20 · Agents as authors** *(opening call; detail in round 2)*
- **Recommend:** an agent's edit lands in an open note like a teammate's (§6 #11), shows as "Claude · via Alex's key" in Edited and History, and agents gain: comment (only when you ask), duplicate, apply a template, publish (with your permission), and move with an exact position. **"Import through your AI"** (Tasks 74's parity): "move my Notion into Moduo" through Notion's own connector, re-runs update instead of duplicating, and "Undo this import".
- *Outside the target roles?* Yes.

❓ OK as the direction?

**N21 · Notes in other modules** *(opening call; proposals for their re-plans)*
- **Recommend:**
  - **Tasks:** a project shows "Notes · 3" (its linked notes) in its overview (TV-U16).
  - **Calendar** (paused): "New note from this event" makes a note linked to the event, titled and dated, listing its people.
  - **Contacts:** keep the Notes view on a contact or company, with "New linked note".
- *Outside the target roles?* Yes.

❓ OK as proposals?

**N22 · Notes' notifications** *(opening call; the full table in round 2)*
- **Recommend:** `@you` in a note or a comment → bell, on its own; a reply or comment on a note you wrote or commented on → bell, grouped; a note shared with you → bell; **edits → no notice** (N8's marker instead). Quiet hours hold them all (Chat-7).
- *Outside the target roles?* Yes.

❓ OK as the direction?

**N23 · Home: Notes' widgets** *(opening call)*
- **Recommend:** **Start here** (the workspace's start page, until you've read it) and **Recent for you** (opened or edited by you, with "changed" dots). The old "recent notes touched by anyone" retires.

❓ OK as the direction?

### Consistency pass (round 1)

1. **"Inbox" meant two things** (Notes' derived shared one, Tasks' personal one) → N3: one meaning app-wide.
2. **"Pinned" was shared in Notes, personal in Tasks** → N3 personal; the organiser's need becomes the start page (N4).
3. **`@` had three meanings** (people only in notes, people then things in Tasks, things only in DF-23's other editors) → N5.
4. **The July docs say per-note sharing is deferred**; it shipped in October → N3 builds on it; the supersession banner on `specs/notes.md` will say so.
5. **PRODUCT_BRIEF and ROADMAP still promise "every checkbox is a real task"**; DESIGN_BRIEF reversed it in July → N6 keeps July's rule (a checkbox stays a checkbox; a task line is the task); PRODUCT_BRIEF §6 is edited at the spec step.
6. **"Detail" vs "Details", "Trash" vs "Recently deleted"** → Tasks' words (N3, N12).
7. **Tasks' "no threads"** vs reviewing a document → N7 keeps Tasks' rule now and asks for a notes-only exception later.
8. **Offline:** Tasks is read-only offline; Notes writes offline → N15 makes the difference deliberate.

## 9. What happens next

1. ✅ Research lanes land → diagnosis (§1) and round 1 (§2, §3, §8) with a structure prototype. *(The current-state and visual-audit lanes fold in as they land.)*
2. Rounds 2a/2b: every view and state; a separate gap audit.
3. Round 3: in-flight work reconciled.
4. The spec, `specs/notes-v2.md`, on Fable 5.1.
5. Decision entries, a supersession banner on `specs/notes.md`, a validator pass, "Ready to execute".
