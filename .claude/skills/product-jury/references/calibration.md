# Calibration: how far to trust the critic

**For the agent writing the scorecard, never for a critic.** A critic that knows what a run is
supposed to show scores toward it. Nothing in this file may appear in a brief, and an ablated
run's `ablation.json` stays out of every critic's reach for the same reason.

## Status

**Partly checked, not calibrated.** One planted-defect level (clean vs level2, Moduo,
2026-10-23) is recorded below: the ordering held and four of five planted defects were found by
all three runs. Level1, level3 and the noise floor are not run yet, so every scorecard still says
"Uncalibrated" until Procedure A has a complete row.

What that means for a card: the levels are the critic's reading on an unanchored scale. Treat
them as a ranking of what to fix, not as a grade to compare with other products. The research
behind this skill measured 2023 to 2025 models on mobile screens and websites; none measured a
current model on a dense desktop app.

## Procedure A: planted defects (run first; cheapest, ground truth known)

The lab degrades the app on purpose and the critic must notice. Because the degraded rungs share
the app's own domain, data and visual language, they are the only pairs where the right order is
known for certain.

1. Run the lab four times on the same build and seed: clean, then `--ablate level1`,
   `--ablate level2`, `--ablate level3` (each level stacks more ablations). For sensitivity to
   one defect, run single ablations instead: `--ablate no-focus`, or a comma list. The lab's
   single ablations: `no-focus`, `no-motion`, `jitter-spacing`, `off-tokens`, `system-font`,
   `flat-elevation`, `low-contrast`, `blank-empty`, `layout-shift`, `slow`, `jank`.
2. Score each dossier with the normal workflow: fresh critics, three runs each, never told a run
   is degraded.
3. **Ordering:** overall and the touched categories must fall monotonically from clean to
   level3. Record each level's overall.
4. **Recall:** for each planted ablation, did a confirmed finding name it (right screen, right
   kind of problem)? **Precision:** of the confirmed findings that appeared only in the degraded
   run, how many trace to a planted ablation?
5. **Noise floor:** score the clean dossier a second time with new critics. The spread between
   the two cards per category is the noise floor; a re-score delta smaller than it is "within
   noise".

| Date | Model | Mode | Clean | L1 | L2 | L3 | Monotonic | Recall | Precision | Noise floor |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-23 | Opus 5.5 | generalist x3 | 6.55 (U6 C7 S7 P6 Ch7) | not run | 6.10 (U6 C6 S6 P6 Ch7) | not run | yes, clean > L2 | 4 of 5 ablations, 3/3 runs | not computed | not run |

Moduo build `9cb967b` on the local stack, WebKit headless, 1440x900, the same seed both runs.
Runs within a dossier never differed by more than one level. The overall moved by 0.45 through
Craft (7 to 6) and Speed (7 to 6); Usability, Platform and Character held, which fits: level2
plants no flow or content defects.

| Ablation | Planted on | Found (runs of 3) | Finding id | Notes |
|---|---|---|---|---|
| no-focus | every screen | 3/3 | "focus is invisible" (sev 3) in each run | Clean runs raised only one minor focus-style finding. The lab's focus walk carried it: 0 to about 160 stops without an indicator. |
| jitter-spacing | every screen | 3/3 | misalignment findings | Clean runs raised none. |
| off-tokens | every screen | 3/3 | half-pixel sizes and off-token values | Clean runs also raise token drift (the real 150 ms and 16 px values), so this is weaker evidence. |
| slow | every request | 3/3 | latency findings (click p95 176 ms, view switch 888 ms) | Clean runs raised latency in 2/3, at lower severity. |
| no-motion | every screen | 0/3 | none | Expected blind spot: stills can't show a snap, and the budget rows reward no motion on frequent actions. Only a headed run's frame strips or a human catches it. |

Panel versus generalist: run the same four dossiers with `--panel`. Keep the panel as a default
only if its recall is higher at similar or better precision for the same total number of critic
runs. Record the result here.

## Procedure B: the reference ladder

Score open-source apps of known craft, matched by domain, and check the critic orders them as a
designer does. Apps, setup and the pass criterion are in `ladder.md`. Record each run:

| Date | Model | Track | Pair (higher first, by designer) | Verdict both orders | Runs agreeing | Pinned versions |
|---|---|---|---|---|---|---|
| | | | | | | |

The designer's own blind pairwise ordering of the rungs is the ground truth; reputation alone
is a hypothesis.

## Using the results on a scorecard

- **Calibrated** means Procedure A passed (monotonic, recall recorded) on the current model.
  Write "Calibrated <date>" on the card, with the recall figure. A model change voids it: run
  Procedure A again.
- **An offset** (critic vs designer) is allowed only after Procedure B pairs pass. Compute it as
  the mean gap between the critic's overall and the designer's rating on the same rungs. Report
  the critic's own levels unchanged and the offset estimate beside them ("about 7.1, critic 6.4
  plus 0.7 from n rungs"), never with two decimals.
- **The fix list never changes with calibration.** The strict scale is what makes it useful.
- Never estimate an offset for gate areas: they are measured, not judged.

## Adding a run

Fill a row, recompute the noise floor and offset from every usable row, and keep the reasoning
in one line per run. Note anything that broke the comparison (different seed, window size,
engine, or a changed lab version).
