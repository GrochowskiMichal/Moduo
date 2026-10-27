# A/B rig

Runs a **task set × arms × repeats** and writes **one JSON row per run** (specs/harness-v3.md, HV-20, AC33). No harness change is kept until the rig has run it against real past tasks. HV-13 (docs eval), HV-25 (experiment arms) and HV-29 (MCP agent-experience eval) build on it.

```bash
bun run ab list                                                     # task sets and arms
bun run ab run --set core --arms control,smoke --dry-run            # plan only: one "planned" row per run
bun run ab run --set core --tasks 645-notes-reset --arms control --repeats 1
bun run ab check-tasks --set core                                   # calibrate the oracles, no model
bun run ab report .harness-ab/results/<batch>-core.jsonl            # pass rate, cost, time per task × arm
```

`run` flags: `--set` (default `core`), `--arms a,b` (default `control`), `--tasks a,b` (default all), `--repeats n` (default 3), `--base <rev>` (clone every task at that commit instead of its own: the after run of a before/after pair), `--dry-run`, `--keep` (keep the workspace), `--no-verify`. A full `core` sweep with two arms is 7 × 2 × 3 = 42 agent runs: plan the usage before starting one.

## What one run does

1. **Workspace.** `git clone --shared` of this repository into a temp folder, checked out detached at the task's `base`, with `origin` removed (the rig refuses a workspace that still has a remote). A task's `fixtures` folder is copied in and committed, so the agent starts from a clean tree. Then `bun install --frozen-lockfile` (skip with `"install": false`).
2. **Agent.** `scripts/agent/lane.sh` (HV-1, with `MODUO_LANE_PROFILE`, `MODUO_LANE_SETTINGS` and `MODUO_LANE_SRT` pointing at the rig's profile, settings and `srt-offline.mjs`) runs `claude -p --output-format stream-json --verbose` in bypass mode inside `srt`, with `--strict-mcp-config` and no MCP servers, `--setting-sources project` (the harness as committed at `base`, not your user settings), `--no-session-persistence`, and the arm's model and effort. `"implement": true` adds `--implement`, the frozen-tests phase (HV-18). The transcript is `stream.jsonl`. When the task's base has the shadow risk hook (HV-24), its decisions land in `risk-decisions.jsonl` beside it (`MODUO_RISK_LOG`); read them with `readDecisions()` from `scripts/agent/risk-hook.ts`.
3. **Oracle, outside the agent.** The task's `oracle.files` are copied from its `fix` commit over whatever the agent wrote (the hidden tests), then each `oracle.checks` command runs in the same sandbox.
4. **Verify.** The set's `verify` (or the task's; `null` skips it) runs the same way.
   The workspace isn't a trusted folder, so Claude Code ignores the project's `permissions.allow` (bypass mode allows everything anyway); its deny rules and hooks still apply.
5. **Row.** Appended to `.harness-ab/results/<batch>-<set>.jsonl`; the transcript, prompt, diff and logs go to `.harness-ab/runs/<runId>/` (gitignored). The workspace is deleted unless `--keep`.

## Safety refusals

A run never touches the shared local Supabase stack, production (the app, its Supabase project, `mcp.moduo.app`) or a git remote. `safety.ts` holds the one list; the rig refuses (exit 3) before anything starts when a task, an arm or `--source` names any of them.

- **Network:** the run's srt profile is `.claude/sandbox/lane.srt.json` cut to the model API and `registry.npmjs.org`: no `mcp.moduo.app`, no GitHub, no local services from the allowlist. Tests need local binding (rstest probes a port), and with it srt's macOS profile opens every localhost port, so the agent and the checks run through `srt-offline.mjs`, which builds the same sandbox with srt's library and denies the stack's ports (54320–54329) after srt's localhost rule; it refuses to run if that rule isn't there. The host checks in `safety.ts` are a backstop: names that resolve to loopback (`vcap.me` and the like) are stopped by the resolved-address check in srt itself, so the rig expects **srt ≥ 0.0.81**. A host with an IPv4 address in its name (e.g. `ec2-54-1-2-3.compute-1.amazonaws.com`) is refused too. An arm may add hosts with `"network"`: plain host names only (no wildcard, IP or port), never a local one or one under a forbidden domain (`FORBIDDEN_DOMAINS`, matched as the host or any subdomain). macOS only, like the frozen-tests globs.
- **Environment:** the agent and the checks get `PATH`, `HOME`, the locale and model auth only; Supabase URLs, `MODUO_*` keys and tokens are dropped. The source checkout's `.env*`, `~/.config/gh`, `~/.supabase` and `~/.wrangler` are unreadable.
- **MCP:** none. An arm can't add MCP servers or pass `--mcp-config`, `--settings`, `--permission-mode`, `--add-dir` or the other flags the rig owns. A row whose transcript shows any MCP server is an `error`.
- **Models:** Anthropic only (an alias or a `claude-*` ID).

HV-29's MCP eval doesn't loosen any of this: it runs on its own Supabase stack (project `moduo-mcp-eval`, ports 553xx) and `safety.ts` allows exactly one MCP target, that stack's connector (`refuseMcpTarget`). See [mcp-eval/README.md](./mcp-eval/README.md).

## Adding a task set

A set is a folder `tasks/<set>/` with a `set.json` (`description`, `verify`) and one `<id>.json` per task (the file name is the id). Fields (type `Task` in `model.ts`):

