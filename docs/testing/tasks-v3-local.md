# Tasks v3 on this Mac: testing guide

> Written 2026-10-14 · branch `t/maciej/tasks-v3-build` (integration head) · **Live-verified:** yes, a full walkthrough on the local stack in headless Chromium at 1440×900, dark theme.
> **Released 2026-10-14:** the migrations are on prod and app.moduo.app runs this build. This guide still works on the local stack.
> **Screenshots** (local, not in git): `docs/local/tasks-v3-walkthrough/` in the `tasks-module-research` worktree. The links below work when you open this file there.

## 1. Open and sign in

- [ ] Open **http://localhost:8100**. It's served from the `tasks-module-research` worktree, on `t/maciej/tasks-v3-play`, which is the integration head.
  - If the page doesn't load, run `MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8100` in that worktree.
  - If the database is down, run `bun run local:up`.
  - Never run `local:reset`: it wipes the tour data.
- [ ] **Edge functions** are served from the same worktree (`bun run local:functions`, already running).
- [ ] Sign in as **`dev@moduo.local`**:
  1. Type the email and press Continue with email.
  2. Read the six-digit code in **Mailpit**: http://127.0.0.1:54324.
  3. Type the code, then press **Continue**.

  A code works for 10 minutes, and Resend unlocks after 60 seconds.
- [ ] Switch workspace (top left) to **Overview check (TV-U16)**. This is the tour workspace:
  - 5 projects: Hackathon kit, plus Website launch, Billing revamp, Engineering and Q4 Marketing, all imported from the test fixtures;
  - two teammates (Tess Mate, Third Member), the team Judges, and some logged time;
  - one template and two saved views.

  *My workspace* holds about 1,300 projects left behind by test runs. Skip it.

## 2. What to try

**List** · [01](../local/tasks-v3-walkthrough/01-list-detailed-rows.png)
- [ ] In a project, open Display and set Rows to Detailed, then switch Completed between Hidden, 7 days and All. **Expect:** the IDs (OCTU-n), tags, comment and subtask counts, Project, Due and Assignee columns, and a Backlog section below.
- [ ] Use ↑↓ to move, ⏎ to open, the chevron to unfold subtasks, and drag a row into another section.

**Board** · [02](../local/tasks-v3-walkthrough/02-board-lanes.png)
- [ ] On All, switch to Board, then in Display set Lanes to Assignee (also try Priority, Project and Team). **Expect:** one lane per person, with status columns.
- [ ] Drag a card across columns and lanes. **Expect:** its status or assignee changes, and Undo puts it back.

**Task panel and full page** · [03](../local/tasks-v3-walkthrough/03-task-panel.png) · [04](../local/tasks-v3-walkthrough/04-task-full-page.png)
- [ ] Open *Homepage hero copy*. **Expect:** status, assignee + Team, priority, due with time, tags, the extra fields (Energy · Scheduled · Reminder · Estimate · Repeat · Waiting on), subtasks, blockers, links, files and activity.
- [ ] Press ⤢ (Open full page). **Expect:** the page shows "List · Website launch" with "2 of 5" up/down, and the right panel switches to Project.

**Capture** · [05](../local/tasks-v3-walkthrough/05-capture.png)
- [ ] Press ⌘⇧K anywhere and type `Call Tess tomorrow 3pm #Urgent`. **Expect:** a date chip, a tag chip and the Inbox destination. ⏎ creates the task; ⌘⏎ creates it and keeps the dialog open for the next one.

**Inbox triage** · [06](../local/tasks-v3-walkthrough/06-inbox-triage.png)
- [ ] Select an Inbox task. **Expect:** a bottom bar with Accept 1 · Decline 2 · Duplicate 3 · Snooze H. Try each key; Undo follows every one.

**My tasks and Upcoming** · [07](../local/tasks-v3-walkthrough/07-my-tasks.png) · [08](../local/tasks-v3-walkthrough/08-upcoming.png)
- [ ] My tasks groups your tasks by status. Upcoming lists your days: Today, Tomorrow, the weekdays, then Later. Drag a row to another day.

**Focus** · [09](../local/tasks-v3-walkthrough/09-focus-screen-timer.png) · [10](../local/tasks-v3-walkthrough/10-focus-timer.png)
- [ ] Press Q on four tasks, then open Focus and press Start. **Expect:**
  - the Now card with Done ⏎ · Skip S · Hand off W, and Up next grouped by project;
  - a timer on the card and in the top bar.
- [ ] Leave the page alone for a few minutes, then click the top-bar timer. **Expect:** "You were away …", with Keep · Discard · Count as break.
  - A session is **paused** in the tour workspace; Resume or Stop it from the top bar.

