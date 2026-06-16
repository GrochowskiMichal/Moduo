# Session 11 — Tasks UI/UX rebuild: decisions log

Running record of decisions made with Maciej before any code is rewritten.
Source audits: [../tasks-polish-audit-raw.md](../tasks-polish-audit-raw.md) (per-surface),
[../tasks-polish-system-audit-raw.md](../tasks-polish-system-audit-raw.md) (system-level).

## RESET — design-system control (Maciej, 2026-06-13, after testing the merge)
Maciej: components still feel sloppy / not one system, despite shadcn. Root cause:
shadcn is primitives + tokens, NOT an enforced system; the module stacks ~3
generations (bespoke → shadcn → Session 11), per-call overrides, and **no
composition layer** (a shared control "rung"). Decision = stop polishing surfaces,
**lock the system**, and give Maciej direct visual control. Four calls:
- **Process = Figma source-of-truth + Code Connect.** Build the canonical component
  set in Figma (Maciej edits visually) → implement code to match → Code Connect maps
  each Figma component to its file so they can't drift. *(Needs a Figma file from Maciej.)*
- **Fonts = ONE family everywhere, but still customizable.** Drop the display/body
  split; hierarchy via weight/size only. **REVISED 2026-06-14:** Session 11 over-shot
  by retiring the picker entirely (hardcoded Geist) — Maciej still wants a font picker,
  just a single axis (one face for the whole UI), not two. Restored as `data-font`
  (geist default; inter/pilat/cal/fraunces/serif/mono) with a single Settings picker.
- **Sizing = keep density (comfortable/compact/dense), DROP text-size axis.** One type
  scale; density still adjustable. (Revises the "density is an axis" + Round A text calls.)
- **Mode toggle = Plan / Focus** (the rail list stays "Queue"; "Queue" as a *mode* read wrong).
- Also: "New task" → **"New"/"Add"**; **icon-only** List/Board switch; bucket prefixes/IDs
  = optional, **off by default**, separate small feature.

**Enforcement plan:** one control-rung recipe every control routes through (nested-radius
math, non-clipping focus ring); delete all bespoke generations; lint bans raw control
heights/fonts; Storybook visual-regression gate. Apply the motion system for real
(fade/blur on popovers/dialogs/mode-shift — Session 11 tokenized but barely wired it).

## Goal (Maciej, 2026-06-13)
Full UI/UX quality pass on Tasks, run with maximum rigor. Interrogate every element for
form / layout / color / reusability / **stackability** (same-size controls must share
height·radius·font·icon-size and align in a row). Everything must become **reusable
primitives** that carry to other modules; **Notes is the canary**. Must look modern under
any of the 8 accent colors. Plan **micro-interactions / motion** as a reusable layer.
References: **Linear** (dense, quiet, hairline, strong type hierarchy) + **Todoist/TickTick**
(content-first, minimal chrome).

## Settled
- **Queue naming** — the execution queue is **"Queue"** (drop "Today"/sunrise). Mode toggle
  **Plan / Queue**; verbs "Add to queue" / "Queued"; icon **ListChecks/Layers**. Keeps the
  `committed_for(date)` model — UI rename only.
- **Board look** — **Linear-quiet**: transparent columns on the card pane; cards = `bg-card`
  + hairline border. Fixes the inverted elevation (cards were `bg-background`, darker than
  columns). Board reads like List-with-columns.
- **Form fields** — **Ghost until focus**: borderless/transparent at rest; hairline + ring on
  hover/focus. Applies to detail-panel properties, capture modal, inline editors. (Sets the
  default `FieldShell` variant for detail panels.)
- **Tag chips** — **Colored `#` + neutral name**: drop the dot, color only the `#` glyph in
  the tag hue, name stays neutral foreground; borderless, no pill. (Full-hue reserved for the
  active filter chip, pending the tag-depth confirm.)

## The "huge on web" cause — RESOLVED: browser per-site zoom (confirmed 2026-06-13)
**It was Chrome/Dia per-site page zoom at 125%, not fonts, not density, not a bug.** Evidence:
`screen.width=1728` → 16″ MBP base devicePixelRatio = 2.0, but the tab reported dpr **2.5**
(2.5/2.0 = 1.25× zoom). Measured element sizes were already Linear-grade (rows 36px, title 13px,
heading 18px) — they only *looked* big because the tab rendered them at 2.5× device-px while
linear.app sat at 100%. ⌘0 (reset zoom) fixed it. (My earlier two theories — "Inter 18% wider"
then "display-role font" — were both wrong; logged for honesty.)

**Demoted to quality cleanups (real, but NOT the cause):** the `*{font-family:Pilat}` rule
(unclassed text → body), typography-role over-application (still do titles→body for content-first
feel + sane font-picker), and Pilat being `local()`-only/unbundled. **Density default change is
now in question** — see Round A note.

## Round A — sizing/type/icon ladder (settled)
- **Density default → KEEP `comfortable`** (no global `DEFAULT_APPEARANCE` change). At 100% zoom the
  default is already Linear-grade; the "huge" was browser zoom. The density axis still lets users go
  compact/dense. **Token cleanup stands regardless:** bind every control to `--ctrl-h*`/`--row-h*` and
  kill all 13 raw `h-7`/`h-8` overrides.
