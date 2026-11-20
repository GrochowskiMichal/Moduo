---
name: product-jury
description: The blind product jury, an engine of /product-studio (not a command of its own). Fresh critics that never see the code read a lab or prototype dossier and score Usability, Craft, Speed and feel, Platform and keyboard, and Character; code-computed gates cap the scores and a ranked fix list comes back. Read it when /product-studio scores a module or a prototype. To ask for a critique, use /product-studio criticise <module>.
user-invocable: false
---

# /product-jury

Score a product app the way a skeptical design lead would after a day of use: from what the
running app shows and what the lab measured, never from the code, the design notes or what the
builder meant. Return a scorecard with evidence for every number and a ranked fix list.

**The score is an estimate.** No product-app award publishes numeric scores, so nothing outside
this skill anchors the scale. Say on every card whether the critic is calibrated: read the status
in `references/calibration.md` (it stays "uncalibrated" until a ladder or planted-defect run is
recorded there).

**Skill root:** the directory holding this file (`$SKILL`; substitute the absolute path). The lab
lives next to it: `$SKILL/../product-lab/` (scripts, the dossier contract in
`references/dossier.md`, the config contract in `references/config.md`).

## Blind to the build, not to the task

Anyone who knows what an app is meant to do scores the intent instead of the screen, and the
model that built a screen favours its own work. So the critic sees only what the lab wrote for it
in `critic.md`. That file does give it the product's purpose, its users, the platform conventions
and every journey's goal: misreading platform conventions was the largest source of false
findings in the research, and a goal is part of the task, not a pitch. If the user explains
the design idea, hold it until the score is in (step 6).

## Workflow

### 1. Target

`/product-studio` runs this workflow for both the live app (its phase 2) and its prototypes (its
phase 6, with the prototype note in `references/critic-brief.md`).

- **An existing run:** a `.lab/<run-id>/` folder from `/product-lab`. Use it if it is from the
  build being judged; if the code changed since, run the lab again.
