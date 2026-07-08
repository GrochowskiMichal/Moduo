# Moduo — Notes Brief

> **Status:** Planned — full rebuild on the spine primitives. A make-or-break leg.
> **Pairs with:** Tasks (real schedulable checkboxes), Mindmap (note-in-canvas), Contacts/Calendar/Email/Finance (via `/refs` + `@mentions`), and the spine itself. Siblings: [PRODUCT_BRIEF.md](../../docs/PRODUCT_BRIEF.md) · [ROADMAP.md](../../docs/ROADMAP.md) · [data-layers.md](../../docs/data-layers.md).

---

## 1. What it is & job-to-be-done

A fast, plain-feeling place to write things down and have them *connect* to the rest of your work. The job, in the user's own words: **"Is there anybody else who thinks Notion is too complicated for just writing down ideas?"** People don't want a database engine to capture a thought — they want a blank line and a cursor, and later they want that thought to be findable and linked to the client, task, or meeting it was about.

Two distinct jobs, both must be frictionless:

| Job | The user's mental model | Failure mode we're fixing |
| --- | --- | --- |
| **Capture** — get a thought out of my head *now* | "open, type, done" | Notion's capture tax: pick a destination, a template, properties, before you can write. |
| **Reference** — find it later and tie it to other work | "the notes about Acme" / "what did we decide?" | Obsidian's local-only silo; Notion notes that float free of tasks/contacts. |

Ceiling: **Notion-ease minus databases**, **Obsidian-minus-local-first** (markdown-native, cloud-synced, shareable).

## 2. Depth ceiling & explicit non-goals

Deliberately light, never mediocre. The editor is great; the *system around it* is small.

