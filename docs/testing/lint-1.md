# Manual test checklist — LINT-1 (Biome green + gated in CI)

> Generated 2026-10-07 · branch `t/mike/lint-1` · **Live-verified:** yes — `bun run verify` green locally (1582 tests), CI run 37686979878 green including the new Biome step.

## Gate
- [ ] **Do:** `bun run verify` on a fresh pull of develop → **Expect:** exits 0; Biome reports 0 errors _(terminal)_
- [ ] **Do:** open any PR's `checks` run → **Expect:** a passing "Biome (JS/TS lint + format)" step after Typecheck _(GitHub)_

## Landing page
- [ ] **Do:** `bunx biome check landing/` → **Expect:** no lint diagnostics (linting is off for `landing/**` by decision) _(terminal)_

## Known gaps / not-yet-testable
- Landing bugs are no longer linted; landing-v4 has a loose `==` at `landing/index.html:8775` for Maciej to check.
- Branches with unformatted code now fail CI on their next push (Biome checks formatting).
