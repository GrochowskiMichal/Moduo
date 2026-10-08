# Manual test checklist — Storybook 10 + MCP

> Generated 2026-10-08 · branch `t/mike/storybook-10` · **Live-verified:** partial. The agent built both Storybooks (main: 248 entries, design-sync reference: 148), started `bun run storybook`, rendered the Button story with controls, actions, interactions and the density and Shade toolbar, and listed the 7 MCP tools at `http://localhost:6006/mcp`. Design-sync regeneration and the MCP from a Claude session were not run.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Storybook
- [ ] **Do:** `bun install`, then `bun run storybook` → **Expect:** opens on port 6006 with no build error; the sidebar shows `app`, `auth`, `ui` and the feature folders _(browser)_
- [ ] **Do:** open three `ui` stories (button, dialog, select) and switch the density and Shade toolbar items → **Expect:** each renders and restyles; Controls, Actions and Interactions panels are present _(browser)_
- [ ] **Do:** open a story's **Docs** page → **Expect:** autodocs render (props table and examples) _(browser)_
- [ ] **Do:** `bun run build-storybook` → **Expect:** exits 0 _(terminal)_

## Storybook MCP (opt-in)
- [ ] **Do:** with Storybook running, `claude mcp add --transport http storybook http://localhost:6006/mcp`, then ask Claude "which props does Button take?" → **Expect:** it answers through the `docs-show` tool _(Claude Code)_

## Design sync
- [ ] **Do:** `bash .design-sync/regen.sh` → **Expect:** step 1/3 (reference Storybook) passes; later steps may still fail on the two deleted components listed below _(terminal)_

## Known gaps / not-yet-testable
- The `notification-center` story throws `items is not iterable`: it passes `args: {}` and the component reads dashboard context. This predates the upgrade.
- `.design-sync` still names `IntegrationsModal` and `WorkspaceSettingsModal` (previews, `config.json`, `regen.sh`, `tsconfig.dts.json`, `NOTES.md`). Both components were deleted in DF-19i. This branch only removed them from `entry.tsx` so the reference build compiles.
- The MCP's story-testing tool needs `@storybook/addon-vitest`; the suite runs on Rstest, so it isn't installed.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
