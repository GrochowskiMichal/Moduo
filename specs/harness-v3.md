# Spec: Harness v3 — the flow board, built

> Status: **Ready to execute** · Owner: mike · Planned 2026-10-23 (engineer mode); Maciej agreed to all of it the same day · Target: everything before the closed alpha (2 Nov 2026), Mike's call · Board: [Moduo Flow Board](https://claude.ai/artifact/PV3Ay6K4Jg96FTPp9syPP3) · Evidence: `docs/local/claude_science/harness/harness-audit-2026-10-23.md` and `docs/local/claude_science/harness/reports/Moduo harness experiments deep dive.md` (local, not committed)

## Scope

Turn the agent harness that builds Moduo into the flow on the board: every signal routed by a cheap model into one of four lanes, a build engine that writes contracts and frozen tests before code and races drafts, a gate where code decides the risk tier and every PR into `develop` gets machine checks plus a vote-verified AI review, work state that moves itself from GitHub events into Moduo (Moduo becomes the block queue), knowledge that is compiled into checks and short path rules instead of piling up, and a learn loop with a private benchmark, an A/B rig and weekly outcome numbers.

Why now: the 23 Oct audit measured the current harness over 21 days (458 sessions, 400 merged PRs). The machine half is good; the rest is slowing the team and letting the riskiest bugs through. Only 25% of PRs use the block flow; 42% of commits touch ledger or knowledge files; none of the 14 "in progress" ledger rows matched GitHub; `/s1` points at three skills the model can't call and `tdd` ran 0 times; SQL/RLS tests, e2e and Rust tests never run in CI; and the five data-loss bugs fixed in #509 were found by a manual audit in code no gate covers. Mike chose to build all of it before 2 Nov.

### What exists today, mapped to the board

| Board step | Today | This spec |
| --- | --- | --- |
| Session start | `session-start.sh` (base check + a 337 KB "read the indexes" list), `session-title.sh`, Entire, `moduo-report.sh` (curl + key in env) | Keep the base check; drop the reading list; presence through an `mcp_tool` hook (HV-1, HV-8) |
| Intent router, prewarm, scout | None; built-in Explore runs on the main model; worktrees made by hand; 49 stale worktrees | Haiku prompt hook router, worktree pool, `scout` subagent on Haiku (HV-2, HV-23) |
| Fast lane | De facto 75% of PRs, unwritten | Written rule and a `/fast`-free path in AGENTS.md (HV-3, HV-30) |
| Bug lane | `diagnosing-bugs` referenced, never invoked | Repro-first with hardening, called by exact name (HV-3) |
| Shape | `/s1` (designer posture, 50–100 questions), broken references to `to-tickets`, `wayfinder`, `grill-with-docs` | `/s1` keeps Maciej's posture; engineer mode uses the flows typed by the person (HV-3) |
| Build engine | `/s2` one block, verify, validator twice on Tier 2 | Contract tests frozen, best-of-3 on Tier 2, three strikes then escalate, one validator pass (HV-3, HV-18, HV-26) |
| Gate | CI: secrets, types, lint, unit; Tier decided by the agent | Path classifier, SQL/RLS, Rust, e2e smoke, test-weakening detector, ratchets, AI review on PRs into develop, catching tests (HV-4, HV-5, HV-6, HV-27) |
| Ship | `/ship` (good) | `/ship` user-only; Workers gradual rollout with rollback (HV-1, HV-28) |
| State | `BUILD_ORDER.md` 219 KB + Moduo tasks typed by the model + PRs | GitHub events move Moduo; Moduo is the queue; ledgers deleted (HV-7, HV-8) |
| Knowledge | 1.4 MB decisions, 830 gotchas, folder `AGENTS.md` that reach 7–22% of sessions | Path-scoped rules, `supersedes:`, generated index, ast-grep pack, docs eval (HV-10–HV-14) |
| Learn | Gardener routine gone (404) | Benchmark, variant hunt, retro, A/B rig, weekly numbers, routines (HV-15, HV-20–HV-22, HV-25) |
| Rails | Guards (fail open), bypass mode, three Moduo connections | Fail closed, auto mode + `srt` for lanes, one Moduo, one Supabase, Haiku risk hook in shadow (HV-1, HV-2, HV-24) |

## Product behavior & UX

The "users" are the two founders and their agents. What changes for each:

**Mike or Maciej asks for something.** A session opens in its own ready worktree (never the shared main checkout). Within a second or two a Haiku hook has added a hidden note to the conversation: the lane (answer, fast, bug, block), the risk area (sync, auth, RLS, billing, MCP, desktop, UI) and the block ID if one is named. The person never sees a prompt from the router; they can override with "treat this as a block" or "fast lane".

