# Gotchas: Lexical, notes, Notion import

**Compiled away in HV-14b (2026-10-27).** Each of the 90 traps that lived here is now a check, a path rule that loads when you open a matching file, or was deleted as stale (fixed, removed code, or a duplicate of a decision). Code comments that say "gotchas/notes.md" point at the topic below.

## Where each topic went

| Topic (old sections) | Now |
| --- | --- |
| Lexical: command handlers already in an update, focus restore, nodes, markdown import and export, collaborative undo and block moves, the v2 binding's shape | [.claude/rules/notes-editor.md](../../.claude/rules/notes-editor.md); `lint:ast` `lexical-update-in-command`, `lexical-history-in-collab`, `lexical-dom-lookup-in-state-read`; `afterFocusRestore`, `$importDescription` |
| Notes data: seeding docs on the server, drafts, agent (MCP) writes, never trusting a broadcast's sender (clients pull the stored row), publish, archive, re-rooting access, device caches, Notion import | [.claude/rules/notes-data.md](../../.claude/rules/notes-data.md); `lint:ast` `idb-listing-wipe`; the notes-doc bundle and `api-keys.test.ts` tests |
| The chat editor's stored form and composer keys | [.claude/rules/chat-ui.md](../../.claude/rules/chat-ui.md) |
| Drags and drops inside and around the editor, the notes sidebar's drag | [.claude/rules/ui-drag.md](../../.claude/rules/ui-drag.md); `lint:ast` `dnd-context-without-sensors` |
| Lexical in jsdom tests | [.claude/rules/tests-dom.md](../../.claude/rules/tests-dom.md) |
| Live-driving an editor in the Browser pane | [.claude/skills/s2/live-verify.md](../../.claude/skills/s2/live-verify.md) |
| Enum values, backfills | [.claude/rules/migrations-legacy.md](../../.claude/rules/migrations-legacy.md) |
| Billing columns, the Stripe Sync Engine's slugs, plan policies | [docs/decisions/billing.md](../decisions/billing.md) (removed here as duplicates) |

## Adding a trap

As in [ui.md](ui.md): a `lint:ast` rule or a test when the wrong code has a shape, otherwise one line in the matching `.claude/rules/*.md` or a comment at the trap.
