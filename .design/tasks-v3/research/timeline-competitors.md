# Timeline view: what the leaders do, and what Moduo should build

> Research for the Tasks v3 re-plan, 2026-10-10. Nothing here is decided; open calls belong in [../REPLAN.md](../REPLAN.md).
> Sources are help centres, changelogs and forums. I viewed no screenshots and measured no competitor sizes.
> **†** means I read it through a search summary or a copy, because the page blocked fetching or rendered by script. Treat † as likely, not verified.

It builds on REPLAN **#14** (a project is a bar ending at its target; dated sections are phase markers), **#18** (a dated section is a phase marker with progress) and **#19** (a task with only a due date is a point). The evidence supports all three.

## 1. Scope and rows

**What leaders do**
- **Linear** shows projects only: "Individual issues cannot be viewed on the timeline" ([docs](https://linear.app/docs/timeline)).
- **Jira** shows epics as rows that expand to their child items. A child without a parent never appears ([docs](https://support.atlassian.com/jira-software-cloud/docs/manage-epics-on-the-roadmap/)). **Jira Plans** lets you choose which hierarchy levels show ([docs](https://confluence.atlassian.com/jirasoftwareserver103/view-your-advanced-roadmaps-plan-1489805829.html)).
- **Basecamp's Lineup** shows projects only, split into Present, Future and Past ([help](https://public.3.basecamp.com/p/3QUgFdzBbLxk9FPgRSxVq1y6)).
- **Motion's** Gantt shows projects, grouped by assignee or status ([help](https://www.usemotion.com/help/project-management/views/reference-views/gantt-chart-a-deep-dive)).
- **GitHub, Notion, monday and Asana** give each item its own row under group headers.
- **ClickUp's Timeline** packs many tasks into one lane per group ([help†](https://help.clickup.com/hc/en-us/articles/31440827150615-Group-tasks-in-Timeline-view)).

**The pattern.** A roadmap (one row per project) and a schedule (one row per task) are different jobs. Calm tools start wide, with projects, and expand a project to show its tasks.

**For Moduo**
- **Workspace scope:** one row per project, under area headers. A chevron expands a project into its tasks, by section (one level only).
- **Project scope:** the project row, then sections and their tasks.
- One item per row; no packed lanes. The Inbox stays off, as decided.

## 2. Date cases

**Moduo tasks have no start date, so only projects have a true span.** Making up start dates backfires: ClickUp's Gantt adds one when you drag a due-only task, and users want that off ([May 2023, 12 votes](https://feedback.clickup.com/feature-requests/p/disable-start-date)). Its Gantt also leaves due-only tasks off the chart ([guide†](https://help.clickup.com/hc/en-us/articles/40982447293207-How-to-use-Gantt-charts-for-project-planning)), and Jira's basic timeline reportedly needs both dates for a bar (Atlassian Community†).

| Case | What leaders do | Moduo |
| --- | --- | --- |
| **Due date only** (most tasks) | Asana: "a small colour block with the task name after" ([forum](https://forum.asana.com/t/task-information-not-showing-on-the-timeline-view-next-to-the-task/970551)). monday: a point at the deadline ([ClickUp-written review](https://clickup.com/learn/topic/project-management/tools/monday/gantt-charts/)). Milestones are diamonds in Linear, and in monday, TeamGantt and ClickUp†. | A **due point** of fixed size on the due day. It has no width, because there's no known duration (#19). |
| **Start only, or target only** | Jira Plans and BigPicture fade the side whose date is missing ([Jira](https://support.atlassian.com/jira-software-cloud/docs/roll-up-dates-on-your-timeline/), [BigPicture](https://appfire.atlassian.net/wiki/spaces/DLP/pages/2212497400)). | Projects only. Solid from the date you set; an outline runs to the first or last dated task. With no dates, an outline spans the dated tasks; with none of those, no bar. |
| **Start and end** | A solid bar, everywhere. | A solid project bar. |
| **Several sessions** | No tool I found draws them. Motion schedules work chunks on its calendar†. | Sessions stay on the Calendar; hover or selection shows ticks on the row. Sessions but no due date: a hollow point at the next session. |
| **Recurrence** | Asana shows only the next occurrence ([forum†](https://forum.asana.com/t/show-recurring-tasks-on-future-calendar/81981)). ClickUp's Timeline ([†](https://feedback.clickup.com/feature-requests/p/show-recurring-tasks-in-timeline-view)), Todoist ([help](https://www.todoist.com/help/articles/use-the-calendar-layout-in-todoist-lPHRQTu0o)) and TickTick† can show future occurrences. | The current occurrence, with a repeat glyph. "Show repeats" adds ghost points you can't drag. |
| **Overdue** | Red: Linear's late forecast; Jira's and Plane's dependency lines. | The point stays on its day, in the muted late tone. The name column reads "Late · 3 Oct". |
| **Done** | Basecamp: "muted, thinner" ([post](https://updates.37signals.com/post/new-new-home-screen-the-lineup-doors-and-more)). Linear's diamond changes with its status ([docs](https://linear.app/docs/project-milestones)). | Muted, with the done check. Done items never widen the visible range. |

**Rule: solid means a date you set; an outline means a range worked out from the tasks.** It replaces Jira's stripes and today's gradient fade, which says "unknown" about the most common task.

## 3. Anatomy

**What leaders do**
- **Names.** Asana's Timeline puts names beside bars; users report them cut off, with section names stopping near 20 characters ([forum†](https://forum.asana.com/t/word-wrap-for-section-name-in-timeline-view/190008)). Asana's Gantt adds a name column, fixed-width in February 2024 and resizable by March 2025 ([forum](https://forum.asana.com/t/gantt-view-please-show-task-list-and-task-names-in-full-rather-than-cutting-them-off-at-a-preset-width/714017)). Notion ([help](https://www.notion.com/help/timelines)) and Linear (Shift+[, [changelog](https://linear.app/changelog/2024-02-29-milestones-on-the-timeline)) toggle a list on the left.
- **Bar size.** In 2020 monday moved labels outside its bars and shrank items to "squeeze more items" in ([blog](https://monday.com/blog/product/timeline-updates-gantt-view-changes-and-more/)). In 2025 its bars grew to about twice the label height, and users said half as many rows fit ([community†](https://community.monday.com/t/the-gantt-view-update-yes-the-timeline-is-fatter-thicker/110716)).
- **Header and zoom**
  - Linear's header shows the date under the cursor and can show week numbers; Jira's shows sprints and releases.
  - Zoom: Linear goes week to year, Jira weeks to quarters, GitHub month to year ([docs](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-roadmap-layout)), Notion hours to years. Asana's Years view stops at one year ([forum†](https://forum.asana.com/t/timeline-view-display-more-than-1-year-in-years-view/532660)).
- **Weekends.** TeamGantt greys them out ([help](https://support.teamgantt.com/article/72-customizing-days-in-your-projects)); monday added a show/hide switch in 2020; Asana users asking to hide them were still pointed to a third-party workaround in June 2023 ([forum](https://forum.asana.com/t/option-to-hide-weekends-in-timeline/18792/113)).
- **Off-screen items.** Notion and Linear put arrows on rows whose item is off screen; a click jumps to it.

**The pattern.** A name column fixes truncated titles. Tall bars cost density.

**For Moduo.** A sticky, resizable **name column** holds title, date and counts (dates and counts never truncate). A bar shows its title only when it fits inside, never trailing. Add a two-tier sticky header with the cursor date, weekend tint at Week and Month, off-screen arrows with dates, and a Year zoom.

## 4. Unscheduled items

**What leaders do**
- **A side panel**
  - Asana: an Unscheduled panel on the right ([help†](https://help.asana.com/s/article/timeline)) and a "No date" option ([forum, 2024](https://forum.asana.com/t/how-to-show-unscheduled-tasks-in-timeline-view/970781)).
  - ClickUp's Timeline: a sidebar on the right ([help†](https://help.clickup.com/hc/en-us/articles/31440880547991-Add-and-manage-tasks-in-Timeline-view)).
  - Todoist: a "No date" panel.
  - TickTick: "Arrange tasks" ([blog†](https://blog.ticktick.com/2018/08/10/arrangetasks4ios/)).
- **Rows that stay in place**
  - Notion shows "a phantom project" when you hover over a row; a click places it ([copy of its help†](https://classroom-physicists.physics.mcgill.ca/documentation/notes/quick-guide-to-using-notion/timelines)).
  - GitHub sets dates "with a single click" ([changelog](https://github.blog/changelog/2023-01-31-roadmap-in-projects-public-beta/)).
  - Jira gives a new bar 7, 14 or 30 days, depending on the zoom ([docs](https://support.atlassian.com/jira-software-cloud/docs/add-issues-to-epics-on-the-roadmap/)).
- Basecamp leaves projects without dates off the Lineup.

**The pattern.** A panel on the right, plus click-to-place on rows. No one uses a bottom tray.

**For Moduo**
- Drop the tray. **"No date · 23"** opens a right-panel view: virtualized, grouped by project, searchable.
- Dropping a task on a day sets only its due date, never its project.
- Inside a project, undated tasks stay as rows in their sections. Hovering shows a ghost point ("Set due · Fri 17"); a click sets it.

## 5. Interactions

**What leaders do**
- **Dragging** moves and resizes bars everywhere. In Linear, ⌘ keeps milestones still while a project moves, and Shift moves a cluster of them. Height (shut down September 2025, [news](https://alternativeto.net/software/height/news)) dragged several tasks at once ([page†](https://www.height.app/product/gantt-charts)).
- **Creating dependencies.** Hovering over a bar shows dots at its ends, which you drag onto another item. Jira ([docs](https://support.atlassian.com/jira-software-cloud/docs/create-or-remove-dependencies-on-your-timeline/)), Linear ([docs](https://linear.app/docs/project-dependencies)), Notion ([release](https://www.notion.com/en-gb/releases/2022-12-15)), Plane ([docs](https://docs.plane.so/core-concepts/issues/timeline-dependency)) and ClickUp† all work this way.
- **Showing dependencies.** Jira has an on/off switch ([docs](https://support.atlassian.com/jira-software-cloud/docs/show-or-hide-dependencies-on-your-roadmap/)) and turns lines red when dates overlap; Linear draws them blue, red when broken.
- **Shifting dependents when a date moves**
  - Asana's Gantt: maintain the buffer, consume it, or ignore it ([write-up](https://cirface.com/blog/asana-gantt-view)).
  - Notion: shift on overlap, keep the gap, or don't shift ([write-up†](https://sparxno.com/blog/notion-dependencies)).
  - monday: Flexible, Strict or No action ([support†](https://support.monday.com/hc/en-us/articles/360007402599)).
  - Linear moves only backlog and planned projects. ⌘ holds the chain in place, and Shift moves all of it.
- **The keyboard is thin:** GitHub has arrow keys in its table ([changelog](https://github.blog/changelog/2023-03-23-roadmaps-in-projects-are-now-generally-available)); Linear has Space to peek ([changelog](https://linear.app/changelog/2021-05-27-linear-preview-roadmap-timeline)). **No leader documents a keyboard-only way to move dates, undo a drag, or edge scrolling while dragging** (Linear's ⌘ and Shift only modify a mouse drag), which is an opening for Moduo.

**For Moduo**
- Dependency lines show **on hover or selection** (options: Off, On selection, Always).
- A broken link is a dashed line with a late glyph, in the muted late tone; no red.
- One shifting rule: push not-started dependents only when they would overlap. ⌥-drag skips the push; a toast says "Moved 2 blocked tasks · Undo".

## 6. Display options

**What leaders do**
- **The basics:** group by; colour by (TickTick: list, tag or priority; monday: status, priority or owner, [blog](https://monday.com/blog/product/introducing-the-brand-new-monday-com-gantt-view/)); show completed; filters; dependencies.
- **The heavy options:** baselines (monday†, Asana's Gantt, [TeamGantt](https://www.teamgantt.com/features)); critical path (ClickUp†, monday†, TeamGantt, Plane); lead and lag time (TeamGantt); capacity and scenarios (Jira Plans).
- **Linear** has none of the heavy options. G2 reviewers† praise how quickly you can set up its clean timeline, but say it thins out for plans that span several quarters and teams.

**For Moduo:** keep the basics (see the sketch). Baselines, critical path, slack, lead and lag, strict modes and capacity are overkill for teams of five.

## 7. Phases and milestones

**What leaders do**
- **Linear** puts draggable milestone diamonds on project bars; the icon follows status, the current one is yellow, and close ones "collapse into a set, like on a map app" ([changelog](https://linear.app/changelog/2024-02-29-milestones-on-the-timeline), [docs](https://linear.app/docs/project-milestones)).
- **Jira** shows sprints and releases in its header. **Jira Plans** shows releases as red or green circles.
- **GitHub** draws vertical markers for iterations, milestones and dates.
- **Basecamp** draws named lines for company-wide dates ([post](https://updates.37signals.com/post/new-in-basecamp-time-travel-in-the-lineup-24-hour-clock-and-more)).
- **Asana, monday and TeamGantt** use diamonds ([TeamGantt†](https://support.teamgantt.com/article/28-milestone)).
- **Productboard** snaps its cards to a whole week, month or quarter ([help†](https://support.productboard.com/hc/en-us/articles/4403428374675)).

**For Moduo** (following #14 and #18)
- A dated section is a **diamond**: on the project bar at workspace scope, on its header row inside a project. It stays hollow until the section's tasks are done; close ones merge into "◆ 3".
- Consecutive dated sections split the project bar into segments, so "Week 1…12" reads as a ruler.
- No header marker lines by default.

## 8. Reception

- **Readability and density:** Asana's cut-off names and monday's thick bars (§3); an Asana user confused that one-day tasks "do not fill the entire space of the day" ([forum, 2020](https://forum.asana.com/t/is-it-possible-to-change-one-day-visualization-at-the-timeline/100301)).
- **Due dates only:** ClickUp's invented start dates (§2); Height users asking to set a single date ([forum title†](https://forum.height.app/t/modifier-to-add-start-or-end-date-only-to-task-in-gantt-view/1074)).
- **Performance**
  - Jira caps its timeline at 5,000 issues and 500 epics, a limit raised in June 2022 ([JSWCLOUD-20432](https://jira.atlassian.com/browse/JSWCLOUD-20432)).
  - dhtmlx draws only what's on screen by default, and still warns of delays from 10–20k tasks ([docs†](https://docs.dhtmlx.com/gantt/guides/performance/)).
  - ClickUp's feedback board is full of speed complaints ([example](https://feedback.clickup.com/feature-requests/p/terrible-performance-looking-for-alternatives)).
- **Learning curve**
  - G2 reviewers† call TeamGantt easy, but note that it takes training and lags on big projects.
  - Jira users get stuck when child items don't show ([community†](https://community.atlassian.com/forums/Jira-questions/Unable-to-see-child-issues-on-timeline/qaq-p/2642872)).
- **Doubts about dated roadmaps**
  - Janna Bastow calls them "a big pile of assumptions" and proposes Now, Next and Later instead ([ProdPad, 2019](https://www.prodpad.com/?p=6771)).
  - Linear added rough timeframes so teams can plan "at your current level of certainty" ([changelog](https://linear.app/changelog/2024-01-17-project-timeframes)).
  - Basecamp's [Hill Charts](https://basecamp.com/hill-charts) track certainty, not time.

## 9. Personal and student use

- **TickTick** has a Timeline (Premium) for lists, folders and filters, but not for Today or the Inbox. It colours items by list, tag or priority ([help†](https://help.ticktick.com/articles/7055782331050622976)). Since January 2026 it also has a year view with heatmaps ([news](https://alternativeto.net/news/2026/1/ticktick-8-0-adds-suggested-tasks-improved-yearly-monthly-views-and-customization-options/)).
- **Todoist** has list, board and calendar layouts. Gantt charts come only through [Ganttify†](https://www.todoist.com/help/articles/use-ganttify-with-todoist-08yhLcWJa).
- **Things** has an Upcoming list ([support](https://culturedcode.com/things/support/articles/2803579/)).
- **Sunsama** has no timeline. A request for one, from 2021, has 21 votes ([roadmap](https://roadmap.sunsama.com/improvements/p/objectives-timeline-view)).
- **Akiflow:** I found no timeline, only a request to group by time horizon ([board†](https://akiflow.featurebase.app/p/add-time-horizon-grouping-to-project-list-views-this-week)).
- **Students:** study-skills pages recommend a one-page "semester at a glance" listing every syllabus deadline, to spot the busy weeks ([SFU†](https://www.lib.sfu.ca/node/29025), [CU Boulder†](https://www.colorado.edu/artssciences-advising/resource-library/academic-skills/calendar-to-plan-the-semester)).

**The pattern.** People planning for themselves want a deadline map that shows which weeks are heavy. They don't want bars.

**For Moduo.** At Quarter zoom, a row per course with its due points and week sections is the term at a glance. Add an optional quiet count of tasks due per week in the header: numbers only, no heat colours.

## Moduo target sketch

**Rows at each scope**
- **All, or one area:** area headers, then project rows (bar, diamonds, progress) that expand to tasks by section. Opens at Quarter.
- **Inside a project:** project row, sections, tasks. Opens at Month.
- **My tasks and Upcoming:** by project; teams can group by assignee.
- **Subtasks:** off by default; when on, nested at `--row-h-sm`, indented 16 px.

**How each date case renders:** as in the §2 table.
- The due point is a 12 px circle (10 px dense); a section diamond is the same size. ❓ Circle or diamond for tasks? I recommend the circle, so diamonds keep meaning "milestone".
- Sessions only: a hollow circle. Late: the muted late tone. Done: muted, with the accent done check.

**Anatomy.** These sizes are Moduo proposals built from `tokens.css`, not measured from other tools.

| Element | Comfortable / compact / dense |
| --- | --- |
| Row | `--row-h`: 36 / 32 / 28 |
| Project bar | 24 / 22 / 20 px, at most 1.2× the label's line height (the monday lesson); radius 6 / 5 / 4; neutral fill, 3 px project-colour cap, 2 px progress underline |
| Point or diamond | 12 / 12 / 10 px; dependency dots 6 px, on hover |
| Name column | 280 px default, resizable 200–480; ⇧[ hides it, and titles then sit right of their items |
| Header | Two tiers, 48 / 44 / 40 px, sticky, "Today" pill; group headers stick below in sentence case ("Design · 2 of 5 · 14 Oct") |

- **Accent, in budget order:** the selection tint, a 1 px today line, the done check.
- **Grid:** hairlines at each zoom unit, stronger where a month starts, and a tint on weekends at Week and Month. Draw them as a CSS background.
- **Zoom:** keep today's Week (120 px per day), Month (40) and Quarter (14); add Year (about 3). ⌘-scroll moves between them.
- **Range:** endless and virtualized. It opens with today a quarter of the way across.

**Interactions**
- **Drag:** a project bar moves (its ends resize); a point moves only its due date; a diamond moves its section's date. Nothing drags between groups.
- **Click an empty row:** on a task row, it sets the due date there. On a project row, it places a bar of 7, 14, 30 or 90 days by zoom; dragging draws one.
- A multi-selection moves together. The view scrolls when a drag nears its edge. ⌘Z undoes any change.

| Key | Action |
| --- | --- |
| ↑ ↓ or J K | Move between rows |
| ⌥← ⌥→ | Move the date a day (add ⇧ for a week) |
| D / ⇧D | Open the date picker / clear the date |
| Space / Enter | Peek / open |
| X, ⇧↑↓ | Select / extend the selection |
| T / F | Go to today / fit the selection |
| − / = | Zoom out / zoom in |
| ⇧[ | Show or hide the name column |
| ⌘K | Commands, including "Blocked by…" |
| Esc | Clear the selection |

Check this map against the app's existing shortcuts before adopting it; − and = may collide with window zoom in Tauri.

**Display menu** (the List and Board toolbar grammar): Group by · Show done (Hidden, 7 days, All, as on the Board) · Colour by (project, status category, none) · Dependencies · Show sessions · Show repeats · Subtasks · Due per week. Filters use the shared FilterBar.

**Empty and undated.** With nothing dated, the rows still list, and the canvas shows the today line and one sentence: "Nothing has a date yet. Click a day on a row, or open No date." The whole canvas takes drops, which fixes today's 8 px drop strip. "No date · N" opens the right panel (§4).

**Performance.** Render only the visible rows and dates, plus a screen of margin. Keep hover state per row. Draw dependency lines only for on-screen or selected items. Let the minute tick move only the today line.

**Left out on purpose:** baselines, critical path, slack, lead and lag, strict auto-scheduling, workload lanes, scenarios, hidden weekends, working-day calendars, red health or forecasts, packed lanes, rotated text, task start dates, Inbox lanes, drag-to-reassign.

## Evidence quality

- **Strong** (official sources, read directly): Linear, Jira, GitHub, Notion, Basecamp, Plane.
- **Medium:** Asana (script-rendered help, so forums), monday (support blocked; blog and community via search), ClickUp (help returned 403; search summaries and its feedback board), TeamGantt.
- **Weak:** TickTick, Height (offline since September 2025), Motion, Akiflow, and how students actually plan.
- **Toggl Plan** is being replaced by Toggl Focus, with no shutdown date as of December 2025 ([thread](https://community.toggl.com/t/toggl-focus-faqs-when-switching-from-toggl-plan/3242)).
- **Our own docs disagree** (not fixed here): [RESEARCH-2026-10](../../tasks-dogfood/RESEARCH-2026-10.md) says due-only tasks "already render" as diamonds; the [code audit](./current-state-board-timeline-dnd.md) shows gradient bars.
