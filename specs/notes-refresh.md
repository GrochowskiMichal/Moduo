# Spec: Notes refresh (new core, new surface)

> Status: **In build — NR-1 done, NR-2 built** · Owner: mike (engineer-mode `/s1`, 2026-10-13; 20 product-code calls ratified by Mike) · Supersedes: [specs/notes.md](./notes.md) and [.design/notes/DESIGN_BRIEF.md](../.design/notes/DESIGN_BRIEF.md) wherever they disagree (§2 page anatomy, §2a sidebar, §3c `/mindmap`, quote-comments). Everything else in them (task-line semantics, `@` = people, publish, markdown at every door, offline) still holds · Module contract: [docs/moduo-module-contract.md](../docs/moduo-module-contract.md)

## Scope

Notes shipped in July (NO-1…NO-10) and works, but it is the app's most fragile leg. Agent (MCP) writes to a note someone has opened are silently overwritten. Two markdown dialects drift the content. The live channel is not access-controlled. Notes jump between Inbox and the tree. Empty "Untitled" notes pile up. The UI hangs off a 949-line page and a 1165-line overlay plugin, and none of the manual checklists was ever walked.

This refresh **keeps the data model and Lexical**. That means one Yjs document per note plus the `note_updates` log, workspace sharing, the spine links, the `notes_op_*` contract and the MCP tools. On top of that it **rebuilds the surface and the editor core**:

- a focused writing layout and a sidebar that never moves notes on its own;
- quiet block handles;
- `[[` links;
- task lines that live inside the document;
- one markdown converter;
- agent edits that land live and can be undone;
- a secured live channel;
- comments anchored to text;
- images and files;
- a ⌘K palette that searches everything.

It ships **behind a per-user "New Notes" switch** over the same data, then flips and deletes the classic UI.

The lead pillars are a drastic UI/UX improvement plus writing feel and speed, so polish and responsiveness are first-class acceptance criteria, not garnish.

## Product behavior & UX

### Layout: focused writing

- **Columns:**
  - **Sidebar:** collapsible with the standard top-bar toggle.
  - **Editor:** one centred column at the reading width `--width-prose-max`.
  - **Right panel:** closed by default.
- **Top bar:**
  - a breadcrumb (`Pages › Clients › Acme`, each crumb clickable; an Inbox note shows `Inbox`);
  - presence avatars;
  - one sync signal: nothing while healthy, a muted dot with "Saved locally — will sync" otherwise. This replaces today's stack of up to three signals;
  - Share, `⋯` and the right-panel toggle.
- **Right panel:** opens on demand with the same variants as today: Detail, Comments, Outline and the transient Task panel. The variant you last opened is remembered per user.
- **Full width:** `⋯ → Full width` widens one note and is remembered on that note, for tables and long briefs.

### Note header and footer

- **Header:** an optional emoji icon, then the title (still the first line of the body), then one muted meta line. The meta line holds linked-entity chips (`Acme · 2 tasks · Thu call`) and `Edited 2h ago by Maciej`, or `Claude edited · 2 min ago · Undo` after an agent write. No covers.
- **Footer:** a quiet "Linked from (n)" section listing backlinks grouped by relationship, with snippets. Clicking one opens it.

### Sidebar: Favorites · Inbox · Pages

- **Favorites:** per user, in your own order. Hidden when empty.
- **Inbox:** a real, stored place. Quick captures land here and stay until you file them by dragging into Pages, choosing `Move to…`, or nesting under a page. A count badge sits on the header. When empty it shows one quiet line: "Captures land here."
- **Pages:** one tree where any root note can live, with or without children. **A note never changes section unless you move it.** `+ New page` appears on header hover.
- **Footer `…` row:** Published (n) · Archive (n) · Trash (n). Each opens as a sidebar sub-view with a back arrow. Trash keeps its 30-day purge and "Delete forever".
- **Rows:**
  - selection uses the `--selected-bg` recipe (R5), and hover is a dimmed tint, never the same as selected;
  - `⋯` and right-click open the same menu: Add to favorites · New subpage · Duplicate · Move to… · Export .md · Publish… · Archive · Move to trash.
- **Keyboard:** it is a real tree (`role="tree"`, `aria-expanded`, `aria-level`).
  - ↑ / ↓ moves between rows.
  - → expands, or goes to the first child.
  - ← collapses, or goes to the parent.
  - ↵ opens.
  - ⌫ moves to trash, with the undo toast.
- **Drag:** reorder, nest, file from Inbox into Pages, or move back to Inbox. Reordering also works from the keyboard. Dropping a note onto another module's target still creates a spine link.
- **Search:** until NR-10 the sidebar keeps its full-text search, restyled. NR-10 turns it into a row that opens ⌘K scoped to notes.

### Capture and empty notes

- **Shortcuts:**
  - **⌘N** inside Notes, **⌘⇧N** anywhere, or **New note** in the palette: a focused note in Inbox, caret in the title.
  - **`+`** on a page: a focused child note.
  - Under 200 ms to the first keystroke.
