# Gotchas / footguns

Things that have bitten us, so they don't bite again. **Read before debugging; append when something costs you more than a few minutes.** Each entry: the trap, why it happens, what to do instead.

---

## Repo / build

- **Never import a bare `{ runtime }`.** Always resolve via `getRuntime()`. The bare export was an always-null const footgun; grep `./runtime` when auditing lib exports. → [data-layers.md](./data-layers.md)
- **redb is paused — never make it load-bearing** for a new feature. New models are Supabase-first; redb is kept only for the future offline/"lite" version and not-yet-migrated legacy modules. → [data-layers.md](./data-layers.md)
- **The local done-check is `bun run verify`** (typecheck + lint:tw + lint:css + unit tests) — it mirrors CI's gate. CI does **not** run the e2e / visual-snapshot / billing suites (those stay local/manual), so a green PR doesn't cover them.
- **Visual-snapshot PNG baselines are NOT generated in CI** and are platform-suffixed (`*-visual-darwin.png`). Capture is a deliberate human `bun run e2e --update-snapshots` run on the canonical env. A visual diff means **stop and ask**, never auto-accept/regenerate.
- **macOS Liquid Glass app icon has been lost in merges twice.** It lives in-repo at `scripts/icons/source/Moduo.icon`; regenerate with `bun run icon:liquid` (needs full Xcode for `actool`). Don't let a merge drop it.

## Git / branching

- **`maciej` is a hot branch — merge-commit into it, never fast-forward.** Before editing in a worktree, **check the worktree's base vs `maciej`** (`git rev-list --left-right --count HEAD...maciej`) — sessions have started on a weeks-stale `main` base and edited stale copies of `CLAUDE.md` / `DESIGN_SYSTEM.md` / `tokens.css`. Cut `t/<owner>/<kebab>` off `maciej`, not `main`. A `SessionStart` hook (`.claude/hooks/session-start.sh`) now runs this check automatically and warns on a stale base at session start — but only takes effect once it's merged into `maciej`. → [CONTRIBUTING.md](../CONTRIBUTING.md)

## Claude Code / skills

- **Global skills are shared with Junction.** `~/.agents/skills/*` and `~/.claude/skills/impeccable/` are loaded by *every* project. Do **not** edit them for Moduo work — Moduo-specific skills/commands live **repo-local** in `.claude/skills/` and `.claude/commands/`. → `.claude/skills/`

## UI / design

- **"The app looks huge on web" was browser zoom**, not fonts or density. Check the browser zoom level before chasing a density/type-scale bug.
- **dnd-kit drags aren't simulable with synchronous synthetic events.** Its rAF collision-detection loop drops same-tick pointer events (why earlier sessions called drag "unsimulable"). To live-verify a drag, dispatch pointer events with **per-frame delays** between move steps. → [build-log.md](./build-log.md)
- **Don't hardcode visual values.** If a needed color/size/radius/shadow/duration isn't a token, add it to `src/styles/tokens.css` — never inline it. Motion goes through the motion tokens so `prefers-reduced-motion` keeps working. → [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md)
