# Spec: Notes rebuild (Wave 3)

> Status: **Shipped** — NO-1…NO-10 landed 2026-07-03 → 2026-07-04, plus the follow-ups NO-9b (public-page renderer) and NO-7b (Notes rail + drag-into-editor); Wave 3 complete. **[`specs/BUILD_ORDER.md`](./BUILD_ORDER.md) is the status of record**; this spec is the design/AC reference. · Owner: maciej · Related briefs: [.design/notes/BRIEF.md](../.design/notes/BRIEF.md) (product intent), [.design/notes/DESIGN_BRIEF.md](../.design/notes/DESIGN_BRIEF.md) (the build spec — **authoritative for UX/data details**; §1 lists its designer-ratified deltas from the BRIEF)

## Scope

Rebuild Notes as a Supabase-first, spine-wired, offline-capable module: Notion-style page nesting (everything is a note), deliberate task lines that ARE real tasks, markdown at every boundary (AI/MCP is a first-class author), async multiplayer with presence, publish-to-web, and the full module contract (ops, activity, manifest, widget). This is the make-or-break leg (ROADMAP Wave 3) and the multiplayer enabler. The Lexical editor core and CT-4 chips survive; the shell, sync engine, data layer, and grammar are rebuilt.

## Product behavior & UX

See DESIGN_BRIEF §2–3 (anatomy, flows) — not restated here. The headline behaviors:

1. **Capture:** ⌘N / ⌘⇧N / palette → focused empty note instantly, first line = title, lands in Inbox (or selected note as child). No dialogs.
2. **Tree:** arbitrary-depth nesting; sidebar sections Pinned · Inbox · tree · Published · Archive · Trash; drag to reorder/reparent; child notes mirror as page-row blocks in the parent body.
3. **Task lines:** `/task` (create-or-link) and checkbox-convert (`⌘⇧T`/menu/selection) produce live task lines — check/rename/schedule syncs both ways; Task-detail rail variant edits everything in place; detach keeps-or-deletes; ⌘Z right after minting fully reverts; deleting N task lines = one detach toast.
4. **Grammar:** `/page` `/note` `/task` `/contact` `/company` `/event` `/mindmap` + basics; `@` = workspace people only (notify); drag-into-editor inserts a chip, drag-onto-row links only.
5. **Sync:** local-first feel (IndexedDB + outbox), Realtime broadcast for near-live merge + presence avatars (cursors = stretch), quiet offline dot, no conflict dialogs ever.
6. **Find:** sidebar full-text search (title + body); Detail rail = links hub + tags + suggestions + activity; Comments rail = note-level quote-comments; Outline rail = headings TOC.
7. **Publish:** revocable read-only public link per note, subtree included, Published section.
8. **Interchange:** md paste/copy; per-note .md export; tree zip export; md/zip import wizard; one-time redb migration on desktop.

## Edge cases

- Offline capture/edit on desktop → everything persists locally, syncs on reconnect (idempotent outbox; no dupes on retry).
- Web reload mid-edit / dropout mid-edit → edits survive (IndexedDB draft), sync on reconnect.
- Two devices / two people editing the same note concurrently → CRDT merge, no dialog; presence avatar shows the other party when live.
- A stale device syncs week-old edits → lossless merge; content may interleave (accepted, self-healing).
- Deleting a line/selection/note containing task lines → tasks soft-detach + ONE undoable toast (never a modal, never stacked).
- ⌘Z immediately after a mint → the just-minted task is deleted too, not orphaned.
- Task renamed/completed/deleted in Tasks while its line is visible in a note → line reflects on refresh/refocus; a deleted task's line renders tombstoned with a "remove line" affordance.
- Trash-then-purge with inbound links/chips → tombstone rendering everywhere (registry tombstone).
- Move-note cycle attempt (into its own descendant) → structurally rejected server-side, quiet client no-op.
- Publish a note whose child is later trashed → child disappears from the public subtree immediately.
- View-only member → read-only editor, comments allowed, no publish/trash/drag affordances.
- Deploy gap (code live, migration unapplied) → reads degrade to cached/empty with a quiet banner; explicit mutations surface honest errors (per gotcha).
- Import of a malformed md zip → per-file exception isolation; summary reports skipped files; nothing partial-corrupts the tree.
- Legacy notes (old `kind`, checkboxes, `/toggle` remnants, old title field docs) → open cleanly; kinds backfilled to `'note'`; old visual checkboxes stay humble checkboxes.

