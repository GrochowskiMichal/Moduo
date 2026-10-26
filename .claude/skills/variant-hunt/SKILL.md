---
name: variant-hunt
description: Seeded variant hunt — take one fix commit (or a benchmarks/escapes/<id> folder), name the mechanism of the bug it fixed, search the sibling sites (grep + the TypeScript/Rust LSP) across apps/app/src/lib, feature storage/sync code, prefs sync, auth and apps/desktop/src-tauri stores, and report a candidate only when a failing test proves it. Use after a data-loss or sync fix lands, for each new escape, and in the nightly hunt routine. Never fixes anything; confirmed bugs go to the normal Tier 2 path.
effort: high
---

# variant-hunt: one fix in, proven siblings out

A bug that escaped once usually has siblings: the same mistake made in another domain, store or platform. This skill hunts them from one seed. Its output is a short table in which **every candidate has a failing test or is dropped** (specs/harness-v3.md, AC26). An unproven suspicion is not a finding; it never reaches the report.

## Input

One seed: a `benchmarks/escapes/<id>/` folder (preferred: it already names the mechanism, the sites and the regression test) or a bare fix commit SHA. With a bare SHA, write the escape folder first (`benchmarks/escapes/README.md` §Adding an escape).

## Rules that always hold

- **Never fix.** Not even a one-liner. The hunt writes tests and a report; a confirmed bug becomes a Moduo task and goes through the normal bug lane (Tier 2 when it touches sync, prefs, auth or desktop stores).
- **Never edit an existing test or product file.** Only add new proof-test files. Exception in Rust: a proof test goes in a new `#[cfg(test)] mod hunt_<seed>` (e.g. `hunt_509_5`) appended at the end of the module it tests (Rust unit tests must live in the crate); touch nothing else in that file.
- **Proof tests are parked, not red.** `bun run verify` must stay green on the branch:
  - TypeScript: a new file `<dir>/<subject>.<seed>.variant.test.ts` next to the code (e.g. `cache.509-3.variant.test.ts`, so two seeds never collide), whose suites run only on demand:
    ```ts
    // HV-15 variant of benchmarks/escapes/<id>: <one line>. Fails until <MOD-handle or "the fix"> lands.
    // Run: MODUO_HUNT=1 bun run --cwd apps/app test <path>
    const hunt = process.env.MODUO_HUNT ? describe : describe.skip;
    hunt("HV-15 variant <id>: <what goes wrong>", () => { … });
    ```
  - Rust: `#[ignore = "HV-15 variant <id>: <what goes wrong>"]`; run with `cargo test --lib <name> -- --ignored`.
- **The local Supabase stack is shared.** Unit tests with the existing fakes (`fakeServer`, `memoryCache`, `rs.mock("./runtime")`) are the default. Touch the stack only through `bun run db:test`'s rolled-back transactions; never reset, seed or clean it.
- **Read-only on git.** No commits, branches or stashes from a hunt subagent; the session that ran the hunt stages the new files by explicit path.

## Steps

1. **Read the seed.** `README.md` + `escape.json` of the escape, then `git show <fixCommit> -- <sites>` and the regression test. Note which functions, guards and types the fix introduced (e.g. a tagged `{kind: "error"}`, `hasOutboxEntries`, `withDueOn`, `ALL_TABLES`).
2. **Name the mechanism** as one sentence of the form *"<source> is treated as <wrong thing>, so <sink> does <damage>"*. Example: "a failed read is treated as no data, so reconcile seeds defaults and pushes them over real data". The source and the sink are what you search for; the fix only guarded one path between them.
3. **List the sibling sites.** Search the whole hunt scope, not only the fixed files:
   - `apps/app/src/lib/` (runtimes `runtime*.ts`, `lib/sync/` store, cache, kernel, `tanstack/`, `request-cache.ts`, `*-prefs.ts`)
   - feature storage and sync: `apps/app/src/features/*/{storage,sync,store,hooks,commands}` and `*-cache.ts`, `*-store.ts`
   - prefs sync: `lib/prefs-sync.ts` and every `useDomainSync` / `reconcileDomain` caller
   - auth: `apps/app/src/providers/auth-provider.tsx`, `workspace-provider.tsx`, sign-out and user-switch handlers
   - desktop stores: `apps/desktop/src-tauri/src/store_redb/`, `commands/*/storage.rs`, `sync/`, `email_sync/`, `migration_legacy/`

   Use both tools:
   - **grep** (`rg`) for the mechanism's shape: the escape README's "What a variant looks like" line is the starting pattern list.
   - **LSP** (`ToolSearch` → `LSP`): `findReferences` on the fixed function and its siblings, `goToImplementation` on the runtime interfaces, `incomingCalls` from the sink (the write, the wipe, the push) back to its sources. A sibling is often another implementation of the same interface (web vs Tauri runtime, Tasks store vs Chat store vs Notes cache).

   Read the area's gotchas (`docs/gotchas/supabase.md` §Prefs sync, §The shared store; `docs/gotchas/desktop.md`) and `docs/decisions/tasks.md` before deciding something is a bug: some "empty on error" paths are deliberate (an offline boot reading the device copy).
4. **Triage each site** in one line: reachable from a real user path? already guarded (the same fix, or a different guard)? deliberate per a decision? Drop what is guarded, unreachable or decided, with the reason; these stay out of the report table except as a count.
5. **Prove each surviving candidate** with the smallest test that drives the real code (mock the network boundary, never the unit under test) and asserts the user-visible damage: data overwritten, write lost, wrong value shown, rows deleted. Run it on demand (`MODUO_HUNT=1 …` / `-- --ignored`). It must **fail on the current HEAD for the bug's reason** (an assertion about the damage, not a setup error, a type error or a timeout). Read the failure output to be sure. Then sanity-check the oracle: the test should pass if you imagine the obvious correct fix; if it would also fail then, the test is wrong.
   - A candidate whose test passes, or that you can't drive in a test within reasonable effort, is **dropped** ("no failing test"). Never report it as a likely bug.
6. **Report** (and nothing else) as:

   | Seed | Candidate (file:line) | Mechanism match | Failing test | Verdict |
   | --- | --- | --- | --- | --- |
   | 509-1 | `lib/foo.ts:42` | error read as empty → pushes defaults | `lib/foo.509-1.variant.test.ts` · "…" (fails: expected 0 pushes, got 1) | confirmed |

   Verdicts: **confirmed** (failing test, real user path) · **dropped** (with reason). Below the table: sites searched (count and the grep/LSP queries used), sites dropped by reason, and for each confirmed bug a three-line task draft (title, user-visible damage, the proof test path and run command).
7. **Hand off confirmed bugs** (the session running the hunt, not a subagent): one Moduo task each in the `Moduo` project, tagged `bug`, titled `<what loses data> (variant of <escape id>)`, description = damage + proof test path + run command + seed. The fix follows the bug lane: un-skip the proof test, make it pass, then the test joins `benchmarks/escapes/` as a new escape.

## Running it for many seeds

One subagent per seed (Opus, high effort, `general-purpose`), all in the same worktree, each told its seed folder, this skill's path, and the file names it may create (`*.<seed>.variant.test.ts`, `mod hunt_<seed>` in Rust, e.g. `hunt_509_5`). They return the step-6 report; the calling session merges the tables, de-duplicates candidates found by two seeds, re-runs every proof test itself before calling it confirmed, and files the tasks.
