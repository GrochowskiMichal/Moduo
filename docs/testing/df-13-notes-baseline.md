# Manual test checklist — DF-13 Notes editor baseline + public page reach

> Generated 2026-07-10 · branch `t/maciej/df-13-notes-baseline` · **Live-verified:** yes (hosted test account, local web build) — except the edge-fn deploy (see Known gaps).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Live markdown (type, don't paste)

- [ ] **Do:** in any note, type `# ` at a line start, then some text → **Expect:** the line becomes a display-sized H1 as you type _(both)_
- [ ] **Do:** type `**bold**` mid-sentence → **Expect:** the word turns bold the moment you close the `**` _(both)_
- [ ] **Do:** type `*italic*` → **Expect:** live italics _(both)_
- [ ] **Do:** select a word, press ⌘B, then ⌘I → **Expect:** bold, then bold+italic (both visible at once) _(both)_
- [ ] **Do:** type `[] ` (brackets + space) at a line start → **Expect:** a live checkbox line; `[x] ` gives a pre-checked one _(both)_
- [ ] **Do:** type `- ` at a line start → **Expect:** a bullet list (note: typing `[ ]` *after* the bullet exists stays literal text — Lexical converts only at line start; use `[] ` or /todo) _(both)_
- [ ] **Do:** type `--- ` on an empty last line → **Expect:** a divider appears and the caret lands on a fresh paragraph under it _(both)_
- [ ] **Do:** type `1. `, `> `, ``` ``` ``` → **Expect:** ordered list, quote, code block — all live _(both)_

## Selection format toolbar

- [ ] **Do:** select any text with the mouse → **Expect:** a small floating bar (Bold · Italic · Strikethrough · Code) above the selection _(both)_
- [ ] **Do:** click Bold in the bar → **Expect:** format applies, selection stays, button shows pressed state _(both)_
- [ ] **Do:** click elsewhere (collapse the selection) → **Expect:** the bar disappears _(both)_
- [ ] **Do:** scroll while the bar is up → **Expect:** it dismisses (no stale floating bar) _(both)_
- [ ] **Do:** select text inside a code block → **Expect:** no toolbar (inline formats don't render there) _(both)_

## Keyboard path (format without the mouse)

- [ ] **Do:** select text, press ⌘B / ⌘I / ⌘U → **Expect:** bold / italic / underline (Lexical core) _(both)_
- [ ] **Do:** select text, press **⌘⇧S** → **Expect:** strikethrough (the bar's Strikethrough button shows pressed) _(both)_
- [ ] **Do:** select text, press **⌘E** → **Expect:** inline code (monospace); the tooltips on the bar advertise both shortcuts _(both)_
- [ ] **Do:** press ⌘⇧S with the caret collapsed (no selection) → **Expect:** nothing happens, no browser "Save As" dialog _(both)_

## Checkbox = task (the shape morph)

- [ ] **Do:** look at a plain checkbox line (from `[] ` or /todo) → **Expect:** a **round** checkbox — thin muted ring, transparent fill; hover darkens the ring _(both)_
- [ ] **Do:** check it → **Expect:** pink/primary fill + ✓, still round _(both)_
- [ ] **Do:** hover a checkbox line → "Make task" (or ⌘⇧T) → **Expect:** the checkbox **does not visibly change shape or position** — same round toggle, now live-synced to Tasks; only the meta chip appears on the right _(both — this is the flagship moment, eyeball it hard)_

## Right panel summon

- [ ] **Do:** open /notes with **no note selected** → **Expect:** a panel-toggle icon button top-right of the editor pane; the right rail shows "Select a note to see its links, comments, and outline." _(both)_
- [ ] **Do:** click the toggle → **Expect:** right panel hides; click again → returns. Tooltip reads "Show links, comments & outline" when hidden _(both)_
- [ ] **Do:** select a note → **Expect:** the rail becomes the Detail · Comments · Outline switcher, same toggle still works _(both)_
- [ ] **Do:** collapse the right panel via the bottom-bar toggle → **Expect:** the editor's summon button reflects it (states stay in sync) _(both)_

## Public published page

- [ ] **Do:** publish a note that has child pages; open the public link on a desktop-width window → **Expect:** subtree nav rail on the left, as before _(web)_
- [ ] **Do:** open the same link in a phone-width window (<768px) → **Expect:** a "Pages" disclosure button above the content; tap → the page tree; tap a page → navigates and the disclosure closes _(web)_
- [ ] **Do:** publish a note containing a task line → **Expect:** the public body shows the plain checkbox text, **no** `<!-- moduo:task:… -->` comment _(web)_
- [ ] **Do:** reorder child pages by dragging in the sidebar, reload the public page → **Expect:** nav order matches the sidebar (authored), not alphabetical _(web — edge fn deployed 2026-07-11; live endpoint confirmed returning `position`)_

## Edge cases

- [ ] **Do:** ⌘B with no selection (collapsed caret), then type → **Expect:** typed text is bold (Lexical's native pending-format behavior); no toolbar appears for the empty selection _(both)_
- [ ] **Do:** open a note in read-only (viewer permission) and select text → **Expect:** no format toolbar _(both)_
- [ ] **Do:** viewport narrower than 900px in-app → **Expect:** the summon toggle opens the right panel as a sheet _(both)_

## Migrations / data

- No DB migrations. The `notes-public` **edge function** changed (adds `position`+`createdAt`, scrubs task-id comments) and was **DEPLOYED to prod 2026-07-11** (v3, `verify_jwt:false` preserved). Live endpoint verified returning the new fields with comments stripped. No pending deploy.

## Known gaps / not-yet-testable

- **Edge fn deployed 2026-07-11** (v3) — the JSON payload is confirmed live (position+createdAt present, task-id comments scrubbed). The one thing not exercised end-to-end is a real **drag-reorder of child pages → public nav order** (drag wasn't scripted; the comparator is unit-tested and the payload is verified) — worth a 30-second manual pass.
- Demo data left on the hosted test account: note "DF-13 verify note" (published, token `bf35089d…`) with 3 child pages and one minted task "done and round". Unpublish/delete freely.
