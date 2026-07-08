# Moduo — Notes DESIGN BRIEF (the build spec)

> **Status:** Ready — ratified with the designer 2026-07-03 (three grilling rounds). Execution contract: [specs/notes.md](../../specs/notes.md).
> **Pairs with:** [BRIEF.md](./BRIEF.md) (product intent — still valid *except* where §1 below revises it) · [docs/moduo-module-contract.md](../../docs/moduo-module-contract.md) · [docs/data-layers.md](../../docs/data-layers.md).

---

## 1. Direction deltas from BRIEF.md (designer-ratified 2026-07-03)

The BRIEF predates the planning round. Five decisions **supersede** it:

1. **Checkboxes do NOT mint tasks.** A `[ ]` is a humble visual checkbox forever (shopping lists never pollute Tasks). Tasks enter notes **deliberately**: `/task` (create new or link existing) or an explicit convert gesture on a checkbox line. The "one great moment" is now: **a task line in a note IS the task** — same row both ways, schedulable and fully editable from inside the note.
2. **Everything is a note (Notion page model).** The `category`/`folder` kinds are retired; any note can contain child notes to arbitrary depth (7+ levels is a real use). Existing category/folder rows migrate to plain notes. Sidebar fixed sections only: Pinned · Inbox · the tree · Published · Archive · Trash.
3. **AI-as-author is a first-class use case.** Agents build whole doc trees (briefs, rules, project docs) via MCP. Markdown fidelity in/out and a tree-capable MCP surface are core, not garnish.
4. **Offline writing must work.** Desktop = true offline (edit + browse the tree with no network, sync on reconnect). Web = disconnection-resilient (keep typing through dropouts; edits survive reload; sync on reconnect). Full-offline web PWA stays on the local-first "lite" roadmap.
5. **Trash and Archive are two separate things** (bottom of sidebar). Archive = "done with it, keep it" (old client work, MTG decks). Trash = soft-deleted, restorable, auto-purged after 30 days.

Also ratified: **Publish to web** (per-note revocable read-only public link, subtree included) replaces the legacy "expose" feature; **note-level quote-comments** (no inline anchoring at v1); **presence avatars** with live cursors as a stretch; **per-note permissions and guest accounts deferred** (workspace-level module permissions at alpha); **`/embed-note` cut** (child pages + refs cover it); **toggle blocks cut** (no plain-markdown equivalent); **mindmap embeds kept as-is** (renamed `/mindmap`; the mindmap rethink is a future wave).

---

## 2. Page anatomy (three-pane, `FeaturePanelsShell`)

```
┌──────────────┬──────────────────────────────────┬───────────────────┐
│ SIDEBAR      │ EDITOR                           │ RIGHT PANEL       │
│              │                                  │ (switchable)      │
│ Search       │ ⌘N-focused, first line = title   │                   │
│ Pinned       │                                  │ Detail (default)  │
│ Inbox        │ [emoji] Title-line               │ · Links hub       │
│ ─ tree ─     │ body blocks…                     │ · Tags            │
│  ▸ Clients   │ ☐ plain checkbox                 │ · Suggestions     │
│    ▸ Acme    │ ◉ task line        [due chip]    │ · Activity        │
│  ▸ Projects  │ ▸ page-row (child note)          │ Comments          │
│ Published    │ [chip: /contact Acme]            │ Task detail       │
│ Archive      │                                  │ Outline           │
│ Trash        │ presence avatars (top-right)     │                   │
└──────────────┴──────────────────────────────────┴───────────────────┘
```

- **Everything tokenized.** The current notes chrome predates the design system; the rebuild is tokens-only (`lint:tw` exemption for the notes editor should be *removed* once this lands). Rungs, radius-by-role, type roles per [DESIGN_RULES.md](../../DESIGN_RULES.md).
- **Editor typography:** body = `font-sans` at `text-base`; the title line renders as `font-display` H1 weight. Headings via the existing type roles. No new fonts.
- **Min-width behavior** matches Calendar/Contacts panel rules; sidebar and right panel collapse via the standard top-bar toggles (`routeToFeatureLayout` already returns `"notes"` — verify it stays correct after the rebuild).

### 2a. Sidebar