- **No run yet:** run the lab first (it seeds, signs in, drives the journeys and writes the
  dossier). The project needs a `lab.config.mjs` (see the lab's `references/config.md`):

  ```bash
  node $SKILL/../product-lab/scripts/lab.mjs --label jury
  ```

  The last line it prints is the dossier path. Score a production build, never a dev server.
- **Several builds** ("before vs after", "ours vs theirs"): one dossier and one set of fresh
  critics each, then put the cards side by side.
- **No seeded backend:** stop. The lab screenshots everything it sees, so it only runs against
  local or disposable data. Ask for a local stack or a seeded account.

### 2. Check the evidence is real

Open `summary.json`, `states/<first screen>/sheet.png` and the first journey's first frame.
Stop and tell the user when the frames are blank, show a login wall, an error page or a
crash screen, or when `summary.json` lists errors that stopped the journeys. A cookie or consent
prompt is not a reason to stop: users see it too. When the run was ablated (`ablation.json`
exists), say so: a degraded run scores for calibration only.

### 3. Run the critics

Critics are fresh subagents (Agent tool, `general-purpose`), launched together in one message so
they run in parallel. Each gets only the brief from `references/critic-brief.md` with three
absolute paths filled in: the rubric (`$SKILL/references/rubric.md`), `critic.md` and the
dossier folder. Nothing else reaches a critic: not `gates.json`, `impeccable.json`,
`ablation.json`, `tokens.json`, `summary.json`, `dossier.md`, code, diffs, `DESIGN.md`,
`PRODUCT.md`, a PR description, an earlier scorecard, `calibration.md`, or your own opinion.

- **Default:** one generalist critic, run three times (three subagents, same brief).
- **`--panel`:** the four role critics from the brief (newcomer, power user, design lead,
  accessibility auditor), three runs each (twelve subagents), then one chair subagent with the
  chair brief. Use the panel at milestones and redesigns. It is unproven against a single
  critic: until `calibration.md` records that it finds more planted defects at the same budget,
  report which mode ran.
- **Re-runs** pass the user's list of dismissed findings into the brief's `<dismissed>` slot, so
  later critics don't raise them again under another name.

**Without subagents**, and only then, score it yourself under the same brief, from the evidence
alone, before reading any code or design notes, and mark the card "self-score, not blind". If
you built or edited this app in this conversation, a self-score is never blind: say so.

### 4. Merge the runs (you are the chair, or the chair subagent is)

Follow the chair rules in `references/critic-brief.md`:

- **Confirmed** findings were raised in at least two of three runs (same screen, same problem).
  Single-run findings stay **candidates**, listed separately.
- **Verify every citation:** open the cited file or field. Drop a finding whose evidence doesn't
  exist or doesn't show the problem.
- **Severity comes from evidence**, Nielsen 0 to 4: blocks a journey or loses input is 4;
  recurs on several screens or stops a main task is 3; and so on. A critic's own label is a
  hint, not the answer.
- **Category levels:** take the median of the three runs per category. When runs differ by two
  levels or more, write "unstable" next to that category.

### 5. Apply gates and caps by arithmetic

Read `gates.json` only now, after the critics are done. Weighted overall = 0.30 Usability + 0.25
Craft + 0.20 Speed and feel + 0.15 Platform and keyboard + 0.10 Character, with "below 6" counted
as 5. Then apply, in order:

1. Each `caps[]` entry: lower that category to `max` if it is above it.
2. Any `hardFails[]` entry, or a confirmed severity-4 finding: the overall is at most 5.5.
3. A gate area of `null` is "not measured": list it, never treat it as zero.

Recompute the overall after the caps. Report the critic's raw overall and the capped overall.

### 6. Scorecard

Write `.lab/<run-id>/jury/scorecard.md` (and each critic's JSON in `.lab/<run-id>/jury/runs/`),
then give the same card in chat:

```markdown
# Product jury: <what was scored, e.g. "build:web at a1b2c3d">
Estimate. <Uncalibrated | Calibrated <date>: see calibration>. <Generalist x3 | Panel 4x3 + chair |
Self-score, not blind>. <n> journeys, <n> screens, <engine(s)> on <date>.

**The idea, as the critics read it:** one sentence (the most common reading; note disagreement)
**Overall: 6.4** (critics 6.7; capped by: Speed and feel max 6, performance gate 5)

| Category | Level | Evidence |
|---|---|---|
| Usability (30%) | 7 | journeys/capture-task/keyboard/03-task-saved.png: ... |
| Craft (25%) | | |
| Speed and feel (20%) | | |
| Platform and keyboard (15%) | | |
| Character (10%) | | |

| Gate (computed by code) | Score | Evidence |
|---|---|---|
| Accessibility | | |
| Performance | | |
| State coverage | | |
| Reliability | | |
| Platform conformance | | |
| System conformance | | |

## Fixes, most score first
1. [Usability · sev 3 · harden] states/tasks/error.png: what is wrong, and what to change
2. ...

## Candidates (one run only)
## Cannot judge from this evidence
## Measured
Hard fails, p95 latency per class, dropped frames, axe serious/critical, overflow, token
conformance, keystrokes vs target per journey (from gates.json and measurements.md).
```

Order fixes by expected score gain: a fix that lifts a capped category or clears a hard fail
comes first, then by severity times the category weight. Each fix names one evidence file, what
is wrong, what to change, and a fix move from the rubric's vocabulary.

Then, in chat only:

- If the user told you the design idea, one line: does the critics' reading match? If not, the
  app isn't saying it, and that is the first Character fix.
- The two fixes that would move the overall most.
- An offer: fix the list here with `/product-studio`, or re-run the lab after changes.

### 7. Re-scoring after fixes

- Run the lab again, then **new** critics. Never reuse a critic or show it an earlier card.
- Rename the old card to `scorecard-<n>.md` before writing the new one.
- **Deltas come from measurements:** gates, budget rows, token conformance, keystroke counts and
  the list of findings that appeared or disappeared (`$SKILL/../product-lab/scripts/delta.mjs
  <old-run> <new-run>`). Critics are near chance on close before/after pairs, so report a change
  in a holistic category level only when it is larger than the spread between that run's three
  critics. Otherwise write "within noise".

## Rules

- **No evidence, no points.** Every level above 6 cites a frame or a measurement. Start every
  category at 6 and make the evidence earn each step up.
- **Don't argue a score up.** Dispute a level only by pointing at a file the critic misread.
- **Judge the app on screen.** Fix what is there; propose no new concept or redesign.
- **Specific, not cruel:** "states/tasks/empty.png: the empty list shows only a grey line; say
  what a task is and offer the capture shortcut", never "the empty state needs work". Someone
  made this.
- **Measurements win over impressions** on anything the lab measured (latency, frames, tokens,
  keystrokes, contrast). Critics judge what only a person can: hierarchy, clarity, care in every
  state, the idea.
- **Seeded data only.** Never run the lab against production or a real person's account, and
  never commit or publish a dossier.
