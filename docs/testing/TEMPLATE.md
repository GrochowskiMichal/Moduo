# Manual test checklist — <sprint / branch>

> Generated <date> · branch `<branch>` · **Live-verified:** <yes / partial / no — note what>.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## <Feature / surface 1>
- [ ] **Do:** … → **Expect:** … _(web / desktop / both)_
- [ ] **Do:** … → **Expect:** … _(web)_

## <Feature / surface 2>
- [ ] **Do:** … → **Expect:** … _(desktop)_

## Edge cases
- [ ] **Do:** <empty / error / conflict / large-N / deleted-entity / permission-denied> → **Expect:** …

## Migrations / data
- [ ] **Do:** <what schema/data changed; how to confirm it applied> → **Expect:** …

## Known gaps / not-yet-testable
- <anything the agent could not verify, and why>

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
