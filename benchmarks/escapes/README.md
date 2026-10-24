# Escapes

Every bug that reached a shared branch (`mike`, `maciej`, `develop`) or production gets one folder here, so the harness can be measured against it and the variant hunt can look for its siblings (specs/harness-v3.md, HV-15).

One folder per escape, named `<pr>-<n>-<mechanism>`:

- `README.md`: the mechanism in one line, the fix commit, the sites it fixed (at their current paths), the regression test and what a variant looks like.
- `escape.json`: the same, machine-readable (`id`, `title`, `mechanism`, `sites`, `tests[]` with `file`, `name`, `run`, plus `pr`, `fixCommit`, `foundBy`). `scripts/agent/escapes.test.ts` checks that every named test file exists and still contains its test, so a rename breaks verify instead of the benchmark.

The regression tests stay next to the code they cover (they run in the normal suites); this folder points at them rather than copying them.

## Seeds

| Escape | Mechanism | Test |
| --- | --- | --- |
| [509-1](509-1-error-read-as-empty/README.md) | error read as empty | `apps/app/src/lib/prefs-sync.test.ts` |
| [509-2](509-2-outbox-overtaken/README.md) | a live write jumps the queue | `apps/app/src/lib/sync/store.test.ts` |
| [509-3](509-3-signout-wipes-outbox/README.md) | teardown drops pending writes | `apps/app/src/lib/sync/store.test.ts` |
| [509-4](509-4-stale-derived-field/README.md) | derived field drifts | `apps/app/src/features/tasks/due-on.test.ts` |
| [509-5](509-5-decode-failure-then-delete/README.md) | decode failure read as empty, then overwritten | `apps/desktop/src-tauri` (two Rust tests) |

## Fixed variants

| Escape | Seed | Tests |
| --- | --- | --- |
| [644-1](644-1-error-read-as-empty/README.md) | 509-1 | tasks runtime, dashboard layout, Google calendars, rename (five tests) |

## Adding an escape

1. Write the failing test first (bug lane), then fix.
2. Add `benchmarks/escapes/<pr>-<n>-<mechanism>/` with `README.md` and `escape.json`, copying a seed.
3. Run the variant hunt on the fix commit (`.claude/skills/variant-hunt/SKILL.md`).
