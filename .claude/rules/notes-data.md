---
paths: ["apps/app/src/features/notes/**", "apps/app/src/routes/pages/notes-page.tsx", "supabase/functions/moduo-mcp/modules/notes.ts", "supabase/functions/notes-public/**", "supabase/migrations/*notes*.sql"]
incident: "Imported notes rendered blank on any other device (NOTE-FIX-1), a re-rooted shared sub-note went private (NR-1), and Settings' wipe left a previous person's notes on disk (SK-C4)"
expires: 2027-01-31
---

# Notes data: docs, drafts, import, publish, agents

Compiled from the notes gotchas (HV-14b). Decisions: [docs/decisions/notes.md](../../docs/decisions/notes.md).

## Documents and seeding
- Seed a note's content on the server, never in one editor session: build the doc with `repairNote` / `buildDocStateFromMarkdown` before it is shown, and derive titles only from this editor's own updates.
- Seeding is once-only (`notes_op_seed_doc` refuses if a snapshot or any `note_updates` row exists): two independently built docs concatenate, they don't merge. A body-only note is seeded through that op, never inside another write.
- The collab bootstrap writes an empty paragraph into a new doc: "is this note empty?" reads the text (`hasDraftContent`), never counts updates; drafts stay out of the outbox until `promoteDraft`.
- `apps/app/src/features/notes/editor/materialize.ts` builds docs headless with the live editor's node set and transformers; never let the two drift.

## Agent writes and the live channel
- Edge Functions can't import the notes editor: `moduo-mcp` loads a prebuilt bundle (`bun run build:notes-doc`); its test fails until you rebuild after any change under the editor.
- Push only an edit's own `update` events (`Y.mergeUpdates`): an update encoded against a state vector carries the doc's whole delete set.
- `Y.UndoManager` knows "already undone" only in its own session: the agent Undo keeps one step and clears on any remote change; a new non-local origin goes into `isForeignOrigin`.
- Never trust "who wrote this" from a broadcast, and never put note content in a Realtime message (`realtime.messages` outlives erasure): announce "note X changed" and let clients pull through the access-checked read.
- Each `callOp` stays in its tool handler (`api-keys.test.ts` reads tool bodies); key-callable SQL uses `perm_actor_id()`, not `auth.uid()`. Adding a column tier to `selectFirstDeployedTier` shifts every index: compare against `tiers.length - 1`.

## Server rules (migrations and functions)
- Any path that re-roots a note calls `notes__keep_access_on_reroot` first, or a shared inherit sub-note goes private.
- `notes_op_import` doesn't guard `parent_id`: a caller passing an external parent validates it.
- Archiving unpublishes the whole subtree; unarchive never re-publishes.
- Edge Functions can't serve HTML (the platform rewrites `text/html` to `text/plain`): public pages render client-side from JSON. Untrusted Markdown to HTML escapes raw HTML and allow-lists link schemes (`http(s):`, `mailto:`); react-markdown shows HTML comments as text (`stripTaskIdComments`).
- Each module's api-key lane is its own module id (`permissionKey` in `apps/app/src/features/notes/ops-manifest.ts`).

## The page and device caches
- A note created outside /notes and deep-linked at once races the page's cache-first paint and stale-id cleanup: create it in place instead of navigating.
- Find a person's per-note databases from the records (`docDbName(owner, noteId)`), never only through `indexedDB.databases()` (`apps/app/src/features/notes/sync/people.ts`; `lint:ast` rule `idb-listing-wipe`).
- Only the sync owner registers the preferences push (`usePreferences({ syncOwner: true })`): a second instance unmounting must not drop it.

## Notion import
- A Notion export is a zip inside a zip (with Part-2, Part-3): unwrap recursively but bounded, and drop the nested zip's name from paths (`apps/app/src/features/notes/import-zip.ts` `stripExportWrapper`, matched per entry, never "the longest common prefix").
- Seed import ids on Notion's page id and guarantee distinctness across the plan (`apps/app/src/features/notes/import.ts` `assignImportIds`): the server skips a duplicate id, and the page vanishes.
