# Domain docs (for the engineering skills)

How skills such as `tdd`, `diagnosing-bugs`, `grill-with-docs`, `domain-modeling` and `improve-codebase-architecture` should read and write Moduo's domain documentation. Layout: **single-context**.

## Before exploring, read

- **Glossary:** [docs/moduo-architecture-vocabulary.md](../moduo-architecture-vocabulary.md). This is Moduo's `CONTEXT.md`. Name concepts (in specs, tests, refactor proposals) with its terms.
- **Decisions:** the index [docs/decisions.md](../decisions.md), then the area files in `docs/decisions/` that touch your work. These play the role of ADRs; there is no `docs/adr/` folder.
- **Traps:** the matching `docs/gotchas/<area>.md`.

## When a term or decision gets resolved

- A new or sharpened term goes into the glossary doc, in its existing format. Don't create a separate `CONTEXT.md` glossary.
- A new decision goes at the top of `docs/decisions/<area>.md` as a full entry (bold one-sentence title, the why, a pointer to the authoritative doc), plus its title as one line in [docs/decisions.md](../decisions.md). Don't create `docs/adr/` files.

## Flag conflicts

If your output contradicts a recorded decision, say so explicitly and name the entry (date + title) instead of silently overriding it.
