# Build order → the queue is in Moduo

Since HV-8 (2026-10-26, [specs/harness-v3.md](./harness-v3.md)) this file is only a pointer. Nothing here is ticked, flipped or moved any more.

- **The queue:** `bun run queue` prints the Focus, then the ready, claimed and waiting blocks. It joins Moduo (each block's task: state, owner, order), the specs' *Execution blocks* tables (dependencies) and open PRs (claims). `bun run queue next` prints the block `/s2 next` builds. Without Moduo it falls back to the specs, open PRs and git history, and says so.
- **Block tasks** live in the milestone projects **Closed alpha**, **Open alpha** and **Beta & later**, tagged `block`, titled `<ID> — <name>`, each with a spec link and a "blocks" edge from every dependency.
- **New blocks:** write them in the spec's *Execution blocks* table, then `bun run queue:import specs/<feature>.md` (idempotent: a re-run updates, never duplicates).
- **Stages move by themselves** from GitHub: draft PR `[ID] …` → Building, ready → In review, merged → Awaiting release, closed unmerged → To do, release tag → Shipped (`.github/workflows/moduo-sync.yml`).
- **Focus** (the designer's current focus area) is the note titled "Focus" in Moduo (a top-level note). Edit it there, or `bun run queue:import --focus "<text>"`.
- **History:** finished blocks are in git and in each spec; the old ledger is `git show 5a1234c8c:specs/BUILD_ORDER.md`, the build log `git show 5a1234c8c:specs/BUILD_LOG.md`.