- **A new note exists only on this device until its first character.** If you navigate away without typing, it disappears silently: no toast, no Trash entry, no server row.

### Writing: quiet blocks

- **Block handle:** hovering a top-level block shows a faint `⋮⋮` handle in the left gutter. Drag it to move the block; click it for Turn into · Duplicate · Delete · Comment. **⌥⇧↑ / ⌥⇧↓** moves the block under the caret.
- **Slash and `@` menus:** they share one keyboard behaviour: ↑↓ ↵ Esc, focus stays with the menu, and both close on an outside click. The grammar is today's minus `/mindmap`, plus `/image` and `/file` from NR-9.
- **`[[`:** opens a note picker that inserts a live note chip and records the link. The top row is "Create '…'" when nothing matches. `/note` stays as an alias.
- **⌘K on a selection:** opens a link dialog for a URL or a note, which is also reachable from the selection toolbar.
- **Mindmap:** `/mindmap` is gone. Existing mindmap embeds render as a quiet "Mindmap (unavailable)" line, so no content is lost.

### Task lines (same model, rebuilt row)

- **The model is unchanged:** a task line *is* the task. Plain checkboxes stay checkboxes. Tasks enter a note via `/task`, ⌘⇧T, or "Make task" on a checkbox line. Detach and undo rules are as in [specs/notes.md](./notes.md).
- **The row is rebuilt as a real in-document component:**
  - a round check and an inline-editable title;
  - quiet chips on the right for due date, schedule and assignee, each settable inline from a small popover;
  - clicking the row's meta opens the Task panel.
- **No drift:** the row never lags behind the text on scroll, resize or remote edits.

### Agent co-authoring

