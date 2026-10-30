# Changelog

What changed in each Moduo release, newest first. Also in the app (What's new) and at
https://moduo.app/changelog.

<!-- Generated from release-notes/releases.json by scripts/release/changes.ts. Don't edit by hand. -->

## 1.6.0 · 2026-10-30

### New

- Calendar's left panel lists all your calendars in one place: click a calendar's color to show or hide it, and give it any color you like.

### Improved

- Booking links make sure Google Meet or Zoom is connected before you share them, and you can copy, pause, edit or delete a link from Calendar's left panel.
- Click or drag anywhere on Calendar's week, day or month view to start a new event, right where you drew it.
- An event's panel shows everything linked to it as cards, as a task's does, and a history of its changes.
- Calendar's side panels stay open or closed as you left them, like on every other page.
- See your calendar as a workspace member sees it with the glasses on their row in Calendar; press them again to go back.

### Fixed

- Calendar's times and dates follow your clock, week start and date order from Settings, Time and region.
- Calendar's today marker follows your corner radius setting.
- In the browser, ⌥N starts a new item and ⌥⇧N a new note, since browsers keep ⌘N for a new window.
- Text you copy out of Notes comes back exactly as you wrote it, and pasted code, keys and numbered lines keep their shape.
- Scheduling an overdue task from a day's due list finds free time today instead of saying there's none left.

### Security

- Security and reliability improvements.

## 1.5.0 · 2026-10-28

### New

- Change or delete just one day of a repeating event, or all of them, including Google repeats. Undo brings back exactly what you changed.
- Calendar has a Month view (press M), and Day view now shows each meeting's people, linked notes, next task and where it happens beside it.
- Hold a task in focus time: in Plan, press S, then F, then Enter. Teammates see only "Focus time", and booking links stay open over it unless you tick Focus time.
- Mark any event you own as private with P: teammates see only "Busy" at that time, and it stays out of their search, mentions and assistant answers.
- See teammates who share their calendar as lanes beside your week, and find a time you're all free by naming them in the box. Preview your week exactly as a teammate sees it.
- Open a booking link from the calendar to see its settings beside your week, with its open times outlined on it. Pause it, change its length or let Focus time block it without leaving the week.
- Press O in Calendar to offer a guest a few specific times as one link or as text, held on your calendar as busy until they pick one; the rest release at once, or after 48 hours.
- Choose where new events go: Moduo or one of your Google calendars. Events made for Google are created there first and show once, even after syncing.
- Your calendar updates live: events added or changed on another device, by an assistant or by a teammate appear in the open week within seconds, no reload needed.
- Google Calendar events now edit both ways: move, resize, rename or delete them in Moduo and the change saves to Google. If Google refuses, the change rolls back and says why.
- Press N in Calendar and type an event the way you'd say it, like "Investor prep thu morning 90m". It finds the free time, adds a Meet link when there are guests, and invites them through Google.

### Improved

- The calendar week reads cleaner: overlapping events sit side by side or stack neatly, overnight events show on both days, and hours stay right when the clocks change.
- The event panel now follows what you select and shows where it happens (place with a map, meeting link to copy), who's coming and their replies, and who can see it.
- Calendar fits smaller windows by folding its side panels, shows a second time zone with Z, and has a Working hours sheet for your day and week.
- Booking pages are easier for guests: one details step, a button that says what's next, and a quick way to see the other open times that day.
- Week headers now show how many tasks are due each day, with a quick way to schedule them. All-day items stay in two tidy rows, and a "now and next" pill shows your current meeting.
- Connect, pick and manage your calendar accounts right from Calendar, with a clear Reconnect when Google stops accepting access and Undo when you remove one.
- Home's Today widget now shows what's on now and next with a Join button, and assistants can read your calendar the way teammates see it, offer times and say who sees an event.
- Calendar now says when a calendar didn't sync and lets you try again, keeps its shape while loading, shows when you're offline, and welcomes you with a short guide on an empty first week.
- Run your week from the keyboard: move with the arrows, nudge, copy and duplicate events, and undo any change with ⌘Z (press ? for every key).
- Right-click any event, or press ⌃↵, for a quick menu to open, copy, duplicate, make private, link, move to Google or delete it. The Event panel's ⋯ has the same actions with their keys.
- The Calendar's side panel is now Plan: your tasks grouped by what's overdue, due this week, scheduled and undated. Select one and press S to drop it into the next free time.
- Events can now live on your own custom calendars, and saved calendar sets include them. Meeting links are kept apart from the place, so Join works for booked and synced meetings alike.

### Fixed

- Booking links no longer offer times taken by your repeating events: a weekly meeting that started weeks ago now blocks this week's slots too, and a skipped or moved occurrence frees its old time.

### Security

- Security and reliability improvements.

## 1.4.0 · 2026-10-26

### New

- Search in Notes finds what you wrote, not just titles, with the line it was found in.

### Improved

- Comments in notes are clearer: commented text is underlined, a count sits in the margin, and you can edit or delete a comment.
- Notes open faster: the ones you are likely to open next load in the background, and typing does less work.
- Notes works from the keyboard: open a note's menu, the block menu, the formatting bar and comments without the mouse.
- Publishing a note now names the subpages that go public with it, and a published note says it's public.
- Right-click a note, or use its ⋯ in the sidebar, for everything you can do with it, including Share and Publish.
- A note with many pages inside it lists them compactly, and the sidebar footer shows Published, Archived and Deleted.
- Typing / in a note now offers tasks and pages first, and any line can become a task or a subpage.

### Fixed

- A dropped connection no longer moves tasks to the Inbox, resets your Home layout, brings back removed Google calendars or reports a rename that didn't save.
- Editing or deleting a chat message while it is still sending now sticks for everyone.
- Renaming or moving a note right after reconnecting no longer brings back the older name or place.
- Ticking a task off and on quickly, changing many at once or dragging one on the Board now saves in the order you did it, even on a shaky connection or right before signing out.
- Turning a checkbox line into a task keeps it in place, with no empty gap left behind.
- Reset local cache now stays blocked when Moduo can't check this device for unsynced notes, so they can't be lost.
- People with Full access to a note can make it follow its parent page's sharing again, including when moving it.

### Security

- Security and reliability improvements.

## 1.3.2 · 2026-10-23

### Improved

- Notes looks calmer: no extra heading or menus, a star to favorite a note, and a Details panel that matches Tasks.
- Code blocks show code in a monospace font with colours, wrap long lines, and are easy to leave.
- Tables get buttons to add rows and columns, Tab adds a row at the end, and every cell can be clicked into.
- Undo in a note goes back one line at a time, and redo always brings it back.

### Fixed

- Dragging a block by its handle moves it again, and the handle sits on the line it belongs to.
- Imported notes keep their titles when you edit them, and switching between notes no longer shows a loading message.
- Typing three dashes makes a divider, checkboxes line up with their text, and links can be opened, edited and removed.

## 1.3.1 · 2026-10-23

### Improved

- New and renamed notes from teammates and agents show up in the sidebar, and links appear in the side panel right away.
- Notes has a new, calmer layout for everyone: a centred reading column, Favorites, Inbox and Pages in the sidebar, and panels that open only when you need them.
- Markdown you paste anywhere in a note turns into headings, lists and checkboxes.
- Notes reopens the last note you had open, where you left off. Checkboxes and live tasks now look different at a glance.

### Fixed

- Notes you open and leave without typing no longer pile up as empty Untitled notes.
- Undo in a note now takes back only your own edits, never a teammate's or Claude's.
- The welcome note keeps its content on every device instead of opening empty as Untitled.

## 1.3.0 · 2026-10-23

### New

- Connect Claude and other AI assistants to Moduo with just a link: sign in, choose what they can reach, and disconnect them any time in Settings.

### Improved

- Moduo has its own connector address for Claude and other AI apps, so Claude shows the Moduo logo. Your existing connections keep working.
- Connecting Claude again offers to replace your earlier Claude connection, and Settings shows when each connected app was added.

## 1.2.6 · 2026-10-23

### Improved

- Settings no longer asks for a password: you sign in to Moduo with the code we email you.
- A page now shows the pages inside it once, in the list at its foot. Older links to those pages in the text tidy themselves away, and /page opens the new page.

### Fixed

- On a shared computer, switching accounts or signing out now also clears the previous person's cached notes in browsers that can't list their stored data.

### Security

- Security and reliability improvements.

## 1.2.5 · 2026-10-22

### Fixed

- A mistyped moduo.app address now shows a proper "Page not found" page instead of the home page.

## 1.2.4 · 2026-10-20

### Improved

- Reliability improvements.

## 1.2.3 · 2026-10-20

### Fixed

- Task details keep their full-width labels when the right panel is 320 px wide; they narrow only below that.

## 1.2.2 · 2026-10-19

### Improved

- Reliability improvements.

## 1.2.1 · 2026-10-19

### Improved

- The privacy policy now covers booking reminders, chat files and statuses, email when away, who has a note open, and what account deletion removes.

## 1.2.0 · 2026-10-19

### New

- After an update, Moduo tells you once what changed. Earlier releases are in Settings, under About, and on the changelog page of our website.

### Improved

- A browser tab left open across an update now offers a reload, and never reloads on its own.

## 1.1.0 · 2026-10-18

### Improved

- Desktop updates now download straight from Moduo's own servers.
- Web and desktop now show the same version number, so it's easy to tell which release you're on.

### Fixed

- The web app keeps working after an update, instead of showing errors until you reload.
