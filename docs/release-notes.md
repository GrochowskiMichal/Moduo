# Release notes: how to write them

Release notes are written by agents as blocks land and are published **with no human review**: in the app's What's new, the desktop update toast, `moduo.app/changelog`, `CHANGELOG.md` and the updater manifest. The automated leak check is the only gate. Spec: [specs/release-v2.md](../specs/release-v2.md).

## When to write one

`/s3` writes one note per landed block:

- **The block changes something people can notice** (a new ability, something better, a fixed bug): a public note.
- **Everything else** (refactors, tests, tooling, CI, docs, infra, migrations with no visible change): a note with `internal: true`. It is never shown, but it tells `/ship` the block was considered.

One block, one file. A block that does two visible things may write two files.

## The file

`.changes/<block-id-lowercase-or-slug>.md`, for example `.changes/tv-u12.md`:

```md
---
type: improved
internal: false
highlight: true
---
Select several tasks at once and move, tag or finish them together.
```

| Field | Values | Meaning |
| --- | --- | --- |
| `type` | `new` · `improved` · `fixed` · `security` | `new`: something people couldn't do before (makes the release a minor version). `improved`: something they could do, now better. `fixed`: something that was broken works. `security`: see below. |
| `internal` | `true` · `false` (required) | `true` = never published. |
| `highlight` | `true` (optional) | Leads the release: up to two highlights show in the update toast and at the top of What's new. Without any, the first `new` notes lead. Use it for the release's headline, not for every note. |

The text: **one or two sentences, at most 200 characters**, ending with a full stop.

## How to write it

Write for someone who uses Moduo and has never seen its code.

- **Say what people can now do, or what now works.** "Snoozed tasks come back at the start of your working day." Not what you changed inside.
- **Use the names people see in the app**: Tasks, Notes, Chat, Calendar, the dashboard, Focus, What's new, Settings. Plain product words are fine even when they sound technical: agents, Claude Desktop, MCP, GitHub pull requests.
- **Present tense, second person, no hype.** "You can…", "Search finds…". No "we're excited", no emoji, no exclamation marks in a row.
- **No internals, ever.** No file names or paths, no code identifiers (`camelCase`, `PascalCase`, `snake_case`, `kebab-case`), no backticks or `name()`, no block or ticket IDs (`TV-U12`, `MOD-114`), no table, SQL function or Edge Function names, and none of these words: RLS, migration, Supabase, Tauri, Rust, Cloudflare, Worker, endpoint, token, secret, CVE, exploit, vulnerability, validator, Turborepo, workflow.
- **Hyphens and slashes:** common English compounds pass (sign-in, follow-up, real-time, re-open, drag-and-drop). If the check flags a hyphenated word, rephrase it ("two-step" → "in two steps"). Write "Mac and Windows", not "Mac/Windows".
- **Security fixes** are always `type: security` with exactly this text: `Security and reliability improvements.` Never describe what was wrong: the notes are public before every user has updated.

| Instead of | Write |
| --- | --- |
| Fixed race in `useTaskStore` on reconnect. | Tasks no longer disappear for a moment when your connection comes back. |
| Added `task_links` index for faster spine reads. | Linked items open faster. |
| Moved the update feed to the Cloudflare Worker. | Desktop updates download faster. |
| Patched an RLS hole in shared notes (CVE-…). | Security and reliability improvements. |

## The check

`bun run lint:notes` (part of `bun run verify` and CI) runs [`scripts/release/check-notes.ts`](../scripts/release/check-notes.ts) over `.changes/` and `release-notes/releases.json`. It fails naming each offending word and why, for example:

```
✗ .changes/tv-u12.md: leaks internal words: "useTaskStore" (camelCase identifier), "task_links" (snake_case identifier)
```

Its list of table, SQL function and Edge Function names is read from `supabase/` every run, so new ones are covered automatically. Names that are one plain word (`tasks`, `contacts`) are product words and stay allowed. Internal notes skip the word rules but must still parse.

A PR that adds only a note still runs the check in CI: `.changes/`, `release-notes/` and `CHANGELOG.md` never count as a docs-only change.

## What happens at release

`/ship` runs `bun scripts/release/changes.ts prepare`: it computes the version (any public `new` note → minor, otherwise patch), adds the release to `release-notes/releases.json` (newest first, public items grouped New, Improved, Fixed, Security, all security notes collapsed into the one line, at most two highlights), rewrites `CHANGELOG.md` from it and deletes the consumed note files. `releases.json` is the source of truth; never edit `CHANGELOG.md` by hand (a test checks it matches).

Other commands: `status` (pending notes and the next version), `notes <X.Y.Z>` (the updater Markdown for a release), `coming-next` (the staging updater Markdown for pending notes), `changelog` (rewrite `CHANGELOG.md`).
