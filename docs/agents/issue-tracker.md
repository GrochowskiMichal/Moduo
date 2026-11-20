# Issue tracker (for the engineering skills)

Moduo does not track work in GitHub Issues. Blocks are specced in the repo and queued in Moduo:

- **A feature's tickets** are the execution blocks in its spec, `specs/<feature>.md` (section *Execution blocks*): ID, name, scope, acceptance criteria, tests, and the blocks each depends on (last column). Specs follow [specs/_template.md](../../specs/_template.md).
- **The queue** is Moduo: one task per open block, titled `<ID> — <name>`, tagged `block`, in the milestone projects (Closed alpha, Open alpha, Beta & later), with a "blocks" edge from each dependency. `bun run queue` lists the ready, claimed and waiting blocks; `bun run queue next` is the one `/s2 next` takes. A session claims a block by opening a **draft PR** into the personal branch titled `[<ID>] <name>` before building.
- **Finished blocks** need no record: GitHub events move their task to Awaiting release and Shipped, and git keeps the rest.

## How skills should use it

- **`to-tickets` / `to-spec`:** write blocks into the spec's *Execution blocks* table, with the dependencies as the blocking edges, then run `bun run queue:import specs/<feature>.md` (idempotent). Never create GitHub issues, and never write block tasks into Moduo by hand.
- **`triage`:** not used. There are no triage labels; the designer ratifies blocks during `/s1`.
- **Blocking edges:** a block is ready only when every dependency is merged (Awaiting release or Shipped) or closed.
