# CV-E2E — e2e isolation across worktrees

> Branch `t/maciej/cv-e2e-isolation` · head: the branch tip (the hand-back names it) · status: built, not landed (cut from `b22678e4`; the build branch has moved on, so land it with a merge, never by taking this tree)
> Migration: none. App code: none. Touches `playwright.config.ts`, `scripts/agent/`, `tests/support/local-stack.ts` and the runbook's step 3 only.

## Delivered against the row

- **A port per worktree.** `playwright.config.ts` without `E2E_BASE_URL` starts this worktree's own `rsbuild dev --host 127.0.0.1 --port <p>` (`MODUO_TARGET=web`), `reuseExistingServer: false`. `<p>` = 8200 + sha1(real path of the worktree) % 800 (`scripts/agent/e2e-env.ts`; clear of 8081, 6006, 54321–54329 and the 81xx ports the older spec headers name; `E2E_PORT` pins it). The e2e, perf and clips projects share one `APP_URL`. Rsbuild is called directly because `dev:web` pins `--port 8081` on the command line, which beats the config. A busy port fails loudly (the wrapper says who holds it; it never kills it). `E2E_BASE_URL` still means "my own server, start nothing", so the old spec headers keep working. `bun run e2e` in the main checkout starts that checkout's server on its own port too.
- **Servers only when a run needs them.** Playwright starts every `webServer` entry whatever `--project` says, so each e2e run also tried to boot Storybook (180 s). The app server now boots only when e2e, perf or clips is part of the run, Storybook only when `visual` is (no `--project` = everything, as before; `runsProject` in `e2e-env.ts` reads the runner's argv, case-insensitive, `*` counts as "maybe").
- **One e2e run at a time on the local stack, across worktrees: `scripts/agent/e2e.sh <playwright args…>`.** Machine-wide lock = atomic `mkdir ${TMPDIR:-/tmp}/moduo-e2e.lock` holding `pid`, `start` (the process's `lstart`, so a reused pid isn't mistaken for the holder), `worktree`, `cmd`, `since`, and `tree` (the run's own pid: a wrapper that is SIGKILLed leaves Playwright running, and the lock stays held until that ends). Waiters print "waiting for <worktree>'s e2e run (<args>, running Nm)" at once and every 30 s, give up after `E2E_LOCK_TIMEOUT` (default 2700 s, exit 75). A dead holder's lock is reclaimed under a second mutex that re-checks the lock it judged. The wrapper also: exports `DOCKER_CONTEXT=orbstack` when the default context can't see the stack (`stackKeys()` calls `supabase status`), refuses to start when `.env.local` points at the cloud or the stack is down, adds `--project=e2e` unless a project is named, checks the worktree's port under the lock, runs through `quiet.sh`, and on INT/TERM/HUP stops the run before releasing.
- **Runbook:** step 3's first bullet now says e2e goes only through `e2e.sh` (one sentence). Nothing else in the runbook changed.
- **Three spec bugs, found by the full runs (none by the five blocks' own specs):**
  1. `endFocusRuns` (`tests/support/local-stack.ts`) PATCHed `status: ended` without clearing `paused_at`, so a Focus run any earlier test or person left paused made it fail with a `focus_runs_paused` CHECK violation (400) in the setup of `focus.spec.ts` and trust-pass AC1.6, and the serial blocks behind them never ran. It now sends `paused_at: null` too.
  2. `focus.spec.ts` (`openFocus`, `openFocusIn`) and trust-pass's `openFocus` waited for `[data-slot="focus-view"]` to be visible, but the loading skeleton (`FocusSkeleton`, `aria-busy="true"`) carries the same `data-slot`, so the wait passed on the skeleton and the next assertion (the Now card, default 5 s) raced the store load: AC8.5 failed once under load (the failure's page snapshot showed only the `Focus` heading). They now wait for `:not([aria-busy="true"])`.
  3. `project-overview.spec.ts` opened `/tasks?id=<project>`, switched the panel view and asserted the description at the default 5 s while the page was still "Loading tasks" (the snapshot showed Inbox, a loading grid and "No project here"). Its first assertion now carries the same 20 s first-load wait every other spec's first line has.

## The numbers

| | runs | red | notes |
| --- | --- | --- | --- |
| Tasks v3 build (builders' own e2e runs, before) | 513 | 170 (33%) | 168 of those passed on a later run; 44% of all e2e minutes went to failing runs |
| First full run with the isolation but before the helper fix | 66 tests | 2 failed, 13 not run | the leftover paused Focus run above (it poisoned `focus.spec.ts`, trust-pass AC1.6 and what was serial behind them) |
| Specs behind TV-D11b / TV-D11a / TV-U6 / TV-U14 / TV-U10, `--repeat-each=5`, no retries, one file at a time | 105 | 0 | `offline` 10, `tasks-sidebar` 20, `capture` 15, `tasks-dnd` 30, `tasks-list` 5, `tasks-detail` 25 |
| Every other e2e spec, `--repeat-each=3`, no retries, one file at a time | 135 | 0 | focus 18, trust-pass 36, tasks-toolbar 12, onboarding 6, inbox 15, tasks-bulk 3, tasks-views 6, home-widgets 3, importers 6, project-overview 3, references 12, reminders 3, time-report 3, tasks-timeline 9 |
| Whole `e2e` project through the wrapper, 3 runs, other worktrees building (load average 4–6), before fixes 2 and 3 | 3 × 66 | 2 runs red, 1 test each | AC8.5 once, project-overview once: both race the app's own store load, which no lock or port can help |
| `focus` and `trust-pass` `--repeat-each=5`, `project-overview` `--repeat-each=5`, after fixes 2 and 3 | 95 | 0 | focus 30, trust-pass 60, project-overview 5 |
| Whole `e2e` project through the wrapper, twice in a row, on the final code (after) | 2 × 66 | 0 | 9.9 min and 9.8 min |

## Review

`bun run verify` green. Validator round 1: no BLOCKER, one MAJOR (the port check ran before the lock and could tell an agent to kill its own run), several MINORs in the lock (a waiter could delete a lock it had judged dead after the holder released and another waiter took it; the lock followed the wrapper's pid, not the run's); all fixed, round 2 on the delta: no BLOCKER/MAJOR. Left as NITs: the signal handler waits only for `quiet.sh`, not the whole tree, before releasing; `?` counts as a wildcard in `runsProject` (Playwright expands only `*`; the cost is one needless server). The three later spec fixes (Focus and project-overview waits) came after round 2 and were not re-reviewed; they are single-assertion changes.

## Acceptance criteria proven

| Ask | Proof |
| --- | --- |
| A port per worktree, never someone else's server | this worktree resolves to 8672; the runs above started and stopped their own rsbuild there; a stand-in listener on 8672 makes the wrapper exit 2 naming its pid, without touching it; three other dev servers (8093, 8100, 8131) were up the whole time and never used |
| One run at a time across worktrees | a live fake holder: the second wrapper printed "waiting for agent-fake's e2e run" and exited 75 at the timeout; five wrappers racing over one dead lock all ran, one at a time, with exactly one "removing a stale lock" |
| Signals | SIGTERM mid-run: exit 143, lock removed, no Playwright or rsbuild left; SIGKILL of the wrapper mid-run: the lock stayed held while the orphaned run lived and was reclaimed after it ended |
| The real flakes | the five blocks' specs never failed once the port and the lock are in (0 of 105, no retries); the reds the full runs still found were the three spec bugs above, each fixed at its cause and re-run |

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **Lock in `${TMPDIR:-/tmp}`, a `mkdir`.** As the brief says. Assumption to check once: every session that runs e2e shares the user-level `$TMPDIR` (`/var/folders/…/T/`); a session with another `TMPDIR` would not see the lock. Rejected: a fixed `/tmp/moduo-e2e.lock` (a sandboxed session may not write `/tmp`).
- **Hash of the real path, 800 ports, no probing.** Stable per worktree and the same in the runner and every worker; two worktrees can collide with p ≈ 1/800, and then the second one's run says so instead of guessing. Rejected: probing for a free port (the config loads in every worker and must agree).
- **`reuseExistingServer: false`, a cold start per invocation.** A run never tests a server it didn't start; Rsbuild's cache keeps the start to seconds. Rejected: reusing a server by "looks like ours" (can't prove which tree it serves).
- **Storybook left on 6006 and reusable**, started only for the visual project. The visual project is a checkpoint and human job on one tree; a per-worktree Storybook port was not asked for.
- **The wrapper adds `--project=e2e`.** A bare `playwright test` also runs the perf project (needs the 10k seed) and the visual project (needs Storybook).
- **No retries, no sleeps, no global timeout change.** The two waits that got `timeout: 20_000` are first-load readiness waits (the suite's existing convention), on the state the assertion needs.

## Gotchas (area: ui)

- **E2E on the shared local stack goes through `scripts/agent/e2e.sh`, never a bare `bunx playwright test`.** Every spec signs in as `dev@moduo.local` in the same workspace, so two runs at once read each other's rows, and without `E2E_BASE_URL` the old config reused whatever dev server was on 8081 (often another worktree's code). The wrapper takes a machine-wide lock and the config starts the worktree's own server on its own port. (CV-E2E, 2026-10-14.)
- **`stackKeys()` runs `supabase status`, which fails ("No such container: supabase_db_moduo") unless `DOCKER_CONTEXT=orbstack`.** Every e2e spec dies in setup when the Playwright process doesn't have it; `e2e.sh` exports it when the default context can't see the stack.
- **Playwright starts every `webServer` entry whatever `--project` says**, so an e2e-only run also booted Storybook. The config now decides from argv which servers a run needs.
- **`dev:web` hardcodes `--port 8081`, and the CLI flag beats `server.port` and `PORT`.** Call `./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port N` to pick a port.
- **A loading skeleton that shares the real view's `data-slot` makes "the view is visible" a wait that passes on the skeleton.** `FocusSkeleton` is `data-slot="focus-view"` with `aria-busy="true"`; wait for `[data-slot="focus-view"]:not([aria-busy="true"])` (or the first line of real content with the 20 s first-load wait), never the bare slot. The same goes for any spec that deep-links (`/tasks?id=…`) and then asserts store-dependent content at the default 5 s: until the store has loaded the page is the Inbox and the panel says "No project here". On a busy Mac (several worktrees building) the load alone can pass 5 s.
- **A cleanup that flips `status` has to clear the fields its CHECK ties to it.** `focus_runs_paused` is `(status = 'paused') = (paused_at is not null)` (and `focus_runs_ended` likewise for `ended_at`): ending a paused run needs `paused_at: null`.

## For later blocks

- **Orchestrator:** the runbook's checkpoint line ("the full e2e run serially", `docs/agents/chat-v2-build.md` Checkpoints section) and any block's final full run should use `scripts/agent/e2e.sh` too; this block left those sections alone on purpose. A human's `bun run e2e` or `bun run perf` skips the lock.
- **Every CV block with an e2e spec:** run it as `scripts/agent/e2e.sh tests/<spec>` in the background (it may wait for another worktree's run). Seed your own rows with `runTag()` and read them back by what you created, as `capture.spec.ts` and `offline.spec.ts` do; the shared dev Inbox holds hundreds of runs' tasks.
- **Known limit:** SIGKILL of the wrapper skips its trap; the lock then stays held through the run it started (`tree`) and is reclaimed within seconds of that run ending. A hard-killed run can leave its rsbuild on the port: the next run of that worktree says so and names the pid.

## Manual checklist (step → expect → surface)

- [ ] Start `scripts/agent/e2e.sh tests/capture.spec.ts` in two worktrees at once → the second prints "waiting for <the first>'s e2e run" and starts when the first ends → terminal.
- [ ] `bun run e2e` in the main checkout (no env, nothing on its derived port) → starts its own server and Storybook, runs every project → terminal.

## Verify before release

- A concurrent run from a session whose `TMPDIR` differs (see the lock assumption above): `echo $TMPDIR` in two sessions.
