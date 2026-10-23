# Changelog

What changed in each Moduo release, newest first. Also in the app (What's new) and at
https://moduo.app/changelog.

<!-- Generated from release-notes/releases.json by scripts/release/changes.ts. Don't edit by hand. -->

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
