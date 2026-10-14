# Manual test checklist — TV-U18 Native importers

> Generated 2026-10-14 · branch `t/maciej/tv-u18-importers` · **Live-verified:** yes, on the local stack as dev@moduo.local (the dialog from the sidebar's ⋯, a Trello board's preview with its list categories, Import, the new project in the sidebar, Undo; a Linear export with finished tasks left out, then its issue id found by search; a Todoist project's preview); `tests/importers.spec.ts` passes (2/2, serial). Sample exports to try: `tests/fixtures/importers/` (Todoist, Trello, Linear, Jira, Asana).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Opening it
- [ ] **Do:** hover the hairline in the Tasks sidebar, click its ⋯ → **Expect:** "Import tasks…" under New project / New area… (only when you can edit Tasks here) _(web, desktop)_
- [ ] **Do:** click it → **Expect:** "Import tasks" with a drop zone ("CSV or JSON · up to 10 MB · 2,000 tasks at a time"), what to export from each of the five services, and "Your imports" when you've imported before _(web)_
- [ ] **Do:** as a Viewer → **Expect:** no "Import tasks…" in the ⋯ _(web)_

## A Trello board (lists become statuses)
- [ ] **Do:** drop `trello-launch.json` → **Expect:** "7 tasks, 1 project, 2 skipped"; "Website launch · new project · 7 tasks"; "Each list becomes a status. Check where it belongs:" with Ideas → Backlog, To Do → To do, Doing and Waiting on client → In progress, Done → Done, each changeable; "Include finished tasks (2)" ticked; "On the way in": 2 archived, 1 start date left out, 2 attachments stay in Trello; "People in the file": Dana Park · 1 task and Riley Ortiz · 2 tasks, each on Unassigned unless a member here has exactly that name _(web)_
- [ ] **Do:** set "Waiting on client" to To do, press Import 7 tasks → **Expect:** a bar ("Imported 3 of 7 tasks…"), then "Imported 7 tasks into “Website launch”", "2 comments came along", "7 tasks left unassigned" (Trello names no emails; the tick to assign the ones nobody is on to you is off for Trello) _(web)_
- [ ] **Do:** close it and open the project → **Expect:** the board's lists are its statuses (Board grouped by Status shows Ideas · To Do · Doing · Waiting on client · Done); "Homepage hero copy" has tags Design and Urgent, is due Oct 20 at the time Trello showed (in your Time & region zone), has two subtasks (one done) and two comments that open "Riley Ortiz · in Trello · …" _(web)_
- [ ] **Do:** a card's ⋯ in the panel → **Expect:** "Imported from Trello · <short link>"; clicking copies it _(web)_

## Undo this import
- [ ] **Do:** right after an import, press "Undo this import" in the dialog → **Expect:** "Moved 7 tasks to Recently deleted and 1 project"; the project leaves the sidebar; Recently deleted has them _(web)_
- [ ] **Do:** import again, edit one of its tasks (rename it), then ⋯ → Import tasks… → Your imports → Undo this import → **Expect:** the edited task stays ("1 task kept (changed since)"), the rest go; the project stays because a task is left in it _(web)_
- [ ] **Do:** import the same file twice → **Expect:** the second preview says "into “Website launch”, imported before" and "7 tasks came in before: their text and dates are updated; where they are and their status stay as they are"; after Import there are still 7 tasks, nothing doubled _(web)_
- [ ] **Do:** move one imported task to Done and another to a different section, then import the file again → **Expect:** both stay where you put them, in the status you gave them; a changed due date in the file does update _(web)_

## Todoist, Linear, Jira, Asana
- [ ] **Do:** drop `todoist-cs201.csv` (rename it "CS 201.csv" first) → **Expect:** a project "CS 201" with sections Week 1 and Week 2; "Assign the 6 tasks nobody is on to me" ticked; "1 repeat Moduo can't follow, kept as text" (Office hours: "Repeats in Todoist: every 3rd workday" in its description); Problem set 1 repeats every Monday; Read chapter 1 has a 45m estimate, the tag "reading" and its note as a comment _(web)_
- [ ] **Do:** drop `linear-eng.csv` → **Expect:** two projects (Billing revamp, Engineering); "In Review" shows as a status inside In progress; ENG-123 is Done with priority High and the tags Bug and urgent; untick "Include finished tasks" → "4 tasks, 2 projects, 2 skipped" _(web)_
- [ ] **Do:** after the Linear import, type "ENG-121" in the toolbar's search (on All) and in ⌘K → **Expect:** "Plans table" is found _(web)_
- [ ] **Do:** drop `jira-web.csv` → **Expect:** a project "Website" with the section "Checkout redesign" (the epic), "Postcode lookup returns 500" a subtask of "Address form validation", WEB-44 under Won't do, a 4h estimate on WEB-42; "1 epic became a section" _(web)_
- [ ] **Do:** drop `asana-marketing.csv` → **Expect:** "Q4 Marketing" with sections Planning and In progress; "Write the copy" a subtask of "Launch email"; "1 without a title" skipped _(web)_
- [ ] **Do:** import the Asana file with a teammate here named "Maya Chen" → **Expect:** "Maya Chen · maya@example.com · 2 tasks" starts on Maya; "Sam Lee · sam.lee@example.org" starts on Unassigned; pick someone for Sam, Import → the tasks are theirs; an email alone (Linear's maya@example.com) starts on Unassigned unless it's your own email _(web, two accounts)_

- [ ] **Do:** import the Trello board into a workspace where a teammate is named "Riley Ortiz", pick Riley for "Riley Ortiz" → **Expect:** Riley gets one assignment notice for the import, not one per imported comment _(web, two accounts)_
- [ ] **Do:** import a board, archive its project, import the same file again → **Expect:** the preview counts the earlier tasks as "came in before" (not new); after Import they stay in the archived project, untouched in place and status _(web)_

## Files it can't take
- [ ] **Do:** drop a 12 MB file → **Expect:** "This file is 12.0 MB. Moduo reads export files up to 10 MB: export one project or board at a time." _(web)_
- [ ] **Do:** drop a spreadsheet CSV of something else, or a JSON that isn't a Trello board → **Expect:** a plain sentence saying what Moduo reads; nothing is written _(web)_
- [ ] **Do:** press Stop during a long import → **Expect:** it stops between tasks; the end says "Stopped part way" and Undo takes back what landed _(web)_

## Verify before release
- [ ] Try a real export from each service (formats drift: Jira's date format follows the exporter's settings; Linear's assignee column may hold names instead of emails).
- [ ] An import of ~2,000 tasks on the hosted stack: time it, and check the app stays responsive while Realtime brings them in.
- [ ] The desktop build: the file picker and drop work in the Tauri window.

## Polish later
- [ ] The dialog's × does nothing while an import runs (Stop is the way out); hide it or make it Stop.
- [ ] A task matched by the server to an earlier import the app hadn't read gets the file's place and status (the end says so); it can only happen if a task is hidden from you but yours by key.
- [ ] Trello members missing from the board's member list all read "A Trello member" (one picker for all of them).
- [ ] The project's name can't be changed in the preview (Todoist takes the file's name).
- [ ] Section dates (Jira epics' due dates, Linear milestones' target dates) aren't carried.
