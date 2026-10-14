# Tasks v3 build: runbook and handoff

How the Tasks v3 build runs, so anyone can pick it up: Maciej, Mike, or an agent session either of them starts. The spec is [specs/tasks-v3.md](../../specs/tasks-v3.md). The rules and every carry-forward note live in the 🟠 box at the top of the "Tasks v3" section of [specs/BUILD_ORDER.md](../../specs/BUILD_ORDER.md). Finished blocks are in [specs/BUILD_LOG.md](../../specs/BUILD_LOG.md), and decisions in [docs/decisions/tasks.md](../decisions/tasks.md).

> **Closed 2026-10-14: Tasks v3 is released** (prod database, functions, `develop`, `prod-app`; see BUILD_LOG "Tasks v3 release"). This runbook is the record of how v3 was built. New Tasks work branches off `maciej` the normal way, and visual and functional follow-ups go through the dogfood board in the shared Moduo workspace.

## Where it stands (2026-10-11)

**Landed** on `t/maciej/tasks-v3-build` and merged into `maciej`:
- TV-D5, TV-P0, SH-1, TV-U2, DS-6, TV-U4, TV-D8, RF-1, TV-D9, TV-D10;
- TV-D11a, the shared store;
- TV-U6, the sidebar;
- TV-D10-fix;
- TV-D11b, virtualization and the 10k fixture;
- TV-U14, capture.

SH-0 and PERM-W landed in their own sessions.

**None of v3's migrations are on prod.** Everything is migrated to prod at once when the module is done, and only when Maciej says "release". Until then, `maciej` must not be synced into `develop` (see AGENTS.md §Git).

**Ready now** (every dependency has landed):

| Block | Lane | Migration? |
| --- | --- | --- |
| TV-U13 Detail panel v3 + full page | panel | yes (reactions) |
| TV-U10 List v3 | ui | no |
| TV-D12 Recurrence a–i, reminders, notifications | data | yes |
| TV-D14 Time entries, report, Time & region | data | yes |
| TV-U8 Saved views | ui | yes |
| TV-F6 Focus salvage + one time engine | focus | yes (re-cut `focus_runs`) |

**After those:**
- TV-U10 unlocks TV-U11, U12, U15 and TL1;
- TV-D12 unlocks TV-D13, which unlocks TV-D16, which unlocks TV-U18;
- TV-U13 and TV-F6 unlock TV-F7, which unlocks TV-F8;
- TV-U13 and TV-U14 unlock TV-D15;
- TV-U6, TV-U13 and TV-D14 unlock TV-U16;
- TV-U15 and TV-F7 unlock TV-U17;
- TV-D11a, TV-D13 and TV-D14 unlock TV-H1;
- TV-D7 goes last.

AT-2 and AT-3 belong to the attachments session.

**Migration order:** D12 → D14 → D13 → U13 → U8 → F6 → D15 → D16 → D7.
- Only one block applies a migration to the local database at a time.
- A block's UI work can start in parallel. It applies its migration only on its turn, with a timestamp after every migration already landed.
- Never two blocks altering `tasks` or `buckets` at once.

## Set up a machine

1. Check out the integration branch from origin:
   ```bash
   git fetch origin && git switch -c t/maciej/tasks-v3-build origin/t/maciej/tasks-v3-build
   ```
   On Maciej's machine it already exists, so run `git pull --ff-only` instead.
2. `bun install`.
3. Start a local Supabase stack, replay every migration and point the app at it:
   ```bash
   bun run local:up
   bun run local:reset
   bun run env:local
   ```
   The local stack is "prod" for this build. Never touch the cloud project: no Supabase MCP, no `--project-ref`.
4. `bun run verify` should pass. `bun run perf:seed` then `bun run perf` checks the 10k-task budget against the local stack.

## Run the build: orchestrator prompt

Paste this into a fresh session on the integration branch, on Opus 5.5 at high effort:

