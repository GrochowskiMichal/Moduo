# Manual test checklist — TV-U13b Follow-ups from landed blocks

> Generated 2026-10-13 · branch `t/maciej/tv-u13b-followups` · **Live-verified:** yes, on the local stack (web), in the workspace "U13b check" made for it (dev@moduo.local): the Inbox's "via Claude Desktop" on a task a key captured, a paused reminder and its Restore, a repeat's history ("1 done · last Oct 6"), and "Just this one" when moving a repeat's Due. The three bulk fixes are proven by unit tests that failed before the fix (`use-tasks-module.bulk.test.tsx`).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

No migration.

## Bulk edits (fixes in TV-U12's code)
- [ ] **Do:** select 3 open tasks (⇧-click), drag them onto **Focus** in the sidebar → **Expect:** "Added 3 tasks to Focus" with Undo. Drag the same three again → nothing is taken out (the drop only adds; the bar's **Focus** button is still the toggle). _(web)_
- [ ] **Do:** make one of the selected tasks blocked by an open task, drag the selection onto Focus → **Expect:** they're all added, and the toast says "“…” is blocked by an open task." (no "Blocked by" dialog for a selection). _(web)_
- [ ] **Do:** select 4 tasks, one of them read-only to you, drag them to another project → **Expect:** "3 of 4 changed", the read-only one named; Undo moves the three back. _(web)_
- [ ] **Do:** select a parent (with an unselected subtask) and another task → Delete → Undo → **Expect:** both come back at once, and the subtask is back under its parent. _(web)_
- [ ] **Do:** select 2 tasks → Waiting on → a note → Undo → **Expect:** both entries go. _(web)_

## The detail panel
- [ ] **Do:** open a repeating task → **Expect:** beside its rule ("Every week"), a quiet "n done · last …" (or "History" before any); click it → each cycle, newest first: "Oct 6 · Done by you", "Skipped by Mike", "· your time 25m" (only your own time). _(web)_
- [ ] **Do:** on a repeating task, change **Due** to tomorrow → **Expect:** "Move “…” to Tomorrow · It repeats…" with **Just this one** and **Change the pattern**. Just this one → Due is tomorrow, the rule stays. Change the pattern → the rule follows the new day. Cancel → nothing changes. A one-off task's Due saves at once. _(web)_
- [ ] **Do:** give a task "1 day before due", move it to **Backlog** → **Expect:** the Reminder reads "1 day before due · paused" (a crossed bell); open it → "· Paused" and "Paused while it's in Backlog. Move it to To do to restore it." _(web)_
- [ ] **Do:** move it back to **To do**, open the Reminder → **Restore the reminder** → **Expect:** the reminder is live again (no "paused"). A reminder whose time already passed stays paused, and the toast says "Its time has already passed." _(web)_

## The Inbox's agent chip
- [ ] **Do:** capture a task through an API key (Claude Desktop with the Moduo connector: "add a task …") → **Expect:** in your Inbox the row reads "via <your key's name>" after the title. Someone else's agent's task handed to you reads "from Mike via <key>". Your own captures say nothing. _(web / desktop)_
- [ ] **Do:** as a teammate who can't see that task (it's in your Inbox) → **Expect:** they never see it, nor the key's name. `bun run db:test agent_followups` passes (17 checks). _(SQL)_

## MCP (the connector)
- [ ] **Do:** ask Claude to "set the description of project X to …", then "list my projects" → **Expect:** the description is saved (and shows in the panel's Project view) and the list shows it. A view-only key is refused. _(Claude Desktop, deployed connector)_

## Verify before release
- The chip's read through prod's PostgREST (`module_activity` with an `in.(…)` filter of up to 100 ids) and the read policy's cost on a big Inbox.
- A real key capture through the deployed `moduo-mcp`, and `projects_update` with `description` through it (deploy `moduo-mcp` with the release).
- The panel's repeat dialog and history popover in the signed desktop build.

## Polish later
- The date picker's popover stays visible behind the "Just this one · Change the pattern" dialog until you choose.
- In a narrow centre pane, the source chip ("via Claude Desktop") gives way entirely so the title shows; at normal widths both show.
- The history popover lists at most the newest 100 cycles (the server's cap) with no "older" link.
- Reopening a repeat's cycle takes its completion back (D12's rule), so "n done" drops by one; expected, but worth a look.
- The bulk Undo after a partial change re-sends the reverse write for the part that saved only; if that is refused too, the toast is the generic "n of m changed".
