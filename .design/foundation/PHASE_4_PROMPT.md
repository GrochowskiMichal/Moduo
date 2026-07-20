# Phase 4 — Notes page redesign

> Paste this into a fresh Claude Code session. It is self-contained — the agent has no
> memory of prior sessions.

I'm starting Phase 4 of the design-foundation rebuild. The plan lives at
[.design/foundation/TASKS.md](.design/foundation/TASKS.md), Phase 4 section. The hard
design rules are in [CLAUDE.md](../../AGENTS.md), the system reference is in
[DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md), and the brief is in
[.design/foundation/DESIGN_BRIEF.md](.design/foundation/DESIGN_BRIEF.md).

**Read these first**, in order: CLAUDE.md → DESIGN_BRIEF.md → TASKS.md (Phase 4 section
only) → REVISION_DELTA.md.

## Precondition — verify before doing any Phase 4 work

[.design/foundation/REVISION_DELTA.md](.design/foundation/REVISION_DELTA.md) captures
design revisions from the Phase 3 verification session. Several of those revisions
affect the app shell that Notes will compose against — specifically direction changes
#1 (top bar on `bg-background`), #2 (only panels carry surface chrome), #3 (zero padding
between regions), #6 (drop icon-rail mode + add resizable handles), and #7 (strip all
per-route content from the top bar). **Phase 6.5 in TASKS.md is the dedicated session
that processes that delta.**

Before you do any Phase 4 work, check whether the shell-affecting delta sections have
landed:

- [FeaturePanelsShell](./src/components/app/feature-panels-shell.tsx) should no longer
  reference `var(--width-sidebar-icon)` or have a `"icon"` rail mode.
- [AppChrome](./src/components/app/app-chrome.tsx) should NOT wrap the top bar in
  `bg-card border-b border-border`, and the chip-render blocks in the tab loop should
  be gone.
- [AppChromeMenus](./src/components/app/app-chrome-menus.tsx) should be deleted.
- The horizontal modules nav should use a fade mask, not `overflow-x-auto`.

If any of those are still in their pre-delta state, **stop and tell me to run Phase 6.5
first as its own session.** Don't try to do 6.5 inside this Phase 4 session — the
TASKS.md convention is one phase per session, one PR per session.

## Branch

Phase 4 gets its own branch off the latest `design/foundation-build` (or off main if
`design/foundation-build` has already merged by the time you start). Name:
`design/notes-page`. Single PR titled `redesign notes page` when done.

## Setup

```
# If the repo isn't already cloned:
git clone https://github.com/GrochowskiMichal/moduohyb.git
cd moduohyb

# Otherwise just cd to your existing clone.

git fetch origin
git checkout design/foundation-build && git pull --ff-only   # parent branch
git checkout -b design/notes-page                             # work branch
bun install
```

First-time setup may need: Xcode Command Line Tools (`xcode-select --install`), Rust
toolchain (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`), and Bun
(`curl -fsSL https://bun.sh/install | bash`).

## Sanity checks before starting

```
bun run typecheck    # must be clean (0 errors)
bun run lint:tw      # ~1300 violations / ~44 files baseline; expect none in files you touch
bun run lint:css     # 0 errors, ~216 pre-existing warnings; none new
```

If `lint:tw` shows violations in Phase 4 files you haven't touched yet, that's a
pre-existing condition outside your scope. If you introduce new violations as you work,
that's a regression — fix it before committing.

## What to build (Phase 4 — six tasks)

These six tasks are quoted verbatim from
[.design/foundation/TASKS.md](.design/foundation/TASKS.md). Treat each as one commit on
the `design/notes-page` branch. Run `bun run dev:desktop` while you work — the Tauri
dev cycle picks up changes via HMR (cargo only re-runs on Rust changes; the React side
hot-reloads).

1. **Notes 3-pane layout** — compose
   [FeaturePanelsShell](./src/components/app/feature-panels-shell.tsx) with the three
   rail contents. URL stays `/notes`. Modifies
   [notes-page.tsx](./src/routes/pages/notes-page.tsx).

2. **Notes sidebar tree** — Pinned / Notes / Custom DB sections; tree rows use
   `var(--row-h)`, `hover:bg-accent`; folder icons via lucide; right-click opens a
   [ContextMenu](./src/components/ui/context-menu.tsx) with Pin / Copy Link / Duplicate
   / Rename / Move / Move to Trash / Publish. Modifies the existing tree component in
   [src/features/notes/](./src/features/notes/).

3. **Notes content area + breadcrumb** — breadcrumb in
   `text-sm text-muted-foreground`; title in `font-display text-3xl`; body editor uses
   `font-sans text-base text-foreground` (the readability fix). Container max-width
   `var(--width-prose-max)`. Modifies the Lexical-hosting component.

4. **Lexical theme alignment** — update the Lexical editor's theme classes in
   [src/features/notes/editor/](./src/features/notes/editor/) so that headings, lists,
   quotes, code blocks, tables, links all use token-driven colors. Replace the
   `notes-*` rules in [global.css](./src/global.css) with token references.

5. **Notes right rail** — Relation Graph viewer (existing XYFlow component, restyled),
   Tags section (Badge primitives via [TagInput](./src/components/ui/tag-input.tsx)),
   Close Relations list (rows with count badges). Rail width `var(--width-rail)`,
   collapses to whatever rail-collapse mode survives the Phase 6.5 rail rework. Modifies
   [src/features/notes/ui/](./src/features/notes/ui/).

6. **Run `/design-review` on Notes** — Playwright-driven visual sweep. Check contrast,
   focus rings, hover states, dark mode rendering, responsive collapses. Address
   findings before closing the phase. Phase 4 is done when this design-review pass is
   clean.

## Rules (same as Phase 3)

- **Do not modify** [src/tw/](./src/tw/) — RN compatibility shim.
- **Do not add new top-level routes** without explicit confirmation from me. `/notes`
  exists; don't create siblings.
- **Do not start Phase 5.** Stop at the end of Phase 4 (after the design-review pass is
  clean and the PR is open).
- **Follow the hard design rules from CLAUDE.md**: no raw hex codes in component code,
  no arbitrary Tailwind values for design-system properties (color/spacing/radius/font),
  no inline `style={{ color: ... }}` for design-system properties, wrap shadcn
  primitives where one exists, story required for any new primitive.
- **Respect the concentric inner-radius rule** from REVISION_DELTA.md §5: child element
  radius = max(parent radius − padding, 0). Notes will have many nested cards (tree
  rows, tag chips, relation cards) — apply the rule throughout.
- **Commit style**: concise present-tense imperative subject line, one task per commit,
  Co-Authored-By trailer if Claude wrote the change.

## When you're done

- All six Phase 4 tasks committed on `design/notes-page`
- `bun run typecheck` clean
- `bun run lint:tw` shows no new violations in files you touched
- `bun run lint:css` shows no new errors
- `bun run dev:desktop` runs and `/notes` renders without console errors in the Web
  Inspector
- `/design-review` pass clean (see TASKS.md Phase 4 task 6)
- PR opened titled `redesign notes page` against `design/foundation-build` (or main if
  it's been merged)
- Stop and hand back to me; do not start Phase 5

## What I'm NOT asking for

- Anything outside the six Phase 4 tasks above
- Phase 5 (Settings redesign) work
- Phase 6 (polish + Stylelint flip) work
- Phase 6.5 (revision delta) work — that's its own session
- The Ground route split (recorded as F1 in the delta — different track)
- Mobile / tablet layouts
- Light mode polish