**Fast lane** (the diff fits one sentence): the agent drafts on a `t/<owner>/<kebab>` branch with the Edit tool, runs the affected checks, opens a PR with a short Test-this, merges into the personal branch on green. No spec, no block, no ledger, no Moduo hop.

**Bug lane:** first a failing test that reproduces the bug, hardened so 3–5 plausible wrong fixes would still fail it; then the build engine; then the test joins `benchmarks/escapes/`, and the nightly variant hunt looks for siblings.

**Block lane:** Maciej keeps `/s1` as today (grilling with recommended answers, prototypes in the real design system). Mike types `/mattpocock-skills:grill-with-docs` and `/mattpocock-skills:to-tickets` himself. Specs now carry a contract per changed function (pre, post, error) and, for data work, rows of an RLS matrix. Blocks are created as Moduo tasks; the queue lives in Moduo.

**Build engine** (`/s2`): claim with a draft PR (Moduo moves to Building by itself) → contract tests written first and frozen (the agent cannot edit test files while implementing) → drafts (Tier 2: three in parallel worktrees, the checks pick the smallest passing diff with the best mutant kill rate) → local oracles → on a red check, retry with the failure, at most three times → on the third failure the agent stops and files a defect report ("the spec or the test may be wrong") in Moduo for a person. It never edits a test to pass.

**Gate:** CI labels the PR's tier from its paths. PRs into `develop` run every oracle (SQL/RLS tests, Rust, e2e smoke, test-weakening detector, ratchets) and get an AI review whose findings were voted real before posting. The review never blocks a merge: its comments are advice for the founder merging the batch. Tier 2 PRs into `develop` also get "catching tests" posted as comments.

**Ship:** unchanged `/ship`, now user-only. Prod web deploys roll out to a slice of traffic first and roll back by themselves when errors climb. The tag moves every shipped block's Moduo task to Shipped.

**Moduo** shows each block's stage (moved by GitHub events), each agent's presence (online/idle, by hook), needs-you questions with a recommended answer, defect reports, and a daily production digest in a chat channel.

**Learning:** every escaped bug becomes a failing test in `benchmarks/escapes/`. A weekly retro turns lessons into an ast-grep rule, a hook or a test when the lesson is mechanical, otherwise into a short path rule with an incident link and an expiry date. No harness change is kept until the A/B rig has run it against real past tasks. Weekly outcome numbers land in Moduo.

**Knowledge:** agents read rules that load by path (also when they `cat` a file), the current view of decisions (superseded entries hidden), and grep the rest. The ledgers, the build log and the paused checklists are deleted.

## Edge cases

- **Two sessions share the main checkout** (happened on 23 Oct: the checkout switched branch under a running session). Session start warns when cwd is the main checkout and points to `bun run wt` (pool); `guard-git.sh` blocks `git checkout`/`switch` of a branch in the main checkout when another Claude process has it as cwd.
- **Moduo is down or the CI key is revoked.** The sync Action logs and exits 0; work never waits on Moduo. `bun run queue` falls back to spec tables + PR state and says "Moduo unreachable".
- **A PR names no block ID or MOD handle.** No Moduo change; the Action notes "no task" in its log. Fast-lane PRs are expected to have none.
- **A PR names a block whose task belongs to someone else.** Status still moves (the event is a fact); the Action adds no comment and assigns nobody.
- **A PR is closed without merging.** The task goes back to To do with a comment linking the closed PR.
- **Two open PRs claim the same block.** The second gets a PR comment "claimed by #n" and no Moduo change.
- **A release tag contains blocks from several PRs.** Every block task referenced by a PR merged between the previous tag and this one moves to Shipped.
- **The router misclassifies.** The person overrides in words; the override is logged as a label for the router's A/B data. The router never blocks a prompt and adds at most ~2 s.
- **Haiku hook model or quota fails.** The hook exits 0 with no context (fail open is correct here: it only advises).
- **A guard hook crashes or can't start.** `onFailure: "block"` stops the command; the error names the hook and the fix.
- **`srt` blocks something a lane needs** (npm registry, GitHub, the local Supabase port). The allowlist covers registry.npmjs.org, github.com, api.github.com, the Turborepo cache Worker, 127.0.0.1 ports used by the local stack; anything else fails loudly with the host name.
- **Auto mode prompts too often in interactive work.** Allow rules for the common read-only commands are added from transcripts (`fewer-permission-prompts`); bypass stays available only inside `srt`.
- **AI review is wrong.** It never blocks, so a founder resolves or ignores the comment; ignored agreed findings on Tier 2 paths are counted in the weekly numbers, so a review that cries wolf shows up.
- **The property harness flakes.** Seeds are fixed in CI and printed on failure; a flake above 1% in a week fails HV-17's acceptance and the harness is made deterministic before it gates.
- **A rule's referenced file is deleted or renamed.** The dead-reference check fails `verify` with the rule and the missing path.
- **A path rule is never loaded or cited for 30 days.** The weekly retro lists it; it is deleted unless a person renews the expiry.
- **The docs eval score drops after a knowledge change.** The change is reverted or the missing fact restored before merge.
- **A variant-hunt candidate has no failing test.** It is dropped, never reported.
- **A lane hits the Max usage limit mid-run.** Work is committed and pushed at each green step (current `/s2` rule), the Moduo task gets a `failed` note "usage limit", and the next lane resumes from the branch.

