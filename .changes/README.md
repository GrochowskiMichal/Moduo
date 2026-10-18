# Pending release notes

One file per landed block that people can notice, written by `/s3`: `.changes/<block-or-slug>.md`.

```md
---
type: improved        # new | improved | fixed | security
internal: false       # true = never published (internal work)
highlight: true       # optional: lead the release's toast and What's new
---
Tasks you snooze now come back at the start of your working day.
```

One or two plain sentences, at most 200 characters, about what people can now do. `bun run verify`
runs the leak check (`scripts/release/check-notes.ts`). The writing rules: [docs/release-notes.md](../docs/release-notes.md).
`/ship` turns these files into `release-notes/releases.json` and deletes them.
