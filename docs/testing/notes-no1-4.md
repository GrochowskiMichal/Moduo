# Manual test checklist — Notes rebuild NO-1..NO-4 (schema + sync engine + page shell + grammar)

> **✅ Migration status (reconciled 2026-08-14 · DOC-1): every migration this checklist depends on is APPLIED to prod.** OPS-1 + OPS-2 (2026-07-29) applied and verified every migration file in the repo against the live catalog. Any "unapplied" / "deploy-gated" / "**[post-deploy]**" wording below describes the state when this doc was written — **those rows are runnable now, not blocked**, and any "test the pre-migration degraded behavior first" step is no longer reachable. Status of record: [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md).

> Generated 2026-07-03 · branch `claude/practical-brahmagupta-7cef0c` · **Live-verified:** partial — the whole UI flow was exercised on a local dev server with the real hosted session (deploy-gap mode) AND with stubbed `notes_op_*` RPCs (non-degraded mode); the **real server round-trip needs the migration applied first** (see Migrations below).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## ⚠ Deploy order (read first)

The migration `20260703120000_notes_module.sql` **must be applied only AFTER this branch's code is deployed** — it drops the client-direct write policies the OLD notes editor uses (once applied, the old editor's saves silently stop persisting). New code first, migration second. The new code degrades gracefully in the pre-migration window (banner, read-only).

## Pre-migration (deploy-gap) behavior — test BEFORE applying the migration

- [ ] **Do:** open `/notes` → **Expect:** quiet banner "Notes is waiting on a server update…", your legacy notes listed in the sidebar (read-only editor), no crash _(web)_
- [ ] **Do:** reload → **Expect:** same state; no stuck spinners, no error toasts _(web)_

## Migrations / data

- [ ] **Do:** apply `supabase/migrations/20260703120000_notes_module.sql` to prod (after deploy), regenerate `src/types/supabase.ts` → **Expect:** applies cleanly; `notes` gains body_text/body_md/search_tsv/doc_version/published_at/publish_token; new `note_updates` table; 18 `notes_op_*` functions _(server)_
- [ ] **Do:** check a pre-existing note in the DB → **Expect:** `kind='note'` (categories/folders backfilled), a matching `entities` registry row (type `note`, label = title) _(server)_
- [ ] **Do:** in SQL: a live note whose parent was trashed pre-migration → **Expect:** it was re-rooted (`parent_id IS NULL`) by the one-time normalization _(server)_

## Capture (AC1)

- [ ] **Do:** on `/notes`, press ⌘N (or the sidebar +) → **Expect:** a fresh empty note opens instantly, caret ready, "Untitled" placeholder in display type; URL carries `?id=` _(both)_
- [ ] **Do:** from `/tasks`, press **⌘⇧N** → **Expect:** jump to `/notes` with a fresh focused note _(both)_
- [ ] **Do:** ⌘K → "New note" → **Expect:** same, and an existing note selection isn't wiped from the URL until the new note replaces it _(both)_
- [ ] **Do:** type a first line + a second line → **Expect:** after ~½s the sidebar row (and search/@mention label) shows the first line as the title; first line renders display-sized _(both)_
- [ ] **Do:** clear the first line entirely → **Expect:** row shows italic "Untitled" _(both)_

## Tree & sections (AC2)

- [ ] **Do:** hover a note row → + → type in the child → **Expect:** the parent moves Inbox → Workspace with a disclosure chevron; the child nests; expand state survives reload _(both)_
- [ ] **Do:** nest 7+ levels deep via repeated + → **Expect:** indentation keeps stepping, everything renders and selects _(web)_
- [ ] **Do:** drag a row onto another row's middle → **Expect:** ring highlight, drop nests it (last child); drag to a row's top/bottom edge → thin line indicator, drop reorders _(both)_
- [ ] **Do:** drag a parent onto its own descendant → **Expect:** quiet no-op (no toast, no move) _(both)_
- [ ] **Do:** reload after a reorder → **Expect:** order persisted _(both)_
- [ ] **Do:** row ⋯ → Icon → pick an emoji → **Expect:** icon replaces the file glyph; Remove icon restores it _(both)_
- [ ] **Do:** row ⋯ → Pin → **Expect:** a Pinned section appears at top listing it (it stays in its tree spot too) _(both)_
- [ ] **Do:** row ⋯ → Duplicate → **Expect:** "<title> (copy)" appears beside it WITH the full body content _(both — needs migration; copies the un-compacted tail too)_

## Slash grammar & mentions (AC5 — NO-4)

- [ ] **Do:** type `/` in a note → **Expect:** grouped menu (Basics · Insert · Embeds/mindmap last); type `child` → Page is the top hit; `toggle` → nothing _(both)_
- [ ] **Do:** `/h2` ⏎, type a line → **Expect:** real H2; same for bullet/number/quote/code/divider/table (3×3) — `/todo` makes a humble checkbox that is NOT a task _(both)_
- [ ] **Do:** `/contact` ⏎ → **Expect:** a search picker with focus IN its input; type + ⏎ inserts the person's chip inline; the note↔contact link appears on both hubs _(both — needs migration)_
- [ ] **Do:** in the `/contact` picker type a brand-new name → **Expect:** a "Create …" row; picking it creates the contact AND inserts the chip (same for `/company`; `/event` and `/note` search-only) _(both — needs migration)_
- [ ] **Do:** Escape (or click away) with the picker open → **Expect:** it closes, caret back in the note, nothing inserted _(both)_
- [ ] **Do:** `/page` ⏎ → **Expect:** a page-row block appears in place, a real child note exists in the tree; clicking the row opens it; renaming the child updates the row; deleting the ROW leaves the child in the tree _(both)_
- [ ] **Do:** sidebar + on the OPEN note's row → **Expect:** child created AND a page-row appended to the parent's body (repeat twice: no empty-paragraph pile-up between rows) _(both)_
- [ ] **Do:** type `@` → **Expect:** workspace PEOPLE only (no tasks/notes/contacts); picking a teammate inserts their name and lands a notification in THEIR bell _(both — needs migration + a 2nd member)_
- [ ] **Do:** `/mindmap` ⏎ → **Expect:** your mindmaps listed; picking embeds the familiar read-only canvas _(both)_

