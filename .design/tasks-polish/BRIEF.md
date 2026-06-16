# Tasks UI/UX rebuild — build brief (Session 11)

**Status:** awaiting Maciej's green light. No code rewritten yet.
**Decisions:** [DECISIONS.md](./DECISIONS.md) · **Element-level audits:** [per-surface](../tasks-polish-audit-raw.md) · [system-level](../tasks-polish-system-audit-raw.md)

## 1. Goal

A maximum-rigor UI/UX quality pass on Tasks. Every element interrogated for form, layout,
color, reusability, and **stackability** (same-size controls share height·radius·font·icon and
align in a row). The output is a **reusable primitive + motion layer** that carries to other
modules — **Notes is the canary (next session)**. Must read as modern under any of the 8 accent
colors. References: **Linear** (dense, quiet, hairline, strong type hierarchy) + **Todoist/TickTick**
(content-first, minimal chrome). Delivery: **one PR**, primitives **shared from day one**.

---

## 2. The "huge on web" question — RESOLVED (it was browser zoom)

**Confirmed 2026-06-13:** the web UI looked "zoomed in" because the Moduo tab was at **125% per-site
page zoom** in the browser (Dia), while linear.app sat at 100%. Proof: `screen.width=1728` ⇒ base
devicePixelRatio 2.0 on the 16″ display, but the tab reported **dpr 2.5** (= 2.0 × 1.25). Measured
element sizes were already Linear-grade (rows 36px, title 13px, heading 18px); they only rendered large
because of the zoom. **⌘0 resolved it. No code needed.** (Two earlier theories — Inter-wider, then
display-role font — were wrong.)

**Demoted to optional quality cleanups (real, but not the cause — do if cheap, not load-bearing):**
1. **Typography-role cleanup** — task titles + content → **body (`font-sans`)**, `font-display` reserved
   for true headings + the Queue/Focus hero (§3b). Worth doing for the content-first Linear feel and so
   the display-font picker only re-skins headings, not the whole surface. (Still recommended.)
2. **The `*` rule** — [global.css:130](../../src/global.css) `* { font-family: "Pilat Extended", … }`
   puts unclassed text into the display fallback; route unclassed text to `var(--font-sans)`.
3. **Pilat is `local()`-only/unbundled** → "Pilat" silently becomes Inter where it isn't installed.
   Decide whether to bundle a web font or label it a local enhancement. (Open.)
4. **Density default — RE-OPENED.** The earlier "default → compact" call was made under the zoom illusion;
   at 100% the comfortable default is already Linear-grade. **Recommend keeping `comfortable` as default**
   and NOT changing the global. Still bind every control to `--ctrl-h*`/`--row-h*` and kill the 13 raw
   `h-7`/`h-8` overrides (token-cleanup stands regardless). *(Awaiting Maciej reconfirm.)*
5. **Appearance sync** (note, not in scope): web and desktop keep separate appearance storage.

---

## 3. The reusable system (foundation — everything sits on this)

### 3a. Control-height ladder (4 rungs, density-aware)
One rung = a fully-specified bundle so any two controls on it stack pixel-perfect.

| Rung | Height token | Font | Icon | Radius | Pad-x | Used by |
|---|---|---|---|---|---|---|
| **XS** | `--ctrl-h-sm` | text-base (14) | `--icon-sm` (14) | rounded-md | `--pad-x-sm` | dense toolbar controls, chips, inline editors |
| **SM** | `--ctrl-h` | text-base (14) | `--icon-sm` (14) | rounded-md | px-3 | default buttons, selects, inputs, segmented |
| **LG** | `--ctrl-h-lg` | text-base (14) | `--icon` (16) | rounded-md | px-4 | hero primary actions (Done-next) |
| **Row** | `--row-h` / `--row-h-sm` | title 15 / meta 12 | `--icon-sm`→`--icon-xs` | — | — | list rows, rail items, cards |

- **Stackability contract:** any `items-center` flex row with ≥2 interactive controls declares ONE rung;
  no two direct-child controls with different size props / `h-*` in one row. First rows to fix: the Plan
  toolbar (was 26/26/**32**/26 → all SM), the detail panel (was mixed sm + raw `h-8` → all one rung).
- **`Input` gains a `size` variant** (`sm`|`md`, mirroring Select) + a `bare` borderless variant — this is
  the root fix that retires all 13 raw `h-7`/`h-8` patches.

### 3b. Typography roles (display vs body) — canonical, lint-encodable
Two families: **display** = `font-display` (chrome/structure), **body** = `font-sans` (content/values/
long-form), **mono** = code & keycaps only.

| Role | Family | Token |
|---|---|---|
| Page/view + dialog heading, Queue/Focus hero | display | text-2xl / hero |
| Section / eyebrow label | display | text-2xs uppercase tracking-wide |
| Control label, Select **value/trigger** | display | text-xs/sm |
| **Task title** (row, card, detail, inline-edit, bucket name) | **body** | **15px** |
| Description / note body / comments | body | text-base |
| Row metadata, captions | body | text-xs (12) |
| Timer / numerics | body + **tabular-nums** | — |