**Timeline** · [11](../local/tasks-v3-walkthrough/11-timeline-drag.png)
- [ ] On All, switch to Timeline and pick a zoom (Week, Month, Quarter or Year). Try Today and "No date · 3".
- [ ] Drag a point. **Expect:** a date label follows it, Esc cancels, and dropping saves with Undo. Also try ⌥←/→ and ⇧D on a selected task.

**Projects, overview and templates** · [12](../local/tasks-v3-walkthrough/12-project-overview.png) · [13](../local/tasks-v3-walkthrough/13-templates.png) · [14](../local/tasks-v3-walkthrough/14-template-use.png)
- [ ] Open Hackathon kit, then set the panel's view (title-row ▾) to Project. **Expect:**
  - status, start, target, lead and client, and an editable description;
  - Progress with "2 of 6 done", then Done this month with time; Waiting, Sections, People, Files and Recently, each after a thin line (no Next up since MOD-152).
- [ ] Set the project's status to Done while it still has open tasks. **Expect:** it asks first, with Won't do · Move · Keep.
- [ ] Open the sidebar's ⋯ → Templates, then Use… on Hackathon kit. **Expect:** a start date, "Every date moves with the start" and Keep who's assigned.
- [ ] From a project's ⋯, try Save as template… and Duplicate….

**Teams** · [15](../local/tasks-v3-walkthrough/15-settings-teams.png)
- [ ] Open Settings → Members and access → Teams → Judges: name, letters, colour, default project and people.
  - **Expect:** the archived default project ("Last year's kit") says it needs a live one.
  - Give a task to a team from the panel's Team button.

**Time report** · [16](../local/tasks-v3-walkthrough/16-time-report.png)
- [ ] With the panel on Project, press Time report. **Expect:** By task or By day, Round to 15 min, and Export CSV and Export PDF.

**Saved views** · [17](../local/tasks-v3-walkthrough/17-saved-views.png)
- [ ] Open *Team board* (in Views) and change its layout. **Expect:** "Unsaved changes · Save · Save as new view… · Revert".
- [ ] Use ⋯ → Save as view… to make your own, then pin it to the sidebar, delete it and press Undo.

**Home widgets** · [18](../local/tasks-v3-walkthrough/18-home-widgets.png)
- [ ] Home shows Tasks (your Focus), Team (one row per person: Focus size, in progress, waiting, due this week), Upcoming and Time ("this week · today"). Use ✎ (bottom right) to edit the layout.

**Files and Storage** · [19](../local/tasks-v3-walkthrough/19-settings-storage.png)
- [ ] Add a file to a task (the + under the description). Then open Settings → Storage. **Expect:**
  - "… of 2 GB used" and the per-file limit;
  - Largest files, with the task and a delete button.

**Importers** · [20](../local/tasks-v3-walkthrough/20-importer-preview.png)
- [ ] Open the sidebar's ⋯ → Import tasks… and pick a file from `tests/fixtures/importers/` (Trello, Linear, Asana, Jira or Todoist). **Expect:** a preview that shows:
  - the counts;
  - each list mapped to a status category, and each person in the file mapped to a teammate;
  - "On the way in" notes.
- [ ] Press Import, then use Undo this import on the Done step.

**Welcome (new person)** · [21](../local/tasks-v3-walkthrough/21-welcome-role.png) · [22](../local/tasks-v3-walkthrough/22-welcome.png)
- [ ] In a **private window**, sign in as `newbie@moduo.local` (same code flow) and open Tasks. **Expect:**
  - "What will you run in Moduo?", then the Welcome to Tasks dialog;
  - three teaching tasks in the Inbox;
  - for a team role, Project kickoff added to the templates.
- [ ] The welcome shows once per person, and newbie has now seen it. To see it again, ask an agent to give newbie a fresh start (an empty workspace and empty preferences, as `tests/onboarding.spec.ts` does), then use a new private window.

## 3. Known gaps

- **Deferred on purpose:** [tasks-v3-polish-deferred.md](./tasks-v3-polish-deferred.md). Each one has a recommendation.
- **Seen in this walkthrough, not fixed yet** (the seven Tasks items were fixed in polish batch 2, `t/maciej/tv-polish-2`: [t-maciej-tv-polish-2.md](./t-maciej-tv-polish-2.md)):
  - **Local setup only:**
    - Signing in logs a failed trial start: the local functions have no Stripe test key.
    - The local functions' `PUBLIC_APP_URL` says port 8081, so links they build (invites) point at 8081, not 8100.
  - **Outside Tasks:** an unknown address such as `/home` shows a bare "Not Found".

## 4. Not in this build

- **TV-D7, contract cleanup:** it drops the old columns and mirrors after the release (≥2 desktop releases and 14 days after TV-D9 ships).
- **TV-SEC1:** shipped with the release (#364).

## 5. Release order

The migration order, what prod already has (including `20261013224816`, workspaces) and the rehearsal results are in [tasks-v3-release-rehearsal.md](./tasks-v3-release-rehearsal.md).