## Acceptance criteria

Intake and lanes
- **AC1** — A new session prints the base check and the worktree warning when relevant, and no reading list.
- **AC2** — A one-sentence change goes from request to a merged PR in the personal branch with no spec, block, ledger or Moduo edit.
- **AC3** — Every prompt gets a lane and risk area from the router as added context, within about 2 s, without ever blocking or asking.
- **AC4** — The `scout` subagent runs on Haiku and returns files, symbols, current decisions and rules with line numbers.
- **AC5** — `bun run wt <name>` hands out a ready worktree (dependencies installed, own dev port) in under 60 s; stale worktrees for merged branches are removed by `bun run wt:prune`.

Safety rails
- **AC6** — Interactive sessions start in auto mode; unattended lanes run bypass only inside `srt` with a network allowlist; prod deploy and push-to-prod commands are denied in lanes.
- **AC7** — A guard hook that crashes or times out blocks the command it guards.
- **AC8** — `/ship` can only start when a person types it.
- **AC9** — A grep with an unquoted glob that zsh would abort is blocked with the quoted command to use instead.
- **AC10** — A session in this repo has one Moduo server (at `mcp.moduo.app`) and one Supabase server, and no deprecated connector.

State and queue
- **AC11** — Opening a draft PR titled `[ID] …` moves the block's Moduo task to Building; ready for review → In review; merged → Awaiting release; closed unmerged → To do with a comment; a release tag → Shipped. No model call is involved.
- **AC12** — `bun run queue` prints ready, claimed and waiting blocks from Moduo, spec dependency tables and open PRs; `/s2 next` picks from it.
- **AC13** — `specs/BUILD_LOG.md`, `docs/build-log.md` and `docs/testing/` are deleted; `specs/BUILD_ORDER.md` is a short pointer to the queue; no skill or doc tells an agent to tick, flip or move ledger lines.
- **AC14** — Agent presence shows online at session start and idle at stop in Moduo, with no curl and no key in the environment.

Skills and the build engine
- **AC15** — No skill names a skill the model is not allowed to call; `tdd`, `diagnosing-bugs`, `code-review` and `pr` are called by exact name at fixed steps, and transcripts from the next 2 weeks show them invoked.
- **AC16** — On the third failure of the same check the agent stops and posts a defect report; it never edits a test file while implementing.
- **AC17** — The validator runs once per Tier 2 diff, advises, and states explicit disagreements.
- **AC18** — On Tier 2 blocks `/s2` races three drafts in separate worktrees and keeps the smallest passing diff with the best mutant kill rate.

Gate and release
- **AC19** — CI sets the tier label from the paths a PR touches.
- **AC20** — PRs into `develop` run SQL/RLS tests, Rust checks, an e2e smoke, the test-weakening detector and the size and complexity ratchets, each only when its paths changed.
- **AC21** — Every PR into `develop` gets an AI review with vote-verified inline comments; the review never blocks a merge.
- **AC22** — Tier 2 PRs into `develop` get catching tests (pass on the parent, fail on the diff) posted as comments.
- **AC23** — A prod web deploy reaches a slice first and rolls back by itself when the error rate crosses the threshold.

Quality oracles
- **AC24** — The sync outbox property harness catches at least 4 of the 5 #509 bugs when their fixes are reverted, runs deterministically, and takes under 2 minutes in CI.
- **AC25** — The RLS matrix covers the 10 most sensitive tables and every SECURITY DEFINER RPC, and every policy mutant is caught.
- **AC26** — A variant hunt over the five #509 seeds produces a report in which every candidate has a failing test or is dropped; confirmed bugs become tasks.
- **AC27** — The Cloudflare security-audit skill and `/claude-security` have run over the risky surfaces before 2 Nov, with every finding triaged.

Knowledge
- **AC28** — Folder rules load when an agent views a matching file through Read, Edit or a single-file `cat`/`sed -n`/`grep`; root AGENTS.md is a map of at most 150 lines.
- **AC29** — Every decision entry has a status; superseded entries name their successor; `bun run docs:current <area>` prints only current entries; the index is generated and CI fails when it's stale.
- **AC30** — Every gotcha area is reduced: mechanical traps are ast-grep rules, tests or wrappers; the rest are path rules or code comments; stale ones are deleted. The ast-grep pack runs at edit time, in `verify` and in CI.
- **AC31** — A rule or doc that names a missing file or symbol fails `verify`.
- **AC32** — The 46-question docs eval runs with one command, and its score doesn't drop across the knowledge changes.

