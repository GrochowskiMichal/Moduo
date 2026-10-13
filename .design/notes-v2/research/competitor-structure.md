# Notes v2 research: competitor structure

> **Lane 4 of the Notes v2 re-plan** (2026-10-13). This compares how the leading note, doc and wiki tools are **structured**, and what a team of up to 5 and a hackathon organiser actually need from them. It is input to [`../REPLAN.md`](../REPLAN.md) §1–§3; it decides nothing.
>
> **Evidence:** primary docs and changelogs where possible, plus live public pages (Devpost) read directly on 2026-10-13. Reddit could not be reached by the research tools, so complaints come from G2, Capterra, Hacker News, vendor forums and Apple Community. Claims marked **†** come from long-standing product knowledge and were **not** re-checked this session. Treat them as likely, not confirmed.

---

## 0. Headline

1. **Every tool has the same three-level skeleton:** a shared container (space, teamspace, channel, project or vault), a list or tree of pages inside it, and a **home page at the top of the container**. Structure is not where they differ. They differ in three things: how a newcomer finds the prepared material (a home page, pinning, verified badges), how they signal freshness (verified-until dates, page status, "updated" stamps), and how copies are made (a template gallery, or "duplicate this").
2. **For teams of up to 5, depth costs more than it gives.** The loudest complaints are about **findability** (sprawling sidebars; Confluence reviewers calling the search bar "nearly useless"), **staleness** (outdated pages nobody owns), and **setup weight and speed** (Notion). Nobody small complains that a hierarchy is too shallow.
3. **Hackathons converge on one shape:** a **single hub with fixed sections** and a **dated Updates feed**. Devpost's live tabs are Overview (Requirements · What to Build · What to Submit · Prizes · Judges · Judging Criteria), Dates, Resources, Rules, Updates, Discussions, Participants, Project gallery and Submissions. That set maps almost 1:1 onto the REPLAN's "brief, rules, schedule, judging criteria, resources and FAQ as notes". The one gap is FAQ: Devpost has no FAQ tab, so organisers put it in a Notion "hacker guide" or Discord.
4. **What goes wrong at hackathons is fragmentation, not missing features.** A typical event uses three or four places: the Devpost page, a public Notion hacker guide, Discord `#announcements` and email. A schedule or deadline change has to be pushed to each one, and participants who read the stale copy miss it. Organisers end up writing "read the whole guide" and "don't mute Discord".
5. **The key finding for the REPLAN's "copy one prepared workspace into N team workspaces":** every copy mechanism we looked at (Notion "Duplicate", Google `/copy`, Basecamp project templates) produces a **disconnected copy**. When the organiser fixes a rule after the copy, N teams keep the old rule. Devpost avoids this because there is one hub that everyone reads. **Proposal for `t/maciej/hackathon-plan`:** organiser-owned notes (brief, rules, schedule, judging, FAQ) stay **one shared, read-only source** that every team workspace shows. Only team-owned scaffolding is copied: the idea doc, research, pitch outline, submission write-up and milestone tasks.
6. **Best patterns for Moduo (§4):** a container home with pinned "start here" notes in sections; a quiet Updates feed on that home; "updated since you read it" on prepared notes; "duplicate this" over a gallery; tabs plus an outline for long briefs; checklist items that become real tasks (Google Docs' "Add to Tasks" is the only mainstream precedent); comments with resolve and reactions; a plain "linked from" list; read-only publish to the web; whole-workspace offline on desktop.
7. **Don't copy (§5):** databases and property schemas, in any of their forms (Notion databases and wikis, Coda tables, Slite and Craft Collections, Obsidian Bases, Confluence databases); unlimited nesting; synced blocks; template marketplaces; restriction matrices; draft→publish and change-request workflows; page analytics; graph views; AI sprinkled through the UI.

---

## 1. Structure comparison

The comparison is split into three tables so each stays readable. Rows are tools; HackMD is included because hackathons use it.

### 1a. Containers, wayfinding, templates

| Tool | Containers (top → bottom) | How a newcomer finds prepared info | Templates |
| --- | --- | --- | --- |
| **Notion** | Workspace → Teamspaces (+ Private, Shared, Favorites) → pages nested without limit. A "wiki" is a page converted into a database. | Teamspace/wiki home page, Favorites, sidebar, search. Verified pages get a blue check in search and @-mentions. | Marketplace gallery; "Duplicate" on public pages (copies all subpages); `/template button` and database templates |
| **Google Docs** | Drive folders / shared drives → doc → **tabs** (up to 3 nesting levels, each linkable) → headings in an auto outline; smart chips (people, dates, files) link out from the text | Nothing inside Docs beyond the tabs and outline panel; you find docs through Drive search and links. Drive folder structure is not visible from inside Docs. | Thin gallery; `@` building blocks (meeting notes, checklists, roadmaps); `/copy` and `/template/preview` share links |
| **Obsidian** | Vault (a local folder) → folders → Markdown notes; Canvas files; `.base` files (Bases, 2025) | File explorer, bookmarks, backlinks pane, graph, search; the Publish site has its own navigation | Core Templates plugin (a folder of template notes); default template for daily notes |
| **Apple Notes** | Account → folders/subfolders → notes; tags; Smart Folders built from tags | Pinned notes at the top of a folder; search; Quick Note | None built in (duplicate a note) |
| **Confluence** | Site → Spaces → content tree (pages, live docs, folders, whiteboards, databases) | **Space overview** (home) page, page-tree sidebar, starred items, search | Gallery plus blueprints; space templates |
| **Craft** | Spaces (personal + shared) → folders → docs → subpages; Daily Notes per space; Collections | Sidebar, search, Daily Notes calendar | Gallery plus custom templates; default template for daily notes |
| **Slite** | Workspace → **Channels** → docs (nested); Collections ("a simple database of linked documents") | Channels sidebar, search, **Ask** (AI Q&A that ranks verified docs higher) | Workspace templates |
| **Linear** | Workspace → Teams / Projects / Initiatives / Issues / Cycles → documents. **Each doc belongs to exactly one parent.** | Project overview lists its docs and links. **Team home page** (June 2026) has pinned docs and links grouped into sections. ⌘K search. | Document and project templates † |
| **Basecamp** | Project → tools (Message Board, To-dos, **Docs & Files**, Schedule, Chat) → folders → docs/uploads | The project home shows each tool as a card, so there is one obvious place per project | Project templates (duplicate a whole project) † |
| **Coda** (now *Superhuman Docs*) | Workspace → folders → doc → pages → subpages (unlimited) | Page list in the left panel, which becomes the navigation of a published doc | Gallery; copy a doc |
| **GitBook** | Organization → Collections → Spaces → pages and page groups; docs sites with **site sections** (a tab bar) | Organization **Home** (open change requests, comments, recent edits); the published site's navigation and search | Space templates † |
| **HackMD** | Workspace (personal/team) → notes; **Books** (an index note acts as the table of contents) | The book's left-hand TOC; the first linked note is the landing page | Note templates; "add note from template" inside a book |

### 1b. Sharing, discussion, tasks inside docs

| Tool | Sharing outside the team | Discussion | Tasks inside docs |
| --- | --- | --- | --- |
| **Notion** | Publish to web / **Notion Sites** (free: one notion.site domain and search indexing; custom domain is a $10/mo add-on). Guests: Free 10, Plus 100, Business 250 (2025 guidelines; some 2026 sources say Plus is unlimited). A "Duplicate as template" toggle on published pages. | Inline (on a text selection) and page-level comments, resolve, reactions, @mentions of people, pages and dates † | To-do blocks are plain checkboxes; "real" tasks live in a database. The two are separate. |
| **Google Docs** | Link roles (viewer / commenter / editor), publish to web, forced-copy links | Anchored comments, resolve, emoji reactions, **assign a comment** with +mention, Suggesting mode † | **Checklist item → "Add to Tasks"**: assignee and date, synced both ways with Google Tasks, crossed out when done. Work and school accounts only. |
| **Obsidian** | Obsidian Publish (paid site); Sync shared vaults, where **every member needs their own Sync subscription** | No comments in core | Markdown checkboxes; the Tasks community plugin queries them † |
| **Apple Notes** | iCloud invite to a note or folder. **People on non-Apple devices can't collaborate.** "Send copy" works for single notes only. | No comments; @mentions, Activity view and highlights in shared notes † | Plain checklists |
| **Confluence** | Page restrictions; guest and anonymous access (admin-enabled) † | **Inline and page-footer comments**, resolve, reactions, @mentions † | **Action items** with an @assignee and a date, rolled up into a personal task list † |
| **Craft** | Share link with View or Edit. Viewers need no account; editors do. Publish as a web page; password, expiry and custom domain on higher tiers. **No folder sharing**: each doc is shared separately. | Comments on any block; mentions trigger push notifications | To-dos and a Tasks view † |
| **Slite** | Public share links; guests † | Inline comments and doc discussions † | Checkboxes † |
| **Linear** | Workspace members and guests; no public publishing of docs † | Inline doc comments, resolve, reactions, @-references to issues, docs and people † | **Create an issue from selected text** in a doc † (real, linked tasks) |
| **Basecamp** | Client access (clients see only what you allow) † | Comments under every doc, "Boosts" (reactions), and a "who to notify" picker when posting † | To-dos are a separate tool; docs link to them |
| **Coda** | Publish a doc (public site, custom domain) | Inline comments † | Checkboxes plus tables (a database) |
| **GitBook** | Published docs sites (public, signed-in or link-only) | Page comments; reviews on change requests | — |
| **HackMD** | Per-note read and write rights for owner, signed-in users or everyone. Books are Private, Public view or **Collaborative (anyone with the link can edit)**. A Publish tab. | Comments † | Markdown checkboxes |

### 1c. Live collaboration, offline, history, AI

| Tool | Live collaboration | Offline | History / versions | AI (where it shows up) |
| --- | --- | --- | --- | --- |
| **Notion** | Presence avatars and live cursors † | **Since Aug 2025**, desktop and mobile only (not web). Set **per page, per device**; paid plans auto-download recent and favourite pages; subpages are not included automatically; databases get only the first 50 rows of the first view. | Page history kept **7 days (Free) / 30 (Plus) / 90 (Business) / unlimited (Enterprise)** | Everywhere. **Notion 3.0 (18 Sep 2025) rebuilt Notion AI as Agents** that run multi-step jobs for 20+ minutes; also MCP connectors. |
| **Google Docs** | Live cursors and presence | Docs Offline in Chrome † | Version history with named versions † | Gemini side panel and "Help me write" † |
| **Obsidian** | **No real-time co-editing** (on the roadmap); Sync resolves conflicts, which a forum user says "sometimes produces funky results" | Native: local files | File recovery snapshots; Sync history † | None in core |
| **Apple Notes** | Shared notes sync; no live cursors † | Native | None † | Apple Intelligence writing tools †. iOS/macOS 26 added Markdown import and export. |
| **Confluence** | **Live docs** (always live, never "published") alongside **pages** (draft → publish) | None (cloud) † | Full page history | **Rovo**: "Create with Rovo" drafts pages, live docs and whiteboards |
| **Craft** | Real-time co-editing | Native apps † | † | Assistant; API and **MCP** (2025) |
| **Slite** | Real-time † | † | † | **Ask** (cited answers; ranks verified docs higher and pushes outdated ones down); MCP server (Feb 2026) |
| **Linear** | Real-time, saved and synced live | Desktop cache † | Version history with restore | Agents; "Write with Agent" drafts updates (Jul 2026) |
| **Basecamp** | Not built around live co-editing † | — | File versions † | Minimal † |
| **Coda** | Real-time | — | † | Coda AI † |
| **GitBook** | Live edits on unpublished spaces; **locked live edits** on published ones (changes go through change requests) | — | A version per merged change request | GitBook AI / Assistant on published sites † |
| **HackMD** | Real-time cursors, side-by-side edit and preview | — | Versions † | — |

---

## 2. Per-tool notes

**Notion.** The default many teams start from, and the shape Moduo is measured against. Its strong ideas for us are the **teamspace or wiki home page**, **verified pages** (owner plus verified-until date; when the date passes, the owner gets an inbox notice and an email), **Duplicate on public pages** (copies all subpages) and **Sites** for publishing. A wiki is a database under the hood, so verification only fully works inside one; outside a wiki it needs Business or Enterprise. Complaints: it's slow, especially with large databases and complex pages; it's hard to set up "for the long term"; and sidebars sprawl into "untitled pages" that a consultant's cleanup guide sets out to fix. Offline (Aug 2025) works page by page and device by device, and reviewers call it more of a workaround than a seamless feature. Its AI is everywhere (Agents).

**Google Docs.** Has no real container of its own: Drive is the container, and Docs can't see Drive's folders. As a team wiki it breaks down into duplicates, "Untitled document" and unclear owners (vendor-written accounts; weigh them accordingly). Two genuinely strong ideas: **tabs** (up to 3 nesting levels, linkable, with emoji icons) that turn one long doc into a navigable mini-site, and **checklist item → assigned task** that syncs both ways with Google Tasks. That second one is the clearest mainstream precedent for Moduo's "note checkboxes that are real tasks". Forced-copy links (`/copy`, `/template/preview`) are how teachers and organisers hand out templates without a gallery.

**Obsidian.** Local-first files with backlinks, daily notes, templates, Canvas and (since 2025) **Bases**, a database view built on note properties. It is built for one person: no real-time co-editing, no comments, and a team must buy a Sync seat per member. Strong ideas: the **backlinks pane** (a plain list of what links here) and **daily notes with a default template**. Bases is the "no databases" line moving into even the most minimal tool; Moduo should not follow it.

**Apple Notes.** The baseline for "quick and calm". Pinned notes, tags plus Smart Folders, Quick Note from anywhere, checklists, shared folders with an Activity view. It fails as soon as anyone isn't on Apple: non-Apple users can't collaborate, and there are reports of shared-folder sync silently failing. The iOS/macOS 26 Markdown import and export makes it easier for people to move their notes into Moduo.

**Confluence.** The full-weight team wiki: spaces, a page tree, a **space overview** home, blueprints, **page status** (defaults Rough draft / In progress / Ready for review, editable), inline comments, **action items**, analytics and restrictions. Since 2025 it also has **live docs**, which skip the draft→publish step, a sign that even Atlassian sees publishing as friction for everyday team writing. Complaints are the most consistent of any tool: reviewers call it "very hard to navigate" with a search bar that is "nearly useless" and say the parent/child page structure makes things harder to find (Capterra); outdated and orphaned pages pile up; and an Atlassian Community post warns that space home pages turn into a dumping ground for links.

**Craft.** A beautiful single-player tool that grew teams later. Spaces → folders → docs, Daily Notes per space with a calendar, block comments, share links that viewers open without an account. **Sharing is per doc; folders can't be shared**, so a "shared set of prepared notes" doesn't exist unless you buy a Team plan with Shared Spaces. The lesson: decide early what the unit of sharing is.

**Slite.** The small-team wiki built around **verification**: an owner, an expiry (for example 30 days, 90 days or a year), verified docs ranked higher in search and Ask, and outdated docs pushed down. Docs live in **channels**, not folders. It also added Collections (a database), which is the same drift as Obsidian Bases. Its strongest idea for us is that **freshness feeds ranking**: stale docs sink on their own.

**Linear.** Docs are always **attached to something**: a project, initiative, team, issue or cycle, exactly one parent each. The June 2026 **team home page** ("every team has a page to keep its context organized") holds pinned docs and links grouped into sections. Linear also has **project and initiative updates** with expected cadence, overdue reminders and an Updates tab (Oct 2025). This is the closest match to Moduo's spine: docs are context for work, and updates are a separate, dated stream.

**Basecamp.** One project = one bundle of tools (Message Board, To-dos, Docs & Files, Schedule, Chat), each shown as a card on the project home. Every doc has comments, and posting asks you **who to notify** †. The Message Board is an announcement stream separate from chat. The lesson: a **fixed, small set of places per project** beats a configurable tree, and announcements are their own kind of object.

**Coda (now Superhuman Docs).** Doc → pages → subpages, nested without limit; a published doc turns its page list into site navigation. Its own help centre warns that spreading subpages across many top-level pages becomes "an unintentional game of hide-and-seek". Everything else that makes Coda Coda is tables, which we don't want.

**GitBook.** Publishing-first: organization → collections → spaces, **site sections** shown as a tab bar on the public site, and **change requests** (branches) that become mandatory once a space is published. An organization **Home** lists open change requests, comments and recent edits. It suits public product docs; for a team of up to 5 or a hackathon, a review-gated workflow is too heavy.

**HackMD / HedgeDoc.** The hackathon and open-source community's live notepad: Markdown with side-by-side preview, real-time cursors, **book mode** (an index note becomes a left-hand table of contents, and its first link is the landing page) and slide mode. Books carry one permission (Private, Public view or Collaborative), with an option to apply it to new notes automatically and a warning when a note inside is more restricted than the book. HedgeDoc 1.x is maintenance-only and 2.0 has been in alpha for years, so the self-hosted variant is stagnant.

---

## 3. Hackathons: how they actually run on these tools

### 3.1 What organisers publish: the canonical section set

From the live Devpost pages for the *Google Chrome Built-in AI Challenge 2025* and *TreeHacks 2025* (read 2026-10-13), Notion hacker guides (HackViolet, HackMerced, Avalanche Hacks) and the MLH Organizer Guide:

| Section | Where it lives today | Moduo equivalent (REPLAN) |
| --- | --- | --- |
| Overview / brief: what to build, what to submit, requirements | Devpost Overview | Brief note |
| Prizes, judges, **judging criteria** | Devpost Overview (judges score against named criteria in online judging) | Judging note |
| Dates / schedule | Devpost "Dates" page; the hacker guide's schedule | Schedule note (plus calendar later) |
| Rules, code of conduct | Devpost Rules tab; the guide | Rules note |
| Resources (APIs, starter kits, mentors) | Devpost Resources tab; the guide | Resources note |
| FAQ | **Not on Devpost.** Lives in the Notion guide or Discord | FAQ note |
| **Updates** (dated announcements) | Devpost Updates tab; Discord `#announcements` | *Gap: Notes has no updates stream today* |
| Discussions / questions | Devpost Discussions; Discord `#ask-organizers` | Comments on the hub notes (Chat owns conversations) |
| Team formation | Discord `#team-formation`; Devpost Participants | Hackathon plan (invites, teams) |
| Submission write-up | Devpost project "story" | Team's submission note |

The Devpost Updates feed for the Chrome AI challenge shows what organisers actually post mid-event: *"Deadline Clarification – MORE THAN 2 WEEKS TO GO"*, *"…Deadline Update"*, *"Optimize your project for the Judges"*, *"Got questions? We've got answers!"* (which points people to Discord). **Clarifications to rules and dates are the normal case, not the exception.**

### 3.2 Organiser, step by step

Sources: the Mattermost hackathon runbook, the MLH Organizer Guide, Devpost.

1. **T-40 to T-30:** set dates and partners; keep a project-plan sheet of tasks, owners and dates. (In Moduo this is Tasks, not Notes.)
2. **T-25:** build **one landing page with "all info, team-finding and submission processes, and FAQs"**, plus a submission repo or a Devpost page (draft, then Publish).
3. **T-20 to T-10:** announce and promote; schedule reminders.
4. **T-5:** an idea-pitch call to form teams; slides and recordings go into a shared drive.
5. **Set up comms:** MLH recommends Discord (free voice), with a minimum channel set: team formation, ask-organizers, ask-mentors, introductions, random, plus internal mentor and admin channels.
6. **T-0:** kickoff call; publish the hacker guide (usually a public Notion page) that links to Discord and Devpost.
7. **During:** the help desk posts reminders and updates in chat "throughout the event". MLH advises leaving buffer time, because every announcement sets off a burst of questions. Rule and deadline clarifications go out as Devpost Updates.
8. **Submission:** Devpost deadline; custom submission questions; final reminders.
9. **Judging:** online (judges get Devpost accounts and score against the criteria) or offline (demos, then export a CSV).
10. **T+3 to T+7:** demo call, winners posted as an Update, retrospective, results post.

### 3.3 Participant (team), step by step

1. Register on Devpost → join Discord → open the hacker guide (often after being told to "read the whole thing").
2. Find a team in `#team-formation`, or arrive with one.
3. Start an **idea doc**, usually a Google Doc, HackMD note or Notion page: problem, idea, target user, MVP scope, stack, demo plan, who does what.
4. Split work into GitHub issues, a Notion board or a checklist in the idea doc.
5. Watch Discord for schedule and rule changes while building.
6. Write the **pitch outline** and slides. Judges reward a clear problem, what it does and the trade-offs made, more than polish.
7. Write the **Devpost story**, which has fixed headings: *Inspiration · What it does · How we built it · Challenges we ran into · Accomplishments that we're proud of · What we learned · What's next*.
8. Submit before the deadline; demo.

### 3.4 What goes wrong

- **Information split across 3–4 tools.** The HackMerced and HackViolet guides keep the schedule in Notion but send "all links" to Discord `#announcements`. A change has to be pushed to both, and whoever reads the stale copy misses it.
- **Guides nobody reads.** Organisers have to say "read the whole thing" and "don't mute Discord notifications"; they need checklists to make people go through the material.
- **Mid-event changes** to deadlines and rules (the Devpost Updates above); last-minute renames that force "redo posters, slides, announcements" and plans that "didn't reach everyone on time" (Deerwalk hackathon retrospective).
- **Every announcement sets off a burst of questions** (MLH), which land in Discord and are lost for the next person who has the same question.
- **Timezones:** guides have to spell out "Pacific Standard Time" on every time.
- **Copies drift:** any per-team copy of the prepared material (Notion Duplicate, Google `/copy`) is disconnected from the organiser's original, so fixes don't reach teams. The organiser also can't see inside forced copies, which land in each participant's own Drive.
- **Guest and seat ceilings:** Notion Free allows 10 guests, which rules out "one Notion workspace with every participant as a guest" for anything but a tiny event.
- **Permission edge cases:** HackMD "Collaborative" books mean anyone with the link can edit the organiser's material; notes inside a book can carry a different permission from the book itself.

### 3.5 What this asks of Notes (proposals; anything cross-module is for `t/maciej/hackathon-plan`)

- **Organiser material is one shared, read-only source** that every team workspace shows. It is not copied, so a rule fix reaches everyone at once. *(Proposal for the hackathon plan.)*
- **A hub home** that lists the prepared notes in a fixed order (Brief → Rules → Schedule → Judging → Resources → FAQ), with "start here" first.
- **An Updates stream on the hub:** dated posts, delivered once to every participant as a quiet digest, with "what changed" linked to the edited note. *(The boundary with Chat needs a call: an update is a post attached to the hub, not a channel message.)*
- **Questions as comments on the FAQ or Rules note**, so the answer stays where the next person will look.
- **Team scaffolding copied per team:** idea doc, research, pitch outline, a submission note pre-filled with the Devpost headings, and milestone tasks.
- **Read-only web view** for judges and the public brief. *(Web access is the hackathon plan's job.)*

---

## 4. Patterns worth adopting

Each pattern answers four questions: what it is, who uses it, why it fits a team of up to 5 or a hackathon, and whether people outside that group would still want it.

*In this section, "container" means whatever Tasks v3's team/project becomes for Notes. That mapping is the connectivity lane's job.*

**P1. Container home with pinned "start here" notes in sections.**
- *Who:* Linear team home (2026), Confluence space overview, Notion teamspace/wiki home, GitBook organization Home, Basecamp project home.
- *Why it fits:* a first-time participant needs one obvious place where the prepared notes sit in reading order. A team of 5 needs the same thing when someone new joins. It replaces a deep tree with a short curated list.
- *Outside the group:* yes. A freelancer's client space (contract, brief, invoices), a student's course (syllabus, readings), a founder's company home.
- *Watch-out:* Confluence's "dumping ground" complaint. Keep it to pinned items in a few named sections; don't let it become a free-form page.

**P2. One fixed-section hub, read in order (a "book").**
- *Who:* Devpost tabs, HackMD book mode, Notion hacker guides, GitBook site sections.
- *Why it fits:* hackathon material always has the same sections (§3.1), and reading it in order (next/previous) beats hunting.
- *Outside the group:* partly. Course syllabi, client onboarding kits and agency "how we work" packs. Ship it as a starting set of notes, not a new object type.

**P3. A quiet Updates feed on a container.**
- *Who:* Devpost Updates, Linear project and initiative updates (cadence, reminders, an Updates tab), Basecamp Message Board.
- *Why it fits:* mid-event changes are the normal case. One dated post that everyone gets once (digest by default) is the fix for "the change reached Discord but not the guide". It matches the PRODUCT_BRIEF's quiet, grouped notifications.
- *Outside the group:* yes. Founders' weekly updates, PMs' project status, agencies' client updates.
- *Flag:* where this sits between Notes and Chat is a call for the Chat re-plan.

**P4. "Updated since you read it" on shared notes.**
- *Who:* Notion verified pages (owner, expiry, badge in search), Slite verification (expiry; verified ranked higher, outdated pushed down), the Hacker News "every page has an owner and an expiry" idea that experienced writers endorsed.
- *Why it fits:* the minimal version needs no workflow: a "changed since your last visit" marker plus a short diff on the organiser's notes. Rules changed on Saturday? Every team sees it on the note itself.
- *Outside the group:* yes; staleness is the top wiki complaint. Full owner and expiry verification can wait. It fits teams larger than Moduo's target.

**P5. "Duplicate this" over a template gallery.**
- *Who:* Notion's Duplicate on public pages (with subpages), Google `/copy` and `/template/preview`, Basecamp project templates, HackMD "add note from template".
- *Why it fits:* the REPLAN's team scaffolding is a copy of a prepared set. The PRODUCT_BRIEF says "no template hunt", so a handful of opinionated starting notes plus "duplicate this set" covers it.
- *Outside the group:* yes. Freelancers reuse a client kit; students reuse a course layout. Only team-owned material should be copied; see §0.5 for why organiser material should not.

**P6. Tabs and an outline inside one long note.**
- *Who:* Google Docs tabs (3 levels, linkable), Coda pages, HackMD book TOC.
- *Why it fits:* a long brief or rulebook stays one note with linkable parts, so "see Rules → Eligibility" can be a deep link.
- *Outside the group:* yes. Students' long notes, PMs' specs, agencies' proposals.
- *Open question for round 1:* tabs inside a note vs separate notes on a home page. Both solve the same problem, and having both may confuse people. The research leans towards **separate notes + container home** for the hackathon, and an auto outline (from headings) for long notes, rather than tabs.

**P7. A checklist item becomes a real task.**
- *Who:* Google Docs "Add to Tasks" (assignee, date, syncs both ways, Workspace accounts only), Confluence action items with assignee and date, Linear "create issue from selection" †.
- *Why it fits:* this is the Notes "one great moment" in the PRODUCT_BRIEF. A team turns its idea doc's to-do list into milestone tasks without retyping.
- *Outside the group:* universally wanted. Google Docs is the only general-purpose doc tool whose checklist items sync both ways with a task list, and only on work accounts. Confluence and Linear do it inside their own ecosystems. Doing it across notes, tasks and calendar is a differentiator.

**P8. Inline and note-level comments with resolve, reactions and @mentions.**
- *Who:* every tool except Obsidian and Apple Notes.
- *Why it fits:* teams review the pitch, and organisers answer questions where they belong (on the FAQ or Rules note) instead of in a Discord scroll.
- *Outside the group:* yes, it's table stakes. Note: Craft's "Viewer can comment without editing" is the right default for judges and guests.

**P9. A plain "linked from" list (backlinks without a graph).**
- *Who:* Obsidian's backlinks pane, Notion backlinks †, Linear @-references.
- *Why it fits:* it is the spine made visible. On the Rules note, a team sees which of its tasks and docs cite it.
- *Outside the group:* yes. The PRODUCT_BRIEF's "never look like a graph" rule is satisfied by a list.

**P10. Read-only publish to the web, optionally with "duplicate".**
- *Who:* Notion Sites (free subdomain and indexing), Craft links that need no account, HackMD Public-view books, GitBook sites.
- *Why it fits:* a public hackathon brief, judges without accounts, and a team's submission page.
- *Outside the group:* yes. Freelancers' proposals, creators' public notes.
- *Flag:* access for judges and guests belongs to the hackathon plan.

**P11. A pre-filled submission note with the Devpost headings.**
- *Who:* Devpost's story template.
- *Why it fits:* teams write the same seven sections at 3 a.m.; a ready skeleton saves time and matches what judges expect.
- *Outside the group:* only as a general "project write-up" starting note. It's cheap and comes with the hackathon set.

**P12. Whole-workspace offline on desktop.**
- *Who:* the opposite of Notion's per-page, per-device opt-in (a common complaint). Obsidian, Apple Notes and Craft are native and offline.
- *Why it fits:* hackathon venue Wi-Fi is famously bad, and the Tauri desktop app can keep every note a team member can see readable and editable.
- *Outside the group:* yes. The privacy/PKM crowd and the "works offline-ish later" student promise in the brief.

**P13. Daily note with a default template** *(lower priority for this lane)*.
- *Who:* Obsidian, Craft (per space, calendar view).
- *Why it fits:* weak for a hackathon, strong for students, developers and founders. It belongs to the role-journeys lane's call; noted here so it isn't lost.

---

## 5. What to deliberately NOT copy

| Don't copy | Seen in | Why |
| --- | --- | --- |
| **Databases, property schemas, Collections, Bases** | Notion (including wikis, which are databases), Coda tables, Slite Collections, Craft Collections, Obsidian Bases, Confluence databases | A PRODUCT_BRIEF non-goal. Reviewers say Notion is "time consuming to setup correctly" and that non-technical users need extra time to learn databases and formulas. Even Slite, Craft and Obsidian drifted here, which is a warning about where the slope leads. |
| **Unlimited nesting, teamspaces inside workspaces** | Notion, Coda ("hide-and-seek"), Confluence (pages that "get lost") | Findability is the top small-team complaint. Prefer container → notes (at most one level of sub-notes) plus a curated home. |
| **Synced blocks / transclusion** | Notion † | Editing one block in many places is hard to reason about; the spine's references and "linked from" cover the need. |
| **Template marketplaces and galleries** | Notion, Confluence blueprints, Craft, Coda | "No template hunt" (PRODUCT_BRIEF). Ship a few opinionated starting sets; let people duplicate their own. |
| **Per-page restriction matrices** | Confluence restrictions, HackMD per-note vs per-book permissions | Teams of up to 5 need container-level access only. Mixed permissions inside one set produce warnings and confusion (HackMD has to warn about them). |
| **Draft → publish, change requests** | Confluence pages, GitBook locked live edits | Too heavy for everyday team writing; Confluence's own live docs drop the publish step. Keep "publish to web" as a separate, explicit share action. |
| **Page analytics and view counts** | Confluence analytics, Notion page analytics | Surveillance-flavoured for small teams. *Borderline:* "seen by" on a hackathon **update** could help organisers. Flag it to the hackathon plan rather than building analytics. |
| **Graph view** | Obsidian | A PRODUCT_BRIEF non-goal (the Anytype trap). Use the P9 list instead. |
| **AI scattered through the UI** | Notion Agents, Confluence Rovo, Gemini side panel, Slite Ask | MCP-only, with no AI colour or badge. Note that "Ask the hub" (cited answers that prefer fresh notes) is what people value; a user's own assistant can do it through MCP if the notes expose freshness and owner. |
| **Apple-only or account-gated viewing** | Apple Notes (non-Apple users can't collaborate), Craft editors need an account | For a hackathon, the first open must work from a link on any OS (the web access belongs to the hackathon plan). |
| **Per-member paid sync** | Obsidian Sync shared vaults | Contradicts the "fair pricing" pillar. |

---

## 6. Sources

**Notion**
- Offline (official): https://www.notion.com/help/use-pages-offline · launch coverage (Aug 2025): https://9to5mac.com/2025/08/20/notion-offline-mode/ · critique: https://www.androidauthority.com/notion-offline-mode-vs-obsidian-3590238
- Page history by plan: https://www.notion.com/help/duplicate-delete-and-restore-content
- Wikis and verified pages: https://notion.com/help/wikis-and-verified-pages
- Duplicate public pages: https://www.notion.com/help/duplicate-public-pages
- Sites pricing: https://www.notion.com/en-gb/help/notion-sites-availability-and-pricing
- Notion 3.0 Agents (18 Sep 2025): https://notion.com/releases/2025-09-18
- Guests (2025 guidelines and conflicting 2026 claims): https://userjot.com/blog/notion-pricing-2025-plans-ai-costs-explained · https://tinycommand.com/blogs/notion-pricing-2026
- Sidebar and teamspaces guidance: https://www.notion.com/help/guides/structure-sidebar-focused-work-teamspaces · cleanup: https://notionflows.super.site/blog-post/clearing-up-your-notion-sidebar-a-notion-consultants-guide-to-navigating-with-clarity
- Complaints: https://www.capterra.com/p/186596/Notion/reviews/?rating=1 · https://news.ycombinator.com/item?id=36511964 · https://articles.mergify.com/why-we-switched-from-notion-to-linear/

**Google Docs**
- Tabs: https://support.google.com/docs/answer/15499791 · https://workspaceupdates.googleblog.com/2024/10/tabs-in-google-docs.html
- Assign checklist items to Tasks: https://support.google.com/docs/answer/12048749 · https://workspaceupdates.googleblog.com/2022/07/tasks-integration-in-google-docs.html
- Forced-copy links: https://learninginhand.com/blog/google-document-url-tricks
- Docs as a wiki (vendor-written): https://slab.com/blog/documentation-tools/ · https://cotera.co/articles/confluence-vs-google-docs-comparison.md

**Obsidian**
- Bases: https://obsidian.md/changelog/2025-05-21-desktop-v1.9.0 · https://obsidian.md/changelog/2025-08-18-desktop-v1.9.10
- Team Sync (a seat per member): https://obsidian.md/de/help/teams/sync
- Collaboration complaints: https://forum.obsidian.md/t/obsidian-for-a-collaborative-environment/95037 · https://www.capterra.com/p/236468/Obsidian/reviews/

**Apple Notes**
- Non-Apple users can't collaborate: https://discussions.apple.com/thread/254445662 · sync issues: https://forums.macrumors.com/threads/apple-notes-shared-notes-issues.2226184/
- Markdown in iOS/macOS 26: https://apple.gadgethacks.com/how-to/how-to-import-and-export-markdown-in-apple-notes-on-ios-26/

**Confluence**
- Live docs: https://support.atlassian.com/confluence-cloud/docs/configure-live-docs-in-confluence/ · Rovo: https://support.atlassian.com/confluence-cloud/docs/create-and-edit-content/
- Default page statuses (feature request): https://jira.atlassian.com/browse/CONFCLOUD-75296
- Complaints: https://www.capterra.com/p/136446/Confluence/reviews/?page=77 · G2 listing (not fetched; G2 blocks bots): https://www.g2.com/products/confluence/reviews
- Knowledge-base rot and the owner-plus-expiry idea (HN, 2022): https://news.ycombinator.com/item?id=30372219 (thread https://news.ycombinator.com/item?id=30371723)

**Craft**
- Sharing (per doc, no folder sharing): https://support.craft.do/en/share-and-publish/share · comments: https://support.craft.do/en/introduction/navigation/comments · templates and daily notes: https://support.craft.do/en/write-and-edit/templates

**Slite**
- Verification: https://slite.com/help/F9erHftuXmOHY0/Doc-Verification · organize (channels, collections): https://slite.com/help/8bd4HVVH-4KoaC · changelog: https://slite.com/changelog

**Linear**
- Documents: https://linear.app/docs/documents · team documents (Jun 2026): https://linear.app/changelog/2026-06-04-team-documents · initiative updates: https://linear.app/changelog/2025-02-13-initiative-updates · changelog timeline: https://linear.app/changelog/timeline

**Basecamp**
- Docs & Files and Message Board (third-party guides; Basecamp's own help was not reached): https://www.ashrae.org/file%20library/communities/committees/standing%20committees/electronic%20communications%20committee/basecamp-project-docs-files-organization-maintenance-final.pdf

**Coda / Superhuman Docs**
- Pages and subpages: https://help.superhuman.com/hc/en-us/articles/46210114502157-Organize-pages-and-subpages

**GitBook**
- Glossary (collections, spaces, change requests, site sections): https://docs.gitbook.com/resources/glossary · UI and Home: https://docs.gitbook.com/resources/gitbook-ui

**HackMD / HedgeDoc**
- Book mode: https://hackmd.io/s/how-to-create-book · HedgeDoc 2 status (repo snapshot): https://www.fs-infmath.uni-kiel.de/git/FS-InfMath/HedgeDoc/src/tag/v2.0.0-alpha.3

**Hackathons**
- Devpost live hackathon pages (tabs, overview sections, Updates feed): https://googlechromeai2025.devpost.com/ · https://googlechromeai2025.devpost.com/updates · https://treehacks-2025.devpost.com/
- Devpost story headings (example project): https://devpost.com/software/peerbuilt
- MLH Organizer Guide: communication platform https://guide.mlh.com/general-information/event-logistics/hackathon-communication-platform · help desk and announcing updates https://guide.mlh.com/general-information/day-of-logistics-and-hacker-experience/help-desk-recommendations · using Devpost https://guide.mlh.com/general-information/judging-and-submissions/hackathon-submission-portal/using-devpost
- Mattermost hackathon runbook: https://handbook.mattermost.com/contributors/guidelines/how-to-run-a-hackathon
- Notion hacker guides (structure seen via search snippets; the pages render client-side): https://obtainable-spike-408.notion.site/HackViolet-2022-Hacker-Guide-60306983312c46d6aa107e906f164564 · https://createdmary.notion.site/The-Official-HackMerced-Hacker-Survival-Guide-7cd612bd3c3c4cdfb27b8f2535560ee2 · https://tribegroup.notion.site/Avalanche-Hacks-Summer-2022-Participants-Guide-297d276b87ca4c0692930a7e28729c12
- Notion hackathon templates: https://www.notion.com/templates/hackathon-event-page · https://www.notion.com/de/templates/hackathon · participant hub: https://glamorous-patio-de9.notion.site/Virtual-Hackathon-Website-c41088d4bcc948f59af4f19b1fbe2882
- Organiser retrospective (miscommunication, last-minute renames): https://lighthouse.deerwalk.edu.np/posts/zwrqwppejp2yqwg5pq562y5g · remote hackathon: https://www.callstack.com/blog/remote-hackathon
- HackMD event agenda example: https://hackmd.io/EuA4R4ZWQUm_v_kgJwK0UA · Turing Way Book Dash template: https://book.the-turing-way.org/community-handbook/templates/template-bookdash-notes
