/**
 * The welcome note's content (DESIGN_BRIEF §4): seeded on the server with the
 * note, like an import, so it reads the same on every device and session. It
 * used to be typed in by the editor only in the session that created it; any
 * other first open found an empty doc and retitled the note "Untitled".
 */

export const WELCOME_TITLE = "Welcome to Notes";

export const WELCOME_MARKDOWN = `# ${WELCOME_TITLE}

This is your space to write things down. The first line of any note is its title.

Type / for blocks (headings, lists, checkboxes) and @ to mention a teammate. Hover a line and drag its handle to move it, or press ⌥⇧↑ / ⌥⇧↓.

When a line is real work, type /task: it becomes a live task, synced with Tasks both ways. Type [[ to link another note (or create one by name), and /contact to bring in a person's card. Select text and press ⌘K to link it.

- [x] Open Notes
- [ ] Write a first thought (⌘⇧N captures from anywhere)
- [ ] Delete this note whenever you're done with it
`;
