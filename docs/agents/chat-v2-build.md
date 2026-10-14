# Chat v2 build: runbook

How the Chat v2 build runs, so anyone can pick it up. The spec is [specs/chat-v2.md](../../specs/chat-v2.md) (blocks CV-0…CV-23); the rules for the local stack are the 🟠 box of the "Chat v2" section in [specs/BUILD_ORDER.md](../../specs/BUILD_ORDER.md). This build changes the Tasks v3 way of working on purpose: measured on Tasks v3, 60 of 90 calendar hours were spent waiting for a human and 85% of tokens went to builders re-reading 0.5 M-token contexts on every turn.

## Decided (Maciej, 2026-10-14, calls B1–B6)

- **B1 · No stopping:** the build runs through nights, never asks mid-run (product questions become "agent's choice, deferred to by Maciej", recorded in the block's record file), and restarts by itself after a usage limit at its reset time.
- **B2 · Three builders at once**, at most; one chat migration at a time, never while a Tasks block applies one.
- **B3 · Models:** builders and the validator on Opus 5.5; briefs, record folding, merges, recon and test triage on Sonnet 5.5.
- **B4 · Reviews:** one validator round on the block (a second round only on what changed, given the first round's findings); `/code-review high` only on Tier-2 blocks; one security scan per Tier-2 block at its end; `/code-review ultra` and `/claude-security` once before the release.
- **B5 · Checkpoints** every 5–6 landed blocks: records folded, full verify and the full e2e run serially, screenshots, a short report to Maciej that doesn't pause the build.
- **B6 · The orchestrator** is the Chat re-plan session (`t/maciej/chat-replan` → `t/maciej/chat-v2-build`).

## Roles

| Who | Model | Does | Never |
| --- | --- | --- | --- |
| Orchestrator | Opus 5.5 | picks ready blocks, writes or assigns the brief, starts builders (background, `isolation: worktree`), grants migration turns, **lands** blocks in a queue, runs integration checks, folds records at checkpoints, reports to Maciej | reads code beyond what a landing needs; asks Maciej mid-run |
| Builder | Opus 5.5, high | builds one block from its brief on its own branch, proves it, writes its record file, hands back | merges into or pushes to `t/maciej/chat-v2-build`; edits shared records; touches the cloud |
| Validator | Opus 5.5, high | reviews the block's diff against its brief | edits |
| Helpers | Sonnet 5.5 | briefs, record folding, test triage, recon | product or design decisions |

## The local stack

- It runs under **OrbStack** at `127.0.0.1:54322` (Postgres) and `:54321` (API); the default Docker context on this Mac is Docker Desktop, so run Supabase CLI commands with `DOCKER_CONTEXT=orbstack` and **never `bun run local:up` or `local:reset`** (the stack is up, and a reset wipes local-only data, the research workspace included).
- `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"` reaches it. The local stack keeps no migration history table: apply files as below.
- A fresh worktree has no `.env.local`, and then `dev:web` and e2e talk to the **prod** project: run `DOCKER_CONTEXT=orbstack bun run env:local` first (without the context it fails) and confirm it prints `→ local stack (http://127.0.0.1:54321)`.
- The stack is shared: while another block holds the migration turn, database-backed tests in `verify` (e.g. `chat_privacy.test.sql` via `privacy-rules.test.ts`) can fail on a branch that doesn't touch them. Say so in the hand-back; don't chase it.
- The research workspace "Chat replan research" (`669be464-0b9a-4d84-8537-544ac04dba5f`, 3,032 messages) was converted to v2 by CV-1's conversion migration on 2026-10-14 (Maciej's OK); the v1 dump is in the gitignored `docs/local/chat-v1-fixture/`. Read the workspace freely; don't delete or bulk-rewrite it.
- Apply a migration as the stack's own role and in one transaction: `psql "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres" -1 -v ON_ERROR_STOP=1 -f <file>` (functions created by `scripts/local/stack.sh` are owned by `supabase_admin`, and `SET LOCAL lock_timeout` only works inside a transaction).

## A builder's run

1. **Read your brief** (`docs/build/chat-v2/briefs/<ID>.md`, 5–10 KB) and only the files it names. Don't read the whole spec, `BUILD_ORDER.md`, `BUILD_LOG.md`, `docs/decisions/*` or the gotchas files end to end; `grep` them for your area when the brief points you there.
2. **Branch:** `git fetch origin && git switch -c t/maciej/cv-<id>-<kebab> origin/t/maciej/chat-v2-build`.
3. **Build.** Keep the context small:
   - run tests and typecheck through `scripts/agent/quiet.sh <label> <command…>` (exit code, failures and a short tail only; the full log stays on disk), and **e2e only through `scripts/agent/e2e.sh <playwright args…>`**: it takes the machine-wide e2e lock (one run on the local stack at a time, it prints whose run it waits for, so start it in the background), starts this worktree's own dev server on its own port, adds `--project=e2e`, and runs through `quiet.sh`;
   - batch shell reads into one command, read files in ranges, never `cat` a large file whole;
   - in the inner loop run the typecheck and only the affected test files; run the full `bun run verify` once, before review;
   - run only your block's own e2e specs; the full e2e suite runs at checkpoints, serially;
   - live-check UI with `read_page` / `get_page_text`; take a screenshot only for a visual you must see;
   - at about 250 k tokens of context, stop: write a handoff section in your record file, push, and hand back "handoff"; the orchestrator starts a fresh builder for the rest.
4. **Migration:** write it in `supabase/migrations/` with a provisional stamp, starting every redefined function from its **live body** (`select pg_get_functiondef(…)`). Apply it to the local stack with `psql … -1 -v ON_ERROR_STOP=1 -f` as `supabase_admin` (above) **only when your brief says you hold the migration turn**; otherwise hand back with "migration ready" and the orchestrator applies it in order. Run `bun run db:test chat` after applying. Never `supabase migration up`, never `local:reset`, never the cloud project.
5. **Review:** one `validator` round on your diff, giving it your brief's path and the range. Fix every BLOCKER and MAJOR; if anything was fixed, a second round on the delta only, with the first findings. Tier-2 blocks (migrations, RLS, contracts, `moduo-mcp`): one `/code-review high` and one security scan of the block's diff, at the end.
6. **Record:** fill `docs/build/chat-v2/<ID>.md` from the [template](../build/chat-v2/_template.md): what you delivered, the tests proving each AC, your agent's choices (who · what · why · rejected), gotchas, notes for later blocks, the manual checklist, anything to verify before release. Edit no other record file.
7. **Hand back:** commit (trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), `gh auth switch --user En5hi && git push origin t/maciej/cv-<id>-<kebab>` (in one command: another session keeps switching `gh` to an account that can't push here), and return at most 150 words: the branch and head, verify result, validator result, migration state, what's deferred and to which block.

**Security findings** never go into commits, records or docs (the repo is public): tell the orchestrator in the hand-back.

## Landing (orchestrator)

1. Merge the block branch into `t/maciej/chat-v2-build` with `--no-ff`, in hand-back order.
2. If the merge touched files another landed block also changed: typecheck plus the block's tests through `quiet.sh`; otherwise none.
3. Apply a pending migration (its turn), then `bun run db:test chat`.
4. Push. Tick nothing in `BUILD_ORDER.md` yet: the records are folded at the checkpoint.
5. Every three landings: full `bun run verify` on the integration head.

A builder's branch is never re-merged with the integration head more than once (right before its full verify, and only when a landed block changed files it touches).

## Checkpoints (every 5–6 landings)

A Sonnet helper folds the record files into `specs/BUILD_ORDER.md` (ticks, "From CV-n" notes in the 🟠 box), `specs/BUILD_LOG.md`, `docs/decisions/chat.md` + the index, `docs/gotchas/<area>.md`, and one checklist per block in `docs/testing/`. Then the full verify, the full e2e run serially, screenshots of what landed, and a short report to Maciej.

## Usage limits

On a usage-limit error the orchestrator notes the reset time, sleeps in the background until then, and resumes each stopped builder with a message. Nothing waits for a human.

## Dependencies outside the spec

- **The v1 privacy rules are on prod** (2026-10-14, `supabase/migrations/20261014090000_chat_privacy_rules.sql`, history `20261014102136`): `perm_can_see_entity`'s chat branches (an API key reads no chat row through the spine), the per-conversation typing topic with `chat_op_typing(p_channel_id, p_parent_id, p_stop)` as its only writer, `chat_caps_get` and `share_op_announce`. CV-1 and CV-2a start from those live bodies and don't redo them; the websocket probe `supabase/probes/chat-typing.probe.ts` and `supabase/tests/chat_privacy.test.sql` are reusable. `chat_can_read_channel` still requires the plan (CH4a's change is CV-1's).
- **Tasks v3** keeps landing on `t/maciej/tasks-v3-build`: merge it into the Chat build head when a Tasks block lands a migration.

## Where it stands

Kept current by the orchestrator. **2026-10-14, evening:** landed: the kit, the v1 privacy rules and the v1 sending/typing limits (both live on prod), CV-0 (five spikes), the briefs, the e2e isolation fix, CV-1 (+ its conversion, applied to the local stack with Maciej's OK), CV-2a and CV-4, all migrations applied locally in that order. **Paused at 91% of the weekly usage window** (the 90% hold); it resets 2026-10-15 08:00 UTC. **Next on resume:** CV-2b (holds the migration turn; its file is `<stamp>_chat_v2_conversation_ops.sql`; it also stamps `removed_by`, which CV-2a's removed-member rule waits on, and the General-join that lets every reader type), then CV-3 and CV-5 in parallel (both need 2b; CV-5's migration after CV-3's if both have one), then checkpoint 2 (fold CV-0 spike 1, CV-1, CV-2a, CV-4, the hotfix; full verify; the full e2e run through `scripts/agent/e2e.sh`).
