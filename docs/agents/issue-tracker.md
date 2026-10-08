# Issue tracker (for the engineering skills)

Moduo does not track work in GitHub Issues. Work lives in the repo:

- **A feature's tickets** are the execution blocks in its spec, `specs/<feature>.md` (section *Execution blocks*): ID, name, scope, acceptance criteria, tests, dependencies. Specs follow [specs/_template.md](../../specs/_template.md).
- **The queue** is [specs/BUILD_ORDER.md](../../specs/BUILD_ORDER.md): one line per open block, `- [ ] **ID — name** · deps: … · lane …`, ordered so every dependency appears above its dependents. `[~]` means in progress. A session claims a block by opening a **draft PR** into the personal branch titled `[<ID>] <name>` before building; check `gh pr list --state open --search "<ID>"` first.
- **Finished blocks** move to [specs/BUILD_LOG.md](../../specs/BUILD_LOG.md) with their date and branch.

## How skills should use it

- **`to-tickets` / `to-spec`:** write blocks into the spec's *Execution blocks* table and add one line per block to `BUILD_ORDER.md` under the feature's section, with `deps:` as the blocking edges. Never create GitHub issues.
- **`triage`:** not used. There are no triage labels; the designer ratifies blocks during `/s1`.
- **Blocking edges:** a block is ready only when every block in its `deps:` is merged into the personal branch the session starts from.
