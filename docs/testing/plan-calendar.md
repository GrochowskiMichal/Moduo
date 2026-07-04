# Session check — Calendar planning (Wave 2, DoR)

> Planning-only session: **no code shipped, nothing to live-verify.** This is a *review* checklist — a one-pass skim so the spec starts building on ratified ground. Surfaces: the docs themselves.

## The two docs that gate the build

- [ ] **Loop semantics** — read [.design/calendar/DESIGN_BRIEF.md §6](../../.design/calendar/DESIGN_BRIEF.md): the elapsed-block row (Done · Later today · Took longer · Remove), the strip's Move-to-today/Review, focus timer. → Wording + behaviors match what you meant in the interview. *(Highest-value check — this is the moat.)*
- [ ] **v1 scope table** — DESIGN_BRIEF §1: every "locked answer" row reads as what you actually decided (views, week default, right-panel variants, fullness cut, NL repeats…).
- [ ] **Deferred list** — DESIGN_BRIEF §11: nothing you expected in v1 sits in the deferred table.
- [ ] **Layout sketch** — DESIGN_BRIEF §3: the three panes + left-rail contents match your mental model.
- [ ] **Blocks** — [specs/calendar.md](../../specs/calendar.md) §Execution blocks: CAL-1…CAL-7 order feels right (CAL-1 ships a visible calendar with your scheduled tasks before any migration).

## Ledger & logs (spot-check)

- [ ] [specs/BUILD_ORDER.md](../../specs/BUILD_ORDER.md) shows the new **Wave 2 — Calendar** section, all seven blocks unchecked, lanes extended.
- [ ] [docs/decisions.md](../../decisions.md) top entry = the 2026-07-02 calendar planning decision (lens model, fullness cut, right-panel principle).

## Known gaps
- Nothing was live-verified (no code changed). The migration, OAuth mirror round-trip, dnd, and visual baselines are execution-time manual tests — each CAL block's wrap will list its own.
- The competitive research ([COMPETITIVE_RESEARCH.md](../../.design/calendar/COMPETITIVE_RESEARCH.md)) flags its own uncertainty list (§7) — pricing figures especially are verify-before-quoting.