- **Sections (fixed order):** search field · Pinned · Inbox · workspace tree · Published · Archive · Trash. Empty sections collapse to nothing (except Inbox, which shows a quiet empty line).
- **Tree rows:** emoji/icon + title + disclosure arrow (children); hover reveals `+` (new child) and `⋯` (menu: rename, icon, pin, duplicate, move to archive, delete, export .md, publish). Arbitrary depth; indentation per level, `scrollbar-thin`.
- **Drag:** reorder within a parent and reparent across rows (existing fractional `position` convention); drag a note onto another module's drop target = spine link (CT-3 payload).
- **Search:** full-text (title + body) — results replace the tree while active, grouped Title-match / Body-match with snippet lines.
- **Trash:** rows show remaining days quietly on hover; menu = Restore / Delete forever. Trash auto-purges entries older than 30 days (client-triggered sweep on module load, `notes_op_purge_expired`).

### 2b. Right panel (the switchable multi-view surface)

Variants (per the standing IA principle — the calendar switcher machinery lifts to the app shell unchanged):

| Variant | Content | Notes |
| --- | --- | --- |
| **Detail** (default) | EntityHub links roll-up (type buckets, snippets, per-row kind menu) · tag row · **suggestion strip** (first live CT-6 consumer) · activity trail (quiet, capped 6) | Same hub component as contacts. |
| **Comments** | Note-level thread (CT-5 `comments_op_add`), newest-last, composer at bottom. **Quote-comments:** select text in the editor → floating "Comment" affordance → composer opens carrying the snippet as a quote header; clicking a quote scroll-finds the text (best-effort; edited-away text keeps the quote as record). @mention people in comments = notification. | Comment count badge on the variant switcher. |
| **Task detail** | The Tasks module's own `TaskDetailPanel` for the focused task line — full editing without visiting `/tasks`. Auto-enters when a task line's meta is clicked; back returns to prior variant. | Reuse as-is, no fork. |
| **Outline** | Headings TOC from the editor state; click scrolls. Earns its seat with long AI-written briefs. | Pure client-side. |

**The reverse gift:** other modules get a **"Notes" rail variant** — on a contact/company/event/task: linked notes list (snippet rows) + one-tap "New linked note" (creates an Inbox note pre-linked to that entity). Wire into Contacts and Calendar switchers in this wave as the proof.

---

## 3. Interaction flows

### 3a. Capture
- `⌘N` (inside `/notes`), global `⌘⇧N`, and palette "New note" → `/notes` with a fresh empty note focused, caret in the title line. Zero dialogs. Optimistic local write; sub-200ms to first keystroke.
- Lands in **Inbox** (global gestures) or in the **selected folder-note** (sidebar `+` / context `+` on a note = new child).
- **First line = title.** No separate title field (the current title input dies). Empty note shows "Untitled" in the tree. Title changes propagate to the sidebar + entities registry with a ~500ms debounce.

### 3b. Task lines — the one great moment
- **Insert:** `/task` → picker: fuzzy-search existing tasks + "Create task '<text>'" as the top row when no strong match. Enter inserts a **task line block**.
- **Anatomy:** Tasks-style checkbox + inline-editable title text + quiet right-side meta (due/schedule chip when set, sync-pending dot while minting). Looks like a checkbox line that grew up, not a card.
- **Live both ways:** checking completes the task everywhere (recurrence-aware `toggleDone`); editing the text renames the task (debounced); rename/complete/schedule in Tasks reflects in the note on refresh/refocus. Clicking the meta opens the **Task detail** rail variant.
- **Where they land:** the Inbox bucket in Tasks, no due date, back-linked to the note (`entity_links`, minted = `spawned-from`, linked-existing = `references`). No special marker in Tasks lists — the link row is the context.
- **Convert:** hover a plain checkbox line → quiet "Make task" affordance (also right-click menu + `⌘⇧T`); works on a multi-line selection (batch mint). Keeps text, mints, line becomes a task line.
- **Revert / detach (three affordances):**
  1. `⌘Z` immediately after minting fully reverts — deletes the just-minted task too.
  2. Task line menu: **"Detach, keep task"** (line → plain checkbox, task lives) and **"Detach and delete task"** (line → plain checkbox, task deleted, undo toast).
  3. Deleting the line (or a selection containing N task lines, or trashing the note): tasks soft-detach and survive; ONE toast — "N task(s) detached · Delete them too?" (8s, undoable). Never a modal, never stacked toasts.

