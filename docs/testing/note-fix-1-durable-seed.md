# Manual test — NOTE-FIX-1 (imported notes render blank after a reload)

Branch: `t/maciej/note-fix-1-durable-seed`

**The bug:** importing a Notion export wrote the markdown but left the editor's
CRDT empty. It looked fine that session (an in-memory seed filled it in), then a
reload — or opening on another device — showed **blank notes**. The content was
never gone, just not in the doc the editor reads.

> ✅ **Migration applied to prod 2026-07-29** (`20260729120000_notes_seed_doc.sql`),
> so both sections below are live. The backfill was already exercised end-to-end
> against a planted pre-fix note; your pass is confirmation, not first-discovery.

## Import (works now)

- [ ] Notes → import icon → drop a multi-file `.md` set (or a Notion `.zip`) →
      **Import** → toast reports the count → **step → expected → web + desktop**
- [ ] Hard-reload the page (⌘⇧R), open one of the imported notes →
      **the body renders in full** (not blank) → web + desktop
- [ ] Check the formatting survived: heading levels (`#` vs `##` vs `###`),
      **bold**/*italic*, links are clickable with the right URL, checkboxes keep
      their checked/unchecked state, numbered lists are still numbered, quotes
      and code blocks intact → web
- [ ] Sidebar order matches the order of the files you imported (not random) →
      web
- [ ] Import into a workspace that **already has notes**: the imported tree lands
      **after** the existing notes, it doesn't interleave with them → web
- [ ] Import a large export (100+ notes): it completes (requests are chunked) and
      the dialog shows "Importing…" rather than freezing silently → web
- [ ] Sign in on a **second device** (or a different browser profile) and open an
      imported note → renders identically, and the content appears **once** — no
      duplicated headings or paragraphs → web + desktop

## Backfill (live)

- [ ] Open Notes with notes that were imported **before** this fix → within a few
      seconds they stop being blank, with no toast and no visible activity → web
- [ ] Those repaired notes do **not** jump to the top of Home's "Recent notes"
      widget (a repair is not an edit) → web
- [ ] Open a blank pre-fix note directly → it fills in promptly rather than
      waiting for the whole sweep → web
- [ ] Their markdown is unchanged: export one to `.md` and confirm links, bold
      and line breaks are still there → web

## Regression watch (things this touched)

- [ ] Type in any note, reload → your text is still there (the sync engine is
      unchanged, but the body derivation it uses was fixed) → web + desktop
- [ ] Export a note you've edited by hand to `.md` → headings, checkboxes and
      numbered lists come out right (this was silently broken before, in export,
      the published page and anything the AI connector reads) → web
- [ ] Publish a note → the public page shows correct heading levels and
      checkboxes → web
- [ ] Search for a word that only appears in an imported note → it's found → web

## Known gaps

- The backfill is **capped at 200 notes per load** — a bigger legacy import
  finishes over successive visits to Notes. Nothing is lost in between; the
  remaining notes just stay blank until their turn.
- A note whose markdown Lexical can't parse is left alone (still blank, body
  intact) and retried on the next load; it logs a warning to the console.
- **MCP connector:** appending to a note that already has a doc won't show in the
  editor, and your next keystroke discards it. Pre-existing in kind, but this
  block closed the window that used to let it self-heal — recorded as a hard
  requirement for MCP-1.
- Editing a note still rewrites its `body_md` from the doc, which is a lossy
  walk (link URLs, inline marks, intra-block line breaks). Untouched here; the
  fix only stops the **import** and **repair** paths from doing it.
