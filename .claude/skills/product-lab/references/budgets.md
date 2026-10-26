# Budgets and gates: what the lab computes by code

The critic judges; the lab measures. This file is the contract for everything the lab turns
into a number without a model: the feel budget rows, the six gate areas and the caps they put
on the jury's categories. `scripts/lib/report.mjs` implements it; change both together.

All values are p95 unless a row says otherwise. Bands come from practice, not from studies
linking them to rated feel (see the research report in `docs/local/claude_science/product-jury/`
in Moduo). Treat them as proposals until a ladder run calibrates them.

## Feel rows the lab measures today

| Row | Interaction | Full | Partial | Fail | Source in the dossier |
|---|---|---|---|---|---|
| 1 | Key press to next paint (journeys, keyboard) | ≤16 ms | ≤33 ms | >50 ms | Event Timing per interaction; unreported = ≤16 ms |
| 2 | Click to next paint (journeys, pointer) | ≤50 ms | ≤100 ms | >200 ms | Event Timing |
| 4 | Motion after a keyboard-triggered action | none or ≤50 ms | ≤100 ms | >150 ms | animation inventory one frame after each key |
| 5 | Overlay: input to first shown frame | ≤50 ms | ≤100 ms | >150 ms | overlay timer (adds harness overhead) |
| 6 | Menu or popover entry | 120-200 ms | ≤250 ms | >300 ms | overlay animation inventory |
| 7 | Dialog, sheet or panel entry | 200-250 ms | ≤300 ms | >400 ms | overlay animation inventory |
| 8 | Exit relative to entry | ≤1.0x | ≤1.2x | >1.5x | overlay inventory on close |
| 9 | View switch to content usable | ≤200 ms | ≤500 ms | >1000 ms | steps with `expect` and `view: true` |
| 10 | Dropped frames while an overlay opens | 0 | 1, not consecutive | 2+ consecutive or any ≥50 ms | rAF gaps; headed runs only |
| 12 | Layout shift per interaction | 0 | Σ ≤0.01 | Σ >0.05 | layout-shift entries, Chromium only |
| 13 | Interrupt: close at 40%, reopen | ends open within 400 ms | within 800 ms | stuck or closed | overlay interrupt test |
| 14 | Overlay entry easing | decelerating | ease or ease-in-out | ease-in or linear | inventory easing |
| 15 | Reduced motion | no translate or scale | | moves | overlay under `prefers-reduced-motion` |
| 17 | Long animation frames during input | 0 | ≤50 ms total | any ≥100 ms | LoAF, Chromium only |
| 18 | Click latency spread (p99 / p50) | ≤2 | ≤3 | >4 | Event Timing (low weight) |

Rows 3, 11 and 16 (optimistic writes under delay, drag tracking, slow operations) need
journey-specific scripts; the lab records them when a journey step declares them and leaves
them out otherwise. A row with no samples is `null`, never a pass.

Row weights in the performance gate follow frequency: rows 1, 2 and 4 count 3, rows 5-9
count 2, the rest count 1. Full = 10, partial = 6.5, fail = 3.

## Gate areas (0-10, null when not measured)

| Area | How the lab scores it | Cap when below 6 |
|---|---|---|
| accessibility | 10, minus 2 per critical and 1.5 per serious axe rule, 0.5 per moderate rule (max 2), 0.5 per focus stop with no visible indicator (max 3), 1 if anything still moves under reduced motion | none (reported) |
| performance | weighted feel rows above | speed max 6 |
| states | share of declared states that rendered, were not blank and differed from default, times 10; minus 2 if any window size overflows horizontally | usability max 7 |
| reliability | 10, minus 1.5 per distinct console or page error (max 8), minus 2 per journey that did not complete | usability max 6 |
| platform | web proxy: 10 x keyboard journeys completed / keyboard journeys declared, capped at 7 and marked partial (no menu probe) | platform max 6 |
| system | token conformance score / 10 | craft max 7 |

## Hard fails

Any of these goes to `hardFails` and caps the overall at 5.5 in the jury:

- a journey step whose `expect` never appeared (no response or ignored input);
- a page error or unhandled rejection during a journey that stopped it;
- a state whose screen is blank because the app crashed (an error boundary or an empty root).

## What the lab does not judge

Anything that needs taste: hierarchy, alignment beyond the token grid, copy, whether a state
is well designed rather than merely present. Those belong to the critic.
