# Manual test checklist — harness v2 (Claude Code only)

> Generated 2026-10-07 · branch `t/mike/harness-v2` · **Live-verified:** partial. AGENTS.md auto-load, all three guard hooks, the link check, typecheck, lint:tw, lint:css and tests were run by the agent; the items below need a human session or a second machine.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Instructions load
- [ ] **Do:** open a new Claude Code session in the repo and ask "what are the must-hold rules?" → **Expect:** it lists the 9 rules from AGENTS.md without reading any file first _(Claude Code, both machines)_
- [ ] **Do:** ask it to open any file under `supabase/migrations/` → **Expect:** the transcript shows `supabase/AGENTS.md` loading, and the answer mentions "applied migrations are history" _(Claude Code)_
- [ ] **Do:** look at the session-start preflight on `t/mike/*` and on `t/maciej/*` → **Expect:** it compares against `origin/mike` or `origin/maciej` respectively, and lists the short reading list _(Claude Code)_

## Plugins (first session after pulling)
- [ ] **Do:** trust the project when asked, then run `/plugin` → **Expect:** these 7 are enabled: `mattpocock-skills`, `supabase`, `postgres-best-practices`, `claude-security`, `security-guidance`, `rust-analyzer-lsp`, `skill-creator` _(both machines)_
- [ ] **Do:** type `/grilling` and `/claude-security` → **Expect:** both skills exist _(Claude Code)_
- [ ] **Do:** have Claude introduce and then fix a type error in a `.rs` file → **Expect:** "Found N new diagnostic issues" after the edit _(Claude Code, needs rust-analyzer)_

## Guard hooks
- [ ] **Do:** ask Claude to run `git push origin develop` → **Expect:** blocked with a message to use a task branch and a PR _(Claude Code)_
- [ ] **Do:** ask Claude to commit a file containing a fake key such as `sk_live_` plus 30 random characters → **Expect:** the commit is blocked by gitleaks (needs `brew install gitleaks`) _(Claude Code)_
- [ ] **Do:** ask Claude to add `className="bg-[#ff0000]"` to a component → **Expect:** right after the edit Claude is told the design gate failed and fixes it with a token _(Claude Code)_
- [ ] **Do:** ask Claude to read `.env.local` → **Expect:** refused by a deny rule _(Claude Code)_

## Workflow skills
- [ ] **Do:** `/s1 <small topic>` → **Expect:** it grills with recommended answers and uses `grilling` (no "grill-me not found") _(Claude Code)_
- [ ] **Do:** start a block with the `/goal` template from the `/s2` skill → **Expect:** a draft PR titled `[<ID>] …` appears before building, and the run ends with the Changed · Test this · Next report _(Claude Code)_
- [ ] **Do:** `/s3` on a branch that touches `supabase/migrations/` → **Expect:** it runs the security scan and asks you to launch `/code-review ultra <PR>` before merging _(Claude Code)_

## Knowledge files
- [ ] **Do:** open `docs/decisions.md`, `docs/gotchas.md`, `specs/BUILD_ORDER.md` → **Expect:** short indexes; every decision is one line linking to `docs/decisions/<area>.md`; finished blocks are in `specs/BUILD_LOG.md` _(repo)_
- [ ] **Do:** spot-check 3 decisions you remember → **Expect:** each is in the index and in full in its area file _(repo)_

## CI
- [ ] **Do:** open the `checks` run on this PR → **Expect:** the new "Secret scan (gitleaks)" step passes _(GitHub)_

## Known gaps / not-yet-testable
- `bun run lint:js` (Biome) fails repo-wide with 57 errors that predate this branch, so `bun run verify` is red until block LINT-1. See `docs/gotchas/workflow.md`.
- The TypeScript LSP plugin isn't enabled: `typescript-lsp` launches typescript-language-server, which needs the tsserver that TypeScript 7 no longer ships. Diagnostics for TS still come from `bun run typecheck` and the hooks.
- Revoke the old Modal key at Modal; it remains in git history.
