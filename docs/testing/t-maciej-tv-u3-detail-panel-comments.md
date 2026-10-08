# Manual test checklist — TV-U3 detail panel + comments

> Generated 2026-10-09 · branch `t/maciej/tv-u3-detail-panel-comments` (PR #324) · **Live-verified: partial.** The real panel ran in the browser against an in-memory harness (no backend in the worktree): rule C, revealing a row, the Scheduled picker, the Time editor's tracked total, @ mention + post, the claim avatar, view-only, ⋯ → Duplicate, and a long title wrapping. Not checked against Supabase: comments reaching the database, the bell notifications, "you 50m" from real entries.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Header (comp §1, U3-3)
- [ ] **Do:** open any open task in Tasks → **Expect:** top line reads `• <Bucket>` on the left, then **Queue**, a link icon and **⋯** on the right; no full-width "Add to queue" button anywhere in the panel _(both)_
- [ ] **Do:** click **Queue** (or press `q` in the list) → **Expect:** it turns into **In queue** with an accent queue icon; the task shows in the Queue view _(both)_
- [ ] **Do:** open a task Mike has queued → **Expect:** his small ringed avatar sits left of the queue button; hover says "In Mike's queue" _(both, 2 members)_
- [ ] **Do:** click the bucket name → **Expect:** a bucket menu; picking another bucket moves the task (the list updates) _(both)_
- [ ] **Do:** open a subtask → **Expect:** the breadcrumb reads `Bucket › Parent title`; clicking the parent selects it _(both)_
- [ ] **Do:** click the link icon, paste in a browser → **Expect:** "Link copied"; the link opens `app.moduo.app/tasks?id=…` with the task selected _(web; on desktop see Known gaps)_
- [ ] **Do:** ⋯ → **Duplicate** → **Expect:** "Task duplicated"; a copy with the same title, description, assignee, priority, dates, estimate, repeat and tags is selected at the end of the bucket; it is open, not queued, with no tracked time or subtasks _(both)_
- [ ] **Do:** ⋯ → **Archive · won't do**, then ⋯ again → **Expect:** the task is archived; the menu now offers **Reopen** _(both)_
- [ ] **Do:** ⋯ → **Delete** → **Expect:** the task goes, with the usual Undo toast _(both)_

## Title and description
- [ ] **Do:** look at a task with a long title → **Expect:** 18 px semibold, wraps onto more lines, checkbox aligned with the first line _(both)_
- [ ] **Do:** click the title, change it, press Enter → **Expect:** saved; Esc instead puts the old title back _(both)_
- [ ] **Do:** open a task with no description → **Expect:** one muted line "Add a description… @ or / to link", no empty box below it _(both)_

## Properties (rule C, U3-1)
- [ ] **Do:** open a task with only a due date set → **Expect:** rows Status, Assignee, Priority, Due, Tags, then one quiet line `+ Energy · Scheduled · Time · Repeat` _(both)_
- [ ] **Do:** click **Scheduled** in that line → **Expect:** a Scheduled row appears between Due and Tags with its date picker open; the line now reads `+ Energy · Time · Repeat` _(both)_
- [ ] **Do:** look down the values → **Expect:** every value starts at the same x behind a small icon; no chevrons; hovering a value shows a quiet field; empty values are muted ("Set priority", "Set date") _(both)_
- [ ] **Do:** change Status, Assignee (incl. Unassigned), Priority and Due from their menus → **Expect:** each saves on pick; a viewer can't be picked as assignee _(both)_
- [ ] **Do:** set a repeat rule, then open Repeat again → **Expect:** "Skip this occurrence" sits under the presets _(both)_
- [ ] **Do:** open a task whose scheduled time has passed → **Expect:** a quiet "passed" after the Scheduled value _(both)_

## Time row (§5)
- [ ] **Do:** open a task with an estimate and tracked time → **Expect:** `1h 20m of ~4h` with a short hairline bar _(both)_
- [ ] **Do:** open a task where you and Mike both tracked time → **Expect:** "you 50m" (your share) after the bar; on a task only you tracked, no "you …" _(both, 2 members)_
- [ ] **Do:** click the Time value, type `2h` in Tracked, press Enter → **Expect:** the total reads 2h everywhere (list, Focus); the trail gains nothing (time ops log no activity) _(both)_
- [ ] **Do:** with Focus running on this task, open the Time editor, wait a minute, change only the Estimate, press Enter → **Expect:** the estimate changes and the tracked total keeps the minute Focus saved _(both)_

## Collections
- [ ] **Do:** look under the properties → **Expect:** `Subtasks 0 +`, `Blocked by 0 +`, `Linked 0 +` in one header style; Subtasks reads `1/2` once some are done _(both)_
- [ ] **Do:** Linked **+** → pick a note → **Expect:** the link toast; the note shows under Linked; picking it again says "Already linked" _(both)_

## Comments & activity (U3-2)
- [ ] **Do:** scroll to the bottom → **Expect:** "<You/Name> created this · date" first, then queue and status lines, then comments, oldest first; the composer; then "Created by … · … · Updated …" _(both)_
- [ ] **Do:** type `@mi` in the composer → **Expect:** a list of members above the box with Mike; ↓/↑ move, Enter picks, Esc closes; the text reads `@Mike ` _(both)_
- [ ] **Do:** write a comment mentioning Mike, press ⌘↵ → **Expect:** it posts and shows with your name; Mike gets a mention notification _(both, 2 members)_
- [ ] **Do:** as Mike, comment on a task assigned to you that you created → **Expect:** you get a comment notification (assignee/creator/earlier commenters are notified, the author isn't) _(both, 2 members)_
- [ ] **Do:** pick a mention, then delete `@Mike` from the text and post → **Expect:** Mike gets no mention notification _(both, 2 members)_
- [ ] **Do:** open a task with more than nine trail items and comments → **Expect:** "Show N earlier" above the latest eight; clicking it shows them all _(both)_

## Notes comments (shared pieces)
- [ ] **Do:** Notes → right panel → Comments: select text in a note, Quote, write a comment, post → **Expect:** the quote shows above the text; clicking it scrolls the editor; authors show real names (not "Teammate") _(both)_

## Other hosts of the panel
- [ ] **Do:** open a task from Calendar's right panel, from a note's linked task and from an email → **Expect:** the same new panel; Contacts' Notes panel still shows its "Notes" header _(both)_

## Edge cases
- [ ] **Do:** as a view-only member, open a task → **Expect:** values visible but inert, no quiet line, no ⋯, no + on collections, "In queue" as plain text when queued; the composer is there (posting depends on links access) _(both)_
- [ ] **Do:** open a done task → **Expect:** no queue toggle; the title muted _(both)_
- [ ] **Do:** open a task whose creator is unknown (reassigned before TV-D1) → **Expect:** "Created" with no name in the feed and the metadata line _(both)_
- [ ] **Do:** compact and dense densities, a light theme, another accent → **Expect:** rows stay one control tall, values still line up _(both)_

## Migrations / data
- [ ] No migration. Comments use TV-D1's `comments_op_add` (already on prod); "you 50m" reads TV-D3's `tasks_time_totals` (on prod).

## Known gaps / not-yet-testable
- Comments, notifications and "you 50m" were verified in tests and an in-memory harness, not against Supabase: the worktree has no `.env.local` and auto mode refused to link it.
- Desktop copy link: if `PUBLIC_WEB_ORIGIN` isn't set in the build, the link is `tauri://localhost/tasks?id=…` (same as chat's copy link).
- Visual baselines for `tests/visual/tasks-detail.spec.ts` are a human capture (`bun run storybook`, then `bunx playwright test --project=visual tests/visual/tasks-detail.spec.ts --update-snapshots`).
- The Medium priority glyph is blank until TV-U1 lands (its `level-icons.tsx` rewrite fixes the "med"/"medium" mismatch).

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
