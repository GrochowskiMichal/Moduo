# Notes v2 research — lane 1: Notes today, code plus a live walkthrough

> Raw research report for the Notes re-plan ([`../REPLAN.md`](../REPLAN.md)), 2026-10-13. Nothing here is decided.
>
> **Baseline.** `t/maciej/notes-replan`. The branch moved mid-run from 9a8887ae to **36dc03f2** (the Tasks v3 integration branch merged in). No Notes file changed between the two (`git diff --stat 9a8887ae 36dc03f2 -- src/features/notes src/routes/pages/notes-page.tsx supabase/functions/notes-public supabase/functions/moduo-mcp/modules/notes.ts` is empty); shared spine files (comments, reactions, references) did change. Line numbers below are at 36dc03f2.
>
> **"Live"** = I saw it in the running web app against the local Supabase stack (§5). **"Traced"** = I read the code but didn't run it.

**Short names used in citations**

| Short | File |
|---|---|
| `PAGE` | src/routes/pages/notes-page.tsx |
| `SIDE` | src/features/notes/ui/note-tree-sidebar.tsx |
| `ED` | src/features/notes/ui/note-editor.tsx |
| `MOD` | src/features/notes/hooks/use-notes-module.ts |
| `ENG` | src/features/notes/sync/engine-v2.ts |
| `TXT` | src/features/notes/sync/doc-text.ts |
| `MD` | src/features/notes/editor/markdown.ts |
| `IMP` | src/features/notes/import.ts |
| `PUBC` | src/features/notes/ui/note-publish-control.tsx |
| `PUBP` | src/routes/pages/published-note-page.tsx |
| `NPF` | supabase/functions/notes-public/index.ts |
| `MCP` | supabase/functions/moduo-mcp/modules/notes.ts |
| `RTW` | src/lib/runtime.web.ts |
| `MIG` | supabase/migrations/20260703120000_notes_module.sql |
| `CAP` | src/features/spine/capture-command.ts |

---

## 0. The five things that matter most

