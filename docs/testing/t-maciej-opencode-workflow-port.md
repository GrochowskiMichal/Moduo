# Manual test checklist — OpenCode workflow port + AGENTS.md consolidation

> Generated 2026-07-14 · branch `t/maciej/opencode-workflow-port` · **Live-verified:** partial — link rewrites, gitignore, JSON validity, and skill discovery were verified in-session; the OpenCode runtime behaviors (commands, MCP auth, notifications) need one real OpenCode session each.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## AGENTS.md as the single source of truth
- [ ] **Do:** open [AGENTS.md](../../AGENTS.md) → **Expect:** the full project instructions (stack, working posture, knowledge map, hard design rules, git rules, agent tooling, personal layer), with `docs/DESIGN_SYSTEM.md` / `docs/DESIGN_RULES.md` links. _(read-confirm)_
- [ ] **Do:** open [CLAUDE.md](../../CLAUDE.md) → **Expect:** only a short pointer to AGENTS.md. _(read-confirm)_
- [ ] **Do:** start a **Claude Code** session in the repo → **Expect:** it follows AGENTS.md content (e.g. it knows /s1 /s2 /s3 and the session-start reads). _(Claude Code)_
- [ ] **Do:** start an **OpenCode** session in the repo → **Expect:** AGENTS.md auto-loaded (it ignores CLAUDE.md once AGENTS.md exists). _(OpenCode)_

## Design docs moved
- [ ] **Do:** open [docs/DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) and [docs/DESIGN_RULES.md](../DESIGN_RULES.md) → **Expect:** both resolve; DESIGN_SYSTEM now ends with Token quick-ref / Accessibility / Anti-patterns / Enforcement sections. _(read-confirm)_
- [ ] **Do:** click the DESIGN_SYSTEM / DESIGN_RULES links in [AGENTS.md](../../AGENTS.md), [docs/onboarding/HANDOFF.md](../onboarding/HANDOFF.md), and any `.design/<module>/DESIGN_BRIEF.md` → **Expect:** all resolve into `docs/`. _(read-confirm)_
- [ ] **Do:** `bun run lint:tw && bun run lint:css` → **Expect:** green (the comment-only edit in `scripts/check-arbitrary-tw.ts` didn't break the gate). _(terminal — lint:tw verified in-session)_

## OpenCode commands & validator
- [ ] **Do:** in an OpenCode session, type `/s1` → **Expect:** the s1 command resolves and instructs loading the `s1` skill (planning posture, read-only). Same for `/s2` and `/s3`. _(OpenCode)_
- [ ] **Do:** in OpenCode, ask for a review "with the validator subagent" on some diff → **Expect:** it spawns the read-only `validator` agent and returns BLOCKER/MAJOR/MINOR/NIT buckets. _(OpenCode)_
- [ ] **Do:** in Claude Code, type `/s1` → **Expect:** the skill still works exactly as before (skills were edited, not moved). _(Claude Code)_

## MCP reconnection (one-time per machine)
- [ ] **Do:** `opencode mcp auth supabase` → **Expect:** browser OAuth completes; `opencode mcp list` shows supabase authenticated. _(terminal + browser)_
- [ ] **Do:** `opencode mcp auth subframe` → **Expect:** same. _(terminal + browser)_
- [ ] **Do:** `opencode mcp auth notion` → **Expect:** browser OAuth to your Notion workspace completes; notion tools available in sessions. _(terminal + browser)_
- [ ] **Do:** in an OpenCode session, ask "list my Supabase projects via the supabase MCP" → **Expect:** it answers using MCP tools, and the org shows project `wtoonrvuqumihpkbvwvs` (gotchas rule: STOP if it shows a different org). _(OpenCode)_

## Notifications
- [ ] **Do:** add `"attention": { "enabled": true, "notifications": true }` to `~/.config/opencode/tui.json`, run a session to completion → **Expect:** a desktop notification when it finishes / needs input. _(OpenCode — your action; repo can't set user-level TUI config)_
- [ ] **Do:** finish a Claude Code response → **Expect:** the existing Stop-hook desktop notification still fires. _(Claude Code)_

## Personal layer
- [ ] **Do:** `git status` → **Expect:** `docs/local/` does NOT appear (gitignored); `git check-ignore docs/local/WORKFLOW.md` exits 0. _(terminal — verified in-session)_
- [ ] **Do:** open [docs/local/WORKFLOW.md](../local/WORKFLOW.md) → **Expect:** your personal notes starter; edit freely, it never commits. _(read-confirm)_

## Edge cases
- [ ] **Do:** `bash .claude/hooks/session-start.sh` → **Expect:** the preflight prints "/s2 · /s1 · /s3" naming (not the old /execute /plan /wrap) and references AGENTS.md; exit code 0. _(terminal — verified in-session)_
- [ ] **Do:** `python3 -c "import json;json.load(open('opencode.json'))"` → **Expect:** no error (valid JSON). _(terminal — verified in-session)_
- [ ] **Do:** open [docs/agent-setup.md](../agent-setup.md) → **Expect:** one setup doc covering both tools; [docs/claude-code-setup.md](../claude-code-setup.md) redirects to it. _(read-confirm)_

## Migrations / data
- [ ] None — tooling/docs only. No schema, runtime, or `src/` changes (one comment-only edit in a lint script).

## Known gaps / not-yet-testable
- OpenCode wasn't on this shell's PATH during the session, so the `/s1-3` command resolution, validator subagent spawn, and MCP OAuth flows are configured but not yet exercised end-to-end — each needs one real OpenCode run (checklist above).
- The skills' new "ready-to-paste prompts" /s3 step and model-agnostic phrasing are content changes — confirmed by reading, not yet by a live wrap session.
- `.claude/worktrees/` (old runtime copies) still contain pre-move links; they're gitignored runtime dirs, intentionally untouched.
