# The dossier: what one lab run writes

One run of `scripts/lab.mjs` writes one folder, `.lab/<run-id>/` at the project root
(`<run-id>` = `YYYYMMDD-HHMM-<label>`). The folder is evidence about seeded test data only, and it
is gitignored: never commit it, and never copy it into a public place.

Three readers use it, and each one opens a different part:

| Reader | Opens | Never opens |
|---|---|---|
| The blind critic (`/product-jury`) | `critic.md` and only the files it lists | `gates.*`, `impeccable.json`, `ablation.json`, `tokens.json`, `summary.json`, any code |
| The jury's scorecard writer (the main agent) | everything | |
| The builder (`/product-studio`) and the person | everything | |

## Layout

```
.lab/<run-id>/
  critic.md                       the critic's index: Part A (look) then Part B (measurements)
  measurements.md                 raw numbers for the critic: no verdicts, no bands, no scores
  dossier.md                      full index for people and the builder
  summary.json                    engines, viewports, counts, timings, errors, what ran
  gates.json  gates.md            code-computed gate areas (0-10), hard fails, caps to apply
  journeys/index.json             per journey: goal, screen, target, per-mode counts, completed, error
  journeys/<id>/<mode>/NN-<step>.png      one frame per step (mode: keyboard | pointer)
  journeys/<id>/<mode>/trace.json         per step: inputs, interactions, frames, shifts, animations
  states/index.json               per screen and state: path, theme, blank, differs from default,
                                  overflow, console errors, failed requests
  states/<screen>/<state>.png     one frame per state; states/<screen>/sheet.png is the contact sheet
  windows/<screen>-<w>x<h>.png    window-size matrix; windows/sheet.png
  themes/<screen>-<theme>.png     secondary themes and reduced motion; themes/sheet.png
  focus/<screen>/k-NN.png         keyboard focus walk; focus/index.json
  hover/<screen>/h-NN-rest.png    pointer targets at rest and under the pointer;
  hover/<screen>/h-NN-hover.png   hover/index.json says what changed
  overlays/<id>/strip.png         frames of open and close; overlays/index.json (durations,
                                  easing, interrupt result)
  feel.json                       budget rows with samples, p50/p95/p99 and the band
  tokens.json                     token table, harvested observations, families, clusters, score
  tokens/drift-NN.png             crops of the top drift findings
  a11y.json                       axe results per screen and state
  impeccable.json                 optional detector output (builder only)
  ablation.json                   present only when the run was deliberately degraded
```

## critic.md

Written by the lab, read by the critic. It holds, in this order:

1. **Product context** from the config: the product's name is withheld; what it is for, who uses
   it, the platform and its conventions (from `platform` in the config plus the platform brief in
   `references/platform-brief.md`).
2. **Journey goals**: one line per journey, with the goal in plain words and the mode run.
3. **Part A: look first.** Lists every image group with what the file names mean. The critic
   writes its free observations from these files before opening Part B.
4. **Part B: measurements.** Points to `measurements.md`.
5. **What this evidence cannot show**: motion feel beyond the numbers, sound, learning over weeks,
   native menus and window chrome when the run used the web proxy (`engine` says which).

## measurements.md

Raw numbers only, in tables: per-journey keystrokes, clicks and pointer travel against the
journey's shortest-path target; latency samples per interaction class (p50, p95, p99, n); dropped
frames and the longest frame per overlay and journey step; overlay entry and exit durations and
easing; layout shift per interaction; axe violations by impact with the rule ids; focus stops
without a visible indicator; states that rendered blank or identical to the default; horizontal
overflow per window size; the top token-drift findings (value, nearest token, count, where, crop
file). No word like "pass", "fail", "good", "tight" or "band" appears in this file: verdicts belong
to the critic (judgment) or to `gates.json` (code), never to the evidence.

## gates.json

```json
{
  "areas": {
    "accessibility": { "score": 7, "evidence": ["a11y.json: 0 serious, 2 moderate", "..."] },
    "performance":   { "score": 6, "evidence": [] },
    "states":        { "score": 8, "evidence": [] },
    "reliability":   { "score": 9, "evidence": [] },
    "platform":      { "score": null, "evidence": ["proxy run: menus not probed"] },
    "system":        { "score": 8, "evidence": ["token conformance 91 (Tight)"] }
  },
  "hardFails": [ { "kind": "ignored-input", "where": "journeys/capture/keyboard step 03" } ],
  "caps": [ { "category": "speed", "max": 6, "because": "performance gate below 6" } ]
}
```

Gate areas and caps follow `references/budgets.md`. `null` means not measured in this run, never
zero. Hard fails are: an ignored input, an action with no response, lost input, a crash or an
uncaught error that blocks a journey.

## run ids for comparison

The lab never compares runs by itself. `scripts/delta.mjs <old-run> <new-run>` prints a table of
measured deltas (per gate, per budget row, token score, counts) plus findings that appeared or
disappeared, for a PR body.