```
You orchestrate the Tasks v3 build. Read docs/agents/tasks-v3-build.md, then the 🟠 box in specs/BUILD_ORDER.md ("Tasks v3"), then specs/tasks-v3.md.

Start one background helper per ready block (Agent tool, isolation: worktree), giving each the "Helper brief" from the runbook plus its block id. Keep at most three running, and only one applying a migration at a time, in the runbook's migration order.

When a helper hands back:
- check its landing on origin/t/maciej/tasks-v3-build;
- relay security findings to the helper that owns the code; never write them into repo files, because the repo is public;
- start the next block whose dependencies have all landed.

Product questions: decide them yourself and record each as "agent's choice, deferred to by Maciej". Never open a PR into develop, never sync maciej → develop, never touch the cloud project, never release.

Report briefly after each landing. When you stop, merge the integration branch into maciej with a merge-commit PR, and update the "Where it stands" section of the runbook.
```

## Helper brief

Paste this into each block helper's prompt, after "Build <BLOCK-ID>".

- **Read first:**
  - the 🟠 box in `specs/BUILD_ORDER.md` ("Tasks v3"), including the carry-forward notes that name your block;
  - your row in `specs/tasks-v3.md`, plus the ACs, Assumptions and AC→test map it cites;
  - `docs/decisions/tasks.md`;
  - the BUILD_LOG "Tasks v3" section;
  - `docs/gotchas.md` and the area files;
  - `AGENTS.md`: tokens only, `@contracts`, migration rules, `getRuntime()`.
- **Set up:**
  - `git fetch origin && git switch -c t/<owner>/<block-kebab> origin/t/maciej/tasks-v3-build`;
  - use the local stack only;
  - apply your migration only on its turn in the migration order.
- **Done when:**
  - `bun run verify` passes;
  - the `validator` subagent reports no BLOCKER or MAJOR;
  - a `/code-review high`-style self-review is fixed;
  - the block is live-verified in the local app if it has UI (`bun run dev:web`).
- **Land:**
  1. Commit with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  2. `git fetch origin && git merge origin/t/maciej/tasks-v3-build`, as a merge commit, never a rebase.
  3. Re-run verify.
  4. `git push origin HEAD:t/maciej/tasks-v3-build`. It must be a fast-forward; if it's refused, merge again and retry.
  5. `git push origin t/<owner>/<block-kebab>` as a backup.
- **Commit with the block:**
  - the BUILD_ORDER tick;
  - a BUILD_LOG entry under "Tasks v3";
  - decisions in `docs/decisions/tasks.md` (who · decision · why · rejected);
  - gotchas, if any;
  - `docs/testing/t-<owner>-<block-kebab>.md`;
  - a "From <BLOCK>" carry-forward note in the 🟠 box for later blocks.
- **Never:**
  - a PR into develop, or a push to `maciej`, `develop` or `main`;
  - anything against the cloud project;
  - security details in commits or docs; tell the orchestrator instead.
- **Product questions:** answer them yourself, recorded as "agent's choice, deferred to by Maciej". Anything you can't verify locally goes under "verify before release" in your checklist.
- **Return at most 200 words:**
  - the landed commit;
  - what you delivered against the row;
  - what you deferred, and to which block;
  - your agent's choices;
  - notes the next block must inherit.

## Known loose ends

- **e2e under load:** resolved by TV-POLISH: the `e2e` project runs one spec at a time (`workers: 1`), so the whole suite passes together. The remaining polish lines are in [docs/testing/tasks-v3-polish-deferred.md](../testing/tasks-v3-polish-deferred.md).
- **Owner account deletion:** deleting an account that owns a workspace fails on the local stack (`tasks_workspace_id_fkey`). Check it against the erasure work (PRIV) before release.
- **Checkpoint polish:** the 🟠 box's carry-forward notes name the polish items found at checkpoint 1 (U10 truncation, U13 time value and avatars, the menu bottom fade). Each belongs to its block.
