# Issue tracker (for the engineering skills)

Moduo does not track work in GitHub Issues. Work lives in the repo:

- **A feature's tickets** are the execution blocks in its spec, `specs/<feature>.md` (section *Execution blocks*): ID, name, scope, acceptance criteria, tests, dependencies. Specs follow [specs/_template.md](../../specs/_template.md).
- **The queue** is [specs/BUILD_ORDER.md](../../specs/BUILD_ORDER.md): one line per block, exactly `- [ ] **ID — name** · deps: … · lane …`, ordered so every dependency appears above its dependents. The checkbox is never ticked by hand: `bun run next` derives each block's state from PRs (a draft PR titled `[<ID>] <name>` claims it, its merge finishes it). Check `bun run next <ID>` before claiming.
- **Finished blocks** are moved to [specs/BUILD_LOG.md](../../specs/BUILD_LOG.md) by the weekly gardener, not by sessions.

## How skills should use it

- **`to-tickets` / `to-spec`:** write blocks into the spec's *Execution blocks* table and add one line per block to `BUILD_ORDER.md` under the feature's section, with `deps:` as the blocking edges. Never create GitHub issues.
- **`triage`:** not used. There are no triage labels; the designer ratifies blocks during `/s1`.
- **Blocking edges:** a block is ready only when every block in its `deps:` has a merged `[<ID>]` PR (`bun run next` checks this). Write `deps:` as IDs or `—`, never prose; prose keeps the block waiting until a human resolves it.
