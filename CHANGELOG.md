# Changelog

What changed in each Moduo release, newest first. Also in the app (What's new) and at
https://moduo.app/changelog.

<!-- Generated from release-notes/releases.json by scripts/release/changes.ts. Don't edit by hand. -->

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
