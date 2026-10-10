# Sitting checklist — <ISO week, e.g. 2026-W41>

> One file per week; `/s3` (or `/s2`'s report) appends a section per landed PR. You run it in **one sitting** at the surfaces, not per block. Items are **questions**, each with the observation the agent expects and a blank for what you actually saw: write the observation even when it matches, because a checklist that only gets ticks confirms instead of discovers. Anything surprising goes to the PR as a comment or becomes a block.

## [<ID>] <block name> · PR #<n> · <date> · _(web / desktop / both)_

**Agent verified live:** <yes / partial / no, and what>

- **What happens when** …? → **Expected:** … → **Seen:** ____
- **What happens when** <the data source errors / the list is empty / you lack permission / two people edit at once / the entity was deleted / there are 500 of them>? → **Expected:** … → **Seen:** ____
- **Migration / data:** how do you confirm the schema change applied? → **Expected:** … → **Seen:** ____

**Not verified by the agent:** <what, and why>

## [<ID>] <next block> · PR #<n> · <date>

…

---
*Convention: AGENTS.md → "Working posture" (Wrap). Older per-branch checklists live beside this file; the gardener archives any file untouched for two weeks.*
