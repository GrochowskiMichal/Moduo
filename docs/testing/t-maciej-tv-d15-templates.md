# Manual test checklist — TV-D15 Templates and Duplicate project

> Generated 2026-10-13 · branch `t/maciej/tv-d15-templates` · **Live-verified:** yes, on the local stack as dev@moduo.local: Duplicate…, Save as template… (a project and a task), the Templates page, the editor (description saved), New project from template…, capture's More → Template… → Create, Share with the workspace, Delete with Undo.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Duplicate project… (the hackathon path)
- [ ] **Do:** make a project with a start and target date, three sections (one with an end date only), five tasks (two with subtasks, one Won't do, one Done), a dependency, a tag and descriptions. Its ⋯ → **Duplicate…** → **Expect:** "Duplicate “…”", the name "… (copy)", Starts on today, no "Keep who's assigned" when nobody is assigned. _(web / desktop)_
- [ ] **Do:** rename it "Team Alpha" while the dialog is open, then wait a few seconds → **Expect:** your typing stays. _(web)_
- [ ] **Do:** Duplicate → **Expect:** "Team Alpha" appears in the sidebar at once and opens; its tasks are the open ones only (Done and Won't do aren't there), subtasks under their parents, every due date shifted by the same number of days, sections with shifted dates, the same statuses (names and order), the dependency and the tag on the copies, no comments, no time, no reminders. _(web)_
- [ ] **Do:** a task that was In progress in the original → **Expect:** it's in the first To do status in the copy. _(web)_
- [ ] **Do:** assign two tasks to a teammate, Duplicate with "Keep who's assigned" ticked, then again unticked → **Expect:** the first copy keeps them; the second has everything unassigned (never assigned to you). _(web)_
- [ ] **Do:** Duplicate a private project (shared with nobody) → **Expect:** the copy is private too (the teammate doesn't see it). _(web)_

## Templates
- [ ] **Do:** a project's ⋯ → **Save as template…** → **Expect:** the name is the project's, the note says it's yours until you share it; Save → toast "Saved … as a template" with Open. _(web)_
- [ ] **Do:** the sidebar's hairline ⋯ → **Templates** → **Expect:** a Templates page: Projects and Tasks, each row with its size ("5 tasks · 3 sections"), Use… on hover, ⋯ (Edit, Share with the workspace…, Delete template). _(web)_
- [ ] **Do:** open a template → **Expect:** it opens in the centre marked *Template* with "Only you · Dates are days from the start"; statuses, sections (Starts/Ends in days) and tasks (section, due in days) are editable; "Not saved yet" until Save. _(web)_
- [ ] **Do:** change the description, add a task and a subtask, remove a section, Save → **Expect:** "Template saved"; reopening shows the changes; projects already made from it are unchanged. _(web)_
- [ ] **Do:** Use… (or the hairline ⋯ → **New project from template…**) → pick the template, name it "Team Beta", keep today → **Expect:** a new project with the template's statuses, sections and tasks, dates from today. _(web)_
- [ ] **Do:** a task's panel ⋯ → **Save as template…** → **Expect:** it saves the task with all its subtasks (a done subtask comes back open when used). _(web)_
- [ ] **Do:** Templates → a task template → Use… → pick a project and a date → **Expect:** the task and subtasks in that project; subtasks' due dates by their offsets from the date. _(web)_

## Capture `/template`
- [ ] **Do:** ⌘⇧K → More → **Template…** (or type `/template`) → pick a task template saved from a task with a due date → **Expect:** a "Template: …" chip in the destination row, the title filled, the destination switched to the template's project, only Assign and Due pills, and "With its n subtasks, description, tags and priority. Pick Due, or it's made without dates." (once Due is set: "Due is the date its dates count from.") _(web / desktop)_
- [ ] **Do:** set Due and Create → **Expect:** the capture waits a moment, then closes; the task with its subtasks, dated from Due; the toast names the template and opens the task. _(web)_
- [ ] **Do:** pick a template saved from a task with no due date → **Expect:** no Due pill and "Its dates count from today."; Create dates its subtasks from today. _(web)_
- [ ] **Do:** with a template picked, type `#urgent` or `/priority high` in the title and Create → **Expect:** "With a template, only the person and Due apply. Remove the other words, or the template."; nothing is made. _(web)_
- [ ] **Do:** type a description, then pick a template → **Expect:** "Your description and subtasks are set aside while the template is on."; removing the chip brings them back. _(web)_
- [ ] **Do:** remove the chip (×) → **Expect:** a normal capture again (description, subtasks and every pill back). _(web)_
- [ ] **Do:** with no task templates, More → Template… → **Expect:** "No task templates yet. Save one from a task's ⋯ → Save as template." _(web)_

## Sharing
- [ ] **Do:** Templates → ⋯ → **Share with the workspace…** on a template of a project you own → **Expect:** "Shared" badge; the teammate sees it, opens it read-only and can Use… it; it has no ⋯ for them. _(web)_
- [ ] **Do:** save a template from a private project you own, then share it → **Expect:** "Share “…”? This includes n tasks from a private project…" first. _(web)_
- [ ] **Do:** as a member with edit (not Full) access to a project, save it as a template and try to share it → **Expect:** Share with the workspace… answers "Only someone with full access to what this template was saved from can share it." and nothing is shared; once they are given Full on the project, sharing works. _(web)_
- [ ] **Do:** as a workspace admin, a teammate's shared template → **Expect:** Stop sharing and Delete template work; Edit doesn't. _(web)_
- [ ] **Do:** Delete template → **Undo** in the toast → **Expect:** it's back in the list. _(web)_

## Copying needs Edit (D15-11)
- [ ] **Do:** as a member who can only view a project (shared with them at view), its ⋯ → Duplicate… → **Expect:** "You need edit access to this project to copy it." and only Close. _(web)_
- [ ] **Do:** the same project's ⋯ → Save as template… → **Expect:** the same reason; nothing is saved. _(web)_
- [ ] **Do:** a task in that project → panel ⋯ → Save as template… → **Expect:** "You need edit access to this task to save it as a template." _(web)_
- [ ] **Do:** the owner shares a template of that project → the member Use…s it → **Expect:** the project is made (using a shared template is unchanged). _(web)_

## Edge cases
- [ ] **Do:** Duplicate a project with no dates at all → **Expect:** no "Starts on" field; nothing in the copy is dated. _(web)_
- [ ] **Do:** go offline and Duplicate → **Expect:** "You're offline. Try again once you're back."; nothing appears. _(web)_
- [ ] **Do:** duplicate a project of about 200 tasks → **Expect:** it lands in under a second (200 tasks ≈ 240 ms in the SQL test on this Mac). _(web)_
- [ ] **Do:** link a task to a private contact and to a workspace contact, save it as a template, use it → **Expect:** only the workspace contact is linked on the copy. _(web)_

## Migrations / data
- [ ] **Do:** `bun run db:test templates` → **Expect:** 108 checks pass (copies, templates, outsiders, erasure). `20261013160000_templates.sql` is on the local stack. _(local)_
- [ ] **Do:** Settings → Advanced → Export data → **Expect:** `tasks` carries `templates` (yours and the shared ones, with their bodies). _(web)_

## Known gaps / not-yet-testable
- Copying into several workspaces at once has no UI (the server seam `project_templates__apply_body` takes the target workspace; the hackathon's provisioning belongs to its own planning session).
- Settings → Tasks → Templates doesn't exist yet: the Templates page opens from the sidebar's ⋯.
- **Verify before release:** apply `20261013160000` after the blocks before it; the template reads through prod's PostgREST (column grants, explicit columns); a large duplicate under prod's statement timeout; the erasure patch's anchors on prod's body of `account_erase_workspace_data`; an old desktop build ignores the new menu items without errors.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
