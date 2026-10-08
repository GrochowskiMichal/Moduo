# Manual test checklist — DS-3 NavRow + MetaCount (+ Tasks rail)

> Generated 2026-10-08 · branch `t/maciej/ds-3-navrow-metacount` · **Live-verified:** partial. The primitives were checked in Storybook (swap widths, hover vs current, menu, rename, keyboard, blue accent). The Tasks rail is covered by jsdom tests but wasn't driven in the running app.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Tasks rail — rows
- [ ] **Do:** open Tasks and look at the rail → **Expect:** All, Queue and Inbox have icons, buckets have a grey dot, every name starts at the same x, and every count ends flush right at the same x _(both)_
- [ ] **Do:** hover a bucket row → **Expect:** a light fill; the count fades out and ⋯ fades in exactly where the count was; the name doesn't move or re-truncate _(both)_
- [ ] **Do:** hover All, Queue and Inbox → **Expect:** the count stays (there's no ⋯ and no empty gap) _(both)_
- [ ] **Do:** compare the current row with a hovered row → **Expect:** the current row's fill is visibly stronger than the hover fill _(both)_
- [ ] **Do:** right-click a bucket → **Expect:** the same menu as ⋯ (Rename, Share, Open at, Section, Delete bucket…) _(both)_
- [ ] **Do:** Tab through the rail → **Expect:** focus moves from each row to its ⋯; with focus on a row, ⋯ shows and the count hides _(both)_

## Rename, sections, add
- [ ] **Do:** double-click a bucket (or F2, or ⋯ → Rename), type a name, press Enter → **Expect:** it's saved, and focus is back on the row _(both)_
- [ ] **Do:** start a rename and press Esc → **Expect:** the old name stays _(both)_
- [ ] **Do:** ⋯ → Section → New section…, type a name, press Enter → **Expect:** the bucket moves under a new collapsible section header with a total count, and focus is back on the row _(both)_
- [ ] **Do:** collapse that section, then reload → **Expect:** it is still collapsed _(both)_
- [ ] **Do:** hover the "Buckets" header and click + → **Expect:** a name field; Enter adds a bucket and keeps the field open; Esc closes it and focus goes back to the rail _(both)_

## Focus comes back (the ledger item)
- [ ] **Do:** ⋯ → Delete bucket… → Cancel → **Expect:** focus is back on that bucket's row (Tab once to see the ring), not at the top of the page _(both)_
- [ ] **Do:** ⋯ → Delete bucket… on the current bucket → Delete bucket → **Expect:** the bucket is gone, an Undo toast shows, and focus is on Inbox _(both)_
- [ ] **Do:** ⋯ → Share, then press Esc → **Expect:** the popover opens next to the row (no extra button appears inside the row), and focus returns to the row _(both)_
- [ ] **Do:** ⋯ → Share, then click into a task title → **Expect:** the popover closes and the cursor stays in the title _(both)_

## Drift
- [ ] **Do:** have a bucket with a drifted task (its scheduled time has passed, still open) → **Expect:** a small dot before its count, with the tooltip "N drifted · triage" _(both)_
- [ ] **Do:** click the dot → **Expect:** triage opens; close it → focus is back on that row _(both)_
- [ ] **Do:** hover the row → **Expect:** the dot stays put while the count swaps for ⋯; the ⋯ menu has "Triage N drifted…" _(both)_
- [ ] **Do:** give Inbox a drifted task → **Expect:** Inbox gets a ⋯ with Triage only; without drift it has none _(both)_
- [ ] **Do:** collapse a section that holds drifted tasks → **Expect:** the header shows a dot with "N drifted in <section>" _(both)_

## Storybook
- [ ] **Do:** open `Components/ui/nav-row` (Rail, States, SectionsAndLevels) on two shades and two accents → **Expect:** rest, hover, current, drop target (ring) and dragging (dimmed) all look different _(web)_
- [ ] **Do:** open `Components/ui/meta-count` → **Expect:** a 12px icon and number, muted, and nothing at zero _(web)_

## Edge cases
- [ ] **Do:** open Tasks as a member who can't edit → **Expect:** no ⋯, no right-click menu and no "+" on Buckets; clicking a drift dot still opens triage _(both)_
- [ ] **Do:** use a very long bucket name → **Expect:** it truncates with an ellipsis and doesn't shift on hover _(both)_

## Known gaps / not-yet-testable
- The rail wasn't driven in the running app: no signed-in session in this worktree. Storybook and jsdom tests cover it.
- Share does nothing in a one-person workspace. This was already true before DS-3.
- Collapsed sections carry over on a workspace switch, like the other Tasks view settings. This was already true before DS-3, and TV-U2's move to view-prefs fixes it.