1. **Opening a quick-captured note erases it.** A note made from the capture bar (⌘⇧K, then ⌘2) is stored as a title only, with no body (`CAP:139-146`). The editor takes the title from the first line of the body, which is empty, so opening the note renames it to "" ("Untitled") within half a second, without a keystroke (`ED:139-165`). Live: "Captured: call the venue about chairs" → title `""` after one open. The capture's toast "Open" also lands on `/notes` with nothing selected (`CAP:145`).
2. **The saved markdown is a lossy copy, and everything outside the editor reads it.** Every sync push overwrites `body_md` with a hand-written walker (`ENG:354`, `TXT`). It drops bold, italics, link URLs, chips, mentions' targets, page rows and tables; it writes every H1 as `###` (`TXT:96`); and it glues the line after a task line onto it (`TXT:124-136`). `body_md` feeds search, export, the public page and the MCP connector. Live: I typed `**10:00**`, a link and a contact chip; `body_md` kept none of them. Editing one word of an imported page replaced its good markdown (`# The brief`, the link to the event site) with the degraded copy.
3. **Concurrent editing can rename real tasks into garbage.** A task line *is* the task's title, synced both ways. Live, two people typing near the same task line produced interleaved text ("mate-c dev-cooncurrencurrennt…") and the real task in Tasks and on Home now carries that title. In a second run, one person pressing Enter at the start of a task line while the other appended to it left the task titled "(10:30 works)" and moved the old title into a plain paragraph.
4. **"New note" leaves focus on the button.** After clicking New note (or the sidebar's + child), keystrokes don't reach the editor. Every space then presses the still-focused button again. Live: typing one short sentence after New note created **five** empty "Untitled" notes (`PAGE:160-167`). Empty notes are never cleaned up, so the Inbox fills with "Untitled".
5. **The model underneath is good.** The CRDT editor, the offline outbox, merging after reconnect, presence, search and the import are fast and held up under load: 350 notes paint in under half a second, a 9,600-word note opens in 0.6 s, a teammate's keystrokes arrive in ~0.2 s, and an offline edit merges ~0.1 s after reconnect with nothing lost (§5, §6). The problems are at the edges: titles, the markdown copy, tasks inside notes, and a tree that doesn't update live.

---

## 1. Capability inventory

Each row: **Works**, **Missing** or **Wrong**, with evidence.

### 1a. Structure and navigation

- **Works — nested pages.** Any note can have children; the tree nests without a depth limit in the UI (9 levels live). Drag to reorder and re-parent (`PAGE` `onDropRow`, `tree.ts` `resolveDrop`).
- **Wrong — the sidebar sections are derived and notes jump between them.** "Inbox" means "a root note with no children"; "Workspace" means "a root note with children" (`tree.ts:4-15`, `SIDE:288-357`). Live: adding a child to "Kick-off call with Acme" moved it from Inbox to Workspace. Traced: removing the last child moves it back. There is no way to file a single page into Workspace.
- **Wrong — one note can sit in three sections at once.** The pinned, published organiser pack showed under Pinned, Workspace and Published at the same time (live). A trashed note keeps its pin icon in Trash (live).
- **Missing — "where am I".** No breadcrumbs. Opening a deep note by link doesn't expand the tree to it (live: "Judging criteria" opened with its parent collapsed). The editor shows no path.
- **Wrong — the tree doesn't update live.** Realtime covers only the open note's text and presence (`use-note-realtime.ts:1-17`). The note list reloads on page load and module actions only (`MOD`). Live: a teammate's new note never appeared in my open sidebar within 20 s, not even after a focus/visibility event.
- **Works — pins, archive, trash, restore, delete forever.** Row menu: Icon · Pin · Duplicate · Export as Markdown · Export subtree as .zip · Archive · Delete; Trash rows: Restore · Delete forever (live). Archive has no toast; Delete shows "Moved to Trash · Undo" (live). Trash empties after 30 days, but only when an editor opens Notes (`MIG:669-690`; no cron).
- **Works — the welcome note.** A fresh workspace gets one "Welcome to Notes" note, once per device (`MOD:216-247`). Two people opening a fresh workspace on two devices would each create one (traced).

### 1b. The editor

- **Works — the block set.** Text, H1–H3, bullet, numbered, checkbox, quote, code, divider, table; Insert: Page, Note, Task, Contact, Company, Event; Embeds: Mindmap (`slash-commands.ts:45-172`, live slash menu). Live markdown typing (`**bold**`, `## `, `[] `), ⌘B/⌘I/⌘U/⌘⇧S/⌘E, a selection toolbar (`ED:445-451`).
- **Wrong — the title is the first line, always.** There is no title field (`title.ts:1-5`). Any edit re-derives it (`ED:139-165`). Imported pages lose their file name as title on first edit: "Brief" → "The brief", "Idea doc" → "Idea: Shift — a shared week planner for night-shift nurses" (live).
- **Wrong — `/mindmap` is still offered** though the Mindmap module is hidden (slash menu live; `slash-commands.ts:166-171`).
- **Missing — images, files, callouts, toggles, columns, page history, templates.** Not in the node set (`note-nodes.ts`) or anywhere in `src/features/notes`.
- **Wrong — tables don't import.** The markdown set has no table transformer (`MD`), so a markdown table arrives as pipe text in the editor (live: "Judging criteria"). The public page, which renders the raw imported markdown, shows the same table correctly (live).

### 1c. Tasks, references and people inside a note

- **Works — task lines.** `/task` searches tasks or offers "Create task '…'" (`slash-menu-plugin.tsx:268-283`); the line becomes the real task, with a round checkbox and "Details" (live). Minting created the task and a `spawned-from` link (live: `tasks_op_create` + `links_op_create`). Plain checkboxes stay "a humble checkbox — never a task" (slash menu copy).
- **Wrong — task lines from import or AI never get links.** Lines written as `- [ ] … <!-- moduo:task:<id> -->` render as live task lines, but no `entity_links` row is written. Live: "Kick-off call with Acme" shows a task line and a contact chip, and its Detail panel says "Nothing linked yet".
- **Works — Reference chips stay current.** RF-1's node resolves the live title (`spine/references/reference-node.tsx:1-20`). Live: after the task was renamed, the chip in "Team Lumen" showed the new title the next time the note was opened.
- **Wrong — `@` mentions are plain text.** `@` is people-only (`ED` `peopleOnly`); picking "Tess Mate" inserts the text "@Tess Mate" and sends a notification (`notes_op_mention`, live 204, teammate's bell showed 1). No chip, no link, and the name can't be found by search.
- **Works — page rows.** "+ child" while the parent is open inserts a page row in the parent (`ED` `InsertPageRowPlugin`, live). The row shows the child's live title.

### 1d. Right panel

- **Works — three views** registered through SH-1: Detail (tags, link suggestions, links, activity), Comments, Outline (`panel-views.ts:9-13`, `panel-registry.ts:43`), switched from the title-row menu with ⌥1–⌥3 (live). Outline listed the headings of "The brief" (live).
- **Wrong — the Detail panel speaks code.** Activity reads "You notes.import" (live; `note-detail-panel.tsx:9,57` reuses the contacts `ActivityTrail`). The link suggestion row is truncated to "Link to …" (live).
- **Wrong — a viewer sees edit hints.** A read-only member still sees "Drag, @mention, or /ref to connect", and the Share and Publish buttons (live).

### 1e. Comments

- **Works — comments and quote-comments.** Select text → "Quote selected text" → the quote rides in the comment as a markdown blockquote (`comments/quote.ts:1-13`); the comment shows the quote above the text (live). ⌘/Ctrl+Enter posts; Enter is a new line (`spine/ui/comments-panel.tsx:280-281`).
- **Missing — anchoring.** The quoted text isn't marked in the note, and the quote isn't tied to a position: a later edit just breaks the jump (`quote.ts:49-61`, "degrades to quote-only").

### 1f. Collaboration and sync

- **Works — offline-first editing.** Every keystroke goes to an IndexedDB outbox, flushes after 400 ms, retries with backoff up to 30 s (`ENG:54-56`, `ENG:340-395`). Live: offline, the editor kept working with a "Saved locally — will sync" cloud icon (`PAGE:650-658`); on reconnect the edit reached the teammate in ~0.1 s and merged cleanly with the teammate's own edit.
- **Wrong — a refused push looks like "offline" forever.** A server refusal (lost access, note trashed by someone else) sets the same "Saved locally — will sync" state and never retries until the next wake (`ENG:383-390`). The edit will never sync, but the app says it will. Traced.
- **Wrong — a new note can't be written offline.** Live: New note while offline left the editor on "Preparing note…" until reconnect; the right panel said "Couldn't load links. Retry".
- **Works — presence.** A facepile of people viewing the note ("1 person viewing", the other person's initials), via one live channel per open note (`use-note-realtime.ts`). No remote cursors or selections (live).
- **Works — compaction.** After 40 pushed updates the client folds the log into a snapshot (`outbox.ts:63-67`).

### 1g. Search, import, export

- **Works — search.** Server full-text search on `body_text` (`RTW:1426-1450`, `websearch`, `simple` config), results with snippets in the sidebar (live, under a second). **Wrong:** chips and mentions aren't in `body_text`, so "Dana" found nothing although two notes show a Dana chip (live). Imported notes show markdown symbols in snippets ("## Key ideas", live; `IMP:84-95` strips only single `#`).
- **Works — import.** `.zip` (including Notion's zip-in-zip), `.md`, `.txt`; preview tree, skip counts ("Skipped 1 CSV · 1 image"), 50-row chunks, deterministic ids so a re-run doesn't duplicate (`note-import-dialog.tsx:108-170`, live: 27 notes in 0.2 s).
- **Wrong — a folder without its own page flattens.** `Loose folder/Orphan idea.md` and `Loose folder/Sub/Second orphan.md` both landed at the root (`IMP:155`, live). Obsidian- and plain-folder zips lose their structure; only Notion's "page + same-name folder" shape nests.
- **Wrong — export is the lossy copy.** "Export as Markdown" and "Export subtree as .zip" read `body_md` (`PAGE:517-570` → `RTW:1451`), so they inherit every loss in #2 of §0.

### 1h. Publishing

- **Works — publish to the web.** One button; the popover then says "Live on the web · Anyone with the link can read this note and its 6 nested pages. Search engines are asked not to index it." with Copy, Open public page, Unpublish (live). Archiving a published note unpublishes it (`20260704120000_notes_archive_unpublishes.sql`). The public page has a page list on the left, the note on the right, "Published with Moduo", a phone layout with a "Pages" disclosure, and a clean "Page not found · This link is no longer available" for a bad token (live, §5).
- **Wrong — before publishing, it doesn't say the child pages go too.** The count is only computed once published (`PUBC:42`), so the "and its child pages" warning (`PUBC:180`) can never show. Live: "Create a read-only public link to this note." on a note with six children.
- **Wrong — a child doesn't know it's public.** Open "Rules" (a child of the published pack): its header still says "Publish", with no sign the page is live on the web (live).
- **Wrong — the public page shows the lossy copy.** Bold and link URLs are gone on any page edited in the app (live: "Read more on the event site." is plain text on `/p/…`).
- **Risk — large workspaces lose public pages.** The function reads every note in the workspace in one unpaged query (`NPF:109-113`); the API caps a response at 1,000 rows (`supabase/config.toml:18`). In a workspace over 1,000 notes, published pages can silently drop children. Traced, not reproduced.

### 1i. AI (MCP connector)

- **Works — reads and creates.** `notes_list`, `notes_get` (markdown), `notes_search`, `notes_create`, `notes_move`, `notes_archive`, `notes_trash`, `notes_link` (`MCP:135-416`). A created note is body-only and the app's repair sweep builds its document on next load (live: two connector-style notes opened with full content).
- **Wrong — AI edits to existing notes are thrown away.** `notes_append` / `notes_update` write `body_md` only (`MCP:256-325`); the editor never sees it, and the next keystroke overwrites it (`MCP:18-29` says so). Live: a connector-style append added "AGENT-APPENDED…" to `body_md`; the open editor didn't show it; one keystroke later it was gone.
- **Missing — the repair sweep is capped.** 200 notes per app load (`repair.ts:136`); the rest wait for the next load (live: 121 of 321 left after the first load, all done after the next navigation). An opened note jumps the queue (`MOD:187-214`).

### 1j. Home

- **Exists, not shown.** A "Notes" widget (recently touched notes) is in the gallery (`dashboard/registry/catalog.ts:32-40`) but not on the default Home (live: Tasks, Today, Quick capture, Clock). Its empty state still says "Press ⌘⇧N to capture one." (`notes-widget.tsx:34`) while the capture bar teaches ⌘⇧K.

---

## 2. The data model as it is today

- **`notes`** (`MIG:27-50` + later): `id, workspace_id, created_by, parent_id, title, icon, position (text, fractional), is_pinned, is_archived, deleted_at, doc_state (base64 Yjs snapshot), doc_version, body_text, body_md, search_tsv, published_at, publish_token, share_mode ('inherit'|'custom'), workspace_shared`, plus legacy `kind, tags, share_scope, share_permission` still on the table and unused by the app (live `information_schema`).
- **`note_updates`** (`MIG:70-90`): the Yjs update log (`note_id, client_id, client_seq, update_b64`), folded into `doc_state` by client compaction.
- **Ops** (all `SECURITY DEFINER`): `notes_op_create / rename / move / set_meta / duplicate / archive / unarchive / trash / restore / purge / purge_expired / publish / unpublish / apply_updates / save_snapshot / seed_doc / import / mention` + `notes_list_unmaterialized`. Newest bodies: most in `MIG`; `archive` in `20260704120000`; `seed_doc` in `20260729120000`; `import` in `20261008123000_key_writes_act_as_creator.sql:436`; `duplicate`, `mention`, `list_unmaterialized` in `20261008130000_definer_reads_item_visibility.sql`; purge internals in `20261008022208_notes_purge_lock_ids.sql:18`.
- **Permissions**: one lane per module: `notes_module_permission` → `module_member_permission(…, 'notes')`, read from the member's `perms` array (`notes.view/create/edit/delete`) (`20261006200000_perm1_roles_overrides.sql:577`). Reads go through `can_access('note', id, 'view')` (`20261006210000_perm_sharing.sql:734-740`). A write trigger checks per-note access and `ws.publish` (`20261006230000_perm_sharing_write_hotfix.sql:100-112`). Per-note sharing exists (Share menu, `PAGE:661`).
- **Desktop** uses the same notes runtime as web (`runtime.tauri.ts:86`); there is no separate desktop data path for Notes.
- **Comments** live in the spine's shared `comments` table (`entity_type='note'`); quotes ride inside the body.
- **Links** live in `entity_links` (`spawned-from` from minting, `references` from chips added in the editor). Imported, AI-written and markdown-pasted chips and task lines write none (§1c).
- **Derived fields written by the client**: `title` (first line), `body_text`, `body_md` (`ENG:354`, `TXT`). The server never parses the document.

---

## 3. Trust bugs, ranked

Severity: **S1** loses or corrupts what people wrote · **S2** wrong or misleading state · **S3** confusing.

| # | Sev | Bug | Repro (live unless marked) |
|---|---|---|---|
| 1 | S1 | **Opening a captured note wipes it.** | ⌘⇧K → ⌘2 → type "Ask Dana about the invoice dates" → Enter. Open the note from the sidebar. Within 0.5 s its title is "" and the text is gone everywhere (`CAP:139-146`, `ED:139-165`). Also seen with a title-only note made by `notes_op_create`. |
| 2 | S1 | **AI edits to existing notes vanish.** | Connector `notes_append` on any note that has been opened once. The editor doesn't show it; the next keystroke deletes it from `body_md` (`MCP:256-325`). |
| 3 | S1 | **Concurrent typing renames tasks into garbage.** | Two people open "Team Lumen". A puts the caret at the start of the "Book a mentor slot for Saturday" task line and presses Enter; B appends " (10:30 works)" at its end at the same moment. The task is now titled "(10:30 works)" in Tasks and on Home; the old title sits in a plain paragraph. A second run (both typing at one spot) produced "mate-c dev-cooncurrencurrennt-fourt-one t five swo threixe…" as a task title. |
| 4 | S1 | **The saved markdown loses content.** | Type `We meet at **10:00**`, a link `[venue map](https://…)`, a contact chip, then a task line followed by a paragraph. `body_md` = `We meet at 10:00 … Map: venue map` and `…<!-- moduo:task:… -->Ask @Tess Mate about the deck. Client:` (chip gone, lines glued). Every H1 becomes `###` (`TXT:96`, `TXT:124-136`). Affects search, export, the public page, AI reads. |
| 5 | S1 | **Editing an imported page degrades its stored copy.** | Import a markdown zip. Open "Brief", type one line. `body_md` goes from `# The brief … [the event site](https://moduo.app/hack)` to `### The brief … the event site` (`ENG:354`). The public page loses the link. |
| 6 | S2 | **Typing after "New note" creates empty notes.** | Click New note, type "Typed straight after New note". Five empty "Untitled" notes; the editor stays empty (`PAGE:160-167`). |
| 7 | S2 | **Concurrent typing at one spot interleaves letters.** | Two people put the caret at the end of the same line and type. Result: "mate-c dev-cooncurrencurrennt…" (live, both views converged on the same garbled text). Title edits too: "…nurses (m (date v2ev v2))". |
| 8 | S2 | **The tree doesn't update.** | Teammate creates a note. Your open sidebar doesn't show it (20 s, plus focus). Same for renames, moves, trash by others (traced). |
| 9 | S2 | **Imported titles are replaced on first edit.** | Import "Brief.md" whose first line is "# The brief". Edit it: the sidebar now says "The brief"; any link or bookmark text that said "Brief" no longer matches. |
| 10 | S2 | **"Saved locally — will sync" when it never will.** | Traced: a server refusal sets the offline state with no retry (`ENG:383-390`). |
| 11 | S2 | **Publish doesn't warn that child pages go public; children don't show they're public.** | Publish a parent with children; read the popover before clicking (`PUBC:42`, `PUBC:180`). Then open a child. |
| 12 | S2 | **Imported/AI task lines and chips are unlinked.** | Import a note with a task line; Detail says "Nothing linked yet"; the task's own panel doesn't show the note. |
| 13 | S2 | **Can't start a new note offline.** | Go offline, New note: "Preparing note…" until reconnect. |
| 14 | S2 | **Folders without a page flatten on import.** | Zip `Loose folder/Orphan idea.md`: lands at the root (`IMP:155`). |
| 15 | S3 | **Notes jump between Inbox and Workspace** when they gain or lose children (`tree.ts:4-15`). |
| 16 | S3 | **"Open" on a captured note goes to /notes with nothing selected** (`CAP:145`). |
| 17 | S3 | **Search can't find chip and mention names** ("Dana" → "No matches."). |
| 18 | S3 | **Markdown tables import as pipe text** (`MD` has no table transformer). |
| 19 | S3 | **Activity says "notes.import"**; widget says ⌘⇧N; `/mindmap` still offered; empty "Untitled" notes never cleaned up. |
| — | — | **Not reproduced:** one offline New note click created two notes once (scenario L); a clean retry made one. The "Enter at start of a task line" split is fine for one person (scenario J). |

---

## 4. Tasks v3 shared pieces Notes already touches

- **SH-1 panel registry.** Notes registers Detail · Comments · Outline "unchanged from its old tabs until the module is rebuilt" (`panel-views.ts:1-13`, `lib/panel-registry.ts:19,43`). The page passes them to the shared `RightPanel` (`PAGE` `noteViews`, `RightPanel module="notes"`). A task opened from a task line shows as the "← task" item on top of the current view, not as a view (`PAGE:789-815`; `components/app/right-panel.tsx:43-64`); switching notes closes it (`PAGE` `setTaskDetailId(null)` on `selectedId`). The last view is remembered per person and workspace (`panel-prefs.ts`, `PAGE:395-398`).
- **Capture registry.** `notesCaptureType` is marked **provisional**: "the one-line note ⌘⇧K already made … Notes replaces it with its own body when the module is rebuilt" (`capture-type.tsx:1-17`, `lib/capture-registry.ts:17,105`). Today it creates a title-only note (`CAP:139-146`), which trust bug #1 then erases. The old global ⌘⇧N "new note" shortcut still exists beside it (`components/app/app-chrome.tsx:131-141`, `lib/shortcuts.ts:80-89`): two ways to capture a note that behave differently.
- **`useCaptureSource`.** An open note rides along on a capture as "From: <note title>" (`PAGE:128-140`, `lib/capture-source.ts:45-51`). It reads the stored title, so after bug #1 it says "From: Untitled".
- **RF-1 Reference node.** Notes still registers it under the old name `EntityRefNode` (`note-nodes.ts:17,35`; `spine/editor/entity-ref-node.tsx:5-8`). It renders chips with live titles (§1c). Chips are dropped from `body_md` (§3 #4), and chips inserted outside the editor (import, AI, paste) write no link.
- **Spine comments.** The Comments view wraps the shared comment box (⌘Enter, @ people, quote button). Tasks' newer reactions were not checked in Notes.

---

## 5. Live walkthrough

**Setup.** Local stack (127.0.0.1:54321); this worktree's `.env.local` pointed at it with `bun run env:local` (values not printed). Web app on port 8094 (`rsbuild dev`). Driven with Playwright 1.63 (Chromium, 1440×900, headless) from the session scratchpad, two browser contexts for two people, session injection as in `tests/support/local-stack.ts`. The `notes-public` function isn't running locally (the edge runtime is stopped), so for `/p/<token>` I answered its request with JSON built by replicating its two queries as service role: **the page is live, the function is traced**. The workspace "Notes replan research" (owner: the seed dev user; member: "Tess Mate", switched to viewer for one pass and back).

**Seeded content** (all in §8): a hackathon organiser pack (Brief, Rules, Schedule, Judging criteria, Resources, FAQ) imported as a zip; Team Lumen with Idea doc, Research and Pitch outline (task lines linked to real tasks, a task chip); Distributed Systems course notes (4 weeks); a 9-level wiki; two loose-folder files; a client meeting note with a contact chip and a task line, and a 9,600-word "AI research brief", both written the way the connector writes; a typed note with bold, a link, a heading, a checkbox, a minted task, an @mention and a contact chip; 311 bulk notes (10 courses × 30 lectures); a published pack; two comments incl. a quote; one archived, two trashed (one restored).

**What I saw, surface by surface**
- **First open.** Three panes. Left: "Notes" with Import and New note icons, "Search notes…", then sections. No note open: "Write something down · Select a note on the left, or press ⌘N for a fresh one." Right: "Select a note to see its links, comments, and outline." Loading: "Loading notes…" (`PAGE:720-735`); the cached tree usually paints before it shows. The two connector-written notes were silently rebuilt on load (2 × `notes_op_seed_doc`) and opened full.
- **Editor.** Big first-line title, quiet body, round task checkboxes with "Details" at the right. Header cluster: viewers' initials, Share, Publish, panel toggle.
- **Import.** "Import notes · Drop a Markdown .zip (e.g. a Notion export) or .md files. Folders become parent notes." → preview tree → "27 notes to import · 2 skipped." → toast "Imported 27 notes · 2 not a page".
- **Viewer.** Read-only editor (`contenteditable=false`), no New note or Import, no row menus, typing does nothing, comment box still there (viewers can comment). Share and Publish buttons still shown.
- **Two people.** Each saw the other's initials once both had the note open (read after 3 s; not timed). Typing shows up for the other person in ~0.2 s. Both views always converged, including on garbled text (§3 #3, #7).
- **Offline.** Cloud icon "Saved locally — will sync"; top bar "Offline". Edits merged on reconnect. New notes stuck on "Preparing note…".
- **Large.** 354 notes: the tree paints in 0.47 s. The repair sweep did 200 notes on the first load and the rest on the next. Search "Lecture 17" returned the matches under a second, not grouped by course.
- **Long note.** 9,600 words (58 KB markdown, 84 KB document): fully in the DOM 0.57 s after navigation; typing 25 characters at its end took 35 ms. JS heap ≈ 123 MB with it open.
- **Public page.** Painted in ~1 s. Clean reading layout, left page list in authored order, tables render (from raw imported markdown), task-id comments stripped. Edited pages show the degraded copy. Bad token: "Page not found".
- **Home.** No Notes widget on the default layout. The Tasks widget shows the garbled task titles from the concurrency runs.

**Timings**

| Action | Time |
|---|---|
| `/notes` first paint (2 notes / 354 notes) | 1.04 s / 0.47 s |
| Click a note → body visible | 0.12–0.13 s |
| Full navigation to `/notes?id=` → editor ready | 2.7–3.0 s (incl. app boot) |
| New note → editor ready | 0.12 s |
| Import 27 notes (click → toast) | 0.21 s |
| Remote edit visible to the teammate | ~0.21 s |
| Offline edit visible to the teammate after reconnect | ~0.10 s |
| 9,600-word note rendered / 25 keystrokes | 0.57 s / 35 ms |
| Public page first paint | ~1.0 s |

---

## 6. What is genuinely strong (keep)

- **The sync core.** Yjs + an IndexedDB outbox + server log + client compaction (`ENG`, `outbox.ts`). Offline edits survived and merged; two people always converged; nothing typed in an open note was lost in any run.
- **Speed at size.** Hundreds of notes and a 10k-word note stay instant (§5 timings).
- **Import.** Fast, honest preview, skip counts by kind, idempotent ids, Notion's zip-in-zip handled (`import-zip.ts`, `IMP:258-330`).
- **Task lines as real tasks**, minted from `/task` with a link, and **Reference chips that keep live titles**: the spine idea working inside a document.
- **The public page.** Calm reading layout, page list, phone layout, revocable link, no-index header, task ids scrubbed (`PUBP`, `NPF`).
- **Server-side guards.** Per-module permission lanes, per-note access and the publish right enforced by a write trigger; once-only document seeding prevents duplicate content (`20260729120000_notes_seed_doc.sql`).
- **Quote-comments with no schema change**, readable everywhere as markdown (`comments/quote.ts`).
- **Presence that stays quiet**: initials, no noise.

---

## 7. Could not verify

- The real `notes-public` function (edge runtime stopped locally). Its logic is replicated, not executed.
- The 1,000-row truncation of public pages (§1h): traced only.
- Desktop (Tauri): not run. Its notes runtime is the web one (`runtime.tauri.ts:86`, `notesV2: webRuntime.notesV2`), so only the one-off redb import path (`sync/redb-import.ts`) differs.
- "Delete forever" (purge) and its confirm dialog: seen in the Trash menu, not exercised.
- The small two-file zip was built but not imported; the 27-note pack was the import test.
- The connector itself (no edge runtime); its RPC calls were replayed as the dev user with identical arguments.
- Reactions on note comments (Tasks' TV-U13), dashboard widget content (not on the default Home), drag-and-drop in the tree, export downloads (code only: they read `body_md`).
- Whether the doubled offline "New note" (scenario L) was the focus bug (#6) or a separate retry bug; a clean retry created one note.

---

## 8. Research data created (remove when done)

All on the **local** stack. Workspace **"Notes replan research"**, id `3e15da47-dec0-4a1b-9b6d-82c26b1936e1`, owned by the seed dev user (`00000000-0000-4000-8000-000000000001`). Deleting this workspace's rows removes everything below. Counts are rows with `workspace_id = 3e15da47-…` at the end of the run.

| Table | Rows | What |
|---|---|---|
| `workspaces` | 1 | `3e15da47-dec0-4a1b-9b6d-82c26b1936e1` |
| `workspace_members` | 2 | dev owner `14cdcacd-9d7f-4053-be6b-f685a24dfcf2` (trigger), teammate member `3ed1a386-0830-4c9c-a837-7ba2e7a880e8` (role set to viewer and back to member) |
| `workspace_roles`, `workspace_share_defaults`, `workspace_chat_caps`, `project_statuses`, `calendars`, `resource_grants`, `access_changes` | 3, 1, 3, 10, 2, 25, 3 | made by triggers on workspace/member/note creation |
| `buckets` | 3 | "Hackathon 2026" `b4592655-cfcc-4738-8da9-f2725e78d12b` (mine); Inboxes `1bc1814c-7d13-431a-b026-b19086feada9`, `1b5a7a58-00db-475f-87aa-0c85a462248f` (made by the app) |
| `tasks` | 6 | `c7016254-0cc4-41fd-a587-d7e5e2344bdc`, `77ba1961-82ff-4ab3-a447-0985877d8ede`, `5bc15726-a360-4a1b-9b75-8e405a730d06`, `f22883c9-308f-4035-a89f-ce68f61a998f`, `adf13338-2017-4659-88ed-03c3beb7c2d4`, `5056462d-1c57-4725-ad22-0019cf542947` (two now carry garbled titles) |
| `contacts` | 1 | "Dana Kowalski" `1a72d498-b53c-4022-be26-e6048ae3f793` |
| `notes` | 354 | 43 listed below + 311 bulk: the root "Course archive (bulk)" `9d67fdf5-8f50-4750-bdb1-7f3f66076351` and all its descendants |
| `note_updates` | 137 | the update log of the notes above (no `workspace_id` column; join on `note_id`) |
| `comments` | 2 | `7b370a70-05a5-4bba-b3df-aba225ca3385`, `965ed557-ae4c-4563-ac8b-fb03b6f2bc3f` (on "Rules") |
| `entity_links` | 2 | `aec98d52-35b3-42d4-a3c6-544e5b03ebda` (note→task), `7e5f9ed7-8d50-402e-b4bf-ef9481f349c9` (note→contact) |
| `entities` | 361 | registry rows for the notes, tasks and contact |
| `module_activity` | 28 | op logs, incl. the mention to the teammate |

**The 43 non-bulk notes**: `3a3a2f7c-db77-4729-9587-8443f2d1e32c`, `2e8f8c05-ec88-474d-b07b-6526c1f2d8dd`, `d9fe1e7e-9473-40f8-9f48-c88a4790da50`, `d59d9ea8-ad72-407a-a711-499c96f6d6c2`, `5cafc988-565a-411a-9d3c-38cc2fef5f02`, `c7bc95ef-e9b5-486d-b0ae-4b738f8230c5`, `ff4af760-27f7-406a-abf2-97bc8c28b9f2`, `e4e4832d-fc9f-490f-96a5-6d8962e58657`, `6a6dce61-e3aa-467f-a684-e775020169c7`, `040fd21b-070d-431d-90a3-6ce797df8ed5`, `6349d374-209c-41ae-9d75-51f86af1c866`, `6f6a7dd0-185f-42de-bc4b-40cc5a84d406`, `36adaed0-d8dd-4696-8d50-73947620c8ce`, `b3467d9e-cb6f-4974-94cd-836212e7586c` (archived), `41ce5aac-9e74-429e-9d49-4ff0fe812376`, `6ee7d8d3-380a-41f5-b162-6ba71725cddd`, `df426538-1d07-431e-8bfd-b60484496bd6`, `a04aea2b-6562-4629-8aa6-ae17dc6ce5a1`, `570c50bc-913a-4fea-ad6c-d3c07c1cd722` (published; pinned), `ccdf1414-6b2d-4a16-b837-097850f1b4ee`, `a6b33a38-0bbb-480a-9a65-6cf4ce25c3d2`, `a7ba061f-8f00-414d-932c-a2c3d7d5f555`, `0714ec84-3acd-46de-a5d3-f57891c5b216`, `d86d5643-0cd2-4a8d-8c6d-191fa5676c15`, `28218598-75b4-44e2-bfd4-71ec3d7459fa`, `330b8779-7a6e-45d3-956c-89bdec71865b`, `fe5ed65f-f165-45cd-bcd2-b2137f529c15`, `620f0876-62b0-4b78-b05a-0d1a9ca56210` (trashed), `9a0d8000-a942-4236-a9fc-1edc578a415e`, `3b67f1bf-2068-494d-8e34-741bd54952f0`, `8d5377c1-ed5c-4c82-8b40-2d92d2308b34`, `05687a4d-18df-4f83-8af6-8fc81893b7e6`, `7d916d90-eee3-4e17-a31e-c216033c60dc`, `779bc73e-86f9-4b58-b8fb-01a977a42eb6`, `1487bfd6-8f01-4a7d-ac83-8108bd2fe460`, `579e2c48-cd86-4689-990c-4f9d1c81cddb`, `26c4411a-8754-4191-b291-f6bb58efbc69`, `30927147-01a9-4f8e-aa45-0018837092ea`, `06be248b-f469-4550-9ada-73b56fdc3ab2`, `89cf03f6-94d5-4f57-b3e7-6c5076ef8b84`, `53ea30db-e1fc-4ff3-a996-66263c6bc55b`, `008263cd-cf9b-4a39-a2f9-8873aa40d897`, `88a3eafe-2e6a-4629-b5ff-a9404ba82254`.

**Outside the workspace**
- The e2e helper's teammate `teammate@moduo.local` (`17c405d5-ca87-4156-9d77-6e81c04262f1`) was reused, not created. Its password was set to the helper's own value, as `tests/support/local-stack.ts` does.
- The dev user's time zone was written by the app on boot (`user_op_set_time_zone`), as on any sign-in.
- Browser storage: Playwright contexts were ephemeral (nothing left on disk). No built-in-browser tab was used.
- This worktree: `.env.local` (local stack) and `.env.cloud.local` (empty placeholders, since there were no cloud values to park) created by `bun run env:local`, both gitignored; `bun install --frozen-lockfile` added missing packages to `node_modules`; the corrupt rspack cache `node_modules/.cache/rspack` was moved to the session scratchpad (rspack rebuilds it).
- Processes: the dev server on port 8094 and every Playwright browser were stopped at the end.