Learn loop and instruments
- **AC33** — The A/B rig runs a task set × arms × 3 repeats into one JSON row per run, without touching the shared Supabase stack, prod MCP or a remote.
- **AC34** — Weekly outcome numbers (first-pass verify rate, follow-up fixes within 7 days, reverts, escapes, erosion, usage per block) are posted to Moduo every Monday.
- **AC35** — Cloud routines run the nightly variant hunt, the weekly retro, the daily production watch and the weekly numbers.
- **AC36** — The Haiku risk hook runs in shadow on prod-touching commands and risky edits and logs every decision without blocking.
- **AC37** — The rig has arms ready for effort (medium vs high), Ponytail on/off and the test prompt (tdd vs contract-first); their results come after the alpha.
- **AC38** — An agent-experience eval of the Moduo connector (15 user tasks × 5 runs against `moduo-local`) has run before 2 Nov with results recorded.

Policy
- **AC39** — AGENTS.md states: Anthropic models only for agents (unchanged), two lanes, auto mode, the single Moduo connection, and the queue in Moduo.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `.claude/hooks/session-start.test.sh` · "no reading list; warns in main checkout" | AC1 | The hook prints the base check, never the old file list, and warns when run from the main checkout. |
| Live check in HV-30's PR · "fast lane label fix" | AC2 | A real one-line change lands with no spec, ledger or Moduo edit in its diff. |
| `scripts/agent/router.test.ts` · "router output shape, never blocks" | AC3 | The hook script returns lane + area as context, exits 0 on model errors, and stays under the time budget with a stubbed model. |
| Live check in HV-23 · "scout on haiku" | AC4 | The transcript shows the scout subagent running on Haiku and returning line-numbered context. |
| `scripts/agent/wt.test.ts` · "pool hands out and prunes" | AC5 | The pool creates a worktree from a cached install and prunes only merged branches. |
| `.claude/hooks/guard-*.test.sh` (run by `scripts/agent/hooks.test.ts`) | AC6, AC7, AC9 | Guards deny prod deploys in lane mode, block on crash, and reject unquoted globs with the fixed command. |
| `scripts/agent/settings.test.ts` · "settings contract" | AC6, AC8, AC10 | settings.json has auto mode, onFailure on every guard, no dead hook; `ship` has `disable-model-invocation`; `.mcp.json` has one Moduo at `mcp.moduo.app`. |
| `scripts/agent/moduo-sync.test.ts` · "event → status table" | AC11 | Each PR or tag event fixture maps to exactly one status call, unmatched PRs make no call, closed-unmerged goes back to To do. |
| Live check in HV-7 · "draft PR moves the task" | AC11 | Opening, readying and merging a real PR moves a real Moduo task through the stages. |
| `scripts/agent/queue.test.ts` · "frontier from deps + state" | AC12 | Given task states, spec dependency tables and open PRs, the queue lists exactly the ready blocks; Moduo unreachable falls back with a notice. |
| `scripts/agent/no-ledger.test.ts` · "no ledger instructions" | AC13 | No skill or doc tells an agent to tick, flip or move ledger lines, and the deleted files are gone. |
| `tools/claude-plugins/moduo-agent/hooks/presence.test.ts` | AC14 | The presence hook config calls the Moduo tool and has no curl or key. |
| `scripts/agent/skill-refs.test.ts` · "invocable references only" | AC15 | Every skill named inside a skill exists and is model-invocable, unless the line tells the person to type it. |
| Transcript count after 2 weeks (weekly numbers) | AC15 | tdd, diagnosing-bugs, code-review and pr show up as Skill calls. |
| `scripts/agent/frozen-tests.test.ts` · "test edits denied during implement" | AC16 | The implement-phase permissions deny Edit on test paths and the sandbox denies writes there. |
| A/B rig fixture task "impossible spec" | AC16 | A task whose test contradicts the spec ends in a defect report after three attempts, with no test edits. |
| `scripts/agent/skill-refs.test.ts` · "one validator step" | AC17 | `/s3` has no validator step; `/s2` has exactly one. |
| Live check in HV-26 on a Tier 2 block | AC18 | The PR body lists three drafts, their checks and mutant kill rates, and the chosen one. |
| `scripts/ci/tier.test.ts` · "paths → tier" | AC19 | Fixture diffs touching each Tier 2 path get tier-2; docs-only gets tier-0. |
| CI run on HV-4's PR | AC20 | The new jobs run when their paths change and skip otherwise. |
| `scripts/ci/test-weakening.test.ts` | AC20 | Deleted asserts, new `.skip`/`.only` and new mocks in `lib/sync` tests are flagged; renames are not. |
| Live check: a seeded Tier 2 bug PR into develop | AC21, AC22 | The review posts the agreed finding as a comment without failing any check; catching tests appear as comments. |
| Staging rehearsal in HV-28 | AC23 | A forced error spike on staging rolls the Worker version back. |
| `apps/app/src/lib/sync/outbox.property.test.ts` | AC24 | Random edits, offline flips, failed reads, decode errors, sign-outs and races never lose an outbox entry; reverting each #509 fix makes it fail for at least 4 of 5. |
| `supabase/tests/rls_matrix_*.sql` + `scripts/db/policy-mutants.ts` | AC25 | Each matrix cell holds for every persona; loosening any policy makes a test fail. |
| `docs/local` report + Moduo tasks from HV-15 | AC26 | Every reported candidate links a failing test. |
| Triage table in HV-19's PR | AC27 | Every finding has a verdict and a task or a reason. |
| `scripts/agent/rules.test.ts` · "rules frontmatter" | AC28, AC31 | Every rule has `paths:`, an incident and an expiry; AGENTS.md ≤150 lines; every path named in a rule exists. |
| `scripts/docs/decisions.test.ts` | AC29 | Status and supersedes fields parse; the current view hides superseded entries; the generated index matches. |
| `lint:ast` fixtures (`tools/ast-grep/rules/*/fixtures`) | AC30 | Each rule flags its pre-fix code and passes its fixed code. |
| `scripts/evals/docs/run.ts` before/after | AC32 | Score on the 46 questions is at least the baseline. |
| `scripts/harness-ab/rig.test.ts` | AC33, AC37 | Dry-run produces one row per arm × task × repeat, refuses runs that point at the shared stack, prod or a remote. |
| `scripts/agent/numbers.test.ts` | AC34 | The numbers script computes each metric from fixture PRs and CI runs. |
| RemoteTrigger listing in HV-22's PR | AC35 | The four routines exist with their schedules. |
| `scripts/agent/risk-hook.test.ts` | AC36 | The shadow hook logs a decision and never returns a block. |
| Results file in HV-29 | AC38 | 75 runs recorded with success, wrong-tool rate and tokens. |
| `scripts/agent/skill-refs.test.ts` · "AGENTS.md contract" | AC39 | AGENTS.md contains the policy lines and stays under 150 lines. |

