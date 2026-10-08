# Manual test checklist — t/mike/lexical-0.49

> Generated 2026-08-14 · branch `t/mike/lexical-0.49` · **Live-verified:** partial — unit/integration gates green (`bun run verify` 154 files / 1360 tests); no interactive browser pass yet.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Notes editor — mindmap embeds (the regression fixed this session)
- [ ] **Do:** In a note, type `[Mindmap](moduo://mindmap/m-9)` then Enter → **Expect:** the mindmap embed chip renders inline at the top of the note body (not wrapped in a blank paragraph line), and the source line disappears. _(web + desktop)_
- [ ] **Do:** Open the same note on a second device/session (collab) and edit around the embed → **Expect:** embed persists, no empty paragraph is inserted before/after it, no phantom line on the other side. _(web)_
- [ ] **Do:** Copy a note body containing an embed using the editor's copy action → **Expect:** pasted markdown keeps `[Mindmap](moduo://mindmap/m-9)` (round-trips, no empty string). _(web)_

## Notes editor — block rows (regression check: PageRow/TaskLine paths use the same replace mechanism)
- [ ] **Do:** In a note, insert a page-row embed (paste `[Label](moduo://note/<id>)`) and a task line (`- [ ] do a thing`) → **Expect:** both render as their block components at root level; toggle the task checkbox and confirm the task persists. _(web + desktop)_
- [ ] **Do:** Type/delete text immediately before and after each block row → **Expect:** no spurious empty paragraphs; caret behaves normally. _(web)_

## Collab sync (Yjs v2 binding — `syncLexicalUpdateToYjsV2__EXPERIMENTAL` call changed)
- [ ] **Do:** Open the same note in two tabs/windows and type concurrently → **Expect:** both sides converge, cursors move, no dropped keystrokes, no "lost update" divergence. _(web)_
- [ ] **Do:** Reload a note that has pending unsent edits → **Expect:** local edits reconcile with the server state, no duplicate text. _(web + desktop)_

## Copy / markdown export
- [ ] **Do:** Select a multi-block selection in a note and copy → **Expect:** markdown export includes headings, lists, embeds, checkboxes in order (this exercises the `exportJSON`/`$nodeToMdJson` path that changed under 0.49). _(web)_
- [ ] **Do:** Paste that markdown back into a fresh note → **Expect:** structure round-trips (blocks, embeds, checkbox state preserved). _(web)_

## General editor sanity (Lexical 0.49 behavior change sweep)
- [ ] **Do:** Type plain text, bold/italic, a link, an unordered list, a code block → **Expect:** all standard markdown shorthand and formatting work as before. _(web + desktop)_
- [ ] **Do:** Use triple-click to select a line → **Expect:** selects the line only (0.45 moved triple-click handling to an extension — confirm default UX is unchanged). _(web)_
- [ ] **Do:** Undo/redo through several edits including a block insert → **Expect:** history stays consistent with collab binding. _(web)_

## Migrations / data
- **Do:** none — dependency-only bump (Lexical 0.40 → 0.49 + `@lexical/*` packages). No DB/schema change. Confirm package.json pins `lexical` (and all `@lexical/*`) to `0.49.0`.

## Known gaps / not-yet-testable
- Headless-only `exportJSON()` returns `children: []` for built-in nodes under 0.49; the app's copy path (`$nodeToMdJson`) refills children from the live tree so it is unaffected, but no interactive browser pass has been run yet to confirm copy/paste on a live editor.
- `@lexical/react` peer wants `yjs >= 13.5.22`; project pins `^13.6.30` — compatible, but the collab binding was only exercised through unit tests, not two live browser tabs.
