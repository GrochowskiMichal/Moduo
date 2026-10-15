# Harness smoke — what a human still checks

> The agent harness (AGENTS.md, hooks, skills, CI) is proven by machines wherever it can be: `bun run test:hooks` feeds every guard hook known-good and known-bad tool calls, CI runs it on every push, and `bun run gen:decisions-index --check` fails a stale index. What follows is the short list that still needs a second machine, a GitHub click or a claude.ai page. Install steps live in [docs/agent-setup.md](../agent-setup.md). Last run: 2026-10-10 by the agent (items 1–3 and 6 not yet run by a human).

- **What happens when** you open a fresh Claude Code session on a second machine after pulling and ask "what are the must-hold rules?" → **Expected:** the 9 rules from AGENTS.md without reading a file; the preflight shows `Operator mode:` and `bun run next` → **Seen:** ____
- **What happens when** you run `/plugin` on that machine → **Expected:** `mattpocock-skills`, `supabase`, `postgres-best-practices`, `claude-security`, `security-guidance`, `rust-analyzer-lsp`, `skill-creator`, `ts7-lsp@moduo-local` all enabled → **Seen:** ____
- **What happens when** you ask "use the LSP to find the definition of `openStripeUrl`" → **Expected:** `src/features/billing/stripe-url.ts`, answered via the LSP tool, not grep → **Seen:** ____
- **What happens when** you try to merge a PR into `develop` before `static-checks` finishes → **Expected:** GitHub blocks the merge (ruleset) → **Seen:** ____
- **What happens when** you press "Run now" on the gardener at claude.ai/code/routines → **Expected:** a `Knowledge gardening <date>` PR into `mike` that regenerated `docs/decisions.md`, moved merged blocks to `BUILD_LOG.md` and archived stale checklists, or "Nothing to garden this week" → **Seen:** ____
- **What happens when** you start `/s2 <ID>` in engineer mode on a Tier 0 block → **Expected:** a draft PR appears before building, a "verify green" PR comment on the first green verify, the PR merges into the personal branch without you, the PR body opens with **Status: Landed**, and any low-confidence assumption sits under ❓ Needs you → **Seen:** ____

**Not verified by the agent:** the gardener's new steps (the routine prompt at claude.ai/code/routines still describes the old ones until it is updated; see docs/agent-setup.md), and the `rust-check` CI job's compile path (it runs only when `src-tauri/` or `checks.yml` changes).