## Assumptions & technical decisions

Decided with Mike (23 Oct):
- **Everything before 2 Nov.** Accepted risk: harness churn during launch week. Mitigation: harness-only blocks first, product-touching oracle blocks (HV-16, HV-17) land as tests only, no product code changes except fixes they reveal.
- **Auto mode for interactive sessions; bypass only inside `srt`** for unattended lanes, with deny rules for prod deploys.
- **Moduo is the queue**, including the Focus line. Maciej agreed (23 Oct), including the `/s1` changes.
- **Anthropic models only, unchanged.** No local or Cloudflare models; the Kev replay and any embedding index are out.
- **AI review runs only on PRs into `develop` and never blocks** (Mike, 23 Oct). It is advice for whoever merges the batch.
- **Delete** BUILD_LOG.md, docs/build-log.md and docs/testing/ (git keeps history).
- **No merge queue, no org move.** `/s3` merges the personal branch in and re-runs checks before merging.

Agent's technical calls:
- **Block dependencies live in the spec's Execution blocks table**, because Moduo tasks have only a one-level parent and no "blocked by" field. Moduo holds state, owner, order and the Focus (a pinned note in the Closed alpha project). `bun run queue` joins the two. Rejected: adding a "blocked by" relation to Moduo now (a product feature with a migration; logged as a follow-up for the Tasks roadmap).
  *Correction (26 Oct, HV-7):* Moduo tasks do have dependency edges (`tasks_get` returns `blockers` and `blocked`, and `blocked` is on every task row). HV-8 should mirror each spec dependency as a blocker edge between the block tasks instead of keeping the join only in `bun run queue`; the spec's table stays the source the import reads.
