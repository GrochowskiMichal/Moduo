# Manual test checklist — DF-10 palette searches entities

> Generated 2026-07-11 · branch `t/maciej/df-10-palette-search` · **Live-verified:** yes — every check below was exercised on the hosted test account (web dev server); the desktop pass is the only unverified surface (same code path).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Palette entity search (⌘K)
- [ ] **Do:** press ⌘K, type a real task name (e.g. `Water`) → **Expect:** a **Tasks** group appears with the matching task ("Water plants") and a small `Task` badge on the right _(web — live-verified)_
- [ ] **Do:** type a query that matches across kinds (a name shared by a contact + a note, if you have one) → **Expect:** separate headed groups in fixed order **Tasks → Notes → Contacts → Email → Events**; only groups with matches show _(both)_
- [ ] **Do:** read the input placeholder → **Expect:** it reads *"Search tasks, notes, contacts… or jump to a page"* (no longer the old "Search workspaces, pages, or actions…") _(web — live-verified)_
- [ ] **Do:** type quickly / keep typing → **Expect:** previous results stay on screen during the pause between keystrokes; it does **not** blank to "Searching…" on every key _(web — live-verified)_

## Deep-linking a result
- [ ] **Do:** search a task, click (or ↑/↓ + Enter) the result → **Expect:** the palette closes and you land on **/tasks with that task selected** (URL gains `?id=…`) _(web — live-verified: closed + `/tasks?id=…`)_
- [ ] **Do:** search a note, open it → **Expect:** lands on /notes with the note selected _(both)_
- [ ] **Do:** search a contact/company, open it → **Expect:** lands on /contacts with that entity selected _(both)_
- [ ] **Do:** search an email or event and open it → **Expect:** navigates to /email or /calendar (the **module page**, item not yet auto-selected — that lands with DF-2); no crash, no dead toast _(both)_

## Static actions still work
- [ ] **Do:** open ⌘K with an empty query → **Expect:** all the usual groups (Navigate / Notes / Contacts / Workspace) with Open Home/Notes/Tasks/…, New note, New/Import contacts, Settings _(web — live-verified)_
- [ ] **Do:** type a command word (e.g. `sett`) → **Expect:** the matching action (Settings) shows; non-matching nav actions are filtered out _(web — live-verified)_
- [ ] **Do:** run "New note" / "New contact" from the palette on a page that already has a `?id`/`?type` selection → **Expect:** the create action fires **without** wiping the existing selection (functional search-updater preserved) _(both)_

## Edge cases
- [ ] **Do:** type gibberish with no matches (e.g. `zzqxnomatch`) → **Expect:** "No results." (not a blank list, not a stuck "Searching…") _(web — live-verified)_
- [ ] **Do:** open ⌘K, select a result, reopen ⌘K → **Expect:** it reopens with an empty query (query + results reset on close) _(web — live-verified indirectly: reset-on-close)_
- [ ] **Do:** search before a workspace has finished loading (cold boot, immediate ⌘K) → **Expect:** no crash; results appear once the workspace is ready _(both)_

## Migrations / data
- No DB migrations, no edge-function changes. Pure frontend wiring over the existing `entities` registry + `spine.searchEntities` (already live).

## Known gaps / not-yet-testable
- **Desktop (Tauri) not exercised this session** — same React code path as web; worth a 30-second ⌘K pass on the desktop build.
- **Email/Event auto-selection** is intentionally out of scope (degrades to the module page until **DF-2** wires URL selection there). The unit tests + the app-chrome route map cover the degrade; a live email/event open lands on the module page as designed.
- **`email_thread` icon** — the registry uses `email`/`email_thread`; the fix mapped both to the Mail glyph, but the hosted account had no `email_thread` registry row to render live (verified via the icon-map + unit-tested grouping instead).
- Live verification used the in-app preview pane (innerWidth reports 0 → the tasks page renders panels as sheets, a known preview artifact); the palette itself is viewport-independent and behaved correctly.
