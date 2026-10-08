# Polish run — feature-agnostic prompt

> Paste this into a fresh Claude Code session and fill in the feature at the
> bottom. The agent has no memory of prior sessions; treat the prompt as the
> only context.

You are joining the moduo design polish run. The design foundation is already shipped — tokens, primitives, shell, settings modal, top + bottom bars, the chrome surface model — all merged to main. Your job is to polish ONE feature. Read [CLAUDE.md](../../AGENTS.md) and [DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md) first; treat both as the contract.

## Process

Step through the design-flow skills in this order: /grill-me → /design-brief → /brief-to-tasks → /frontend-design → /design-review.

Tell the /design-brief skill explicitly that the foundation is done. Point it at [DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md). It must not propose new tokens.

## Composition rules

- Compose the feature on FeaturePanelsShell from the start.
- Left rail = navigation, centre = primary content, right rail = additional context.
- Pass `resizable={false}` only when fixed widths are genuinely required.
- Subscribe to `onCreateNew(handler)` from
  [src/components/app/create-events.ts](src/components/app/create-events.ts) for the
  feature's + action and ⌘N.

## Tokens & primitives

- Tokens are settled — reach for an adjacent token instead of inventing one.
- `rounded-md` / `rounded-lg` / `rounded-xl` adapt to sharp / soft / round.
- Avatars use `rounded-avatar`, never `rounded-full`.
- If shadcn has a primitive for the thing you need, use the shadcn version in
  [src/components/ui/](src/components/ui/) (add via the shadcn CLI if it doesn't
  exist yet). Any new primitive needs a Storybook story and a row in
  [tests/visual/primitives.spec.ts](tests/visual/primitives.spec.ts).
- Verify your top-bar module icon reads at 14×14 px (`data-tabs="icons"` mode).

## Data layer

- Talk to storage through `getRuntime()` / `ModuoRuntime` from
  [src/lib/runtime.ts](src/lib/runtime.ts). Don't call Tauri `invoke` directly
  from feature code — the runtime layer has web + tauri implementations and is
  the contract the rest of the app uses.

## Foundation pickers

The legacy per-route picker UI lives in [src/components/app/app-chrome-menus.tsx](src/components/app/app-chrome-menus.tsx). Decide whether to host this feature's picker inside its own left rail, fold it into another surface, or delete it. Storage hooks (createMindmap, deleteBrainstorm, …) all still work.

## Entitlements

If the feature gates on plan, seats, or trial state, reuse the existing
`WorkspaceSettingsModal`, `UpgradeModal`, and `TrialBanner` surfaces — they're
already on tokens + shadcn. Don't roll a new paywall surface.

## Branching (2026-05-14 contract)

- `main` is the release branch. The originally-planned rename to `production`
  was skipped.
- Branch as `t/<owner>/<kebab>` from your personal branch (`maciej` or `mike`),
  not from `main` or `develop`. Example: `t/maciej/notes-polish`.
- Never push directly to `main` or `develop`. Force-push only on your own task
  branch with `--force-with-lease`.
- PR direction: `t/<owner>/<kebab>` → personal → develop → main. See
  [CONTRIBUTING.md](./CONTRIBUTING.md) for the full table.

## Lint discipline

- Remove the file you're rewriting from `IGNORED_PATHS` in
  [scripts/check-arbitrary-tw.ts](scripts/check-arbitrary-tw.ts) once it's on tokens.
- Run `bun run typecheck`, `bun run lint:tw`, and `bun run lint:css` after every
  commit. CI gates on all three.

## Out of scope

- New tokens (system change, separate PR).
- New top-level routes without explicit ask.
- Touching any feature other than the one in scope below.

---

The feature for this session is:
