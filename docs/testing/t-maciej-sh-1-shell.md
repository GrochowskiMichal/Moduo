# Manual test checklist — SH-1 (Tasks v3 block 4: panel dropdown, capture shell, motion)

> Generated 2026-10-10 · branch `t/maciej/sh-1-shell` (landed locally on `t/maciej/tasks-v3-build`) · **Live-verified:** yes, on the web build against the local stack, at a 1440 × 900 window: Tasks, Calendar, Notes and Contacts directly; Email's panel through a temporary desktop flag (its panel only renders in the desktop app); the capture from Notes and Contacts; reduced motion through `data-motion`. Not tried: the desktop app itself, and the OS-level reduced-motion switch (the Playwright motion spec covers it in Storybook).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## The right panel's title row
- [ ] **Do:** open Tasks and select a task → **Expect:** the right panel starts with a "Details" title (no chevron: Tasks has one view), then the task's details as before. _(both)_
- [ ] **Do:** open Calendar → **Expect:** the panel's title reads "Tasks ▾". Click it → a short menu: Detail ⌥1, Notes ⌥2, a hairline, Tasks ⌥3, with a dot on the open one. _(both)_
- [ ] **Do:** in Calendar press ⌥1, then ⌥3 → **Expect:** the panel switches to Detail, then back to Tasks, fading softly; the page behind doesn't change. _(both)_
- [ ] **Do:** pick Detail, reload → **Expect:** Calendar still opens on Detail (the saved choice is kept). _(both)_
- [ ] **Do:** in Calendar's Tasks list click a task → **Expect:** the panel switches to "Detail ▾" showing that task. _(both)_
- [ ] **Do:** open Email (desktop) → **Expect:** "Reader ▾" with Reader ⌥1, Contact ⌥2, Detail ⌥3, Task ⌥4 (no hairline: all four are about the thread); ⌥4 shows Task. _(desktop)_
- [ ] **Do:** open a note in Notes → **Expect:** "Detail ▾" with Detail, Comments, Outline; your last pick is remembered. _(both)_
- [ ] **Do:** select a contact → **Expect:** the panel's title is "Notes" (one view, no chevron) with the linked-notes list below. _(both)_
- [ ] **Do:** click into a text field (a task title, a comment) and press ⌥1 → **Expect:** nothing switches (on a Mac you type ¡ as usual). _(both)_

## "← item" (something opened in the panel)
- [ ] **Do:** in a note, open a task line's details (the chip on a task line, or right-click → Open task details) → **Expect:** the panel's title becomes "← ☐ task title" with the task below. _(both)_
- [ ] **Do:** click the back arrow → **Expect:** back to the view you were on (Detail, Comments or Outline), and the keyboard focus stays on the panel's title row. _(both)_
- [ ] **Do:** open the task again, click once inside the panel (not in a field) and press Esc → **Expect:** same as the back arrow. _(both)_
- [ ] **Do:** open the task again and press ⌥3 → **Expect:** the task closes and Outline opens. _(both)_
- [ ] **Do:** with a long task title, narrow the panel → **Expect:** the title wraps to a second line instead of being cut off. _(both)_

## Panel width and motion
- [ ] **Do:** drag the right panel's left edge to the right, as far as it goes → **Expect:** it stops at 280 px; it never got narrower than that, even with an old saved layout. _(both)_
- [ ] **Do:** hide the right panel from the bottom bar, then show it → **Expect:** it slides in a little from the right while fading in; the left panel doesn't move. Switching modules doesn't animate the panels. _(both)_
- [ ] **Do:** open any menu or popover (a panel's "▾", a date picker) → **Expect:** it grows quickly from the corner it was opened from; no blur anywhere, also not behind dialogs or the Settings window. _(both)_
- [ ] **Do:** Settings → Preferences → Motion → Reduced, then repeat the three steps above → **Expect:** nothing slides or grows, things only fade in quickly. Set it back to System. _(both)_

## The capture (⌘⇧K)
- [ ] **Do:** from Notes press ⌘⇧K → **Expect:** a capture opens at the top: "☐ Task ▾ · Inbox", a line "Capture a task…" with the cursor in it, and "⏎ Create · ⌘⏎ Create more" below. _(both)_
- [ ] **Do:** type "Buy stamps tomorrow" and press ⏎ → **Expect:** it closes; a toast "Buy stamps · due … · Inbox" with Open; the task is in your Inbox due tomorrow. _(both)_
- [ ] **Do:** ⌘⇧K, type a line, press ⌘⏎ → **Expect:** it's created, the line empties and the capture stays open for the next one. _(both)_
- [ ] **Do:** ⌘⇧K, type "Lunch with Ana", press ⌘4 → **Expect:** the chip becomes "Event ▾ · Calendar" and your text is still there; the app behind does NOT switch to Calendar. ⌘2 → Note · Notes, ⌘6 → Contact · Contacts, ⌘3 → back to Task. _(both)_
- [ ] **Do:** inside the capture press ⌘1, ⌘5 and ⌘7 → **Expect:** nothing happens (Home, Email and Chat have no capture type yet), and the page behind stays put. _(both)_
- [ ] **Do:** click the type chip → **Expect:** Task ⌘3, Note ⌘2, Event ⌘4, Contact ⌘6; picking one puts the cursor straight back in the line. _(both)_
- [ ] **Do:** type "/note Buy milk" as a Task and press ⏎ → **Expect:** a task titled "/note Buy milk" (the prefix no longer switches the type; use ⌘2). _(both)_
- [ ] **Do:** press Esc, then click the bottom bar's capture button and press Esc again → **Expect:** it closes each time and the keyboard focus returns to the button you used. _(both)_
- [ ] **Do:** press ? → **Expect:** the shortcut sheet describes Quick capture as "a task; ⌘ + a module's number switches the type". _(both)_

## Edge cases
- [ ] **Do:** as a member with view-only Notes, ⌘⇧K then ⌘2 → **Expect:** the type stays Task; in the chip menu Note is greyed out. _(both)_
- [ ] **Do:** as a member without Notes at all → **Expect:** the top bar has no Notes tab, so Tasks becomes ⌘2 both in the top bar and inside the capture. _(both)_
- [ ] **Do:** open the capture, Tab to the type chip, press ⌥2 → **Expect:** nothing changes behind the capture (the panel keys wait while a dialog is open). _(both)_
- [ ] **Do:** narrow the window below 900 px and open the right panel → **Expect:** it slides in as a sheet; the title row and ⌥ keys work inside it. _(web)_

## Migrations / data
- [ ] None: SH-1 changes no schema.

## Known gaps / not-yet-testable
- Tasks' Project, In flight and No date views register later (TV-U13, TV-F8, TV-TL2); only Details shows today.
- The capture's richer Task body (destination picker, the four pills, "From:" chip) is TV-U14; today every type is one line.
- Email's panel was checked on web through a temporary flag; open it once in the desktop app.
- Contacts' and Calendar's Notes view repeats "Notes" under the new title row (the linked-notes list has its own heading); that tidies up when each module is rebuilt.