- Flip primitive bases so call sites stop patching: `Label` base → display; `SelectTrigger` base → display
  (drop the 6 redundant `font-display` overrides). `Input`/`Textarea`/`Badge`/`TagChip` stay body.
- Resolves the contradiction at capture-modal (description was display → body).

### 3c. Icon-size ladder (token-bound, density-scaling)
New tokens, scaling with density: `--icon-xs` 12 / `--icon-sm` 14 / `--icon` 16 / `--icon-lg` 20
(comfortable) → 11 / 12.5 / 14 / 16 (dense). Bind primitive defaults to the rung (`button` svg →
`size-icon`), delete per-call `size-4`/`size-3.5` patches. Default `strokeWidth=2` (lucide); the only
sanctioned exception is the check glyph (≤12px in a filled control → 2.5). Icon→label gap: `gap-1.5`
controls, `gap-1` dense meta.

### 3d. Accent-usage policy (modern under all 8 accents; contrast already verified AA)
Accent (`--primary`/`--ring`) appears ONLY on:
1. **One primary action per surface** (New task / Create / Done-next / Commit) — never two competing.
2. **Current selection** in any list/tree (rail active, selected row/card) — quiet left bar + faint tint.
3. **Focus ring** (`--ring`, focus-visible + transient drag/drop only).
4. **Done checkbox** fill (quiet, smaller).

Everything else neutral — **segmented toggles = neutral raised plate**, **priority/energy = neutral
ambient dots** (never hued). Selection recipe (one, shared): `--selected-bg = color-mix(in oklch,
var(--primary) 14%, var(--card))`, `--selected-border = var(--primary)`; hover stays `bg-accent/60`.
**Surface fix:** on near-black the board column/plate fills must sit on a real elevation step (solid
`bg-card`/`bg-muted`, reserve `/30` alphas for plates on already-raised surfaces) — fixes the inverted
board elevation.

### 3e. Motion system (restrained, fade + micro-blur signature)
Keep the 5 durations + 4 eases in tokens.css §12; make them load-bearing (no raw ms/cubic literals).

| Interaction | Property | Duration | Easing | Reduced-motion |
|---|---|---|---|---|
| Row hover-fill, press | background/opacity | `--motion-fast` (100) | `--ease-out` | instant |
| Hover-reveal row actions | **opacity only** (reserve-in-place) | `--motion-fast` | `--ease-out` | instant |
| Overlay/popover/dialog enter | opacity + **blur-in** + 2px rise | `--motion-base` (180) | `--ease-out` | ~80ms fade, no move |
| Mode-shift (Plan→Queue/Focus) | cross-fade + **micro-blur** | `--motion-base` | `--ease-out` | ~80ms fade |
| List↔Board | — | instant | — | instant |
| Check-off (the one delight) | scale 1→0.88→1.06→1 + stroke-draw | `--motion-base` | `--ease-spring` | color only |
| Queue-add settle | icon scale 1→1.08→1 + count tick | `--motion-base` | `--ease-spring`→`--ease-out` | none |

