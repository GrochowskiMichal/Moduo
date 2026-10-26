# A/B rig

Runs a **task set × arms × repeats** and writes **one JSON row per run** (specs/harness-v3.md, HV-20, AC33). No harness change is kept until the rig has run it against real past tasks. HV-13 (docs eval), HV-25 (experiment arms) and HV-29 (MCP agent-experience eval) build on it.

```bash
bun run ab list                                                     # task sets and arms
bun run ab run --set core --arms control,smoke --dry-run            # plan only: one "planned" row per run
bun run ab run --set core --tasks 645-notes-reset --arms control --repeats 1
bun run ab check-tasks --set core                                   # calibrate the oracles, no model
bun run ab report .harness-ab/results/<batch>-core.jsonl            # pass rate, cost, time per task × arm
```

`run` flags: `--set` (default `core`), `--arms a,b` (default `control`), `--tasks a,b` (default all), `--repeats n` (default 3), `--dry-run`, `--keep` (keep the workspace), `--no-verify`. A full `core` sweep with two arms is 7 × 2 × 3 = 42 agent runs: plan the usage before starting one.

## What one run does

1. **Workspace.** `git clone --shared` of this repository into a temp folder, checked out detached at the task's `base`, with `origin` removed (the rig refuses a workspace that still has a remote). A task's `fixtures` folder is copied in and committed, so the agent starts from a clean tree. Then `bun install --frozen-lockfile` (skip with `"install": false`).
2. **Agent.** `scripts/agent/lane.sh` (HV-1) runs `claude -p --output-format stream-json --verbose` in bypass mode inside `srt`, with `--strict-mcp-config` and no MCP servers, `--setting-sources project` (the harness as committed at `base`, not your user settings), `--no-session-persistence`, and the arm's model and effort. `"implement": true` adds `--implement`, the frozen-tests phase (HV-18). The transcript is `stream.jsonl`.
3. **Oracle, outside the agent.** The task's `oracle.files` are copied from its `fix` commit over whatever the agent wrote (the hidden tests), then each `oracle.checks` command runs inside `srt` with the same profile.
4. **Verify.** The set's `verify` (or the task's; `null` skips it) runs the same way.
5. **Row.** Appended to `.harness-ab/results/<batch>-<set>.jsonl`; the transcript, prompt, diff and logs go to `.harness-ab/runs/<runId>/` (gitignored). The workspace is deleted unless `--keep`.

## Safety refusals

A run never touches the shared local Supabase stack, production (the app, its Supabase project, `mcp.moduo.app`) or a git remote. `safety.ts` holds the one list; the rig refuses (exit 3) before anything starts when a task, an arm or `--source` names any of them.

- **Network:** the run's srt profile is `.claude/sandbox/lane.srt.json` cut to the model API and `registry.npmjs.org`: no `127.0.0.1` ports, no `mcp.moduo.app`, no GitHub. An arm may add hosts with `"network"`, never a local one or a forbidden one.
- **Environment:** the agent and the checks get `PATH`, `HOME`, the locale and model auth only; Supabase URLs, `MODUO_*` keys and tokens are dropped. The source checkout's `.env*`, `~/.config/gh`, `~/.supabase` and `~/.wrangler` are unreadable.
- **MCP:** none. An arm can't add MCP servers or pass `--mcp-config`, `--settings`, `--permission-mode`, `--add-dir` or the other flags the rig owns. A row whose transcript shows any MCP server is an `error`.
- **Models:** Anthropic only (an alias or a `claude-*` ID).

HV-29 runs against `moduo-local`, which is the shared stack: it needs its own stack (or a reviewed exception added to `safety.ts`), not a looser arm.

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
| `oracle.env` | Extra environment for the checks (`TZ`, `MODUO_HUNT`). |
| `fixtures`, `install`, `verify` | A folder copied in before the agent; `false` skips `bun install`; the task's own verify command or `null`. |

After adding a task, run `bun run ab check-tasks --set <set> --tasks <id>`: with no agent, the oracle must fail at `base` (the bug is there) and pass at `fix`. `rig.test.ts` checks every set's tasks are well formed and their commits exist.

**Docs eval (HV-13) and similar question sets** fit the same shape: `base` is a fixed commit, the prompt is the question, `install: false`, and the oracle is a check script in the set's `fixtures` that reads the answer. The rig keeps the agent's final answer in the row (`agent.result`, first 2,000 characters) and the full transcript in the run folder.

## Adding an arm

One file `arms/<id>.json` (type `Arm` in `model.ts`):

| Field | Meaning |
| --- | --- |
| `model`, `effort` | `opus`/`sonnet`/`haiku`/`fable` or a `claude-*` ID; `low` … `max`. |
| `settings` | Merged into `.claude/settings.lane.json` for this arm (`enabledPlugins` for Ponytail, extra `permissions.deny`). |
| `settingSources` | Default `project`; `user,project` to load your user settings (plugins installed at user level). |
| `promptPrefix`, `promptSuffix`, `appendSystemPrompt` | Framing around the task's prompt (the tdd vs contract-first test prompt). |
| `args`, `env`, `network` | Extra claude flags (not the rig's own), environment, hosts. All pass the refusal checks. |

`control` is the harness as committed at each task's commit on the default build model; `smoke` is a cheap arm for checking the rig itself. Compare arms on the same batch with `bun run ab report`.

## The row

`Row` in `model.ts`, `schema: 1`: `runId`, `batch`, `set`, `task`, `arm`, `repeat`, `base`, `rigSha`, `model`, `effort`, `expect`, `startedAt`, `outcome` (`planned` · `pass` · `fail` · `error`), `error`, `ms` (setup, agent, oracle, verify), `agent` (model seen, MCP servers seen, turns, cost, tokens, tool counts, test tries, defect report, result excerpt, exit), `diff` (files, insertions, deletions, test files touched), `oracle` (each check's exit), `verify`, `safety` (MCP servers, remotes, reachable hosts), `artifacts`. Change a field's meaning and bump `schema`.