## Markdown doors (AC11 — NO-4)

- [ ] **Do:** paste a multi-block md doc (headings, `- [x]` list, quote, a `[label](moduo://…)` link) into an EMPTY note → **Expect:** real blocks — real checkboxes (toggleable), the moduo link renders as a chip _(both)_
- [ ] **Do:** paste the same into the middle of an existing note → **Expect:** plain text (deliberate — the import wizard in NO-8 is the file door) _(both)_
- [ ] **Do:** select several blocks incl. a chip + page-row, copy, paste into a plain-text editor → **Expect:** clean markdown; chips read `[label](moduo://type/id)`; paste back into Moduo stays rich _(both)_
- [ ] **Do:** select ONE word, copy, paste elsewhere → **Expect:** just that word (never the whole paragraph) _(both)_

## Trash / Archive (AC12)

- [ ] **Do:** ⋯ → Delete on a note with children → **Expect:** whole subtree moves to Trash; ONE toast "Moved to Trash (+N nested) · Undo"; Undo restores everything _(both)_
- [ ] **Do:** select a trashed note → **Expect:** "This note is in the Trash." + Restore button (no editor) _(both)_
- [ ] **Do:** hover a Trash row → **Expect:** quiet "Nd" days-left hint; ⋯ offers Restore / Delete forever _(both)_
- [ ] **Do:** Delete forever → **Expect:** confirm dialog naming the note; after confirm the subtree is gone; a chip/link to it elsewhere renders tombstoned _(both — needs migration)_
- [ ] **Do:** restore a child whose parent is still trashed → **Expect:** it re-roots (appears in Inbox), never invisible _(both)_
- [ ] **Do:** ⋯ → Archive on a subtree root → **Expect:** subtree leaves the tree into Archive, readable there; Unarchive restores _(both)_
- [ ] **Do:** trash something, wait (or SQL-backdate `deleted_at` >30d), reopen `/notes` → **Expect:** the sweep purges it quietly (module_activity gets one `notes.purge_expired` row) _(server)_

## Sync & offline (AC6 — engine half; full multiplayer lands NO-6)

- [ ] **Do:** type, then immediately reload → **Expect:** the text is there (IndexedDB draft) _(web)_
- [ ] **Do:** DevTools → Network → Offline; type a paragraph, create a note, rename it; go Online → **Expect:** while offline a muted cloud-off dot ("Saved locally — will sync") top-right; on reconnect everything pushes (check the other browser/DB); no duplicates _(web)_
- [ ] **Do:** desktop: quit net, edit + create, relaunch app offline → **Expect:** tree + edits still there from cache; sync on reconnect _(desktop)_
- [ ] **Do:** open the same note in two browsers, type in both → **Expect:** both converge after refocus (near-live arrives with NO-6); no conflict dialogs, no lost lines _(web — needs migration)_
- [ ] **Do:** first desktop run after this update, workspace with old local (redb) notes → **Expect:** one-time import toast "Imported N notes from this device."; re-launch doesn't duplicate them _(desktop — needs migration)_

## Welcome seed

- [ ] **Do:** open `/notes` in a BRAND-new workspace (0 notes) → **Expect:** one "👋 Welcome to Notes" note appears; opening it shows the self-teaching content (title line, intro, checklist); it's deletable like any note; it never reappears _(both — needs migration)_

## Deep links / URL

- [ ] **Do:** copy a `/notes?id=…` URL into a new tab → **Expect:** that note opens; back/forward walk the selection history _(web)_
- [ ] **Do:** open a `/notes?id=<deleted-forever-id>` URL → **Expect:** selection clears quietly, no crash _(web)_
- [ ] **Do:** click a note chip / "Recently linked" row elsewhere in the app → **Expect:** it now lands on `/notes` WITH the note selected _(both)_

## View-only member

- [ ] **Do:** open `/notes` as a `view` member → **Expect:** read-only editor, no sidebar +/⋯/drag affordances, no trash/restore _(web)_

## Dashboard regression

- [ ] **Do:** open the Grid dashboard's legacy notes widget → **Expect:** still lists notes + previews content (it now reads through the new surface) _(both)_

## Known gaps / not-yet-testable

- **Server round-trip of every op** (create/rename/move/trash/restore/purge/publish/apply_updates/save_snapshot/import/mention) — migration unapplied in this environment (Supabase MCP not connected to the Moduo org); exercised only against stubbed RPCs + SQL parse. The authed round-trip is the first post-deploy check.
- ~~Sidebar drag not live-verified~~ — **now verified** (post-validator): synthetic per-frame pointer gestures drove a real reparent (drop-into with ring indicator → `notes_op_move` with the target parent) and a reorder (drop-before → fresh fractional key, rows swapped). Still worth one human drag for feel.
- **⌘⇧N** couldn't be sent through the automation browser (Chrome intercepts it); the identical code path was verified via the palette/`?action=new`.
- **True-offline + two-device merge** need the migration; the CRDT merge semantics are unit-tested (`merge.test.ts`).
- **Storybook render** is broken in this worktree (known gotcha) — `note-tree-sidebar.stories.tsx` compiles; visual baselines remain a human capture.
- Legacy `#`-style markdown fidelity of `body_md` is approximate until NO-4's real `@lexical/markdown` transformers (headings currently all serialize as `###`).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
