# Session 11 continuation — Tasks UI/UX + design-system control

> Paste this into a fresh Claude Code session. You have NO memory of the prior session;
> this is the only context. Read [CLAUDE.md](../../CLAUDE.md) + [DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md) first.

## Where things are
- Branch **`t/maciej/session11-tasks-ui`** → **PR #21** (base `maciej`). Already **merged into local
  `maciej`** so the user can test on `dev:desktop`. Don't push `main`/`develop`; force-push only this
  task branch with `--force-with-lease`.
- Full record: [.design/tasks-polish/](.) — **DECISIONS.md** (read this first), BRIEF.md, TASKS.md,
  and the two raw audits. Session breadcrumb: [docs/archive/build-log-tasks.md](../../docs/archive/build-log-tasks.md) (newest first).
- Improvement plan: [docs/improvement-plan.md](../../docs/improvement-plan.md) — Session 11 is ☑;
  **Notes canary is the next planned session**.

## Locked decisions (do NOT relitigate)
- **One font axis, still customizable** (no display/body split; hierarchy via weight/size).
  Revised 2026-06-14: Session 11 wrongly retired the picker entirely — restored as a single
  `data-font` picker (Geist default; inter/pilat/cal/fraunces/serif/mono).
- **Density-only sizing**: `comfortable/compact/dense`; the **text-size axis was dropped** (one type scale).
- **Mode toggle = Plan / Focus**; the rail list/scope stays **"Queue"** ("Today" was renamed, UI only —
  the internal `committed_for`/`execute`/`selection==="today"` model is unchanged).
- **Accent policy**: accent only on one primary action per pane, current selection (`--selected-bg`
  recipe), focus ring, and the quiet done-check. Segmented toggles + priority/energy stay neutral.
- **Motion**: restrained + a **fade + micro-blur** motif. `fx-overlay` class (global.css) on floating
  surfaces; `--motion-fade` survives reduced-motion, `--blur-veil`→0 under reduced-motion; one delight =
  the check-off `.check-pop`. No spring-heavy / sparkle motion.
- **Process = code-first system lock, NOT per-surface tweaking.** Every control routes through one rung
  (height·font·icon·radius·padding); delete bespoke generations; nested-radius via `calc(--radius-md − Npx)`.
  (Figma source-of-truth + Code Connect was discussed and deferred — revisit if the user asks.)

## Design system anchors (Session 11 additions)
- Control rung: `--ctrl-h*`/`--row-h*` + `font-display`(=Geist now) `text-base` (14px) + `size-icon-sm` +
  `rounded-md`. Type roles + icon ladder + accent policy + motion are documented at the bottom of DESIGN_SYSTEM.md.
- New primitives in `src/components/ui/`: field-shell, segmented-control, icon-button, toolbar, calendar,
  date-field, complete-toggle, empty-state. Plus `src/components/tag-chip.tsx` (v2) and
  `src/features/tasks/ui/level-icons.tsx` (priority/energy glyphs).

## How to verify live (the prior session's recipe — browser was flaky)
1. `bun install` in this worktree, then run the **web** dev server on a FREE port:
   `MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port <free>` (nohup background).
   Teardown by the exact port pattern only.
2. The user's **`dev:desktop` runs from the MAIN checkout (`/Users/maciej/Documents/Coding/moduohyb`)
   on branch `maciej`, port 8081** — it does NOT serve this worktree. After merging to `maciej` +
   `bun install` in main, the user restarts `dev:desktop` to see changes.
3. Drive via the **Claude_in_Chrome MCP**, **Browser 1** (local Mac) — Browser 2 is remote Windows and
   can't reach localhost. Inject the hosted test session (creds + recipe in DECISIONS / build-log Session 2):
   POST to `/auth/v1/token?grant_type=password` with the publishable key, write the JSON to localStorage
   key `sb-wtoonrvuqumihpkbvwvs-auth-token`, reload. **Gotchas:** synthetic `.click()` won't open Radix
   popovers (use a real extension click via `find`+`computer`); restarting rsbuild can poison the origin
   in the browser (use a fresh port); rsbuild's incremental cache sometimes serves a stale chunk after an
   import move (restart with `rm -rf node_modules/.cache`).
4. Gates (all must pass): `bun run typecheck` · `bun run test` (vitest, 91 currently) · `bun run lint:tw`
   · `bun run lint:css` · `bun run build:web`. (Note: `lint:tw` also scans comments — don't put a literal
   `rounded-[6px]`-style example in a comment.)

## Open work, prioritized
1. **User re-test feedback** — the user was testing the full system lock on `dev:desktop`. Start by asking
   what still reads wrong; fix via the primitives, not per-surface hacks.
2. **Time-tracking (Wave 4) — GATED.** Round D chose "persisted total + sessions". Needs a hosted Supabase
   migration (`task_time_entries` + cached `time_spent_seconds` + RLS + a `tasks_op_track_time` intent-op
   following docs/moduo-module-contract.md) + runtime methods + the Focus-card stopwatch (Time-spent mode)
   + a static duration **estimate chip** + Pomodoro settings (Settings → new Focus section). **Do NOT apply
   the migration to hosted without Maciej's explicit go-ahead** (pattern: Sessions 4/8/9). Tasks are
   Supabase-direct on web+desktop — **no Rust** needed.
3. **Full inline PropertyRow grid** in the detail panel (currently the cleaned stacked `Field` + ghost
   controls; the decision was label-left / value-right).
4. **Fold the row `MetaChip`** into a primitive; tidy `appearance.ts` (remove the inert
   `fontDisplay/fontBody/textSize` fields + Storybook text-size toolbar).
5. **Visual-test baselines** — rows exist in tests/visual/primitives.spec.ts; generate PNGs via a
   Storybook + Playwright `--update-snapshots` run and commit them.
6. **Bucket prefixes/IDs** (Linear's JND-77) — separate opt-in feature, off by default.
7. **Notes canary** — adopt these primitives in Notes to prove portability (the planned next session).

## Git/PR
Format: concise present-tense imperative subjects; `Co-Authored-By: Claude <noreply@anthropic.com>` trailer.
Merge each chunk to local `maciej` (ff) so `dev:desktop` testing stays current; PR #21 is the review vehicle.
