---
name: product-lab
description: Run the product lab on a desktop or web app (works behind a login). It drives the running app through declared screens, states (empty, loading, error, offline, dense, long content, first run), journeys (keyboard-only and pointer-only) and overlays. It writes an evidence dossier and computes gate scores by code for accessibility, performance and feel, state coverage, reliability, platform and design-token conformance. Use after UI changes to a product app, before a PR for a measured before/after delta, to set up a project's lab.config, or as the evidence step of /product-jury and /product-studio. It measures; it never judges taste. For marketing sites use /jury.
---

# /product-lab

The lab is the half of product QA that needs no model. It operates the app the way a scripted
user would and turns what it sees into evidence: frames, contact sheets, traces, and numbers
with budgets. The blind critic (`/product-jury`) reads that evidence; the builder
(`/product-studio`) fixes against it. Wherever a measurement can capture something (latency,
motion, keystrokes, token values, focus, overflow), the lab measures it so the critic never has
to guess it from a screenshot.

**Skill root:** the directory containing this file (`$SKILL`). Scripts need Node 22.6+, plus
Playwright (and axe-core for the accessibility pass) resolvable from the project. Run every
command from the project root.

## 1. Config

The project describes itself in `lab.config.mjs` (or `.ts`): purpose, users, platform, how to
serve a production build, how to seed and sign in, screens with their states, 10-15 essential
journeys, overlays to time, and the token files. `references/config.md` is the contract.

- Found in order: `--config`, `./lab.config.{mjs,ts}`, `./e2e/lab/lab.config.{ts,mjs}`.
- No config yet: `node $SKILL/scripts/lab.mjs --init` writes a starter. Fill every TODO before
  trusting a run. Ask the person only for what the code can't tell you: which journeys matter
  most, and what a test account may see.
- **Seeded data only.** Point it at a local or disposable backend. Never production, never a
  real person's account: the dossier screenshots everything.

## 2. Run

```bash
node $SKILL/scripts/lab.mjs --label <name>                 # everything, default engine
node $SKILL/scripts/lab.mjs --only states,tokens,a11y      # a subset
node $SKILL/scripts/lab.mjs --screens tasks --journeys capture-task
node $SKILL/scripts/lab.mjs --headed                       # frame timing (row 10) needs a real window
node $SKILL/scripts/lab.mjs --engine chromium              # layout shift and long frames (Chromium only)
node $SKILL/scripts/lab.mjs --ablate level2                # planted defects, for calibration
```

- The last line printed is the dossier path, `.lab/<run-id>/`.
- Default engine: WebKit for `macos-desktop` (Safari's engine is the closest stand-in for a Tauri
  or WKWebView app), Chromium otherwise. Run Chromium as a second pass when you need layout
  shift or long-animation-frame numbers.
- Always a production build, never a dev server: dev overlays and unminified code distort
  every number. The config's `server.command` starts one when `baseURL` doesn't answer.
- A full run on 8 screens takes several minutes. Narrow it with `--only`, `--screens` and
  `--journeys` while iterating; run everything before a PR or a jury.

## 3. Read the dossier

Open `dossier.md` first (gates, hard fails, caps, feel table, token families), then the
sheets. `references/dossier.md` lists every file and who may read it.

- **Hard fails** come first: a journey step whose result never appeared, a crash, an error that
  stopped a journey. Fix these before anything else.
- **Gates** (0-10, `null` = not measured) follow `references/budgets.md`. 8+ is the bar.
- **Look at the frames yourself** before believing a gate: a state that "rendered" can still be
  the wrong screen. The contact sheets are in `states/*/sheet.png`, `journeys/*/*/sheet.png`,
  `focus/*/sheet.png`, `hover/*/sheet.png` and `overlays/*/strip.png`.
- `tokens.json` lists the most frequent off-token values with the nearest token and crops.
  Near-misses (a value just beside a token) are the strongest sloppiness signal.

## 4. Compare runs

```bash
node $SKILL/scripts/delta.mjs .lab/<before> .lab/<after>
```

It prints a Markdown table of measured deltas (gates, feel rows, token conformance, journey
input cost, axe rules fixed or introduced) for a PR body. Use deltas, not critic scores, to
judge a single change: a model's verdict on two nearly identical builds is close to chance.

## 5. Calibrate with planted defects

`--ablate level1|level2|level3` (or a list: `no-focus`, `no-motion`, `jitter-spacing`,
`off-tokens`, `system-font`, `flat-elevation`, `low-contrast`, `blank-empty`, `layout-shift`,
`slow`, `jank`) degrades the same app on purpose and records it in `ablation.json`. Each level
must lower the gates it targets; if one doesn't, the instrument is blind there. The jury uses
the same ablations to measure the critic (`/product-jury`, references/calibration.md).

## Rules

- Never commit `.lab/`. It is evidence of seeded data, not source (add it to `.gitignore`).
- Never tune a budget, a weight or a gate to make a run pass. Change `references/budgets.md`
  and `scripts/lib/report.mjs` together, with a reason, and re-run the ablations.
- The critic never reads `gates.json`, `tokens.json`, `impeccable.json` or `ablation.json`;
  `critic.md` already lists what it may open.
- `--impeccable` (Chromium only, experimental: not yet run end to end) runs Impeccable's pinned
  detector (`npx impeccable@4.7.0 detect --cdp`) on each screen and writes `impeccable.json`
  for the builder. It downloads Impeccable's engine on first use, never reaches the critic, and
  the project's own design rules win over its findings.
- Platform conformance is partial on the web stand-in: native menus, window chrome and
  system shortcuts need the native layer, which this lab does not drive yet. The gate says so.

## Reference map

| File | Read when |
|---|---|
| `references/config.md` | Writing or changing a project's lab config |
| `references/dossier.md` | Reading a run, or handing one to the jury |
| `references/budgets.md` | Interpreting gates and feel rows, or changing a budget |
| `references/platform-brief.md` | What platform conventions the critic is told to expect |