- **An MCP edit is a real document change.** If the note is open, it appears live. If not, it is there the next time anyone opens the note. It is never lost.
- **Attribution:** the meta line shows `Claude edited · 2 min ago · Undo` (the key's name, not "Claude", when the key is named). Undo reverts only the agent's change and keeps every human edit made since.

### Comments anchored to text

- **Starting a thread:** select text, then choose **Comment** from the selection toolbar or the block menu.
- **The highlight:** the text gets a soft highlight that follows edits. The thread opens in the Comments panel, which lists threads in document order. Resolving a thread clears its highlight.
- **Note-level thread:** it stays for general remarks. Old quote-comments show there unchanged.
- **Mentions:** `@mention` inside a comment notifies, as today.

### Images & files (NR-9)

- **Adding:** paste, drag in, or `/image` / `/file`.
  - Images render inline and can be resized.
  - Files render as a compact tile with name and size.
  - Both open in the attachments viewer.
- **Limits** follow [specs/attachments.md](./attachments.md).
- **Export and import:**
  - Markdown export references the files, and the zip export bundles them.
  - Notion import uploads the PNGs it currently skips.

### ⌘K searches everything (NR-10)

- **What it finds:**
  - the global palette searches note titles instantly from cache, then note bodies;
  - task, contact, company, event and email titles via the entity registry;
  - recents when the query is empty;
  - `Create note "<query>"`.
- **The placeholder** stops over-promising, because now it is true.

### Rollout

- **The switch:** the classic Notes header gets a quiet **Try the new Notes** button. The new Notes `⋯` menu has **Switch back to classic Notes**.
- **The preference** is per user, follows you across devices, and is off by default until NR-12 flips it.
- **Same data:** both UIs read and write the same notes. While the switch exists, classic pins and new Favorites are separate: Favorites are per-user and backfilled once from pins.

## Edge cases

- **Adding a first child to an Inbox note:** the parent stays in Inbox. Children never appear in Inbox; a child created under an Inbox note appears nested under it there.
- **Moving an Inbox note under a page:** it leaves Inbox, which counts as filing. Moving a page to root via `Move to… → Pages` keeps it out of Inbox.
- **Agent-created and imported roots:**
  - an MCP `notes_create` root lands in Inbox, because it is a capture;
  - a Notion or markdown import wizard root lands in Pages, because the user filed it by importing.
- **⌘N twice without typing:** neither draft ever reached the server; only a draft you type into persists.
- **First keystroke offline:** the create and the body queue locally and sync on reconnect, so there is no duplicate on retry.
- **Moving a note into its own descendant:** rejected quietly. The drop target never highlights.
- **Dragging a shared note into a private parent, or the reverse:**
  - the design-system dialog asks "Keep current access" or "Match the new parent", replacing `window.confirm`;
  - Esc means keep, so nothing changes silently.
- **Two people moving the same block concurrently, or one moving it while the other types inside it:** the merge never corrupts the document. At worst the block shows the latest move, and the text survives.
- **Agent edit while a human is typing in the same paragraph:** both survive, in CRDT interleave order. Undo of the agent edit leaves the human's characters.
- **Agent writes to a note nobody has ever opened:** the next open shows the text. Search and MCP reads see it immediately.
- **Comment highlight's text deleted:** the thread moves to a "Detached" group at the end of the panel and stays readable.
- **Joining the live channel without access:** someone who knows a note's id but lacks access is refused by the server. They see nothing and their presence never appears.
- **View-only member:**
  - the editor is read-only;
  - no block handles, no slash create, no drag, no publish or trash;
  - comments are still allowed.
- **Stale cache on open:** the cached doc renders instantly and is editable. "Synced" is reported only after the pull completes, and the pull pages through any length of update log.
- **Image over the plan limit, or storage full:** the [attachments.md](./attachments.md) mirror copy applies inline in the image tile. The note stays editable.
- **The switch flipped mid-edit:** the open note's pending updates flush before the other UI mounts.
- **Search offline:** cached titles still match. Body results show "Body search needs a connection" instead of a silent "No results".

## Acceptance criteria

- **AC1 — The switch:** turning New Notes on and off keeps every note, link, task line and comment intact. The choice follows the user to their other devices.
- **AC2 — Stable sections:** the sidebar shows Favorites (per user), Inbox, Pages and a Published/Archive/Trash footer. A note only changes section when the user moves it.
- **AC3 — Capture and discard:** ⌘N, ⌘⇧N or the palette gives a focused note in Inbox, with typing under 200 ms. Leaving it untouched leaves no trace anywhere: not on the server, not in Trash, not in other sessions.
- **AC4 — Tree by keyboard and drag:**
  - the tree is fully operable by keyboard (navigate, expand/collapse, open, trash, reorder) and announces itself as a tree;
  - drag reorders, nests, files and un-files;
  - cycles are refused quietly.
- **AC5 — Focused layout:**
  - a centred reading column and a breadcrumb;
  - the right panel is closed by default and summonable, with its variant remembered;
  - a per-note Full width that persists.
- **AC6 — Header and footer:** the meta line shows linked-entity chips and "Edited … by …". The "Linked from" footer lists backlinks grouped by relationship, with snippets.
- **AC7 — Quiet blocks:**
  - hovering a block shows a handle; dragging moves the block, and the menu offers Turn into, Duplicate, Delete and Comment;
  - ⌥⇧↑ / ⌥⇧↓ move blocks;
  - slash and `@` menus behave identically with the keyboard.
- **AC8 — Links:** `[[` inserts a live note chip, creating the note when nothing matches, and records the link. ⌘K on a selection links a URL or a note.
- **AC9 — Markdown fidelity:**
  - copy, export, publish and MCP reads keep links, bold, italic, strikethrough, code, line breaks inside a block, headings, ordered and bulleted lists, checkboxes, task lines, chips and tables;
  - markdown → note → markdown is stable.
- **AC10 — Task lines rebuilt:**
  - every existing task-line behaviour still works;
  - due date, schedule and assignee are visible and settable inline;
  - the row never drifts on scroll, resize or remote edits.
- **AC11 — Agent edits:**
  - an MCP append, update or create appears live in an open note and on the next open of an unopened note;
  - it is attributed in the meta line;
  - Undo removes only the agent's change;
  - the next human keystroke never discards it.
- **AC12 — A secure live channel:** only people with view access to a note can receive its live edits or appear in its presence, and only editors can send. Presence shows people's names.
- **AC13 — Anchored comments:**
  - select → Comment starts a thread whose highlight follows edits;
  - resolving clears it;
  - deleted anchors move to "Detached";
  - mentions notify;
  - old quote-comments still show.
- **AC14 — Images & files:**
  - paste, drag, `/image` and `/file` work; images can be resized;
  - viewer and download work;
  - export and import carry the files;
  - plan limits apply with the attachments copy.
- **AC15 — Search everything:** ⌘K finds notes by title and body, and finds tasks, contacts, companies, events and emails by title. An empty query shows recents. "Create note …" works. Offline is labelled honestly.
- **AC16 — Import hardening:**
  - re-importing a page that was trashed after import brings it back instead of skipping it;
  - oversize archives are refused with a reason;
  - progress is honest during document building and on a no-op re-import;
  - workspaces with more than 1000 notes list completely.
- **AC17 — The flip:**
  - New Notes is the default, and the classic UI, its switch and its dead code are deleted;
  - mindmap embeds render the "unavailable" line;
  - `bun run verify` is green and the notes e2e smoke passes.
- **AC18 — Module contract:**
  - organizing ops (file, favorite, full width) go through `notes_op_*`;
  - filing writes attributed activity, while favorites and width are personal and write none;
  - the MCP tools still round-trip markdown;
  - the Recent-notes widget works with the stored Inbox.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/notes/experience.test.ts` · "experience pref" | AC1 | The switch reads and writes the synced preference, defaults to classic, and flushes the open note before swapping. |
| `src/features/notes/sections.test.ts` · "stable sections" | AC2, AC18 | Stored Inbox ignores children, favorites follow each user's own order, archived and trashed notes leave every section, and the footer counts are right. |
| `src/features/notes/sync/meta-outbox.test.ts` · "file + favorite replay" | AC2, AC3 | Filing and favoriting queue offline and replay in order without duplicates. |
| `src/features/notes/draft-note.test.ts` · "lazy create" | AC3 | An untouched draft is dropped on navigation, the first character creates exactly once, and a double ⌘N keeps only the draft you typed into. |
| `src/features/notes/shell/tree-keyboard.test.ts` · "tree keys" | AC4 | The arrow keys, Enter and Backspace do what a file tree does, for collapsed, expanded and leaf rows. |
| `src/features/notes/shell/drop-intent.test.ts` · "drop intent" | AC4 | The pointer position picks before, inside or after; Inbox → Pages files the note; a drop into a descendant is refused. |
| `src/features/notes/shell/breadcrumb.test.ts` · "crumbs" | AC5 | The breadcrumb walks a note's ancestors and shows "Inbox" for Inbox notes. |
| `src/features/notes/shell/notes-sidebar.test.tsx` · "tree roles" | AC4 | The rendered sidebar exposes tree, treeitem, aria-expanded and aria-level. |
| `src/features/notes/shell/notes-sidebar.stories.tsx` | AC2, AC4 | Visual states: default, empty Inbox, favorites, view-only, search, footer sub-views. |
| `e2e/notes/shell.spec.ts` (env-gated) | AC1–AC5 | Switch on → ⌘N → type → the note sits in Inbox → drag into Pages → reload → still there; an untouched ⌘N leaves nothing. |
| `src/features/notes/note-meta.test.ts` · "meta line" | AC6, AC11 | Shapes the chips, "Edited … by …" and the agent-edit marker from links plus activity. |
| `src/features/notes/editor/markdown.test.ts` · "single dialect" | AC9 | Markdown → editor → markdown is byte-stable for every listed construct; the old `doc-text` walker is gone. |
| `src/features/notes/editor/block-move.test.ts` · "move under merge" | AC7 | Moving a block while a peer edits inside it keeps the text, in a two-doc merge. |
| `src/features/notes/editor/note-link.test.ts` · "[[ picker" | AC8 | `[[` matches notes, falls back to create, and inserts a chip plus a link. |
| `src/features/notes/editor/task-line-structure.test.ts` · "one meta node" | AC10 | The node transform keeps exactly one meta node at the end of a task line through edits, paste and remote updates. |
| `src/features/notes/tasks/task-line.test.ts` (extended) | AC10 | Inline due, schedule and assignee patches map to the right task ops. |
| `supabase/functions/moduo-mcp/modules/notes.test.ts` · "crdt write" (Deno) | AC11 | Append and update produce Yjs updates that a client doc materializes into the same markdown. |
| `src/features/notes/sync/agent-undo.test.ts` · "undo agent only" | AC11 | Undoing an agent-origin update keeps the human edits made after it. |
| Realtime policy probe (live check, `docs/testing`) | AC12 | A member without access is refused joining `note:<id>`; a viewer can listen but not send. |
| `src/features/notes/comments/anchors.test.ts` · "anchor lifecycle" | AC13 | Mark ids map to threads, a deleted anchor's thread becomes detached, and resolve unmarks. |
| `src/features/notes/editor/image-node.test.ts` + `export.test.ts` (extended) | AC14 | An image node round-trips through markdown as `moduo://attachment/<id>`, and the zip bundles its file. |
| `src/components/app/palette/search-providers.test.ts` · "merge + rank" | AC15 | Title hits rank first, then body hits, then entities; an empty query gives recents; offline body search is labelled. |
| `src/features/notes/import.test.ts` (extended) | AC16 | A trashed id re-imports, an oversize archive is refused, and progress phases are reported. |
| `e2e/notes/smoke.spec.ts` (env-gated) | AC17 | The default UI is New Notes, and capture, nest, task line, comment and publish work end to end. |
| `src/features/notes/ops-manifest.test.ts` (extended) | AC18 | The manifest still registers and the MCP tool list is unchanged. |

## Assumptions & technical decisions

**Engine and editor**

1. **confident** · **Lexical stays** (operator call; Tiptap was rejected by Mike). **Keep `CollaborationPluginV2__EXPERIMENTAL` and the `root-v2` document shape**, because moving to the v1 binding would rewrite every stored document. Mitigations:
   - pin `@lexical/*` to an exact version;
   - add a binding contract test (materialize → markdown → identical) that runs on every Lexical bump.
2. **low-confidence** · **Split node schema from node view.**
   - `editor/schema/` holds plain node classes with no React import. Decorators resolve their component from a view registry the browser editor installs.
   - The same schema then runs in the browser editor, headless materialize, and the MCP Edge Function (Deno, `npm:` specifiers).
   - → verify by: NR-6's first step, a Deno test that builds a doc with `@lexical/headless` + `@lexical/yjs` and a branch deploy that stays under the Edge bundle limit. Fallback: an `notes-write` Node-compatible function on the same code.
3. **confident** · **One markdown converter.**
   - `body_md` and `body_text` are derived from the editor state with `$convertToMarkdownString(NOTES_TRANSFORMERS)`, the grammar typing, paste and import already use.
   - `sync/doc-text.ts` is deleted.
   - The deriving client is whoever made the edit. The Edge Function derives for agent writes, using the same code.
4. **confident** · **An honest provider.**
   - `synced` flips only after the initial pull completes; the cached IndexedDB doc stays editable meanwhile.
   - `pullDoc` pages through `note_updates` in batches of 1000 until it is exhausted.
5. **low-confidence** · **Block handles use `DraggableBlockPlugin_EXPERIMENTAL`** (`@lexical/react`, 0.49) with our own handle and menu. A move is delete-plus-insert under Yjs.
   - → verify by: `block-move.test.ts`. If concurrent text inside a moved block is lost, the move is implemented as a node-level move inside one transaction and re-tested.
6. **low-confidence** · **Task lines inside the document.**
   - `TaskLineNode` stays an ElementNode with text children. The check is a CSS `::before` with click hit-testing, Lexical's CheckList pattern.
   - A trailing inline `TaskMetaNode`, a DecoratorNode, renders the chips through Lexical's own decorator portal, which is supported. That is unlike the foreign DOM that crashed in NO-5.
   - A node transform enforces exactly one meta node, last.
   - Deletes the 1165-line overlay.
   - → verify by: `task-line-structure.test.ts`, Storybook states, and the live check (scroll, resize, two tabs).
7. **confident** · **`[[`** is a Notes-local trigger riding the shared `MentionMenuPlugin` (`triggerChar`). GR-0 (the app-wide grammar spec, not yet written) may adopt it elsewhere.
8. **confident** · **Mindmap.** `EmbedNode` stays registered so old docs load, but renders a quiet "Mindmap (unavailable)" line, and `/mindmap` leaves the grammar. `EmbeddedMindmap.tsx` is deleted.

**Organizing data (NR-1)**

9. **confident** · **Stored Inbox.**
   - `notes.in_inbox boolean NOT NULL` with `CHECK (NOT in_inbox OR parent_id IS NULL)`.
   - A BEFORE INSERT trigger fills a NULL `in_inbox` with `parent_id IS NULL`, so captures and MCP roots land in Inbox. `notes_op_import` passes the row's explicit `inInbox` (false from the wizard).
   - A BEFORE UPDATE OF `parent_id` trigger clears it when a note gains a parent.
   - A new `notes_op_file(p_workspace_id, p_note_id, p_in_inbox, p_position)` handles Inbox ↔ Pages.
   - The column is added with `DEFAULT false`, backfilled to today's derived Inbox (a live, unarchived root with no live children), then the default is dropped, so users see the same Inbox the day it ships.
   - Additive, so there is no deploy gate: classic ignores the column.
   - Rejected: keeping derived sections, which is the root of the jumping.
10. **confident** · **Per-user Favorites.**
    - A new table `note_favorites(workspace_id, user_id, note_id → notes ON DELETE CASCADE, position text, created_at)` with PK `(user_id, note_id)`.
    - RLS: select only your own rows where `can_access('note', note_id, 'view')`. No direct writes.
    - `notes_op_set_favorite(p_workspace_id, p_note_id, p_value, p_position)`, keyed on the resolved actor, with no activity row because it is personal.
    - Backfill: every `is_pinned` note becomes a favorite for each workspace member who can view it. `is_pinned` is then unread by the new UI and dropped in a later contract cleanup.
11. **confident** · **Full width** is `notes.full_width boolean NOT NULL DEFAULT false`, set through `notes_op_set_meta`'s existing jsonb patch (`fullWidth`). The function is replaced with the same signature, so there is no overload trap. No activity row.
12. **confident** · **Function hygiene.**
    - New and replaced functions follow the October hardening: `SET search_path` pinned, `REVOKE … FROM anon, public`, `GRANT EXECUTE … TO authenticated`, and the API-key branch through `notes_module_permission`.
    - Row contracts are extended in `contracts/rows.ts` (`in_inbox`, `full_width`, plus a new `noteFavoriteRowSchema`).
    - No closed vocabulary changes.
13. **confident** · **Lazy drafts.** A new note lives only in client state, under a client-minted UUID held in `?id=`. The first content change sends `notes_op_create`, then the doc push, through the existing FIFO meta-outbox. Navigating away untouched drops it. Rejected: create then delete-if-empty, which leaves server churn, activity rows and trash noise.

**Shell (NR-2)**

14. **confident** · **The switch** is a synced user preference `notesExperience: 'classic' | 'next'` in the `preferences` sync domain.
    - The route component picks `NotesClassicPage` (today's file, renamed) or the new `NotesShell` in `src/features/notes/shell/`.
    - Both share the runtime, the engine and the data.
    - The classic code is frozen: bug fixes only, no features.
15. **confident** · **DnD** uses dnd-kit with `PointerSensor` plus `KeyboardSensor` (Tasks' pattern). It keeps the `entityDrag` payload so cross-module drops still link. The sharing confirm moves to the `AlertDialog` primitive.
16. **confident** · **NavRow (DS-3) lives only on `maciej`.** The new sidebar applies the R5 `--selected-bg` recipe directly, and the DS-5 sweep migrates it to `NavRow` once DS lands in `develop`. No dependency on unmerged design-state work.
17. **confident** · **Reading width** uses the existing token `--width-prose-max` (42rem). No new token.

**Live, agents, comments, files, search**

18. **confident** · **Secure channel.**
    - Note channels become private (`config: { private: true }`, topic `note:<id>`).
    - An RLS policy on `realtime.messages` allows read with `can_access('note', <topic id>, 'view')` and send with `'edit'`, copying chat's policy (`20261006150000_chat_module.sql`).
    - Presence carries the member's display name and avatar from workspace member profiles.
    - The client goes through `getRuntime()`, with no direct `supabaseClient` import.
19. **low-confidence** · **Agent writes.**
    - `note_updates` gains `origin text NOT NULL DEFAULT 'user'` (`'user' | 'agent'`, a closed vocabulary in `vocabularies.ts` with a matching CHECK) plus `actor_key_id uuid NULL`.
    - The connector pulls the doc, applies the edit headlessly, and pushes through `notes_op_apply_updates` with `p_origin='agent'`. It writes `body_md`/`body_text` and a `notes.agent_edit` activity row, and broadcasts on the note channel.
    - Clients apply agent-origin updates with origin `agent:<keyId>`. A per-session `Y.UndoManager` tracking that origin powers Undo.
    - Closes MCP-1's notes half.
    - → verify by: `agent-undo.test.ts`. If UndoManager cannot track updates applied before it was created, the fallback is a server-kept pre-write state vector: Undo = apply the inverse diff of that one update.
20. **confident** · **Anchored comments.**
    - `@lexical/mark` MarkNodes carry thread ids inside the doc, as Lexical's playground CommentPlugin does.
    - `comments` gains `anchor_id uuid NULL` (the thread) and `resolved_at timestamptz NULL`. A thread is all comments sharing an `anchor_id`.
    - This is a shared spine table, so Tier 2.
    - Quote-comments (an `anchor_id` of NULL) stay note-level.
21. **low-confidence** · **Images and files reuse AT-1's `attachments` table and bucket.**
    - Widen `attachments_op_*`'s `entity_type` check to include `'note'`.
    - An `ImageNode` / `FileNode` (decorators) store the attachment id and dimensions.
    - Markdown writes `![alt](moduo://attachment/<id>)`.
    - Public pages get signed URLs from `notes-public`.
    - AT-1 lives only on `maciej` and its landing rule keeps it there, so NR-9 waits on AT-1 reaching `develop`. Whether NR-9 reuses AT-2's upload pipeline or builds a minimal one depends on which lands first.
    - → decide at NR-9's DoR.
22. **confident** · **Search everything.**
    - The palette gets a provider registry: notes (cached titles plus `search_tsv` bodies), the entity registry (`spine.searchEntities` for task, contact, company, event and email titles), and recents.
    - Body search for other modules is out of scope.
    - Rejected: a new cross-module FTS RPC, because the registry already covers titles.
23. **confident** · **The public page** adopts the new prose stylesheet (shared typography); behaviour is unchanged.
24. **confident** · **Out by operator call:** version history and live cursors (avatars only). Callouts, toggles and code highlighting were not picked.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| NR-1 | **Organizing data: stored Inbox, Favorites, full width** | Migration (assumptions 9–12), `notes_op_file` + `notes_op_set_favorite` + `set_meta` `fullWidth` + `import` `inInbox`, runtime `notesV2` additions (`listFavorites`, `setFavorite`, `fileNote`, meta fields), offline meta-outbox support, pure `sections.ts`, contracts. No UI. **Tier 2** (migration). | AC2 (data), AC18 | — |
| NR-2 | **New Notes shell + sidebar, behind the switch** | `notesExperience` pref + switch buttons, `NotesShell`: focused layout, top bar (breadcrumb, presence, one sync signal, Share, `⋯`, panel toggle), sidebar Favorites/Inbox/Pages/footer sub-views, keyboard tree + roles, dnd (pointer + keyboard, file/unfile, AlertDialog), lazy drafts + capture shortcuts, right panel closed by default; mounts today's `NoteEditor` in the reading column. Story + e2e smoke. | AC1, AC2, AC3, AC4, AC5 (layout) | NR-1 |
| NR-3 | **Editor core** | Schema/view split, single markdown converter (delete `doc-text.ts`), honest provider + paged pull, header meta line + "Linked from" footer, full-width toggle, prose stylesheet shared with the public page, binding contract test, version pin. | AC5 (width), AC6, AC9 | NR-2 |
| NR-4 | **Writing UX** | Quiet block handles + block menu + ⌥⇧↑↓, unified slash/mention keyboard regime, `[[` note links, ⌘K link dialog, mindmap drop, new welcome note that teaches `/task`, `[[`, `/contact`. | AC7, AC8 | NR-3 |
| NR-5 | **Task lines in the document** | `TaskLineNode` + `TaskMetaNode` + transform, inline due/schedule/assignee chips + popovers, delete the overlay plugin, keep every NO-5 behavior. | AC10 | NR-3 |
| NR-6 | **Agent writes land live** | Deno headless schema in `moduo-mcp`, `note_updates.origin/actor_key_id` migration + vocabulary, `apply_updates` `p_origin`, connector create/append/update as CRDT writes + broadcast, `notes.agent_edit` activity, client Undo. **Tier 2** (migration, `moduo-mcp`, contracts). | AC11 | NR-3 |
| NR-7 | **Secure live channel + named presence** | Private `note:<id>` channels, `realtime.messages` policy, runtime-routed client, names/avatars in presence. **Tier 2** (RLS). | AC12 | — |
| NR-8 | **Comments anchored to text** | MarkNode threads, `comments.anchor_id/resolved_at` migration, Comments panel rebuilt (document order, resolve, Detached group, note-level thread kept). **Tier 2** (migration on a spine table). | AC13 | NR-4 |
| NR-9 | **Images & files** | `ImageNode`/`FileNode`, paste/drag/`/image`/`/file`, resize, viewer, export/import carry files, attachments `entity_type` widened. **Tier 2** (migration). | AC14 | NR-3, AT-1 on `develop` |
| NR-10 | **⌘K searches everything** | Palette provider registry, notes + registry + recents providers, create-from-query, honest offline, sidebar search row → palette. | AC15 | NR-2 |
| NR-11 | **Import hardening** | Trashed re-import, archive size cap, honest progress phases, paged `listMeta` past 1000. | AC16 | NR-3 |
| NR-12 | **Flip + delete classic** | Default `next`, remove switch + classic page + overlay remnants + `types.ts` + `crdt-preview.ts` + redb import + stale fallbacks + `lint:tw` notes exemption, e2e smoke, docs (DESIGN_BRIEF delta note). | AC17 | NR-4, NR-5, NR-6, NR-7, NR-8, NR-10, NR-11 |

**Lanes:**
- **notes-data:** NR-1, NR-6, NR-7, NR-11.
- **notes-ui:** NR-2, NR-10.
- **notes-editor:** NR-3, NR-4, NR-5, NR-8, NR-9.

**Parallel work:** NR-7 has no dependencies and can run beside NR-1. After NR-3, NR-4, NR-5 and NR-6 can run in parallel worktrees, since they touch different files except `note-nodes.ts`, which NR-3's split turns into a registry.

**NR-9 can follow the flip.** It is not a flip dependency, because AT-1 is held on `maciej`.

**Cut order if the build runs long:**
1. NR-10 (palette), back to the sidebar search.
2. The NR-8 Detached group.
3. NR-11's progress polish.

The core (NR-1–NR-7, NR-12) never cuts.

### NR-1 detail (Definition-of-Ready)

- **Migration** `supabase/migrations/<ts>_notes_refresh_organize.sql`. The `in_inbox` column:
  - add it with `DEFAULT false`;
  - backfill it to today's derived Inbox;
  - `ALTER … DROP DEFAULT`;
  - add the `NOT NULL` CHECK and the two triggers.

  The rest:
  - `full_width`;
  - `note_favorites` with RLS, its index `(user_id, workspace_id)` and the pin backfill;
  - new and replaced functions per assumption 12.

  Additive: classic keeps working untouched.
- **Ops:**
  - `notes_op_file`: guard edit; Inbox requires a root, so filing to Inbox from a nested note moves it to root first; attributed `notes.file` activity.
  - `notes_op_set_favorite`: actor-scoped, view access required.
  - `notes_op_set_meta`: accepts `fullWidth`.
  - `notes_op_import`: accepts per-row `inInbox`.
- **Runtime:**
  - `NoteMeta` gains `inInbox` and `fullWidth`.
  - `notesV2.listFavorites`, `setFavorite`, `fileNote`.
  - Meta-outbox op kinds `file` and `favorite`, which replay FIFO and are idempotent.
- **Pure:** `src/features/notes/sections.ts` `buildSidebarSections({ notes, favorites })` → `{ favorites, inbox, pages: TreeNode[], footer: { published, archived, trashed } }`. `tree.ts` keeps tree building and loses section derivation once classic is deleted; until then classic keeps its own derivation.
- **Oracle:**
  - `sections.test.ts` and `meta-outbox.test.ts` (file + favorite);
  - a runtime row-mapping test;
  - a recorded live probe on a Supabase branch: a root insert puts it in Inbox; a child insert keeps it out; moving it under a parent clears it; the CHECK rejects an Inbox child; user B cannot read A's favorites; pins are backfilled.

### NR-2 detail (Definition-of-Ready)

- **Files:** `src/features/notes/shell/` holds:
  - `notes-shell.tsx` (composition only, no logic over ~150 lines per file);
  - `notes-sidebar.tsx`, `sidebar-tree.tsx`, `sidebar-footer-views.tsx`;
  - `notes-top-bar.tsx`, `note-breadcrumb.tsx`, `note-view.tsx`;
  - `use-notes-shell.ts` (selection, drafts, panel state);
  - `tree-keyboard.ts`, `drop-intent.ts`, `breadcrumb.ts` (pure);
  - `draft-note.ts` (pure lifecycle).

  `routes/pages/notes-page.tsx` becomes a thin switch, and the classic page moves to `notes-classic-page.tsx` unchanged.
- **Behaviour:** everything under §Layout, §Sidebar and §Capture above, plus §Rollout's switch buttons.
- **Sharing on re-root:** every server path that puts a sub-note at the top level (`notes_op_file` into Inbox, `notes_op_move` to root, restore, purge) freezes its effective access first (`notes__keep_access_on_reroot`), so the UI needs no "it becomes private" warning. The only remaining sharing dialog is the existing one for moving a shared note under a *private* parent.
- **The editor column:** mounts today's `NoteEditor` unchanged in the `--width-prose-max` column. The meta line arrives in NR-3.
- **Right panel:** today's variants, lifted. Closed by default, with the open variant and state persisted through the existing `panel-prefs.ts`.
- **States:**
  - Skeleton rows (the `Skeleton` primitive) up to 300 ms, with cached notes painting instantly.
  - An empty workspace shows the existing welcome seed.
  - A read failure keeps the cached data and shows one quiet sync dot; a mutation failure gets an honest toast.
  - View-only hides create, drag, publish and trash.
- **Design:** tokens only, existing primitives (`ContextMenu`, `DropdownMenu`, `AlertDialog`, `Skeleton`, `Tooltip`), R5 selection, and R1–R10 per [docs/DESIGN_RULES.md](../docs/DESIGN_RULES.md). Run `moduo-design-quality` audit mode before landing.
- **Oracle:**
  - `experience.test.ts`, `draft-note.test.ts`, `tree-keyboard.test.ts`, `drop-intent.test.ts`, `breadcrumb.test.ts` and `notes-sidebar.test.tsx`;
  - the stories;
  - `e2e/notes/shell.spec.ts`.
- **Sitting checklist** (`docs/testing/<ISO-week>/NR-2.md`):
  - What happens when you press ⌘N and click another note without typing? *Expected: no Untitled row anywhere, even after reload.*
  - What happens when you add a child to an Inbox note? *Expected: the parent stays in Inbox, with the child nested under it.*
  - Drag an Inbox note into Pages. *Expected: it leaves Inbox, the badge decrements, and it survives a reload.*
  - Navigate the tree with only the keyboard. *Expected: arrows, Enter and Backspace behave like Finder's list.*
  - Flip the switch back to classic. *Expected: the same notes are there, and pins look as they did before.*

## Out of scope

- **Notion-style databases, property schemas, templates, graph view** (brief non-goals, reaffirmed).
- **Version history** (operator call: later), **live cursors** (avatars only), **callouts, toggles, code highlighting** (not picked).
- **Switching editor engine** (Lexical stays), **changing the CRDT storage model**, **tabs**.
- **Body search for modules other than Notes**.
- **Mindmap module work**, and making the `EntityTextEditor`/email Lexical surfaces adopt Notes' new UX.
- **Per-note sharing redesign:** PERM-2b..8's model stays. The share menu is only restyled into the top bar.

---

## Definition-of-Ready gate (NR-1, NR-2)

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** filled and unambiguous: 20 product-code calls ratified 2026-10-13.
- [x] **Every acceptance criterion has at least one test** with a plain-English note.
- [x] **No open question blocks NR-1 or NR-2.** Their assumptions (9–17) are confident. The low-confidence ones (2, 5, 6, 19, 21) belong to later blocks, each with its verification step.
- [x] **Data model is named and Supabase-first:** `notes.in_inbox`, `notes.full_width`, `note_favorites`, plus ops. Later migrations are identified: `note_updates.origin/actor_key_id` (NR-6), `comments.anchor_id/resolved_at` (NR-8), attachments `entity_type` (NR-9), the `realtime.messages` policy (NR-7).
- [x] **Module feature:**
  - spine wiring is unchanged or better: links via `[[` and the meta line, the drag payload kept, `@` people, activity for file and agent edits;
  - MCP tools are unchanged, with a real write path in NR-6;
  - the widget keeps working.
- [x] **Execution blocks** are decomposed, sequenced, context-sized and self-contained.
- [x] **Design constraints acknowledged:** tokens only, R5 selection, shadcn-wrapped primitives, `--width-prose-max`, and the NavRow follow-up via DS-5.
- [x] **Sitting-checklist questions identified** for NR-2 (above). NR-1 is not user-visible.

**Ready to execute: NR-1, NR-2.**

## Open questions

- [ ] (none blocking NR-1/NR-2). For Maciej, at his next sitting, not blocking: ratify the sidebar model (Favorites/Inbox/Pages), anchored comments, and the cross-module ⌘K scope. Mike decided these in engineer mode, and the designer is authoritative on product.
