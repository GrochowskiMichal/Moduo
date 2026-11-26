# Models, review gates and CI

From the AGENTS.md this commit had, moved out so the map stays short (A/B rig, `diet` arm).

## Models (Anthropic only, Claude Max plan, October 2026)

No other model providers. Pick by role, not "strongest everywhere"; raise effort only where a measured gain justifies it.

| Role | Model | Effort |
| --- | --- | --- |
| Main session, `/s1` planning, `/s2` building | Opus 5.5 (`opus`, the default) | `high` (set by the skills); `medium` for chat |
| Advisor during `/s2` (Max only) | Fable 5.1, via `/advisor fable` | n/a |
| The hardest plan syntheses (Max only) | Fable 5.1, via `/model fable` | `high` |
| `validator` subagent | Opus 5.5 | `high` |
| AI review on PRs into develop (`ai-review.yml`) | Sonnet 5 (`claude-sonnet-5`: the one model whose `/code-review medium` votes on findings) | `medium` |
| Read-only recon | `scout` subagent (`.claude/agents/scout.md`) | Haiku 5.5 |
| Lane router (keyword rules; Haiku opt-in), risk hook in shadow, routines | Haiku 5.5 | n/a |
| `/goal` evaluator | Haiku 5.5 (automatic) | n/a |

On Max, Fable counts against at most half the weekly limit. On Pro it bills usage credits, so Pro users skip the advisor. `xhigh`/`max` only for long infra or migration work where you saw it help. Fast typed decision models (e.g. Jev) are not adopted: the product brief keeps AI MCP-only.

## Review gates (lean mode: pre-alpha, no external users)

The tier comes from code, not judgment: `scripts/ci/tier.ts`; details are in `/s2` step 6. **Re-tighten everything in the "paused" line before the first external alpha/beta.**

- **Tier 0/1, everything else:** `bun run verify` and the hooks. No validator, no `/code-review` in the session.
- **Tier 2, risky paths** (`TIER2` in `scripts/ci/tier.ts`; run `bun scripts/ci/tier.ts origin/<personal-branch>`; `pr-tier.yml` labels every PR `tier-0/1/2`): `/s2` races three drafts from the frozen contract commit and keeps one with `bun run drafts`, then the `validator` subagent runs once, advisory; each BLOCKER/MAJOR is fixed or answered in the report.
- **CI on PRs into `develop`** (full suite once, plus the push after merging): SQL/RLS tests with the generated RLS matrix and policy mutants (`bun run db:matrix`, `db:mutants`), Rust gates and an e2e smoke, each only on its paths; ratchets and the test-weakening detector; one advisory AI review (`ai-review.yml`, Sonnet 5, inline comments, never required; [REVIEW.md](../../REVIEW.md) says what it flags); on Tier 2, catching tests written against the parent commit.
- **Paused until beta:** `/code-review ultra`, the `/claude-security` diff scan, `/code-review high` on every PR, per-block manual-test checklist files, hand-written next-session prompts, and Tier 3's designer pass. The floor that stays: gitleaks (hook + CI), `guard-git.sh`, `guard-prod-db.sh`, `static-checks` required on `develop`.
