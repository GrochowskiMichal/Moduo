---
paths: ["apps/storybook/**", "apps/app/src/**/*.stories.tsx"]
incident: "Storybook rendered nothing for weeks because its `@` alias pointed at the repo root and `@contracts` was missing (fixed 2026-10-06)"
expires: 2027-01-31
---

# Storybook

Compiled from the UI gotchas (HV-14b).

- A path alias goes into `apps/app/tsconfig.json`, `apps/app/rstest.config.ts` and `apps/storybook/.storybook/main.ts` together. `preview_logs` on the Storybook server shows the real resolve errors.
- `apps/storybook/.storybook/preview.tsx` is type-checked: a field the workspace context gains fails `bun check` until the mock has it.
- Story harnesses use the app's real sensors and providers: a bare `<DndContext>` swallows clicks (`lint:ast`), a `TaskTimelineView` needs a `DndContext` above it, a floating surface shown "at three densities" is mounted inside each wrapper with `container`, and a Dialog open on first render must not auto-focus a tooltip-wrapped button.
- Start Storybook from your own worktree on a free port (6006 may be another worktree's).