### 3c. Slash grammar (final, designer-ratified)

| Command | Does | Notes |
| --- | --- | --- |
| `/page` | New **child note** (page-row block inserted here + note created in tree) | The Notion muscle-memory word. |
| `/note` | Insert a **reference chip** to an existing note | Consistent rule: entity nouns insert that entity. |
| `/task` | Task line — create new or link existing | §3b. |
| `/contact` `/company` `/event` | Entity chip, create-and-link offered where sensible (contact/company yes; event no at v1) | Chips are the CT-4 `EntityRefNode`. |
| `/mindmap` | Existing mindmap embed (renamed from `/embed-mindmap`) | Kept working, demoted in menu order; no new investment. |
| Basics | `/h1 /h2 /h3 /bullet /number /todo /quote /code /divider /table` | `/todo` = the humble checkbox. `/toggle` removed. `/embed-task` removed. |

Keyword aliases make discovery forgiving (`child`, `subpage` → `/page`; `check`, `checkbox` → `/todo`). Command names are labels — cheap to rename later.

- **`@` = workspace people ONLY** (mention → notification "Maciej mentioned you in *{note}*", quiet/grouped, deep-links). Entities leave the `@` picker (CT-4's `includePeople` surface gets scoped). A teammate who is also a contact: `@anna` notifies her; `/contact Anna` attaches her card — different intents, different gestures.
- **Page-rows:** child notes appear as page-row blocks in the parent body (Notion mirror). Creating a child from the sidebar also appends a page-row to the parent; deleting the page-row block does NOT delete the child note (it stays in the tree; the row is a mirror, removable).
- **Drag-onto:** drop an entity into the open editor = chip at the drop point + link; drop onto a sidebar note row or a hub = link only (no invisible content insertion).

### 3d. Sync, offline, presence
- **Local-first feel on both platforms:** Y.Doc per note persisted to IndexedDB (web + desktop webview alike) + an idempotent outbox; edits apply locally in <16ms, sync is invisible. Desktop gets true offline (tree metadata cached too); web survives dropouts and reloads.
- **Transport:** push = `notes_op_apply_updates` (batched CRDT updates, idempotent by `(client_id, client_seq)`); pull = updates-since-cursor on open/reconnect/refocus; live = **Supabase Realtime broadcast channel per open note** relaying updates + awareness. Compaction: the editor periodically folds the update log into the snapshot (`notes_op_save_snapshot`).
- **Presence:** avatars top-right of the note ("Mike is viewing"), via the same channel's presence. **Live cursors = stretch**: Lexical's collab plugin renders them nearly free once awareness flows; ship if the transport lands cleanly, else fast-follow. No other presence chrome.
- **Status UX:** nothing while healthy. Offline/failing: one quiet muted dot + "Saved locally — will sync" tooltip in the note header. Never a spinner on keystrokes, never a modal.
- **Same-user two-device:** plain CRDT merge, no special UX.

### 3e. Publish to web ("Published")
- Note header `⋯` → **Publish to web**: creates a revocable public read-only link (token URL, clean rendered page, no app chrome, `noindex`). **Subtree included** — child pages navigable under the same link. Unpublish revokes instantly.
- **Published** sidebar section lists notes with an active link (children shown nested under their published root).
- Guest accounts (comment/edit for outsiders) are post-alpha; per-note member permissions are post-alpha (workspace-level notes: none/view/edit as today; viewers can comment).

### 3f. Markdown & import/export
- **Stored as CRDT, markdown at every door:** paste md → blocks; copy → clean md; per-note "Export .md"; whole-tree export = nested folders zip; MCP speaks markdown both ways. Task lines/chips serialize to readable md (`- [ ] title` + a stable id comment; chips → `[label](moduo://type/id)`), lossless enough to re-import.
- **Import:** md files / md-zip (Notion's export format) → recreates the tree from folder structure. Import wizard = drop zone → tree preview → import (batched op, attributed activity).
- **redb migration:** one-time desktop import of legacy local notes into Supabase on first run of the new module (idempotent, summary toast). Legacy expose code + Rust notes commands are removed after migration ships.

### 3g. Trash / Archive / Pin
- Archive: menu action; note (with subtree) leaves the tree for the Archive section; fully readable there; Unarchive restores. Archived notes stay searchable (results mark them quietly).
- Trash: Delete = trash (with subtree), undo toast; Restore or Delete-forever from the section; 30-day auto-purge. Purge tombstones the registry entry (links show tombstoned chips) and hard-deletes doc + updates.
- Pin: per-user? **No — workspace-level** (matches current data; per-user pins would need a new table; acceptable at ≤2-person alpha).

---

## 4. States

- **Empty (fresh workspace):** one seeded, deletable "Welcome to Notes" note demonstrating task lines, `/page`, a chip, and a checkbox — self-teaching, no template gallery. (The full workspace-wide showcase is a platform-wave item.)
- **Loading:** sidebar skeleton rows + editor shimmer ≤300ms; cached notes render instantly from IndexedDB.
- **Error / deploy-gap:** list/read failures degrade to cached data + quiet banner; mutations surface honest toasts. New RPCs on hot read paths wrap in try/catch (the gotcha).
- **View-only member:** editor read-only (no slash-create, no drags), comments allowed, no publish/trash affordances.
- **Tombstones:** chips/links to trashed-then-purged notes render the standard tombstone treatment.
- **Conflict:** none by construction (CRDT). A stale device syncing week-old edits merges losslessly; content may interleave — acceptable, self-healing.

---

## 5. Data model (Supabase-first; target shape)

The prod `notes` table is pre-migrations-era — **extend in place** (CAL-2 pattern: check generated types, drop legacy policies by loop, op-only writes). Legacy `share_scope`/`share_permission`/`kind` columns stay but are superseded (`kind` backfilled to `'note'`).

```
notes (extended)
  + body_text     text            -- derived plain text, client-written on save (FTS source)
  + body_md       text            -- derived markdown, client-written on save (MCP/read source)
  + search_tsv    tsvector GENERATED (title + body_text)
  + doc_version   int             -- snapshot version
  + published_at  timestamptz NULL
  + publish_token text NULL UNIQUE
  (doc_state stays: compacted Yjs snapshot, base64)

note_updates (new)                -- append-only CRDT update log
  id bigserial PK · workspace_id · note_id FK CASCADE · client_id text ·
  client_seq int · update_b64 text · created_at
  UNIQUE (note_id, client_id, client_seq)   -- idempotent outbox pushes
```

- **Ops** (`notes_op_*`, each: guard → write → `entities_op_upsert('note')` → activity where meaningful): `create`, `rename` (registry upsert, **no activity row** — continuous first-line edits), `move` (cycle guard = the invariant), `set_meta` (icon/pin), `duplicate`, `archive`/`unarchive`, `trash`/`restore`/`purge`/`purge_expired`, `publish`/`unpublish`, `apply_updates` (body writes; no activity), `save_snapshot` (compaction), `import` (batched md), `mention` (activity row targeting mentioned users → notification).
- **Permission fn** `notes_module_permission` — copied from `tasks_module_permission` **including the `module_api_key_id()` branch** reading `scopes->>'notes'` (the three-module gotcha).
- **Links:** minted task = `spawned-from`, linked-existing = `references`; `allowedKinds` matrix extended for (note, task). Tags ride `tag_links` (`entity_type='note'`).
- **Public read path:** an edge function renders published notes from `body_md` by token (no RLS hole; service-role read scoped to `published_at IS NOT NULL`).

---

## 6. DoD surfaces

- **MCP manifest + connector module:** reads `notes_list` (tree), `notes_get` (markdown), `notes_search`; writes `notes_create` (md body + parent — agents build trees), `notes_append` (md), `notes_update` (replace body), `notes_move`, `notes_link`. Markdown in/out; the connector builds/loads Yjs docs server-side (yjs is pure JS, Deno-safe).
- **Dashboard widget:** **Recent notes** (recently touched by anyone, snippet rows, deep-link via `moduo:entity:open`). Legacy "notes" preview widget stays untouched until the dashboard rework.
- **Notifications:** @mention (body + comment) only at v1; "shared note changed" waits for digest infra. Quiet, grouped, deep-linking.
```