- **GitHub → Moduo sync is a GitHub Action** (`.github/workflows/moduo-sync.yml`) calling the connector's JSON-RPC with a dedicated "CI" agent key (`MODUO_CI_KEY`, environment-scoped secret). Rejected: a cloud routine (adds latency and Max usage for a deterministic job). The product feature GH-1/2/6 replaces it later.
- **Presence uses an `mcp_tool` hook** against the project `moduo` server. Rejected: keeping curl with `MODUO_MCP_KEY` in the environment.
- **`.mcp.json`'s `moduo` points at `https://mcp.moduo.app`**, so the claude.ai connector at the same URL is de-duplicated and the agent's key wins. Each person removes the user-level `moduo` entry and the API-key connection named "Claude", and sets `disableClaudeAiConnectors` or `deniedMcpServers` in their own `settings.local.json` (documented, not committed).
- **Router = `type: "prompt"` hook on UserPromptSubmit with `model: haiku`**, returning additional context only. If the alias isn't accepted, use the full Haiku 5.5 model ID. Rejected: a blocking classifier.
  *Correction (26 Oct, HV-23):* a prompt hook can only answer ok or block, never add context, so the router is a command hook (`scripts/agent/router.ts`). Haiku via `claude -p` takes ~4.5 s on the Max login, so keyword rules are the default and Haiku is the `MODUO_ROUTER=haiku` arm for the rig; see docs/decisions/workflow.md, HV-23.
