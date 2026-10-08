---
name: moduo-design-quality
description: Enforce Moduo's design system AND build/redesign UI with taste. Audits or fixes changed components against src/styles/tokens.css + docs/DESIGN_RULES.md (R1–R10) — flags raw hex / arbitrary Tailwind / inline-style color / motion-token bypass / anti-slop, checks relational rules a regex can't, and returns a severity-bucketed Before/After report. Modes audit (default) · polish (audit+fix) · build-with-taste · motion-pass. Use after editing UI, before shipping, for a token/quality pass, or to craft a token-driven component. NOT for planning, IA, briefs, or running the design process from scratch — that is /s1 (with the prototype skill or /design).
---

# moduo-design-quality

The enforcement-plus-taste layer for Moduo's frontend (a product app — Tauri + shadcn/ui + React; **not** landing pages or brand work). It checks changed components against the live design system and, when building, ships token-driven UI with taste. It audits/fixes against an existing system — it does **not** invent visual direction or run the design process (that's `/s1`).

**Always read first:** `src/styles/tokens.css` (the value source), `docs/DESIGN_RULES.md` (relational rules R1–R10), and a neighbouring component (match its patterns). Use the shadcn primitive in `src/components/ui/` where one exists; never roll your own. If a needed value is missing, **add it to `tokens.css`** — never inline it.

## Modes

| Mode | Does | Output |
| --- | --- | --- |
| **audit** *(default)* | Read-only. Tier-1 lint + Tier-2 judgment over changed `src/**`. No edits. | The report below. |
| **polish** | audit, then **fix** — token-route hardcodes, swap to shadcn primitives, close interaction-state gaps. | Edits + report of what changed. |
| **build-with-taste** | New/redesigned component, token-driven from the start (see Build). | Working code + a short self-audit vs R1–R10. |
| **motion-pass** | Apply the motion rules across a surface. | Edits + a motion-only Before/After table. |

## Enforcement

**Tier 1 — deterministic (run these, they gate CI):**
- `bun run lint:tw` — arbitrary Tailwind + inline-style hardcodes (raw hex across every color utility, arbitrary font-size/radius/spacing/shadow, motion-token bypass `duration-200`/`duration-[180ms]`, static `style={{ color: "#…" }}`). The `[var(--token)]` escape hatch and one-off geometry (`top-`/`h-`/`w-`/`translate-[…]`) are allowed by design.
- `bun run lint:css` — Stylelint: no hex / non-token color in CSS.
- For a flagged value, suggest the **nearest token** (`text-[12px]`→`text-xs`, a `#cfcfcf`→`text-muted-foreground`). Drift = a near-miss hardcode, not just any literal.

**Tier 2 — judgment (what a regex can't see; this is the skill's real value):**
- **Relational rules** R1–R10 from `docs/DESIGN_RULES.md`: control-rung bundle (R1), radius-by-role + concentric inner radius (R2/R3), type roles + `tabular-nums` (R4), accent-usage policy — accent only on primary action / selection / focus ring / done-check (R5), motion signature (R6), density via vars not `h-9` (R7), sentence case (R8), single font (R9), tokens-only (R10).
- **Contrast** (needs render — live-verify or Storybook): body ≥4.5:1, large ≥3:1, placeholders ≥4.5:1.
- **Interaction states:** every interactive element ships default/hover/focus/active/disabled/loading/error; skeletons not spinners; empty states teach.
- **Overflow/clipping** (popover/portal inside `overflow-hidden`), spacing rhythm, heading order.

## Report format (always this shape)

```markdown
## Design quality report — <target>
**Verdict:** <one honest line: does this hold up against Linear/Notion-grade UI?>
**Issues:** P0 <n> · P1 <n> · P2 <n> · P3 <n>  ·  Tokens: <n> hardcoded, <n> off-scale

### P0 — Blocking
| Before | After | Why · file:line |
| --- | --- | --- |

### P1 — Major (token drift / WCAG AA / control-rung)   (same table)
### P2 — Minor   (same table)
### P3 — Polish  (same table)

### Systemic
- <recurring root cause, e.g. "raw hex in N components — none route through tokens.css">
### Kept / good
- <what already aligns — don't only criticize>
```

Severity: **P0** blocks the task · **P1** major / WCAG AA, fix before release · **P2** annoyance w/ workaround · **P3** nice-to-fix. One `| Before | After | Why |` row per issue (never separate "Before:"/"After:" lines). Name every fix by **root cause**: *missing token* (add to tokens.css), *one-off* (swap to the shared primitive), or *conceptual misalignment* (flow/IA/hierarchy doesn't match neighbours).

## Motion (token-driven — never raw ms/cubic)
- **Animate at all?** Keyboard/high-frequency actions → never. Occasional (modal/drawer/toast) → standard. Rare → may delight.
- **Easing:** enter/exit → `--ease-out`; on-screen move → `--ease-in-out`; never `ease-in` on UI. **Duration < 300ms** for product UI (button 100–160 · popover 125–200 · dropdown 150–250 · modal 200–500), via `--motion-*`.
- **Never `scale(0)`** → start `scale(0.95)` + `opacity:0`. Animate only `transform`/`opacity`. Origin-aware popovers (`--radix-*-transform-origin`). `:active { transform: scale(0.97) }`. Transitions (not keyframes) for interruptible UI.
- **`prefers-reduced-motion` = fewer/gentler, not zero** — keep opacity/color, drop movement. Reveal-on-hover reserves space + fades (never `hidden`→`flex`). The check-off `.check-pop` is the one sanctioned delight.

## Anti-slop (product app — checkable)
No `transition: all` (name props) · no bounce/elastic easing · no gradient text · no nested cards (flatten with spacing/dividers) · no icon-tile-above-heading cards · no glow/sparkle accents, and no AI colour or badge (there is no "AI disc"; brand decision 40) · no display font in labels/buttons/data · no reinvented standard affordances (weird modals — exhaust inline/progressive first; the thin token scrollbars in global.css are the system default, so never restyle a scrollbar per component: use `.no-scrollbar` to hide one and `.pane-scroll` on a pane's main scroller) · no `useState` for continuous scroll/pointer values · placeholder is never the label · use `-` not `—`.

## Build (build-with-taste / polish-new)
Token-driven from line one. Match the **shape** of the experience, not just the surface: progressive disclosure, the right flow (modal vs route, save-on-blur vs submit), same conceptual weight → same visual weight as adjacent features, same nouns/verbs. Product register: one well-tuned sans carries everything; restrained color (accent = primary action / selection / state only, never decoration); responsive = structural (collapse the sidebar), not fluid type. **Taste bar:** would a user fluent in Linear/Notion/Raycast trust it, or pause at every subtly-off control? The tool disappears into the task.

## This skill is not the design process
It works on **changed components against an existing token + rule system**. It does not grill, write briefs, do IA, pick a design direction from scratch, or run phases 1–6. If the task is "plan/design a new feature from zero," that's `/s1`.
