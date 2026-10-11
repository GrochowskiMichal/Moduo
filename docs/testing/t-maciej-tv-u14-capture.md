# Manual test checklist — TV-U14 Capture v3

> Generated 2026-10-11 · branch `t/maciej/tv-u14-capture` · **Live-verified:** yes on the local stack (web, dev server on :8143): ⌘⇧K over Tasks and Notes, ⌘N in a project, `@` person pick, date words marked, Esc order, draft restored + Clear, paste a list (create + Undo), the "From:" link from a note. Email's "From:" (desktop build only) not live-verified.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Two ways in
- [ ] **Do:** anywhere (Notes, Calendar, Home), press ⌘⇧K → **Expect:** the capture opens as "Task ▾ · Inbox ▾", caret in the title; it never asks where. _(both)_
- [ ] **Do:** in Tasks, pick a project in the rail and press ⌘N (or "+ New", or `c` on a row) → **Expect:** the destination reads that project. _(both)_
- [ ] **Do:** in a project, select a task that sits in a section, press ⌘N → **Expect:** "Project › Section". _(both)_
- [ ] **Do:** switch to Focus, press ⌘N, create a task → **Expect:** it's first in Up next. _(both)_
- [ ] **Do:** in the capture press ⌘2, then ⌘3 → **Expect:** the type chip switches to Note, then back to Task; the page behind doesn't change; ⌘1 does nothing. _(both)_
- [ ] **Do:** Calendar → "New task" → **Expect:** the same capture, to the Inbox. _(both)_

## The title and its grammar
- [ ] **Do:** type `Call Tess tomorrow 3pm @te`, pick Tess → **Expect:** "tomorrow 3pm" has a light fill and a dotted underline; Tess becomes a chip; Assign shows Tess; a "Tomorrow, 3:00 PM" chip joins the pill row. _(both)_
- [ ] **Do:** press Esc once, twice, three times → **Expect:** 1st: the Tess chip turns back into "@Tess Mate" words; 2nd: the date words lose their mark (kept as words); 3rd: the capture closes. _(both)_
- [ ] **Do:** press ⌘⇧K again → **Expect:** the same text is back, with "Draft restored · Clear" in the footer; Clear empties it. _(both)_
- [ ] **Do:** type `@` and the start of a project's name, pick the project → **Expect:** no chip in the title; the destination row shows the project; the footer says "@<project> moved into the destination". _(both)_
- [ ] **Do:** type `/pri`, pick "High priority"; `/est 2h`; `/remind 4pm`; `/repeat every tuesday`; `/tomorrow` → **Expect:** each becomes a chip and fills its pill or a More chip; on create none of them is left in the title. _(both)_
- [ ] **Do:** type `#` + a new word, pick "Create #word" → **Expect:** a tag chip; the task gets the tag. _(both)_
- [ ] **Do:** type `Learn C# basics #123 and/or more` → **Expect:** no menu, nothing recognised, the title is saved as typed. _(both)_
- [ ] **Do:** type `Prepare Monday notes`, press Esc once → **Expect:** "Monday" stops being marked and stays in the title. _(both)_

## Missing project
- [ ] **Do:** in the Inbox capture, `@` a teammate → **Expect:** destination "No project ▾" (outlined) and "Unfiled · <name> finds it in My tasks"; Create still works; the teammate sees it in My tasks. _(both)_
- [ ] **Do:** create a team with a default project (Settings or SQL), `@` the team → **Expect:** destination "<default project> (team default)"; Assign reads "<team> · unclaimed". _(both)_
- [ ] **Do:** `@` a team without a default → **Expect:** "Pick a project", Create is off, ⏎ opens the project picker. _(both)_

## "From:" chip
- [ ] **Do:** open a note, press ⌘⇧K, create a task → **Expect:** "From: <note>" chip in the top row; the task's Linked shows the note ("Spawned from"). _(both)_
- [ ] **Do:** the same, but remove the chip (× or focus it and ⌫) → **Expect:** no link. _(both)_
- [ ] **Do:** open a contact, then an event, and press ⌘⇧K → **Expect:** "From: <name>" / "From: <event>". _(both)_
- [ ] **Do:** desktop app: open an email thread, ⌘⇧K, create → **Expect:** "From: <subject>"; the thread shows the task. _(desktop)_

## Paste a list
- [ ] **Do:** paste 12 lines into the title, two of them indented → **Expect:** "Create 12 tasks?" with a preview (each line as it will be made, e.g. "Book taxi · Due Oct 12"), Create 12 · Keep as one · Cancel. _(both)_
- [ ] **Do:** Create 12 → **Expect:** 12 tasks on top of the destination, the indented ones as subtasks; one toast "12 tasks created · Undo"; Undo removes all of them. _(both)_
- [ ] **Do:** paste with `[x]` lines, then 600 lines → **Expect:** "n already done, left out"; "Create 500 tasks?" with "100 past the 500 limit, left out". _(both)_
- [ ] **Do:** Keep as one → **Expect:** the first line becomes the title, the rest the description. _(both)_

## Subtasks, description, pills
- [ ] **Do:** "+ Add subtasks", type a line, ⏎, another, ⏎ on the empty line → **Expect:** two subtask lines, focus back in the title; on create both are subtasks. _(both)_
- [ ] **Do:** ⇧⏎ in the title → **Expect:** the caret goes to the description, which grows to about six lines then scrolls. _(both)_
- [ ] **Do:** ⌘⏎ → **Expect:** created, the capture stays with the destination and the pills, everything else cleared. _(both)_
- [ ] **Do:** set Assign by hand while an `@person` chip is in the title → **Expect:** the chip turns back into words; the pill shows your pick. _(both)_

## Edge cases
- [ ] **Do:** turn the network off, capture a task → **Expect:** a toast "Couldn't reach Moduo…" with Try again; the next ⌘⇧K has the draft; back online, Try again creates it once (no duplicate). _(both)_
- [ ] **Do:** keep a draft with a linked task in it, have its owner make that task private, press ⌘⇧K → **Expect:** the chip reads "Private item"; on create it's not in the title and not linked. _(both)_
- [ ] **Do:** sign out and sign in as someone else on the same device → **Expect:** no draft from the first person. _(both)_
- [ ] **Do:** paste or drop a file onto the capture → **Expect:** a toast "Add files from the task once it's created." (AT-2/AT-3 plug in here). _(both)_

## Migrations / data
- No migrations. The draft lives in localStorage under `moduo:capture-draft:task:<user>:<workspace>` (ids and the person's own words only).

## Known gaps / not-yet-testable
- No "n waiting to sync" or durable offline queue (TV-D11a); no clock mark on a row while it saves (rows appear once saved).
- Moving an unfiled task to the assignee's Inbox (call 20) isn't on the server; the capture says "finds it in My tasks".
- Templates (`/template`, More → Template…) appear only once TV-D15 registers a provider; files only once AT-2/AT-3 register an upload handler.
- The pill row wraps instead of "+n" overflow.
- Verify before release: Email's "From:" in the desktop build; the CSS Custom Highlight API mark in the Tauri WebKit build (Safari 17.2+); ⌘⇧K/⌘N inside the Tauri window.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