- **Scout = `.claude/agents/scout.md` with `model: haiku`**, read-only tools. Rejected: shadowing the built-in `Explore`, which other skills rely on.
- **Worktree pool = `scripts/agent/wt.ts`** on top of `git worktree` with a warm Bun cache; ports from the existing `scripts/agent/e2e.sh` scheme.
- **AI review = `anthropics/claude-code-action`** in `.github/workflows/ai-review.yml` on `pull_request` into `develop`, same-repo PRs only, `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` in an environment secret, running the built-in `/code-review medium --comment`. Rejected: Alibaba Open Code Review (not Claude) and the paused `ultra`.
- **Catching tests and the Cloudflare security-audit skill** run inside the same workflow for Tier 2 PRs only, with Fable validating security findings.
- **Path classifier = a small script** (`scripts/ci/tier.ts`) with the Tier 2 path list in one file, used by CI labels and by `/s2`/`/s3`. Adds to Tier 2: `apps/app/src/lib/sync/**`, `lib/prefs-sync.ts`, the auth provider, `apps/desktop/src-tauri/src/store*/**`.
- **SQL/RLS tests in CI** start the Supabase CLI stack in the job (`supabase start` with only the needed services) and run `bun run db:test`; path-filtered to `supabase/**`.
- **Rust check** = the `rust-check` job from PR #345 (cargo check, `--features lite`, `cargo test --lib`), path-filtered; **e2e smoke** = PR #344 rebased. Both PRs are closed after their content lands.
- **Ratchets** = file size (32 KB) and cognitive complexity per function, frozen at today's values for existing files; new violations fail.
- **Test-weakening detector** = a diff script (`scripts/ci/test-weakening.ts`), not a model.
- **Frozen tests** = an implement-phase settings profile: `permissions.deny` for `Edit`/`Write` on `**/*.test.*`, `supabase/tests/**`, `benchmarks/**`, plus `srt` write-deny for the same paths.
- **Best-of-3** only on Tier 2 blocks (usage), via subagents with `isolation: worktree`.
- **Property harness** = fast-check model-based commands + `fc.scheduler()` against a reference model of the outbox; seeds fixed in CI.
- **RLS matrix** = `supabase/tests/rls_matrix.md` (table × persona × operation) generating pgTAP files; policy mutants applied inside `db:test`'s rolled-back transaction, never on the shared stack outside a transaction.
- **ast-grep pack** = `tools/ast-grep/` with `sgconfig.yml`, one folder per rule with fixtures; `lint:ast` in `verify`; PostToolUse hook on Edit|Write and a Bash post-check of changed files.
- **Path rules** = `.claude/rules/<area>.md` with `paths:`, `incident:` and `expires:` frontmatter; folder `AGENTS.md` files become rules (Claude Code loads rules on single-file Bash views, folder AGENTS.md only on Read).
- **Decisions** gain `status:` (current, superseded, dropped) and `supersedes:` lines; `scripts/docs/decisions.ts` builds the current view and the index (taken from PR #345's `gen-decisions-index`). Haiku proposes supersession links for the 44 prose mentions; a founder confirms.
- **Docs eval** = the 46 questions from the transcript study in `scripts/evals/docs/questions.jsonl`, run through the A/B rig with grep only (no retrieval layer).
- **A/B rig** in the repo (`scripts/harness-ab/`), so both founders and routines use it: worktree at a fixed SHA, `claude -p --output-format stream-json`, oracle and `verify` run outside the agent, `srt` around the run.
- **Routines** = Claude cloud routines (RemoteTrigger) on Mike's account; they need the Claude GitHub App on the repo (currently missing — the gardener died of this). Mike installs it as part of HV-22.
- **Canary** = Cloudflare Workers gradual deployments for the app Worker in `deploy-prod.yml`, 10% then 100% after 15 minutes without an error spike, rollback by version; desktop keeps `desktop-rollout.yml`.
- **Ponytail** is installed as a disabled plugin and enabled only in its rig arm.
- **No pressure language** in any new prompt; the escalation line is calm.

Durable decisions recorded in `docs/decisions/workflow.md` (2026-10-23 · Harness v3).

## Execution blocks

Lanes run in parallel; a lane is a column of dependent blocks. Tier marks the review gate. Estimates are agent-hours.

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| HV-1 | Rails: modes, guards, `/ship` | Auto mode default, `srt` lane profile and allowlist, prod-deploy deny in lanes, `onFailure: "block"` on guards, dead todo hook removed, `ship` user-only, unquoted-glob guard, main-checkout warning and branch-switch guard, session-start without the reading list, `scripts/agent/hooks.test.ts` · Tier 1 · 4 h | AC1, AC6–AC9 | — |
| HV-2 | One Moduo, one Supabase, worktree pool | `.mcp.json` → `mcp.moduo.app`, personal-settings doc for connectors, `bun run wt` / `wt:prune`, stale worktrees pruned · Tier 1 · 3 h | AC5, AC10 | — |
| HV-3 | Skill rewiring | `/s1` without user-only references (lines telling the person what to type), `/s2` exact Skill calls, repro-first bug lane, three strikes + escalation line, one validator pass (advisory, explicit disagreement), `/s3` without the second validator, fast-lane rule, `skill-refs.test.ts` · Tier 1 · 4 h | AC2, AC15–AC17 | — |
| HV-4 | Oracles in CI | `db:test` job with the CLI stack, `rust-check` (from #345), e2e smoke (from #344), path filters; close #344/#345 · **Tier 2** · 6 h | AC20 | — |
| HV-5 | Tier classifier, weakening detector, ratchets | `scripts/ci/tier.ts` + labels, Tier 2 path additions, test-weakening detector, size and complexity ratchets with frozen baselines · **Tier 2** · 5 h | AC19, AC20 | — |
| HV-6 | AI review on PRs into develop | `ai-review.yml` (claude-code-action, `/code-review medium --comment`), advisory, never a required check, REVIEW.md refresh, token in an environment · **Tier 2** · 5 h | AC21 | HV-5 |
| HV-7 | GitHub → Moduo sync | `moduo-sync.yml` + `scripts/agent/moduo-sync.ts` and its event table tests, `MODUO_CI_KEY` · **Tier 2** · 5 h | AC11 | HV-2 |
| HV-8 | Moduo is the queue | Import open blocks into Moduo (tag `block`, spec link, section), Focus as a pinned note, `bun run queue`, `/s2 next` on the queue, `moduo-agent` slimmed (no stage hops), presence via `mcp_tool` hook, delete BUILD_LOG.md, docs/build-log.md, docs/testing/, BUILD_ORDER.md → pointer, `no-ledger.test.ts` · Tier 1 · 6 h | AC12–AC14 | HV-7 |
| HV-9 | Security pass before alpha | Cloudflare security-audit skill (installed project-scoped), `/claude-security` scan, Fable validation, triage table, findings as tasks · Tier 1 (fixes go Tier 2) · 6 h | AC27 | — |
| HV-10 | Rules by path | Folder AGENTS.md → `.claude/rules/*.md`, AGENTS.md trimmed to a map, rules frontmatter, dead-reference check in `verify`, `/doctor prompt-audit` pass · Tier 1 · 4 h | AC28, AC31, AC39 | HV-1 |
| HV-11 | Decisions current view | `status:`/`supersedes:` on every entry, generated index + CI staleness check, `bun run docs:current`, supersession backfill (Haiku proposes, founder confirms) · Tier 1 · 5 h | AC29 | — |
| HV-12 | ast-grep pack | `tools/ast-grep/`, `lint:ast` in verify and CI, edit-time hook, first rules from the #509 classes (supabase `error` ignored, `catch` returning empty in sync, Rust `unwrap_or_default` on decode, bare `DndContext`) · Tier 1 · 5 h | AC30 | — |
| HV-13 | Docs eval | 46 questions in `scripts/evals/docs/`, runner on the rig, baseline score recorded · Tier 1 · 3 h | AC32 | HV-20 |
| HV-14a | Compile gotchas: Supabase + spine | 330 entries → rules, tests, wrappers, comments or deletion · Tier 1 · 6 h | AC30 | HV-10, HV-12, HV-13 |
| HV-14b | Compile gotchas: UI + notes | 310 entries, same treatment · Tier 1 · 6 h | AC30 | HV-10, HV-12, HV-13 |
| HV-14c | Compile gotchas: build-ci, email, calendar, desktop, workflow | 190 entries, same treatment · Tier 1 · 5 h | AC30 | HV-10, HV-12, HV-13 |
| HV-15 | Variant hunt | Benchmark folder seeded with the five #509 tests, hunt skill, five lanes run, report, bug tasks · Tier 1 (fixes Tier 2) · 6 h | AC26 | — |
| HV-16 | RLS access matrix | Matrix for the 10 most sensitive tables + SECURITY DEFINER RPCs, pgTAP generator, policy mutants · Tier 1 (tests only) · 8 h | AC25 | HV-4 |
| HV-17 | Sync outbox property harness | fast-check model + scheduler races, concern mutants, revert check of the five #509 fixes · Tier 1 (tests only) · 10 h | AC24 | — |
| HV-18 | Frozen tests profile | Implement-phase permissions + `srt` write-deny, `frozen-tests.test.ts` · Tier 1 · 2 h | AC16 | HV-1 |
| HV-20 | A/B rig | `scripts/harness-ab/`, task set (5 past fixes + #509 + an impossible-spec task), JSON rows, safety refusals · Tier 1 · 6 h | AC33 | HV-1, HV-2 |
| HV-21 | Weekly numbers | `scripts/agent/numbers.ts`, Moduo note writer, first report · Tier 1 · 4 h | AC34 | HV-5 |
| HV-22 | Routines | Claude GitHub App installed; nightly hunt, weekly retro, daily prod watch (Haiku, digest to a Moduo chat channel), weekly numbers · Tier 1 · 3 h | AC35 | HV-15, HV-21 |
| HV-23 | Router, scout | Router prompt hook + tests, `scout` agent on Haiku · Tier 1 · 4 h | AC3, AC4 | HV-1 |
| HV-24 | Haiku risk hook (shadow) | Prompt hook on prod-touching Bash and risky edits, decision log for the rig · Tier 1 · 2 h | AC36 | HV-1 |
| HV-25 | Experiment arms | Effort, Ponytail and test-prompt arms configured in the rig, first dry runs · Tier 1 · 3 h | AC37 | HV-20 |
| HV-26 | Build engine v3 | Contract-first step, best-of-3 on Tier 2, winner picking by mutants in `/s2` · Tier 1 · 5 h | AC18 | HV-3, HV-18 |
| HV-27 | Catching tests | Tier 2 step in `ai-review.yml` that writes parent-pass/diff-fail tests as comments · **Tier 2** · 4 h | AC22 | HV-6 |
| HV-28 | Canary and rollback | Gradual deployment + automatic rollback in `deploy-prod.yml`, staging rehearsal of a forced spike · **Tier 2** · 5 h | AC23 | — |
| HV-29 | MCP agent-experience eval | 15 user tasks × 5 runs against `moduo-local`, results file · Tier 1 · 4 h | AC38 | HV-20 |
| HV-30 | Docs and decision close-out | AGENTS.md map (policy, lanes, modes, queue), CONTRIBUTING, decision entries, a real fast-lane run as proof · Tier 1 · 2 h | AC2, AC39 | HV-3, HV-8, HV-10 |

Suggested day plan (9 days, up to five parallel lanes):
- **Fri 24 – Sat 25:** HV-1, HV-2, HV-3, HV-4, HV-5, HV-9 (start), HV-11, HV-12, HV-15, HV-17 (start).
- **Sun 26 – Mon 27:** HV-6, HV-7, HV-10, HV-18, HV-20, HV-23, HV-24, HV-16, HV-17, HV-9 (finish).
- **Tue 28 – Wed 29:** HV-8, HV-13, HV-21, HV-25, HV-26, HV-27, HV-28, HV-29.
- **Thu 30 – Fri 31:** HV-14a/b/c, HV-22, HV-30.
- **Sat 1 Nov:** buffer; develop sync; nothing new lands on 2 Nov.

## Out of scope

- Local or Cloudflare-hosted models, Kev, Clef, embeddings, GraphRAG or any vector index (Anthropic only; the evidence says the docs problem is staleness, not search).
- Shepherd, BMAD, Spec Kit, beads, agent teams, swarms, kanban orchestrators.
- A GitHub merge queue and moving the repo to an organization.
- The Moduo product features this harness will later use: GH-1/2/6 (GitHub on tasks) and a "blocked by" task relation. Both stay in the product roadmap; the Action is the stop-gap.
- Results of the effort, Ponytail and test-prompt experiments (the arms are built; results come after the alpha).
- Changing Maciej's designer posture in `/s1` beyond removing broken references.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [x] **Open questions is empty** — Maciej agreed to everything and Mike settled the review (advisory) on 23 Oct.
- [x] **Data model is named and Supabase-first** — no new tables; Moduo tasks hold block state through the existing connector; block dependencies stay in specs.
- [x] For a **module feature** — not a module feature (harness).
- [x] **Execution blocks** are decomposed, sequenced, and each is context-sized and self-contained.
- [x] **Design constraints acknowledged** — no UI in this spec.
- [x] **Manual-test surfaces identified** — the live checks in the tests table.

## Open questions

- [ ] (none)
