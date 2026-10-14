# Manual test checklist — NR-3 Notes editor core

> Generated 2026-10-14 · branch `t/mike/nr-3-editor-core` (#358) · **Live-verified:** partial — the Storybook "Notes / Note view" stories (real engine + editor, fake runtime) showed the meta line, the Linked-from footer, Full width, chips/page rows/tables drawn through the view registry, and no stray paragraph on an empty cache. Signed-in checks below are still open (email-code sign-in can't be automated).
> Run top-to-bottom with New Notes switched on; check off as you go. Each item is a step → what you should see → where.

## Header meta line and Linked-from footer
- [ ] **Do:** open a note linked to a company, two tasks and an event → **Expect:** a muted line under the title like `Acme · 2 tasks · Thu call · Edited … ago`; no "by …" yet _(web)_
- [ ] **Do:** click the company chip → **Expect:** the company opens; click `2 tasks` → **Expect:** the right panel opens on Detail _(web)_
- [ ] **Do:** give a note a very long title that wraps, and link an entity with a long name → **Expect:** the meta line moves down with the title, stays on one line, truncates long chips and never overlaps the body _(web)_
- [ ] **Do:** open a note that other notes reference or mention → **Expect:** a quiet "Linked from (n)" section at the bottom, grouped by relationship (References, Mentions…), each row with its snippet; clicking a row opens it _(web)_
- [ ] **Do:** open a note nothing links to → **Expect:** no footer at all _(web)_
- [ ] **Do:** switch quickly between two linked notes → **Expect:** one note's chips never flash on the other _(web)_

## Full width
- [ ] **Do:** `⋯ → Full width` on a note with a table, then reload → **Expect:** the column spans the pane and stays wide after reload; other notes keep the reading width _(web)_
- [ ] **Do:** as a view-only member, open `⋯` → **Expect:** no Full width item _(web)_

## Markdown fidelity (one converter)
- [ ] **Do:** type a link, **bold**, *italic*, ~~strike~~, `code`, a Shift+Enter line break, a heading, numbered and bulleted lists, a checkbox, a `/task` line, an `@`/`/` chip and a `/table`; then `⋯ → Export .md` → **Expect:** every construct is in the file (the table as a GFM table) _(web)_
- [ ] **Do:** publish that note and open its public link → **Expect:** the same content, styled like the editor (same headings, lists, code and table look) _(web)_
- [ ] **Do:** ask the MCP connector to read the note → **Expect:** the same markdown as the export _(web)_
- [ ] **Do:** select the whole note, copy, paste into a plain-text app → **Expect:** clean markdown _(web)_
- [ ] **Do:** select one word inside a heading, a checklist item and a table cell, paste each elsewhere → **Expect:** just the word, no `##`, `- [ ]` or table _(web)_
- [ ] **Do:** type `|x| ` in a paragraph → **Expect:** it stays text, no table appears _(web)_

## Opening and syncing (honest provider)
- [ ] **Do:** open a note you opened before, on a slow connection (DevTools → Slow 3G) → **Expect:** the content paints at once and is editable; no "Preparing note…" wait _(web)_
- [ ] **Do:** open an existing note in a fresh browser profile (empty cache) → **Expect:** it loads after a short wait with NO extra empty line at the top or bottom _(web)_
- [ ] **Do:** in that fresh profile, type during the load, then wait; then search the note's body text from the sidebar → **Expect:** search finds the new text (the body is written once the pull lands) _(web)_
- [ ] **Do:** ⌘N, type one short line, leave it → **Expect:** body search finds it, and export shows the line _(web)_
- [ ] **Do:** go offline, open a cached note → **Expect:** it opens and edits; the muted "Saved locally — will sync" dot stays until a real push succeeds _(web)_

## Regressions to watch
- [ ] **Do:** use chips in Tasks/Calendar descriptions and email compose → **Expect:** chips still render and open (the chip view now installs through a registry) _(web, desktop)_
- [ ] **Do:** a note with a page row, a mindmap embed and a divider → **Expect:** all render as before _(web)_
- [ ] **Do:** switch back to classic Notes → **Expect:** classic editor unchanged (same width, same placeholder) _(web)_

## Edge cases
- [ ] **Do:** a note with more than 1,000 unsynced updates (long editing session on another device), open it fresh → **Expect:** all content appears (the log is paged) _(web)_
- [ ] **Do:** a table cell with a path like `C:\new` and a cell with a line break → **Expect:** both survive export and re-import _(web)_

## Migrations / data
- None. No schema change in NR-3; prod's `notes_op_apply_updates` / `notes_op_save_snapshot` were checked to keep the stored body when a push sends none.

## Known gaps / not-yet-testable
- Every signed-in item above: email-code sign-in can't be automated in the preview browser.
- "Edited … by …" is not shown: nothing records who made an edit; proposed for NR-6.
- "Edited … ago" refreshes on renames and reloads, not on every body save.
- Clicking a divider no longer selects it (keyboard delete still works).