**Non-goals (do not build):**
- **Notion-style databases** — no table-of-pages, no relations-as-database, no rollupable property columns.
- **Property schemas** — notes have a tiny fixed metadata set (title, icon, tags, parent). No user-defined typed properties.
- **Templates-as-a-system** — no template gallery, no template-database, no "new from template" forcing function at creation. (A "duplicate this note" affordance is fine; a template *system* is not.)
- **Wiki/graph view** as a headline feature — backlinks exist (they're spine roll-ups), but we never present an abstract graph. (Anytype trap.)
- **Real-time co-editing UX** — collaboration is async shared-workspace (see §6). Yjs is for conflict-free sync, not a live cursor-presence feature in v1.

## 3. The "one great moment"

**Every checkbox in a note is a real, schedulable task — not faux markdown.** Type `[ ] call the supplier` in a note and it is a first-class Task: it can be committed to a day, scheduled, given a due date, rolled up onto the contact, and counted in your Plan view — *from inside the note*. Check it in the note, it's done everywhere; reschedule it in Tasks, the note reflects it.

This is the loop Routine got the warmest reception for — *"every checkbox is a full-fledged task that can be scheduled… we've closed the loop."* It is the single feature that proves Notes isn't a silo and that the spine is real, in one gesture the user already knows.

## 4. Must-have features

| Feature | One line | Evidence / insight | Spine wiring |
| --- | --- | --- | --- |
| **Real task checkboxes** | A checkbox block *is* a Task row, schedulable from the note. | Routine's closed loop got the warmest reception; the all-in-one's whole pitch in one gesture. | Creates a `task` entity + an `entity_links` edge (`note → task`, kind `embed`); check-state is the task's status, synced both ways. |
| **Thought-to-saved in one keystroke** | Global "new note" creates and focuses an empty note instantly — no destination/template/property prompt. | Notion's single biggest capture flaw; the user's literal complaint ("too complicated for just writing down ideas"). | New note is inbox-parented by default; later filing/linking is optional, never blocking. Optimistic local write, sub-200ms. |
| **Fast markdown editor (Lexical)** | Markdown-native input, slash menu, the usual blocks — already in the stack. | Obsidian-grade *feel* without local-first lock-in; Lexical is already wired (`LexicalNoteEditor.tsx`). | Editor is the host for `/refs`, `@mentions`, and embeds; all three resolve against the spine. |
| **`/task`, `/note`, `/contact` refs** | Slash-insert a typed inline reference to any entity; renders as a live chip. | Notes that float free of the rest of the app are dead weight; refs are the cheapest cross-module tie. | Each `/ref` writes a typed `entity_links` row from the note to the target `(entity_type, entity_id)`; chip shows live title/status. |
| **Note-in-note embedding** | Embed a note inside another and see it inline. | User explicitly wants this "if possible" — yes. | `entity_links` (`note → note`, kind `embed`); transclusion renders the child's CRDT preview, edits flow to the source. |
| **Inline embeds (task / mindmap)** | `/embed-task`, `/embed-mindmap` blocks already scaffolded in `SlashCommand`. | Existing types show the intent; embeds are how Notes hosts other modules without owning them. | Embed block = an `entity_links` edge + a render adapter; the embedded entity stays owned by its module. |
| **Cloud sync (Yjs ↔ Postgres)** | Notes sync to Supabase so they're shareable and multi-device. | Cloud-first is locked; Notes is the multiplayer *enabler* — a note has to be a shareable workspace entity. | Note becomes a workspace-scoped entity addressable by `(note, id)`; unlocks comments, `@mentions`, sharing, roll-ups. |
| **Tree: categories / folders / notes** | Light hierarchy already modeled (`NoteKind`, `parentId`, `position`). | Keep the familiar object (sidebar tree), not an abstract graph. | Parenting is structural; cross-cutting relations live in the spine, not the tree. |

## 5. Key flows / interactions

- **Capture.** Global shortcut → empty untitled note, cursor in body, zero dialogs. First line becomes the title. Saved optimistically; sync is invisible. Lives in an Inbox until the user (optionally) files it.
- **Checkbox → task.** Type `[ ] …` → block renders as a task chip with a check, a small "schedule" affordance, and (if linked) the context it rolls up to. `/task` inserts a reference to an *existing* task; a fresh `[ ]` *mints* one. Checking it anywhere marks it done everywhere.
- **Reference insertion.** `/` opens the slash menu; `/contact Acme` → fuzzy entity picker → inserts a live chip and records the typed link. `@` inside a note mentions a workspace member (notification + comment-style mention), distinct from `/ref` which links *entities*.
- **Embedding.** `/embed-mindmap` or `/embed-task`, or drag an entity from another pane onto the note → inline embed block + a typed link.
- **Drag-anything.** Drag a note onto a task/contact/calendar event (or vice-versa) → one-gesture typed link; no modal. (Spine drag contract.)
- **Roll-up read.** Open a contact/task and the note surfaces in that hub's "Notes" roll-up, grouped by relationship, with an inline snippet — never as a bare graph node.

## 6. Spine wiring

| Spine system | Notes participation |
| --- | --- |
| **Links (`entity_links`)** | Note is a first-class endpoint. `/refs`, embeds, drag-drop, and note-in-note all write typed, workspace-scoped rows: `(note → task\|note\|contact\|event\|email\|payment, relation_kind)`. Auto-suggested links: when a note's body mentions a known entity name, suggest a link (accept = one click), never auto-applied silently. |
| **Attachments** | Files/emails attachable to a note via `entity_links` (kind `attachment`); a note attachable to anything else the same way. |
| **@mentions** | `@member` resolves to a workspace member → notification + a mention record on the note entity (async coordination, not chat). |
| **/refs** | Typed inline entity references (above). The chip is live (title/status reflect the source). |
| **Notifications** | Quiet/grouped/digest-default. Triggers: you were `@mentioned`; a note shared with you changed; a task minted from your note was completed/rescheduled by a partner. No per-keystroke noise. |
| **Activity** | Per the [module contract](../../docs/moduo-module-contract.md): invariant-bearing mutations go through `notes_op_*` RPCs writing attributed `module_activity` rows; trail renders quietly in the note's detail rail. (Plain title/body edits stay raw CRDT writes — no cross-entity invariant.) |
| **Tags** | Reuse the polymorphic `tag_links` (already cross-module); `NoteMeta.tags` is the per-note view of it. |
| **MCP tools** | `notes.create`, `notes.append`, `notes.link`, `notes.search` exposed via the module manifest (`src/features/notes/ops-manifest.ts`) into the one Moduo connector. Read-only by default for keys; `link` and `append` are the agent-meaningful ops. |
| **Dashboard widget** | "Recent notes" / "Notes for {today's context}" widget — recently touched + notes linked to today's committed tasks or events. Definition-of-done item. |

## 7. Data model sketch (Supabase-first)

Source of truth is Supabase. The Yjs document is stored as a **blob**, not shredded to rows; we derive only what we need to search and roll up.

```
notes                                  -- entity table (matches src/features/notes/types.ts)
  id            uuid PK
  workspace_id  uuid → workspaces ON DELETE CASCADE
  owner_id      uuid → profiles
  parent_id     uuid NULL → notes      -- tree (category/folder/note)
  kind          text  CHECK ('category'|'folder'|'note')
  title         text
  icon          text NULL
  position      text                   -- fractional order key (existing convention)
  is_pinned     bool
  is_archived   bool
  search_text   tsvector               -- DERIVED from the CRDT on save (not authoritative)
  created_at / updated_at / deleted_at timestamptz

note_doc                               -- the authoritative Yjs document, as a blob
  note_id       uuid PK → notes ON DELETE CASCADE
  ydoc          bytea                  -- compacted Yjs state
  ydoc_version  int

note_updates                           -- append-only CRDT update log (existing sync-engine shape)
  id            bigserial PK
  note_id       uuid → notes
  client_id     text
  client_seq    int
  update_b64    text                   -- incremental Yjs update
  created_at    timestamptz
  -- periodically compacted into note_doc.ydoc; cursor per client (see types.ts SyncCursor)
```

**Polymorphic links (spine — shared, not Notes-owned):**
```
entity_links
  id            uuid PK
  workspace_id  uuid
  src_type      text  -- 'note'
  src_id        uuid
  dst_type      text  -- 'task' | 'note' | 'contact' | 'event' | 'email' | 'payment'
  dst_id        uuid
  relation_kind text  -- 'ref' | 'embed' | 'attachment' | 'mention'
  created_by    uuid
  created_at    timestamptz
```
Embedded checkboxes/tasks: the `task` row lives in the Tasks module; the note holds an `entity_links` edge (`note → task`, kind `embed`) plus a block placeholder carrying the `task_id`. Tags via existing polymorphic `tag_links` (`entity_type='note'`). Activity via shared `module_activity`. Polymorphic integrity follows the spine's chosen approach (see data-layers open Qs) — no per-type FK on link ends.

## 8. Module-specific open questions

| Question | Recommendation |
| --- | --- |
| **Yjs ↔ Postgres storage** | **Store the Yjs doc as a blob + derived searchable fields** (`note_doc.ydoc` + `notes.search_text`), *not* shred-to-rows. Shredding fights CRDT semantics and re-introduces a schema; the blob keeps the editor authoritative and sync trivial. (Locked recommendation.) |
| **Where do minted checkbox-tasks live?** | In the **Tasks** table, always — the note holds an embed link, not a copy. This is what makes "real task" true (schedulable, rolls up, counted in Plan). Avoid a notes-local task shadow. |
| **What happens to a minted task if its checkbox/block is deleted?** | Soft-detach, don't destroy: deleting the block removes the embed link but the task survives (it may have been scheduled/committed). Offer an inline "also delete the task?" affordance. Graceful slippage, no data loss. |
| **Search scope** | Postgres FTS over `search_text` + title for v1 (cloud-first, multi-device). Defer semantic/vector search to MCP-era. |
| **Backlinks UI** | Render as a grouped roll-up in the note's detail rail ("Linked from / Links to", grouped by `relation_kind`, with snippets) — **never** a graph canvas. |
| **`@mention` vs `/ref` boundary** | Keep them distinct: `@` = *people* (notification), `/` = *entities* (link). Conflating them is the Notion ambiguity we're avoiding. |
| **Note-in-note edit semantics** | Transclusion edits the source (single source of truth). Show a subtle "embedded from {note}" affordance so the user knows edits propagate. |

## 9. Dependencies & sequencing notes

- **Hard dependency on the spine.** `entity_links`, the drag contract, comments/`@mentions`, and notifications must exist before Notes' `/refs`, embeds, and roll-ups are real. Per [data-layers.md](../../docs/data-layers.md), the spine is built once alongside the *second* module (Contacts is the proof). Notes should land **after** the spine primitives, consuming them — not reinventing local linking.
- **Tasks must expose mint/link ops first.** The great moment depends on minting a `task` and embedding it; Tasks is the reference module (already has `tasks_op_*` RPCs) and must offer a "create + return task" path the editor can call optimistically.
- **Notes is the multiplayer enabler.** Yjs↔Postgres sync is the gate for shared-workspace async collaboration on notes; sequence it once core single-user editing + the spine are stable.
- **Reuse existing scaffolding.** `LexicalNoteEditor.tsx`, the `sync-engine.ts` / `SyncCursor` / `LocalOutboxEntry` shapes, fractional `position`, and the `SlashCommand` set (incl. `embed-task` / `embed-mindmap`) already encode much of this — the rebuild rewires them onto Supabase + the spine, it does not start from zero.
- **Module-contract DoD.** Not "done" until: invariant-bearing mutations go through `notes_op_*`; each writes an attributed `module_activity` row; the trail renders in the detail rail; a manifest entry exists in the registry; the dashboard widget ships.

---

Grounding files read: `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/docs/moduo-module-contract.md`, `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/docs/data-layers.md`, `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/src/features/notes/types.ts`.
