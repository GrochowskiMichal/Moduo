# Manual test checklist — NR-2 New Notes shell + sidebar

> Generated 2026-10-13 · branch `t/mike/nr-2-notes-shell` · **Live-verified:** partial. The sidebar was driven live in Storybook (`Features/Notes/New Notes sidebar`): click-to-select, → / → / ↵ by keyboard, drag highlighting for file-to-Pages, nest, and a refused cycle. The signed-in app was not: the agent had no test session. Every item below is still to walk on web.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## The switch (AC1)
- [ ] **Do:** open `/notes` (classic) → click **Try the new Notes** (top right) → **Expect:** the new shell: sidebar with Favorites (if you have pins) · Inbox · Pages, a footer row `Published (n) · Archive (n) · Trash (n)`, the right panel closed. _(web)_
- [ ] **Do:** sign in on a second browser/device and open `/notes` → **Expect:** it opens in New Notes too. _(web)_
- [ ] **Do:** in New Notes, `⋯` (top bar) → **Switch back to classic Notes** → **Expect:** classic, with the same notes and pins exactly as before. _(web)_

## Capture and discard (AC3)
- [ ] **Do:** press ⌘N and click another note without typing → **Expect:** no Untitled row anywhere, even after reload; nothing new in Trash. _(web)_
- [ ] **Do:** press ⌘N twice, then type in the second → **Expect:** exactly one new note, in Inbox, titled from what you typed. _(web)_
- [ ] **Do:** from another module press ⌘⇧N → **Expect:** a focused note in Inbox with the caret ready; typing starts instantly. _(web)_
- [ ] **Do:** hover **Pages** → `+` (New page), type a title → **Expect:** the note lands in Pages, not Inbox; still there after reload. _(web)_

## Stable sections (AC2)
- [ ] **Do:** add a child to an Inbox note (row `+`, then type) → **Expect:** the parent stays in Inbox, with the child nested under it. _(web)_
- [ ] **Do:** drag an Inbox note into Pages (onto the Pages header, or beside a page) → **Expect:** it leaves Inbox, the Inbox count drops by one, and it survives a reload. _(web)_
- [ ] **Do:** drag a page back onto the Inbox header → **Expect:** it is in Inbox again. _(web)_
- [ ] **Do:** `⋯` on a row → **Add to favorites**, then drag favorites to reorder → **Expect:** Favorites shows in your order; another member doesn't see your favorites. _(web)_

## Tree by keyboard and drag (AC4)
- [ ] **Do:** click a row, then use only ↑ ↓ → ← ↵ → **Expect:** it behaves like Finder's list: → expands then steps in, ← collapses then steps out, ↵ opens. _(web)_
- [ ] **Do:** focus a page row and press ⌥⇧↑ / ⌥⇧↓ → **Expect:** it moves among its siblings and stays there after reload. _(web)_
- [ ] **Do:** ⌫ on a page row → **Expect:** it goes to Trash with one undo toast; Undo brings it back. ⌫ on a Favorites row only removes the favorite. _(web)_
- [ ] **Do:** drag a parent into its own child → **Expect:** nothing lights up and nothing happens. _(web)_
- [ ] **Do:** drag a shared note under a private one → **Expect:** a dialog: "Keep current access" / "Match the new parent"; Esc keeps access. _(web)_
- [ ] **Do:** drag a sidebar note into the open editor, and onto the Detail panel → **Expect:** a chip in the text; a link in Detail. _(web)_

## Focused layout (AC5)
- [ ] **Do:** open a nested note → **Expect:** a centred reading column; the top bar shows `Pages › Parent › Note`; clicking `Parent` opens it; clicking `Pages` reveals Pages in the sidebar. _(web)_
- [ ] **Do:** open the right panel from the top bar, pick **Outline**, reload → **Expect:** the panel stays open on Outline. _(web)_
- [ ] **Do:** go offline (DevTools) and type → **Expect:** one muted dot "Saved locally — will sync" in the top bar; it clears when back online. _(web)_

## Edge cases
- [ ] **Do:** as a view-only member → **Expect:** no `+`, no New page, no drag, no Publish/Trash in menus; Comments still work. _(web)_
- [ ] **Do:** footer → **Trash** → hover a row → **Delete forever** → **Expect:** a confirm dialog; Back arrow returns to the tree. _(web)_

## Known gaps / not-yet-testable
- The signed-in flows above were not live-verified by the agent (no session); the Storybook checks and 2.3k unit tests cover the logic.
- `e2e/notes/shell.spec.ts` needs `E2E_APP_URL` and an authed session to run.
- Meta line, Linked-from footer and the Full width toggle arrive in NR-3; ⌘K note search in NR-10.