| Field | Meaning |
| --- | --- |
| `base` | Commit the workspace is cloned at: for a past fix, the fix's parent. |
| `fix` | Commit the oracle files come from; `check-tasks` expects the checks to pass there. |
| `prompt` | The bug as a person would report it: symptom, area, expected behavior. Never the fix. |
| `expect` | `fix` (the checks pass) or `defect-report` (the agent ends with a `DEFECT REPORT` and edits no test; needs `implement: true`). |
| `oracle.files` | Hidden test files copied from `fix` after the agent finishes. |
| `oracle.checks` | `{ name, run, expect? }`: commands run in the workspace; `expect: "fail"` passes when the command fails. |
| `oracle.env` | Extra environment for the checks: only `TZ` and `MODUO_HUNT` (`ORACLE_ENV` in `model.ts`). |
| `fixtures`, `hide`, `install`, `verify` | A folder copied in before the agent; paths removed before the agent (both relative, no `..`); `false` skips `bun install`; the task's own verify command or `null`. |
| `hide` | Paths deleted (and committed) before the agent starts: an answer key that a later `--base` contains. |

After adding a task, run `bun run ab check-tasks --set <set> --tasks <id>`: with no agent, the oracle must fail at `base` (the bug is there) and pass at `fix`. `rig.test.ts` checks every set's tasks are well formed and their commits exist.

**Question sets** (the docs eval, `scripts/evals/docs/`) fit the same shape: `base` is a fixed commit, the prompt is the question, `install: false`, and the oracle grades the answer. After the agent finishes (and after the diff is taken) the rig writes its final message to `.harness-ab/answer.md` in the workspace; every check gets `HARNESS_AB_ANSWER` (that file) and `HARNESS_AB_RIG` (this folder), so a grader can live in this checkout, out of the agent's sight: `bun "$HARNESS_AB_RIG/../evals/docs/grade.ts" E01`. `check-tasks` writes no answer, so a grader fails at base. The row keeps the first 2,000 characters of the answer (`agent.result`), the run folder the full transcript.

## Adding an arm

One file `arms/<id>.json` (type `Arm` in `model.ts`):

| Field | Meaning |
| --- | --- |
| `model`, `effort` | `opus`/`sonnet`/`haiku`/`fable` or a `claude-*` ID; `low` … `max`. |
| `settings` | Merged into `.claude/settings.lane.json` for this arm (`enabledPlugins` for Ponytail, extra `permissions.deny`). |
| `settingSources` | Default `project`; `user,project` to load your user settings (plugins installed at user level). |
| `promptPrefix`, `promptSuffix`, `appendSystemPrompt` | Framing around the task's prompt (the tdd vs contract-first test prompt). |
| `args`, `env`, `network` | Extra claude flags (not the rig's own); environment, only `ARM_*`, `EXPERIMENT_*` or `FEATURE_*` variables; hosts. All pass the refusal checks. |
| `experiment` | `{ name, baseline }`: the experiment the arm belongs to and the arm it is compared with. `run` refuses an arm that differs from its baseline in anything the experiment doesn't vary (`EXPERIMENTS` in `model.ts`). |

## Experiment arms (HV-25, AC37)

Each differs from `control` (opus, high effort) in one thing only; the results come after the alpha.

| Experiment | Arms | What changes |
| --- | --- | --- |
| `effort` | `control` vs `effort-medium` | `--effort medium` instead of `high`. |
| `ponytail` | `control` vs `ponytail` | The [Ponytail](https://github.com/DietrichGebert/ponytail) plugin (a third-party skill, still on Claude) enabled through the arm's settings. |
| `test-prompt` | `prompt-tdd` vs `prompt-contract-first` (plus `control` as no framing) | A `promptSuffix` after the task: test-first, or contract first then tests then code. |

```bash
bun run ab run --set core --arms control,effort-medium --repeats 3
bun run ab run --set core --arms prompt-tdd,prompt-contract-first,control --repeats 3
```

**Ponytail setup, once per machine, disabled.** The rig's workspace is a temp clone, so a project-scoped plugin never loads there, and `--setting-sources project` ignores your user settings: the plugin must be installed at **user** scope and left disabled, and only the arm's `enabledPlugins` turns it on.

```bash
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install ponytail@ponytail --scope user && claude plugin disable ponytail@ponytail --scope user
```

A real run refuses an arm whose plugin isn't installed at user scope (a dry run warns), and a row whose session didn't load the arm's plugins is an `error` (the row's `agent.plugins` lists what loaded), so a Ponytail run never quietly runs as control.

The prompt arms say nothing about a skill: in the temp clone the project's plugins (the `tdd` skill among them) are installed for the main checkout's path and don't load. On `impossible-spec` (the frozen-tests phase) the test edits these prompts ask for are denied; that's part of what the experiment measures.

`control` is the harness as committed at each task's commit on the default build model; `smoke` is a cheap arm for checking the rig itself. Compare arms on the same batch with `bun run ab report`.

## The row

`Row` in `model.ts`, `schema: 1`: `runId`, `batch`, `set`, `task`, `arm`, `repeat`, `base`, `rigSha`, `model`, `effort`, `expect`, `startedAt`, `outcome` (`planned` · `pass` · `fail` · `error`), `error`, `ms` (setup, agent, oracle, verify), `agent` (model seen, MCP servers and plugins seen, turns, cost, tokens, tool counts, test tries, defect report, result excerpt, exit), `diff` (files, insertions, deletions, test files touched), `oracle` (each check's exit), `verify`, `safety` (MCP servers, remotes, reachable hosts), `artifacts`. Change a field's meaning and bump `schema`.
