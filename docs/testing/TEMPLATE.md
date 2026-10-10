# Sitting checklist — [<ID>] <block name> · PR #<n> · <date> · _(web / desktop / both)_

> Path: `docs/testing/<ISO-week>/<ID>.md` (e.g. `docs/testing/2026-W41/TV-U5.md`): one file per landed PR, so parallel lanes never edit the same file, and the week folder is what you run in **one sitting** at the surfaces. `/s2` writes it before landing a user-visible change. Items are **questions**, each with the observation the agent expects and a blank for what you actually saw: write the observation even when it matches, because a checklist that only gets ticks confirms instead of discovers. Anything surprising goes to the PR as a comment or becomes a block.

**Agent verified live:** <yes / partial / no, and what>

- **What happens when** …? → **Expected:** … → **Seen:** ____
- **What happens when** <the data source errors / the list is empty / you lack permission / two people edit at once / the entity was deleted / there are 500 of them>? → **Expected:** … → **Seen:** ____
- **Migration / data:** how do you confirm the schema change applied? → **Expected:** … → **Seen:** ____

**Not verified by the agent:** <what, and why>

---
*Convention: AGENTS.md → "Working posture". Older per-branch checklists live beside the week folders; the gardener archives anything untouched for two weeks.*
