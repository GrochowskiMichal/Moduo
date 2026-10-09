# Manual test checklist — row menu popovers fix

> Generated 2026-10-08 · branch `t/maciej/fix-row-menu-popovers` · **Live-verified:** yes, in Chromium on a temporary harness running the real Tasks list (real styles, fake data); not in the signed-in app.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Row right-click menu
- [ ] **Do:** right-click a task → **Set due date…** → **Expect:** the due-date popover opens on that row with the date field focused, and stays open. _(both)_
- [ ] **Do:** right-click → **Schedule…** → **Expect:** the scheduled-time popover opens with its field focused and stays open. _(both)_
- [ ] **Do:** right-click → **Move to bucket…** → pick another bucket → **Expect:** the bucket list opens, the pill changes to the new bucket, the popover closes. _(both)_
- [ ] **Do:** right-click → **Rename** → type a new title → Enter → **Expect:** the title editor opens with the title selected; Enter saves the new title once. _(both)_
- [ ] **Do:** right-click → **Rename** → type something → Esc → **Expect:** the edit is cancelled; the old title stays. _(both)_
- [ ] **Do:** right-click → **Mark done** → **Expect:** works as before; j/k still move the selection afterwards. _(both)_

## Chips and keys
- [ ] **Do:** click a task's due-date chip (e.g. "Oct 20") → **Expect:** its popover opens. Click the chip again → it closes. _(both)_
- [ ] **Do:** click the scheduled-time chip, then the bucket pill → **Expect:** each opens its popover. _(both)_
- [ ] **Do:** select a row, press `s`, `d`, `b` in turn (Esc between) → **Expect:** each opens its popover as before. _(both)_

## Focus returns to the list
- [ ] **Do:** open any row popover (menu, chip or key) → Esc → press j/k → **Expect:** the popover closes and j/k move the selection immediately. _(both)_
- [ ] **Do:** open a chip popover by clicking the chip, close it by clicking the chip again → press Space → **Expect:** Space completes the selected row (focus is on the list, not the chip). _(both)_

## Edge cases
- [ ] **Do:** in a single bucket (no pill shown), right-click → **Move to bucket…** → **Expect:** the bucket list opens. _(both)_
- [ ] **Do:** open a chip popover, then click into the detail panel's title or another field → **Expect:** the popover closes and the cursor stays in the field you clicked. _(both)_
- [ ] **Do:** right-click a row, press Esc without choosing → **Expect:** menu closes, nothing opens, j/k work. _(both)_

## Known gaps / not-yet-testable
- Not verified in the signed-in app or the desktop shell (harness only); the code paths are the same.
