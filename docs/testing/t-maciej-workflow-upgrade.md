# Manual test checklist — Claude Code workflow upgrade

> Generated 2026-06-25 · branch `t/maciej/workflow-upgrade` · **Live-verified:** partial — the gate, `bun run verify`, skill registration, and the hook script were run and confirmed here; the doc/skill *content* is for you to read-confirm.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Behaviour rules & memory (Batch A)
- [ ] **Do:** open [CLAUDE.md](../../CLAUDE.md) → **Expect:** a "Working posture" section (grilling + output discipline + Opus-everywhere), a "Knowledge map" index, and "Active plan" now pointing at ROADMAP.md (not improvement-plan.md). _(read-confirm)_
- [ ] **Do:** open [docs/decisions.md](../decisions.md) and [docs/gotchas.md](../gotchas.md) → **Expect:** decisions read accurately; gotchas match reality (flag anything wrong). _(read-confirm)_

## Planning system (Batch B)
- [ ] **Do:** type `/plan`, `/execute`, `/wrap` in a Claude Code session in this repo → **Expect:** all three resolve to the repo-local skills (descriptions match `.claude/skills/<name>/SKILL.md`). _(both — verified registered here)_
- [ ] **Do:** open [specs/_template.md](../../specs/_template.md) → **Expect:** the required sections + a Definition-of-Ready gate + an execution-blocks table. _(read-confirm)_
- [ ] **Do:** confirm `.claude/skills/` is now committed (not gitignored) → **Expect:** `git ls-files .claude/skills` lists the skill files. _(verified here)_

## Design system source of truth (Batch C)
- [ ] **Do:** open [DESIGN_RULES.md](../../docs/DESIGN_RULES.md) → **Expect:** ratified R1–R10 + token-surface map; no DRAFT marker. _(read-confirm)_
- [ ] **Do:** skim [.design/foundation/TOKENS.md](../foundation/TOKENS.md) + [DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md) → **Expect:** single-font model (default Geist), no `data-text-size`, `--z-dropdown: 70`, no icon-rail-width rows. _(read-confirm)_
- [ ] **Do:** `grep -rn "var(--space-" src` → **Expect:** no results (orphan tokens removed). _(verified here)_

## Design enforcement (Batch D)
- [ ] **Do:** `bun run lint:tw` → **Expect:** "no arbitrary Tailwind values found." _(verified here)_
- [ ] **Do:** temporarily add `text-[#ff0000]` (or `duration-200`) to a non-ignored component, run `bun run lint:tw` → **Expect:** it FAILS and points at the line; remove it after. _(verified here via control test)_
- [ ] **Do:** type `/moduo-design-quality` in a session → **Expect:** the skill is available; description covers audit/polish/build-with-taste/motion-pass. _(verified registered here)_
- [ ] **Do:** open the two empty-state pages (grid / a "coming soon" feature page) in the app → **Expect:** the caption text is muted-grey (`text-muted-foreground`), readable. _(NOT live-verified — see Known gaps)_

## Tests as the gate (Batch E)
- [ ] **Do:** `bun run verify` → **Expect:** typecheck + lint:tw + lint:css + **118 tests pass**, exit 0. _(verified here)_
- [ ] **Do:** push the branch and open a PR → **Expect:** CI "checks" now has a **Unit tests** step that runs the suites. _(not yet pushed)_

## Hooks & notifications (Batch F)
- [ ] **Do:** finish a Claude Code response in this repo (desktop app) → **Expect:** a desktop notification "Block finished — ready for your review". On first run, Claude Code may ask you to approve the new hooks — approve them. _(macOS notify path verified via smoke test)_
- [ ] **Do:** read [docs/claude-code-setup.md](../claude-code-setup.md) and flip the user-only toggles in the app `/config`: **auto mode**, `agentPushNotifEnabled`, `inputNeededNotifEnabled` → **Expect:** away-from-desk push works. _(your action — repo can't set these)_

## Edge cases
- [ ] **Do:** run the workflow in a worktree on a stale base → **Expect:** the gotcha reminds you to check `HEAD...maciej` first (this session's worktree was already at maciej). _(n/a this run)_
- [ ] **Do:** confirm the hook never blocks Claude → **Expect:** `bash .claude/hooks/notify.sh` exits 0 even on a non-macOS/non-Linux box. _(verified exit 0 here)_

## Migrations / data
- [ ] None — this session changed workflow tooling, docs, lint, CI, and removed unused CSS vars only. No schema or runtime data changes.

## Known gaps / not-yet-testable
- The two empty-state pages (`grid-page`, `feature-empty-page`) are hard-to-reach fallback states; the `text-[#d4d8e1]` → `text-muted-foreground` swap is a token-equivalent and passed all static gates, but I did not spin up the preview to view them. Say if you want a live screenshot.
- The committed Stop/Notification hooks are shared with Mike; non-macOS teammates get a harmless no-op. Notifications were smoke-tested (exit 0 + osascript path), not observed end-to-end inside the desktop-app event loop.
- CI's new Unit tests step is confirmed by running `bun run test` locally; it will first actually run in GitHub Actions once the branch is pushed.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