- **Fade + micro-blur motif** (Maciej's ask): overlays/popovers/menus fade + blur-in (~2–4px), hover
  reveals fade in place, mode-shift carries a touch of blur. No bouncy/spring-heavy motion beyond the
  two sanctioned moments. **No sparkle/gradient/glow.**
- **Reduced-motion = kill movement, keep ~80ms opacity/color fades** (retune tokens: zero transforms,
  keep a short opacity duration — change from today's full-zero).
- Standardize **reveal-on-hover** on reserve-then-fade-opacity (never `hidden`→`flex`, which reflows) —
  this kills the "task content moves on hover" defect.

---

## 4. New shared primitives (`src/components/ui/`, stories + visual-test rows required)

| Primitive | Wraps | API sketch |
|---|---|---|
| **FieldShell** (cva fragment) | — | `filled` (default) + **`ghost`** (borderless at rest → hairline+`bg-muted` on hover, ring on focus) + `bare`. Composed by Input/Textarea/SelectTrigger. Modernizes states (drops old `ring-2 ring-offset-2` → `ring-[3px] ring-ring/50`). |
| **SegmentedControl** | shadcn ToggleGroup (`+ toggle`/`toggle-group` via CLI) | `value, onValueChange, size, items:[{value,label?,icon?}], iconOnly?` — replaces the **3 bespoke toggles** (View switch, rail Plan/Queue, execute Pomodoro/Duration). Neutral raised plate. |
| **Calendar** + **DateField/DateTimeField** | shadcn Calendar (react-day-picker via CLI) in Popover | token-routed (selected `bg-primary`, today `ring-1 ring-ring`, hover `bg-accent`). `DateField` = Button trigger + Calendar; `withTime` adds an HH:mm Input. **Replaces all 4 native date inputs** + adds Today/Tomorrow/Next-week presets. |
| **IconButton** | Button `size=icon` + **required Tooltip** | `icon, label, variant, size` — auto aria-label + tooltip. `ghost-quiet` variant (opacity-0 → group-hover). Migrates every bare icon button. |
| **Toolbar** | layout only | `Toolbar.Group / Spacer / Primary` — enforces one rung, one radius, one type role across the control row. |
| **TagChip v2** | restyle existing | drop dot, color the `#` glyph (`.tag-hash { color: var(--label) }`), borderless, `text-2xs`. Active filter chip = full-hue label. |
| **CompleteToggle** | promote bespoke | the animated check primitive (spring pop + stroke draw); used by row/card/detail. |
| **EmptyState** | promote local | `icon, title, description, action?, hint?` (teaching states: "Press `q` to queue"). |

Feature-level (`src/features/tasks/ui/`, promote later if Notes reuses): **PropertyRow** (inline
label→value grid, ghost FieldShell controls), **QuickAction** (reserve-in-place hover/focus row action),
**Queue card**.

---

## 5. Per-surface rebuild (decisions applied)

- **Top toolbar** → `Toolbar`; Group/Columns = DropdownMenu radio (button-shaped), Filter = button,
  view switch = `SegmentedControl`, New task = the one `bg-primary`. All rung SM, one font, one icon size.
- **Task row** → stable grid (no hover reflow); **subtasks indented with a vertical guide** (Linear sub-issue
  style); title body/15; meta icons via ladder; **always-visible quiet "Add to Queue"** `QuickAction`
  (+`q`); dead hover icons removed; TagChip v2; selected = accent bar + tint.
- **Tag chips** → colored-`#` + neutral name, borderless, smaller. Module-wide via TagChip v2.
- **Rail + sections** → section headers stay 11px but **body→display eyebrow** uppercase muted/70 (reads
  smaller/quieter without leaving the scale); rows on `--row-h`; active = selection recipe.
- **Detail panel** → `PropertyRow` (inline label→value), all controls ghost FieldShell, native dates →
  DateField; one `bg-primary` "Commit to Queue"; quieter activity trail.
- **Board** → **Linear-quiet**: transparent columns on the card pane, cards `bg-card` + hairline
  (fixes inverted elevation); **whole card draggable, drag grip removed**; selection recipe parity with List.
- **Capture modal** → Linear-style: remove "New task" band, borderless title (20px display) + body
  description, property pills on one quiet row (neutral fills), footer primary + `⌘↵` hint; keep chrono
  parse + pill pre-fill; dead attachment button hidden.
- **Queue/Execute card** → re-hierarchied for *doing*: title + key details prominent, **timer compact**;
  `SegmentedControl` **Pomodoro | Time-spent** + a static editable **estimate chip**; **time-tracking**
  (§6); pomodoro settings via Settings→Focus + card gear popover; **x/y completed label back at the
  bottom**; **linked section hidden when empty**.

---

## 6. Time-tracking (its own wave — adds backend scope)

Real tracker per Round D: **persisted total + work sessions**.
- Schema: `task_time_entries` (id, workspace_id, task_id, started_at, ended_at, source) + a cached
  `time_spent_seconds` on task (or computed). Hosted migration (Maciej-approved, per the Session 4/8/9 pattern).
- Intent-op: `tasks_op_track_time` (start/stop) following the module contract — edit-permission check,
  invariants, attributed `module_activity`. Runtime methods + **Rust parity**. (MCP tool: optional, defer.)
- UI: stopwatch on the Queue card (counts up = time spent); total + session list in the detail panel.

---

## 7. Build sequence (internal waves, landed as one PR on `t/maciej/session11-tasks-ui`)

1. **Foundation** — font fix, density default, `--ctrl-h`/`--icon`/type tokens, motion-token retune (blur + reduced-motion).
2. **Primitives** — FieldShell, SegmentedControl, IconButton, Toolbar, Calendar/DateField, TagChip v2, CompleteToggle, EmptyState (+ stories + visual-test rows).
3. **Surfaces** — toolbar, row, rail, detail panel, board, capture modal, Queue card (compose primitives).
4. **Time-tracking** — migration + intent-op + Rust + UI.
5. **Verify** — typecheck · vitest · lint:tw · lint:css · build:web · live-verify on hosted across **accents + densities + shades** · `/code-review`.

---

## 8. Remaining small decisions (recommended defaults — adjust on review)

- **DateField time-half:** Scheduled = date + optional HH:mm; Due = date-only; one `DateField` w/ `withTime`.
- **Group/Columns control:** DropdownMenu radio (button-shaped) over ghost Select.
- **Active filter chip:** full-hue label (the one fully-colored tag moment).
- **Capture title size:** 20px display; description body; pills neutral.
- **TagInput wrapper:** display chip unifies now; promote the editable wrapper to shared during Notes canary.

---

## 9. Notes canary (Session 12 — defined now)

Notes adopts: FieldShell + PropertyRow (right-rail properties), TagChip v2 (replaces Badge tags),
SegmentedControl, IconButton (embed controls), the motion system, and Command-in-Popover for the slash
menu. Notes-specific & frozen: Lexical editor internals, XYFlow relation graph. Canary test = the
smallest set of these adoptions that proves the system ports without per-module restyling. Flags: the
`src/tw/` shim and `bg-[#111111]` editor hardcode get tokenized during that pass.