## Acceptance criteria

- **AC1 — Instant capture:** ⌘N/⌘⇧N/palette creates a focused empty note (<200ms to typing), inbox- or context-parented; first line becomes the title everywhere (tree, chips, registry).
- **AC2 — Nesting:** notes nest to arbitrary depth; sidebar tree + page-row mirrors behave per DESIGN_BRIEF §3c; move/reorder persists and cycle-guards.
- **AC3 — Task lines:** `/task` creates or links a real task rendered as a live line; check/rename syncs both directions; the Task-detail rail variant edits schedule/due/bucket/etc. without leaving `/notes`; minted tasks land in the Tasks Inbox back-linked to the note.
- **AC4 — Convert & detach:** checkbox→task convert (single + batch selection) works; detach-keep and detach-delete both work; ⌘Z-after-mint reverts fully; deleting N task lines yields one detach toast with working undo.
- **AC5 — Grammar & mentions:** the slash menu offers exactly the DESIGN_BRIEF §3c set; `@` lists workspace people only and a mention notifies the person (quiet, grouped, deep-links to the note); entity chips create-and-link where specified.
- **AC6 — Offline & sync:** desktop edits/creates offline and syncs losslessly on reconnect; web edits survive reload/dropout; concurrent edits merge without any conflict UI; the offline dot appears only while unsynced.
- **AC7 — Live multiplayer:** with two sessions on one note, edits appear near-live and presence avatars show who's viewing; closing the note clears presence. (Cursors = stretch, not gating.)
- **AC8 — Find & rail:** sidebar search matches titles and body text with snippets; the right panel offers Detail/Comments/Task-detail/Outline variants; the links hub, tags, suggestion strip, and activity trail render on Detail; Contacts + Calendar gain a working "Notes" rail variant with New-linked-note.
- **AC9 — Comments:** note-level comments post/render in the Comments rail; a text selection can start a quote-comment whose quote scroll-finds the text; comment @mentions notify.
- **AC10 — Publish:** publish creates a public read-only page (clean, no app chrome, noindex) covering the subtree; unpublish revokes instantly (link 404s); the Published section lists published roots.
- **AC11 — Markdown interchange:** md paste renders as blocks; copy produces clean md; per-note export downloads .md; tree export downloads a nested zip; md/zip import recreates the tree with a preview step.
- **AC12 — Trash/Archive:** archive hides (with subtree) into Archive, reversible; delete trashes (with subtree) with undo toast; restore works; purge-expired removes >30d items and tombstones links.
- **AC13 — Module contract (DoD):** invariant-bearing mutations go through `notes_op_*` (attributed activity where meaningful); the permission fn includes the api-key branch; the manifest registers; the MCP connector round-trips markdown (create tree / get / append / search); the Recent-notes widget ships wired to `moduo:entity:open`.
- **AC14 — Migration & cleanup:** legacy kinds backfill to `'note'`; existing desktop redb notes import once, idempotently; legacy expose code + dead slash commands (`/toggle`, `/embed-task`) are removed; the old separate title field is gone.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/notes/tree.test.ts` · build/move/cycle | AC2 | Flat rows become the right tree at depth 7+; moving under a descendant is rejected; fractional reorder keeps order stable. |
| `src/features/notes/title.test.ts` · first-line-title | AC1 | First-line extraction becomes the title, "Untitled" fallback, debounce boundary conditions. |
| `src/features/notes/sync/outbox.test.ts` · idempotent replay | AC6 | Replaying the same queued updates after a failed push never duplicates content (client_seq dedupe). |
| `src/features/notes/sync/merge.test.ts` · concurrent merge | AC6 | Two docs edited apart merge to one containing both edits, byte-stable both directions. |
| `src/features/notes/tasks/task-line.test.ts` · mint/link args | AC3 | /task create yields Inbox-bucket task + `spawned-from` link; linking existing yields `references`; title-sync mapper renames not clobbers. |
| `src/features/notes/tasks/detach.test.ts` · detach plans | AC4 | Deleting selections with N task lines yields one batch detach plan; undo plan restores lines + links; ⌘Z-after-mint plan includes task deletion. |
| `src/features/spine/kind-constraints.test.ts` · note↔task kinds | AC3 | (note,task) allows spawned-from + references; nonsense kinds stay disallowed. |
| `src/features/notes/editor/markdown.test.ts` · md round-trip | AC11 | md → blocks → md is stable for headings/lists/checkboxes/task lines/chips; unknown syntax degrades to text, never throws. |
| `src/features/notes/import.test.ts` · zip tree plan | AC11, AC14 | A Notion-style md-zip maps folders→parents; malformed files are isolated + counted, not fatal. |
| `src/features/notes/publish.test.ts` · subtree selection | AC10 | Publish scope = note + live descendants; trashed children excluded; token revocation empties the scope. |
| `src/features/notes/search.test.ts` · query shaping | AC8 | Search hits title and body matches with snippets; archived flagged; trashed excluded. |
| `src/features/notes/comments/quote.test.ts` · quote anchor | AC9 | Quote-comment carries the snippet; scroll-find matches moved text; edited-away text degrades to quote-only. |
| `src/features/notes/mention.test.ts` · people-only @ | AC5 | @ candidates contain members only; mention op payload targets the right user (feeds `spine_activity_targets_me`). |
| `src/features/notes/trash.test.ts` · purge window | AC12 | 30-day purge selects only expired trash; restore clears deletion; subtree cascades both ways. |
| `src/features/notes/ops-manifest.test.ts` · manifest shape | AC13 | Manifest registers ops/resources; registry includes notes; permission key correct. |
| `src/features/notes/widget.test.ts` · recent shaper | AC13 | Recent-notes rows: latest-touched first, snippets, deep-link targets. |
| Storybook stories: sidebar tree, task line states, rail variants, published page | AC2/3/8/10 | Visual states (baselines = human capture per gotcha). |
| `e2e/notes/*.spec.ts` (env-gated) + live-verify on the hosted account | AC1–AC12 | Capture, nest, mint, check-both-ways, offline reload, two-tab live merge, publish round-trip. |
| Manual (post-deploy checklist): MCP keyed round-trip, desktop redb import, true-offline desktop session | AC6/13/14 | The api-key write gotcha + platform surfaces `verify` can't reach. |

## Assumptions & technical decisions

1. **Extend the prod `notes` table in place** (it's pre-migrations-era; CAL-2 pattern: ALTER + drop-legacy-policies loop + op-only writes). Rejected: new table + copy (risks the silent `CREATE IF NOT EXISTS` no-op and a data move for nothing).
2. **CRDT storage = snapshot + append-only update log** (`notes.doc_state` + new `note_updates`, unique `(note_id, client_id, client_seq)` for idempotent pushes; client-side compaction via `notes_op_save_snapshot` — Yjs can't merge in plpgsql). Rejected: snapshot-only (today's shape — lossy under concurrent writers); shred-to-rows (fights CRDT semantics; BRIEF's locked rec).
3. **Derived `body_text` (FTS) + `body_md` (MCP/read/publish source) written by the client on save**; `search_tsv` generated from title+body_text. Rationale: the editor is the only faithful serializer; server never parses the CRDT. Staleness window ≈ one debounce — acceptable.
4. **Local layer = IndexedDB on both platforms** (Y.Doc cache + metadata cache + outbox; `y-indexeddb` + a thin metadata store). Desktop true-offline comes from the webview's IndexedDB — **redb is not extended** (posture rule); Rust notes commands retire after the one-time redb import ships. Rejected: redb as desktop offline store (paused, and would fork the sync engine per platform).
5. **Realtime = one Supabase Realtime broadcast channel per open note** (update relay + awareness/presence). First Realtime usage in the app; polling-since-cursor remains the fallback path so Realtime failure degrades to refocus-freshness, never data loss. Cursors ride Lexical's collab awareness if the transport lands cleanly (stretch).
6. **Task lines = a custom Lexical ElementNode carrying `taskId`** with normal text children (inline-editable title), companion plugin for checkbox/meta/sync; mint awaits the real task id before stamping the node (avoids the known `tmp-` id race), with a pending visual state. Two-way sync: debounced `patchTask` out; bundle refresh in. Link kinds: minted=`spawned-from`, existing=`references` (closed 8-kind set untouched; `allowedKinds` extended for the pair).
7. **Ops set per DESIGN_BRIEF §5**; `rename` and `apply_updates` write **no activity rows** (continuous edits — contract's "plain edits" carve-out) but `rename` upserts the registry label; `notes_module_permission` copies `tasks_module_permission` **with the api-key branch** (`scopes->>'notes'`) — the three-module gotcha.
8. **Publish = `published_at` + unique `publish_token` + an edge function** rendering from `body_md` (subtree walk, noindex, no RLS-public tables). Legacy `exposed_notes` stops being written; its code is removed (AC14). Rejected: RLS-anon access to `notes` (a public policy on the workspace table is a standing foot-gun).
9. **Markdown via `@lexical/markdown`** (same 0.40 family) + custom transformers for task lines/chips/page-rows (`- [ ]` + stable-id comment; `[label](moduo://type/id)`). Tree export zip via a small client zip dep. Import maps folders→parents, one batched attributed `notes_op_import`.
10. **The MCP connector builds/loads Yjs docs in Deno** (yjs is pure JS) to write `create`/`append`/`update` as real CRDT updates targeting the `root-v2` structure; reads come from `body_md`. Risk recorded: the Lexical-Yjs XML shape must be constructed carefully — the connector writes plain block structures only (headings/paragraphs/lists); if it proves brittle, fallback = server queues md appends that any client materializes on next open (fallback is honest but weaker for never-opened notes; primary path is the target).
11. **Right-panel switcher lifts from `src/features/calendar/ui/right-panel-switcher.tsx` to the app shell unchanged** (it was built module-free for exactly this); Calendar keeps working through the lifted one.
12. **Pins stay workspace-level** (existing column; per-user pins would need a new table — post-alpha).
13. **Trash purge is a client-triggered sweep on module load** (`notes_op_purge_expired`, like `tasks_op_catch_up`) — no pg_cron dependency.
14. **`lint:tw`'s notes-editor exemption is removed at the end of the wave** — the rebuilt surfaces are tokens-only.
15. **Seeded welcome note** ships as part of the shell block (deletable, demonstrates task line/`/page`/chip/checkbox); the workspace-wide onboarding showcase stays a platform item.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| NO-1 | **Schema + intent ops + runtime v2** | Migration (extend `notes`, `note_updates`, publish cols, derived cols, FTS index, permission fn w/ api-key branch, RLS rework, kind backfill), full `notes_op_*` set, registry upserts, runtime `notes` v2 surface (web + tauri delegation), deploy-gap degrade, pure mappers + tests. No UI. | AC13 (server half), AC14 (backfill) | — |
| NO-2 | **Sync engine v2 (offline core)** | IndexedDB doc+metadata cache & outbox, push/pull-since-cursor, snapshot compaction, draft recovery, quiet status surface, one-time redb import, legacy expose/Rust-notes removal. | AC6, AC14 | NO-1 |
| NO-3 | **Page shell + tree** | Rebuilt three-pane page: sidebar sections (Pinned/Inbox/tree/Published/Archive/Trash), arbitrary-depth tree + dnd + context menus + icons, capture flows (⌘N/⌘⇧N/palette), first-line-title, duplicate, trash/archive/restore + purge sweep, welcome seed, tokens-only. | AC1, AC2, AC12 | NO-1, NO-2 |
| NO-4 | **Editor grammar rework** | Slash menu rebuild (final grammar + aliases, dead commands removed), `/page` + page-row blocks, `/note` `/contact` `/company` `/event` chips (+create-and-link), `@` people-only scoping, md paste/copy (`@lexical/markdown` + transformers), `/mindmap` rename, old title field removal. | AC5 (grammar half), AC11 (paste/copy), AC14 | NO-3 |
| NO-5 | **Task lines — the great moment** | TaskLineNode + plugin, `/task` picker (create-or-link), convert gestures (hover/menu/⌘⇧T/batch), detach keep/delete + batch toast + ⌘Z revert, two-way sync, schedule popover, Task-detail rail variant, spawned-from/references links, kind-matrix extension. | AC3, AC4 | NO-4 |
| NO-6 | **Multiplayer: realtime + presence + mentions** | Realtime broadcast channel (update relay + fallback polling), near-live merge, presence avatars, cursor stretch, `notes_op_mention` wiring → notifications (first live person-mention consumer). | AC7, AC5 (mention half) | NO-2, NO-4 |
| NO-7 | **Right panel + spine payoffs** | Switcher lift to app shell; Detail (hub + tags + suggestion strip + activity), Comments (quote-comments), Outline; drag-into-editor chip + drag-onto-row link; "Notes" rail variant wired into Contacts + Calendar. | AC8, AC9 | NO-4 (NO-5 for task-detail entry) |
| NO-8 | **Find & interchange** | FTS sidebar search w/ snippets, per-note .md export, tree zip export, md/zip import wizard (preview + batched op). | AC8 (search), AC11 | NO-1, NO-4 |
| NO-9 | **Publish to web** | Publish/unpublish ops + token, public edge renderer (subtree nav, noindex), Published section, header control. *Cuttable to fast-follow.* | AC10 | NO-1, NO-8 |
| NO-10 | **DoD: MCP + widget** | Notes manifest + registry entry, connector module (md in/out incl. Deno Yjs builder), Recent-notes widget (4 registry spots + deep links), connector redeploy note for MCP-1. | AC13 | NO-1–NO-8 |

Cut order if the wave overruns (designer Q8): NO-9 → cursors stretch (in NO-6) → tree-zip export (in NO-8) → "Notes" variant in other modules (in NO-7). Core (NO-1–NO-6, search, import) never cuts.

## Out of scope

- Notion-style databases, property schemas, template systems, graph views (BRIEF non-goals — reaffirmed).
- `/embed-note` transclusion (cut — child pages + refs cover it), toggle blocks, inline text-anchored comments (quote-comments ship instead), live-cursor guarantee (stretch only).
- Per-note permissions, guest accounts (post-alpha backlog; workspace-level permissions at alpha).
- Full-offline web PWA (local-first "lite" roadmap), daily notes, note templates.
- Mindmap module changes beyond the `/mindmap` rename (its rethink is a future wave).
- Dashboard rework (the widget targets the current grid).
- Notion-API importer (md-zip import covers the alpha need).

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** filled and unambiguous (3 grilling rounds, all product calls designer-ratified).
- [x] **Every AC has at least one test** with a plain-English note.
- [x] **Open questions is empty** — technical unknowns researched and recorded under Assumptions (incl. the two risk-flagged ones: Deno Yjs builder #10, first Realtime usage #5 — both with fallbacks).
- [x] **Data model named and Supabase-first** — extend `notes` + new `note_updates`; migrations identified (one per NO-1, publish cols ride it).
- [x] **Module feature:** spine wiring enumerated (links/attach/drag/@mention/notifications/activity/tags — DESIGN_BRIEF §3, §5–6), MCP tools listed, dashboard widget defined.
- [x] **Execution blocks** decomposed (NO-1…NO-10), sequenced, context-sized, self-contained, recoverable from this spec + decisions.md.
- [x] **Design constraints acknowledged** — tokens-only (exemption removal is AC14-adjacent, assumption 14), shadcn-wrapped primitives, DESIGN_RULES rungs.
- [x] **Manual-test surfaces identified** — MCP keyed round-trip, desktop redb import + true offline, two-device live merge, publish link (see Tests table, last rows).

**Ready to execute.**

## Open questions

- [ ] (none)
