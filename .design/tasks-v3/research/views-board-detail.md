# Board, task panel and full page: round 2b research

> Lane report for the Tasks re-plan, round 2b (2026-10-10). Read against [REPLAN.md](../REPLAN.md) §8 as of round 2c, plus today's app in [current-state-board-timeline-dnd.md](./current-state-board-timeline-dnd.md), [current-state.md](./current-state.md) §1.9 and [visual-audit.md](./visual-audit.md) A3, A5 and E. Decided calls are cited by number and not reopened. **[unverified]** marks a claim I couldn't confirm from a primary source.

---

## 1. Card anatomy

**Leaders.** [Linear](https://linear.app/docs/board-layout) toggles card properties per view and never shows descriptions; [Jira](https://confluence.atlassian.com/jirasoftwareserver0821/customizing-cards-1114801503.html) allows three extra fields; [Notion](https://www.notion.com/help/boards) and [ClickUp](https://help.clickup.com/hc/en-us/articles/35342044832279-Customize-Board-view) offer three card sizes; Asana's automatic covers drew years of [complaints](https://forum.asana.com/t/board-view-should-allow-for-default-to-no-images/87999).

**Pattern:** a title plus one configurable meta strip. The description shows only as an opt-in preview.

**Moduo: the kit Card**, with everything bound to density (44).

| | Standard (default) | Detailed adds |
|---|---|---|
| Title line | The leading status control (category icon, 24 px hit area) · the title, in the row's body face, wrapping to 3 lines then "…" | The handle `MOD-142` above the title, in tertiary text |
| Meta line, 12 px | Project dot + name (cross-project only) · priority (if set) · one date (41) · MetaCounts (tags · files · comments · ↳ 2/5 · waiting · repeat) · avatar on the right | A second line: tag names (≤3, then "+n") · "1h 20m of ~4h" · "on Anna · 2d" |
| Description | Off. Display → "Description preview" adds 2 lines (56) | — |

- **The leading control** shows the category icon, and clicking it completes the task. The List lane must adopt the same control, so rows and cards don't fork.
- **An agent at work** shows as "Claude · working" in the meta line (52).
- **What gives way (42):** the meta line never wraps. As width runs out, whole items move behind "+n" in this order: counts, then priority, then the project's name (its dot stays). The date and the avatar never drop.
- **Covers:** decided no (tasks-v2). Attachments show as the files count.
- **The Focus mark** is neutral and appears on hover only (46, visual audit A3).
- **Sizes:**
  - **Width:** fixed at 296 / 280 / 264 px by density, so cards keep their shape when the window resizes. This re-decides tasks-v2 §6's flexing 280–400 px, class (c).
  - **Spacing:** padding 12 / 10 / 8; 6 / 4 / 4 between cards.
  - **Height:** a one-line card is about 60 / 54 / 48 px (today: 65 px at every density).

## 2. Columns

**Leaders.** [Linear](https://linear.app/docs/board-layout) keeps hidden columns as drop targets and has "Show empty groups"; [GitHub's](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-board-layout) column limits highlight the header and [Jira's](https://support.atlassian.com/jira-service-management-cloud/docs/manage-board-columns-and-statuses/) turn it red; a collapsed [Trello](https://support.atlassian.com/trello/docs/collapse-or-expand-a-list/) list keeps its name and count.

**Pattern:** the header is name · count · menu; empty columns can be hidden; WIP limits work as an alarm.

**Moduo:**

| Scope | Group by | Add button at the end |
|---|---|---|
| One project | **Status** (default, call 2) · Section · Assignee · Team · Priority · Waiting on | "+ Add status" or "+ Add section" (22a, 53a); none otherwise |
| Across projects | Status category · Project · Area · Assignee · Team · Priority · Waiting on | None |

- **The header** is the kit GroupHeader, 28 px and sticky.
  - **Contents:** the mark (category icon, two-initial avatar, priority glyph or project dot) · the name as typed, in sentence case (40) · a tertiary count · a section's date chip ("Oct 13–24", 68a) · "+" and ⋯, swapped in on hover.
  - **⋯ for a status:** Rename · Fold · Delete… (its tasks take the first status of the same category).
  - **⋯ for a section:** Rename · Set dates · Delete… (its tasks go to "No section").
  - **⋯ for anything else:** Fold only.
- **Order:** "No section", "No assignee" and "Not waiting" come first, as in the List (❓14); people are alphabetical, with Me first.
- **Waiting on columns:** Not waiting · one per person, contact or agent · Blocked by a task · Other.
  - A drop into a person's column sets waiting on them.
  - The last two need a value a drop can't supply, so they refuse the card before the drop.
- **Folded (53b, decided):** a 32 px button with the mark, the count and a chevron.
  - Backlog and Won't do start folded.
  - A section has no icon, so its button shows two initials in the avatar recipe (43). Otherwise two folded sections look identical.
- **Done:** a status board always shows Done as a drop target, listing cards by Display → Completed. When that's Hidden, the column holds only "14 completed · show".
- **Empty columns:**
  - **Always shown:** statuses, sections and priorities. They're the project's shape and its drop targets.
  - **Hidden when empty:** assignees, teams, projects, areas and waiting targets. Display reads "Empty groups · 3 hidden · Show".
- **WIP limits: no.** The header count is the mirror; a limit is an alarm, against 46 and "mirrors, not walls". Focus caps personal work in progress, and team load (❓12) shows ownership. Kanban purists lose one signal.

## 3. Swimlanes

**Leaders.** Linear (sub-grouping), [Jira](https://support.atlassian.com/jira-software-cloud/docs/configure-swimlanes/) (six kinds), GitHub (group by), Notion (sub-groups) and ClickUp (subgroups, with requests to [hide empty ones](https://feedback.clickup.com/feature-requests/p/hide-empty-swimlanes)) all have them. Asana shipped rows in [July 2025](https://forum.asana.com/t/introducing-swimlanes-on-board-create-rows-to-organize-your-kanban-workflows/1078888) after a years-long request thread. Trello has none built in [unverified]. Height's docs went offline at its [2025 shutdown](https://alternativeto.net/news/2025/3/height-project-management-tool-to-shut-down-by-september-2025/), so it can't be checked.

**Pattern:** one optional second axis, off by default. Nearly universal.

**Moduo: yes, one level, off by default** (call 1), in Display → **Rows: None · Section · Assignee · Priority · Project**. It stays off by default because most ≤5-person boards don't need a second axis.

Section rows on a status board give an agency phases × stages; Assignee rows, a stand-up board; Project rows in All, a light portfolio.

- **The row header** is a full-width GroupHeader, its label pinned at the left edge. Folding shrinks the row to that one horizontal line (46a); empty rows are hidden and counted.
- **Dragging between rows** changes the row's field. The exception is Project rows: moving a task to another project stays a deliberate Move (as ❓70 does on the Timeline).
- **With rows on,** the board scrolls as one, and each cell shows 20 cards, then "+ 34 more".

## 4. Interactions

**Leaders:** Linear creates from a "+" at a column's top, shares one order between board and list, and moves cards with ⌥⇧↑↓ ([docs](https://linear.app/docs/board-layout)). GitHub turns manual order off while a board is sorted.

| | Moduo |
|---|---|
| **Inline add** | The header's "+" (or `C` in a focused column) opens an inline card at the top of the column and of the manual order. An empty column shows "+ Add task" in its body. **The List's group "+" follows the same rule** (call 8). ⏎ creates the task and opens the next blank card; Esc closes. |
| **Pre-fill** | The column's value, the scope and the active filters (tasks-v2). A category column gives the project's first status in that category. In All, the project slot starts empty and reads "Goes to your Inbox". |
| **Across columns** | Changes the column's (and row's) field only; a section drag never touches status (22a). An InsertionLine shows where the card lands, and columns you can't edit refuse it before the drop (today: no preview, and an error after). Undo for 8 s (default a). |
| **Within a column** | In one project, it reorders the project's single manual order, which the List shares (§6.8, as Linear does). Boards across projects, and sorted boards, don't reorder. |
| **Subtasks** | Cards are top-level tasks showing "↳ 2/5". Moving a parent's column changes only the parent; moving its project or section takes the subtasks (P0 #8). Display → Subtasks: With parent (default) · As cards (the default in My tasks, so subtasks assigned to you show, captioned "↳ parent"). Call 3 covers finishing a parent. |
| **Multi-select** | ⌘-click, ⇧-click or the key map's select key (default b). Dragging one selected card moves them all, with one Undo; the bulk bar is the List's (default e). |
| **Keyboard** | ↑↓ within a column; ←→ to the next column at the nearest position; ⏎ opens; ⌥⇧↑↓ and ⌥⇧←→ move the card. Screen readers hear titles and column names, not today's UUIDs. |
| **Context menu** | The one menu shared by every view (decided). |

## 5. Boards across projects

- **Columns are the five categories:** Backlog (folded) · To do · In progress · Done · Won't do (folded). They use the names instead when every project in view shares them (53a).
- **Each card leads with its category icon.** It shows its own status name only when that differs from the column's ("In review" under In progress).
- **The project chip** leads the meta line; Detailed shows "Project › Section".
- **A drop into a category** sets the project's first status in it, and the card shows which.
- **Order is sorted, never manual** (§6.8): due date, then priority, by default.
- **Inbox items never appear** (❓20). *Assumption:* All and saved views leave out unfiled tasks.

## 6. Board states

| State | Moduo |
|---|---|
| **First run, or an empty project** | The status columns are drawn. The first To do column holds the EmptyState: "No tasks yet" · "+ Add task" · the hint "C" |
| **Loading** | Opens from the device copy (§6.11), so only a first sign-in waits: headers at once, three static placeholder cards per column. Never "Nothing here yet" (P0 #5) |
| **Read-only** | No "+" and no drag. The menu offers Open · Copy link · Copy handle. "View only" sits next to the title |
| **Filtered to nothing** | The columns stay, each showing "0". One line reads "No tasks match · Clear filters", and the toolbar reads "0 of 48" |
| **A huge column** | Each column scrolls on its own and draws only what's on screen; the 3-line title cap bounds card heights. Done cards load on demand. The bar: 500 cards in one column of a 10,000-task workspace stay smooth (❓37) |

## 7. The detail panel, top to bottom

**Leaders.** [Todoist's task view](https://todoist.com/help/articles/use-the-task-view-to-manage-tasks-in-todoist-eDeRDO0C) puts content on the left and labelled properties on the right. Things opens a to-do [in place](https://thesweetsetup.com/simple-guide-to-managing-tasks-in-things), with notes and a checklist, and no properties panel or comments [partly verified].

**Pattern:** content first, properties as a compact block, discussion last.

**Moduo:**

1. **The title row:** "Details ▾" · ⤢ full page · ⋯. While an item is open, "← Item name" replaces the dropdown (72a). Collapsing stays in the bottom bar (48b).
2. **The header:** the breadcrumb "● Acme rebrand › Design" (click to move) · the handle (click to copy, ❓4) · ▶ Focus on this (❓31) · Add to Focus and claims.
3. **The title,** 18/600, wrapping, with the status control.
4. **The agent session line,** directly under the title, as ❓52 decided (not after Linked, as the brief listed): "Claude · Writing tests · step 3 of 5 · 2m ago · PR #42 ↗". It expands to the notes and the hand-back summary with "Post as comment" (51).
5. **The description,** folding at about 8 lines into "Show more · 2 tasks · 1 email" (56).
6. **The attachments strip** (AT-2).
7. **Properties** [PropertyRow]:
   - **always:** Status · Assignee · Priority · Due · Estimate;
   - **once set:** Team · Reminder · Scheduled · Repeat · Energy · Tags;
   - **the rest** in "+ Tags · Energy · Scheduled · Repeat", ending in "+2" when it doesn't fit (42).
8. **Collections** [CollectionHeader]:
   - **Subtasks** "2 of 5";
   - **Waiting on**: people, contacts, emails, agents, links, notes and blocking tasks (❓5 extends Blocked by);
   - **Blocks**, read-only;
   - **Linked**, as reference cards (❓55).
9. **Comments and activity** [FeedItem · FeedCard · FeedComposer].
10. **The metadata line:** "Created by Maciej · Oct 6 · Updated 7:20 PM".

**What folds:** the description, subtasks after 10 (done ones gather into "3 done · show"), Linked after 5, and older activity (§9). The title and the properties never fold.

## 8. Editing properties

Every value opens one picker recipe: a popover anchored to the value, with type-to-filter past 7 items, ↑↓ ⏎ Esc, and every change logged and undoable.

| Field | The picker |
|---|---|
| Status | The project's statuses, grouped by category (53a) |
| Assignee and team | Me · members · a hairline · "For a team" · Unassigned. Viewers greyed. From the Inbox: "Assign to Mike · in [Project ▾]" (20a) |
| Due | DateField: Today · Tomorrow · Next week · No date, a calendar, an optional time, or typed "fri 3pm". Its footer "Remind me ▸" adds the Reminder row (24) |
| Scheduled | The sessions ("Thu 2:00 PM · 1h") and "+ Add session" (25); the row shows the next one, then "+2" |
| Estimate | 15m · 30m · 45m · 1h · 2h · 4h, or typed. Once timed: "1h 20m of ~4h", with "Add time…" (75) |
| Priority | High · Medium · Low · None |
| Project › section | Projects by area, then sections. Statuses map as 53a says; subtasks follow |
| Waiting on | People · Contacts · Agents · A task… · An email… · A link… · A note, then an optional check-back |
| Repeat | Presets plus Custom, summed up in one line (27i) |

**Why the narrow panel truncates:** the shell's floor is **240 px, not ~320**, which leaves a value about 110 px. That's where "Wed, …" and "0m of …" come from.

**The fix:**
- **Design to a 280 px floor** (call 5).
- **Below 320 px, the label column narrows** from 96 to 76 px. It stays, as decided in REVIEW.
- **Values wrap and never truncate** (PropertyValue `align="start"`). Rule 41's short forms ("Wed 3:00 PM") keep most of them on one line.
- **The Time row gives way** by dropping its bar first, then moving "you 50m" into the tooltip.
- **Only the breadcrumb shortens:** the section first, then the project, with the full path on hover.

## 9. Comments and activity

**Leaders.** Linear mixes comments and history in one feed and [folds older activity](https://linear.app/changelog/2025-04-03-collapsed-issue-history), with threads, reactions, and edit and delete ([docs](https://linear.app/docs/comment-on-issues)). [Jira](https://support.atlassian.com/jira-software-cloud/docs/what-are-the-different-types-of-activity-on-an-issue/) uses All · Comments · History · Work log tabs. Asana toggles Comments and All activity, and users complain the choice [doesn't stick](https://forum.asana.com/t/set-all-task-activity-by-default/493120).

**Pattern:** one timeline, plus a way to see only the conversation.

**Moduo:**
- **One feed,** oldest first, with the composer at the bottom.
  - A change is one tertiary line: "Alex · via Claude Desktop changed due Wed → Fri · 2h" (52).
  - A comment is a card.
- **Less noise:** one person's changes within 10 minutes merge ("Alex changed due, priority and 2 more"), and older activity between comments folds into "Show 12 earlier changes".
- **Filter:** **All · Comments** in the feed header, remembered per person. No tabs.
- **Edit and delete your own comments.** An edit shows "edited"; a delete gets an 8 s Undo and leaves no tombstone. Full access on the project can delete anyone's.
- **Mentions:** `@person` notifies; `@Design` sends one digest (54); `@item` links as a chip (55); `/today` inserts a date chip (33a).
- **No threading.** "Reply" quotes the comment and mentions its author. Long discussion belongs in Chat.
- **Reactions:** call 4.

## 10. The full-page task

**Leaders.** Notion lets each view open pages as a side peek, a centre peek or a full page ([release](https://www.notion.com/releases/2022-07-20)). Linear pairs a peek ([docs](https://linear.app/docs/peek)) with a full issue view that keeps properties on the right, and Todoist's task view does the same.

**Pattern:** one task at two widths; properties move to the right when there's room.

**Moduo** (decided ❓32: same route, in the centre):
- **Open:** ⤢ in the panel's title row, the key map's open-full-page key (default b), or "Open full page" in the menu.
- **The centre header:** "← Board · Acme rebrand" · "3 of 18 ↑↓" for the next and previous task · ⤡ back to the panel · ⋯.
- **The body:**
  - a main column, at most 720 px: title (24/600), the agent line, the description (never folded), attachments, the collections and the feed;
  - a 280 px property column.

  Under 880 px of centre it becomes one column, laid out like the panel.
- **The right panel:** Details would repeat the centre, so its entry reads "Shown in the centre" and the panel opens on Project. Anything clicked in the page (an email, a note) opens there as "← item" (72a): the brief beside the email it came from (call 7).
- **Back:** "←", Esc when you're not typing, or ⌘[. The view keeps its scroll and selection.
- **When to use it:** long briefs, specs and threads, and editing templates (9, 79). The panel stays the default, with no setting to change it.

## 11. Subtasks inside the panel

**Leaders.** [Todoist](https://www.todoist.com/help/todoist/features/use-sub-tasks-in-todoist-kMamDo) adds and reorders sub-tasks in the task view, and completing a parent completes them. Linear does that only if a team [opts in](https://linear.app/changelog/2024-09-06-auto-close-parent-and-sub-issues).

**Moduo:**
- **A row** (26 / 24 / 22 px): toggle · title. On the right: the due date; the avatar, only when it differs from the parent's; and 65a's marks ("1 file · 2 links").
- **Adding:** the header's "+", or ⏎ at the end of the last subtask's title, like a checklist. Pasting several lines offers "Create 5 subtasks?" (74).
- **Reordering:** drag with the shared InsertionLine, or ⌥⇧↑↓.
- **Opening one** shows it in the panel:
  - the title row reads "← Logo concepts round 2", the parent;
  - the breadcrumb reads "Acme › Design › ↳ parent";
  - there's no Subtasks collection (28);
  - ⇧F focuses it (65a);
  - ⋯ → "Make it a task" detaches it.
- **Done subtasks** stay in place, struck through, until the panel changes task.
- **A repeating parent** resets its subtasks each cycle (27e).

## 12. Panel states

| State | The panel shows |
|---|---|
| **Nothing selected, inside a project** | The **Project** view. Selecting a task switches to Details; Esc comes back (call 6). This is the one exception to 72a's "the panel remembers its last view" |
| **Nothing selected elsewhere** | The EmptyState: "Select a task · ↑↓ to move · ⏎ to open". *Alongside* views (In flight, No date) don't switch on selection |
| **Loading** | Renders at once from the device copy. The feed and Linked load behind three static lines, and selection changes wait about 150 ms (today, holding j floods requests) |
| **A deleted task** | "Deleted task" (55) · "Mike deleted this · 2m ago" · Restore, if you can edit |
| **No permission** | "Private item" and "Ask someone in its project to share it with you." No title, no project, never "Inbox" (P0 #10) |
| **A read-only viewer** | Plain values; the title, status and "+" lines are inert. The composer stays, because view access includes commenting ([permissions](../../../specs/permissions.md) §2) |
| **Done or Won't do** | A line under the title: "Done Oct 9 by Alex" (77), or "Won't do · Reopen" (P0 #4) |

---

## Calls to ask the designer

1. **Swimlanes.** Linear, Jira, GitHub, Notion, ClickUp and, since 2025, Asana all have them. The cost is a second axis to keep calm and fast. *Recommend: yes. One level, Display → Rows, off by default, built after the Board basics.*
2. **The default grouping when a project has sections.** 22a opens it by section, but after 53a sections are phases and weeks: "Week 1–12" would open as 12 columns. *Recommend: Status always; Section is one Display choice away.*
3. **Finishing a parent with open subtasks.** *Recommend: finish them too, as Todoist does, with one Undo; the toast names them ("Done · also 2 subtasks"). Linear leaves them open unless a team opts in.*
4. **Reactions on comments.** They replace "ok" and "thanks" comments and their notifications. *Recommend: yes, six fixed reactions that never notify; hover shows who reacted.*
5. **The right panel's minimum width,** a shell change for every module. *Recommend: 240 → 280 px. At a 1024 px window, the centre keeps about 450 px.*
6. **Nothing selected inside a project.** *Recommend: the panel shows the Project view, because the project is "this". The alternative is an empty Details view.*
7. **The full page and the panel.** *Recommend: while a task fills the centre, the panel shows Project, and anything you click in the page opens there with a back arrow.*
8. **Where inline add lands, in both List and Board.** *Recommend: at the top, from the header's "+", which stays visible, as in Linear. A line at the end (Todoist, Trello) can be 500 cards away.*
