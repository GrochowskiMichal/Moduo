# Manual test checklist — TV-U2 (Tasks v3 block 6: toolbar, Filter, Display, search)

> Generated 2026-10-10 · branch `t/maciej/tv-u2-toolbar` (landed locally on `t/maciej/tasks-v3-build`) · **Live-verified:** yes, on the web build against the local stack at 1440 × 900 (dark): Group by Date, Rows Detailed, Filter → Status → Won't do on the List and the Board, the Board's Display in All, and "No tasks match" from a search; the e2e specs `tests/tasks-toolbar.spec.ts` (3) and `tests/trust-pass.spec.ts` (12, with the new AC1.4 Filter test) pass. Not tried: the desktop app.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## The toolbar
- [ ] **Do:** open Tasks on a project → **Expect:** one row: the project's name and its open count · Search · Filter · Display | the List/Board/Timeline switch | New. No Group control in the toolbar. _(both)_
- [ ] **Do:** press `/` (not in a text field) → **Expect:** the search field opens with the cursor in it; typing narrows the list by title and description. _(both)_
- [ ] **Do:** in search type `#` and a tag's name, then a space → **Expect:** the tag becomes a Filter chip ("Tag is …") and leaves the search text. Same with `@` and a teammate's name. _(both)_
- [ ] **Do:** search for something nothing matches → **Expect:** "No tasks match" with Clear filters; Clear empties the search and the filters. _(both)_
- [ ] **Do:** press `f` → **Expect:** the Filter menu opens. Press it again inside the search field → **Expect:** you type an "f". _(both)_

## Filter
- [ ] **Do:** Filter → Status → **Expect:** To do · In progress · Done · Won't do (never "Todo" or "Archived"). _(both)_
- [ ] **Do:** pick Won't do → **Expect:** the chip "Status is Won't do", "1 of N · Clear", and only your Won't do tasks, struck through and dimmed. Click one → **Expect:** the panel shows "Won't do · Reopen"; Reopen puts it back to To do. _(both)_
- [ ] **Do:** with that filter on, switch to the Board → **Expect:** one group, "Won't do", with the cards (struck through, faded), not three empty columns. _(both)_
- [ ] **Do:** change the chip to "Status is not Done" → **Expect:** the Board shows To do and In progress only. _(both)_
- [ ] **Do:** Filter → Due date → This week → **Expect:** tasks due from today to Sunday ("This week" is a filter; it is never a group). _(both)_
- [ ] **Do:** with a Tag filter on, press New → **Expect:** the capture already has that tag as a chip (and the filter's assignee / priority when one is set). _(both)_
- [ ] **Do:** in the Queue (Plan), put a Tag filter on and press New → **Expect:** the task lands at the end of Up next and carries the tag. _(both)_

## Display
- [ ] **Do:** Display → Group by in a project → **Expect:** Status · Priority · Assignee · Date · None (no Tag, no Energy, no Time / Due / Scheduled). In All → **Expect:** Project too, and All opens grouped by project. _(both)_
- [ ] **Do:** Group by → Date, with tasks due earlier, today, tomorrow, in three days, in ten days and none → **Expect:** Earlier · Today · Tomorrow · the weekday name (e.g. "Tuesday") · Later · No date; a task with both a date and a scheduled time sits under whichever comes first. _(both)_
- [ ] **Do:** open My tasks → **Expect:** grouped by status, In progress first, then To do. _(both)_
- [ ] **Do:** switch to the Board in All, open Display → **Expect:** "Group by: Status · Project" (never "Columns"), no Rows control. _(both)_
- [ ] **Do:** List → Display → Rows → Detailed → **Expect:** every row gains its status name ("In progress"), its time ("1h 20m / ~4h", "~45m"), the assignee's first name next to the avatar, and the project name even inside the project. Standard puts the row back. _(both)_
- [ ] **Do:** set Detailed in one project, go to All, then back → **Expect:** All is still Standard; the project is still Detailed (remembered per view). Reload → still so. _(both)_
- [ ] **Do:** Display → Reset to default → **Expect:** the scope's defaults come back (layout List, its default grouping, Standard rows). _(both)_

## Edge cases
- [ ] **Do:** mark a task Won't do from its ⋯ while the Board is showing (no Status filter) → **Expect:** it stays on the Board in a Won't do group while selected; select another task or change scope → the group goes away. _(both)_
- [ ] **Do:** give project A a filter (Status is To do) and project B one that hides a task T there (Status is Done); from A, open T through a notification or a chip → **Expect:** B opens with T selected and listed, B's chip still on; select another task → T leaves the list. Go back to A → its chip is still there. _(both)_
- [ ] **Do:** with "Status is To do" on, mark the selected task Won't do from its ⋯ → **Expect:** it stays listed, struck through, with Reopen in the panel, until you pick another task or change the filter. _(both)_
- [ ] **Do:** search for a word that only appears in the HTML of descriptions, like "span" or "pre-wrap" → **Expect:** nothing matches (search reads the words, not the markup). _(both)_
- [ ] **Do:** on the Timeline with Filter → Status → Won't do → **Expect:** the bars look finished (muted, struck through) and offer no blocker handle. _(both)_
- [ ] **Do:** save a filter "Assignee is <a former member>", press New → **Expect:** the capture starts assigned to you, not to the former member. In Focus, New never takes the Plan view's filters. _(both)_
- [ ] **Do:** in a project with no tasks matching a filter → **Expect:** "No tasks match · Clear filters", never "No tasks in …". _(both)_

## Migrations / data
- [ ] None. Display and filters are stored per workspace and scope on this device (`moduo:tasks:view:<workspace>:<scope>`); a value #330's WIP stored (Columns, Tag/Energy/Time grouping) falls back to the scope's default.

## Known gaps / not-yet-testable
- Section and Team grouping arrive with their data (TV-D10); the rest of Detailed (handle, Project › Section, Due and Next session columns, sortable headers) with TV-U10; "developers start on Detailed" with onboarding (TV-U17).
- The Board's drag-while-sorted toast still says "Ordered by …"; default m's "Sorted by due · Back to manual order" is TV-U4's.
- Group headers still use the small-caps eyebrow; sentence-case GroupHeaders with "+" are TV-U10's.
- Verify before release: the same flows in the desktop app (Tauri webview), where `/` and `f` must not clash with menu shortcuts.
