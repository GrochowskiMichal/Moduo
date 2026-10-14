# Manual test checklist — TV-U13 Detail panel v3 + full page

> Generated 2026-10-13 · branch `t/maciej/tv-u13-detail` · **Live-verified:** yes, on the local stack (web, `dev@moduo.local`): comment, react, edit, delete + Undo; merged changes in the feed; full page with ↓ and Esc; Project view beside it; a subtask opening as "← item"; call 87 with Undo; Custom repeat; adding a session; the Inbox "Assign to … in" step; your avatar reading "DE". The e2e `tests/tasks-detail.spec.ts` (4 tests) and `bun run db:test comments` (75 checks) pass.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## The panel (AC11.7, AC1.16)
- [ ] **Do:** open a task in a project → **Expect:** "Details ▾" lists Details and Project (no In flight yet); the header reads "● Project › Section" (when the project has sections) · the handle · Queue · ⤢ · ⋯ _(web / desktop)_
- [ ] **Do:** drag the right panel to its narrowest (280 px) → **Expect:** no value is cut ("Wed, …" never appears); the labels narrow; "1h 20m of ~4h" stays on one line with its bar under it _(web)_
- [ ] **Do:** ⋯ → Copy branch name → **Expect:** "Copied mod-142-logo-concepts" (your key, the number, the title) _(web)_
- [ ] **Do:** click the handle → **Expect:** "Copied MOD-142" _(web)_
- [ ] **Do:** "+ Waiting on" → pick a person, then add "Client sign-off" → **Expect:** a Waiting on list with both, each "since Oct 13"; ✕ removes one _(web)_
- [ ] **Do:** Scheduled → Add session → Tomorrow, 3:00 PM, 1h → **Expect:** "Tomorrow, 3:00 PM · 1h"; a second one shows "+1"; on a task assigned to someone else, "Mine / Their's" is offered and nobody else _(web)_
- [ ] **Do:** Reminder → "1 hour before due" (needs a due date) and "At a time…" → **Expect:** both listed, ✕ removes; only you see your reminders _(web)_
- [ ] **Do:** Repeat → Custom → every 1 month, On a weekday 3rd Friday, Ends On a date Dec 15 → **Expect:** the line reads "Every 3rd Friday, until Dec 15" before Save and on the row after _(web)_
- [ ] **Do:** due date set → "Add time" → 3pm → **Expect:** "3:00 PM" beside the date _(web)_
- [ ] **Do:** a long description with task references → **Expect:** it folds at about eight lines with "Show more · 2 tasks", "Show less" at the end; clicking into it shows it whole _(web)_

## Subtasks and call 87
- [ ] **Do:** click a subtask → **Expect:** the panel shows it as "← Subtask title", its breadcrumb "Project › ↳ parent"; the back arrow returns _(web)_
- [ ] **Do:** finish a task with two open subtasks → **Expect:** "Done · also 2 subtasks · Undo"; Undo reopens all three; a repeating task's subtasks stay open _(web)_
- [ ] **Do:** drag a task with open subtasks into Done on the Board → **Expect:** the drop's toast adds "· also n subtasks", one Undo _(web)_

## The feed (AC11.8)
- [ ] **Do:** change due, priority and status within a few minutes → **Expect:** one line "You changed due, priority and status"; click it to see each _(web)_
- [ ] **Do:** post a comment, then 👍 on it from the smiley → **Expect:** "👍 1", highlighted as yours; hover says "You"; no bell for anyone _(web)_
- [ ] **Do:** ⋯ → Edit → change the text, ⌘⏎ → **Expect:** the card reads "edited"; a person newly @named hears about it, an earlier one doesn't _(web)_
- [ ] **Do:** ⋯ → Delete → **Expect:** it disappears with "Comment deleted · Undo"; Undo brings it back with its reactions _(web)_
- [ ] **Do:** switch the feed to Comments, reload → **Expect:** it stays on Comments (per person, this device) _(web)_
- [ ] **Do:** as a teammate who can view the project, react to your comment → **Expect:** your panel shows their reaction without a reload _(web, two browsers)_

## Project view and the full page (AC11.7, defaults p, 32)
- [ ] **Do:** open a project with nothing selected (an empty project, or deselect) → **Expect:** the panel shows Project: name, status, dates, lead, "x of y done · n open", sections _(web)_
- [ ] **Do:** ⤢ on a task → **Expect:** it fills the centre on the same URL: "← List · Project", "3 of 18", ↑ ↓; properties move to a right column on a wide window; the panel shows Project; Esc, ⌘[ or ⤡ goes back _(web)_

## States
- [ ] **Do:** open a link to a task that was deleted → **Expect:** "Deleted task · You deleted this · 2m" with Restore (if you can edit) _(web)_
- [ ] **Do:** open a link to a task you can't see → **Expect:** "Private item · Ask someone in its project to share it with you." — no title, no project _(web)_
- [ ] **Do:** as a viewer → **Expect:** values plain and inert, no "+" line, ⋯ offers only the copies; the comment box stays only if you can comment _(web)_
- [ ] **Do:** a Done task → **Expect:** "Done Oct 13 by you" under the title; a Won't do task "Won't do · Reopen" _(web)_

## Checkpoint 1 fixes
- [ ] **Do:** sign in as an account with no display name (the local seed) → **Expect:** your avatars read two letters of your email's name ("DE"), never "ME" and never a gray "?" _(web)_
- [ ] **Do:** a task in your Inbox → assign it to a teammate → **Expect:** "Assign to Tess Mate · in" with your projects and "Keep unfiled" (AC5.1) _(web)_

## Migrations / data
- [ ] **Do:** `bun run db:test comments` → **Expect:** 75 checks pass (edit/delete/restore/react rules, the read gate, mentions only to viewers) _(local stack)_
- [ ] **Do:** `select count(*) from comment_reactions` after reacting → **Expect:** rows appear; `module_activity` has no row for a reaction _(local stack)_

## Known gaps / not-yet-testable
- Verify before release: `20261013100000_comment_reactions_edits` redefines the comments read policy and `comments_op_add` — apply after TV-D12's migrations in the release train and re-run `bun run db:test comments` against a copy of prod; the read policy's cost on a large workspace's comment delta (it asks the item gate per row); reactions arriving live through prod's Realtime (they ride the comment's `updated_at`).
- Verify before release: an older desktop build reading comments (`edited_at` and the reactions embed are optional) and Notes' comment panel on a database without the migration (the read falls back without reactions).
- MCP: `tasks_complete` doesn't finish subtasks (call 87 is in the app) → TV-D16.
- The agent session line and the "is on this" claim are empty slots (TV-D16, TV-F7).
- The description fold doesn't nudge itself above a card that straddles it.