- **Task titles = body (Geist).** In-list/card/detail-title/inline-edit/bucket-name titles use the
  body font; display (Pilat) reserved for the Queue/Focus hero + page/dialog headings.
- **Base UI text = 14px (text-base).** Inputs, selects, control labels, row metadata at 14px;
  task title 15px. (shadcn parity, slightly roomier than Linear's 13.)
- **Meta icons = 14px, scaling with density** (14 comfortable → 12 dense), bound to the control-
  height ladder. Establishes the icon-size ladder Notes also inherits.

## Round B — accent usage policy (settled)
Accent (`--primary`/`--ring`) appears in exactly four places; everything else neutral:
- **Current/selected task** — quiet left accent bar + faint accent tint (marks "where you are").
  Done checkbox stays accent-filled but smaller/quieter (no longer the loudest thing).
- **One primary action per pane** — detail panel "Commit to Queue" + capture submit = `bg-primary`.
- **Focus ring** — `--ring` (already).
- **Segmented controls** (Plan/Queue, List/Board, Pomodoro/Duration) = **neutral raised plate**, no hue.
- **Priority / energy** = **strictly neutral** ambient dots (weight varies, never hued; "mirrors not walls").

## Round C — motion philosophy (settled)
- **Restrained, with a fade + micro-blur signature.** One delight moment only: check-off/complete
  gets a single spring pop. Everything else = quiet ease-out. Maciej loves **fade + blur, even at
  micro scale** → make it a motif: overlays/popovers/dialogs **fade + blur-in**, hover reveals
  fade in place, the mode-shift carries a touch of blur. No spring-heavy / bouncy motion.
- **Instant views, animate the mode-shift.** List↔Board = instant (keyboard-snappy); Plan→Queue/
  Focus = ~180ms cross-fade (+ micro-blur).
- **Reduced motion = kill movement, keep tiny fades.** No transforms/springs/slides; retain ~80ms
  opacity/color fades so state still registers. (Changes the current token behavior, which zeroes
  everything — reduced-motion will zero transforms but keep a short `--motion` for opacity.)
- **Numerics = body font + tabular-nums** (timer, counts) — no width jitter, stays on-system.

## Round D — Queue/Execute card (settled)
- **Time-tracking = persisted total + sessions.** Real tracker: per-task accumulated total + start/
  stop work sessions. Needs a `task_time_entries` table (+ total) + a `tasks_op_track_time` intent-op
  (Rust parity, activity attribution per the module contract). Survives reload. **Adds backend scope
  to this effort — sequence as its own wave with a hosted migration (Maciej-approved, per pattern).**
- **Timer = 2 modes + estimate chip.** Pomodoro (work/break) and Time-spent (stopwatch up). "Duration"
  becomes a static, editable **estimate chip**, not a running countdown — resolves the duration/timer
  conflation.
- **Pomodoro settings = global prefs + inline popover.** Persisted user prefs in Settings → new **Focus**
  section (work/break/long-break interval/auto-start/sound); a card gear popover edits the same values.
- **Queueing = always-visible quiet button.** Persistent, quiet "Add to Queue" affordance on each row/
  card (ghost icon, darkens on hover/focus) — discoverable for ADHD. Context menu + `q` key secondary.
  Replaces right-click-only.

## Round E — reuse / Notes canary scope (settled)
- **Tasks now, Notes next.** Session 11 = Tasks rebuild + the shared primitives. Session 12 = Notes
  canary (adopt the primitives, prove portability, fix gaps).
- **One big PR.** Single branch `t/maciej/session11-tasks-ui` → one PR (built in internal waves, landed together).
- **Primitives shared from day one.** Generic primitives go straight into `src/components/ui/` with
  Storybook stories + generic (non-task) APIs: SegmentedControl, FieldShell, DateField, Calendar,
  IconButton, TagChip v2, PropertyRow. Task-specific compositions (QuickAction, Queue card) stay in
  `src/features/tasks/ui/`.
- **PropertyRow = inline label → value** (dense, Linear-style, scannable). The detail-panel + Notes
  property pattern.

## Remaining small decisions (recommended defaults — confirm on brief review)
- **DateField time-half**: recommend Scheduled = date + optional time (HH:mm token Input); Due = date-only;
  one `DateField` with a `withTime` prop. Replaces all 4 native pickers + adds Today/Tomorrow/Next-week presets.
- **Group/Columns toolbar control**: recommend shadcn DropdownMenu radio trigger (button-shaped, pairs with
  Filter) over the ghost Select — unifies the toolbar on Button-shaped triggers + the SegmentedControl.
- **Active filter chip**: recommend full-hue label (the one place a tag goes fully colored), vs the neutral
  display chips.
- **Capture modal**: recommend remove the "New task" band (title is the top, Linear-style); title 20px display,
  description body; property pills = quiet neutral fills (priority/energy stay neutral per accent policy).
- **TagInput ownership**: recommend display chip (TagChip v2) unifies now; promote the editable TagInput wrapper
  to shared during the Notes canary (when a 2nd consumer exists).
- Round B — accent usage policy (selection, segmented active, priority, panel CTA)
- Round C — motion philosophy (intensity, view-switch, reduced-motion, timer digits)
- Round D — Queue/Execute card (time-tracking scope, pomodoro model, settings, queueing affordance)
- Round E — reuse/Notes canary scope (primitive promotion boundary, Notes-in-scope-this-session, TagInput ownership)
