# Spec: Notes schema hardening

> Status: **Ready** · Owner: mike (engineer mode; PQ1–PQ7 ratified "all rec", 2026-10-28) · Build: now, NS-1 to NS-11, independent of the alpha and beta schedule
> Related: the 2026-10-28 architecture review of the Notes Supabase layer (this session; proposals P1–P11), [specs/global-search.md](./global-search.md) (GS-2 already shipped P11 and the search half of P6), [docs/decisions/notes.md](../docs/decisions/notes.md) (NR-1, NR-6, NR-7, #412 CAS), [.claude/rules/supabase.md](../.claude/rules/supabase.md)

## Scope

This spec reshapes Notes' Supabase layer to be safer, simpler and cheaper without changing what people see. There are four themes, ordered by risk.

1. **Close what is open:**
   - legacy tables and grants (`exposed_notes`, `note_shares`, client write grants, anon grants);
   - prod-only helpers anon can execute;
   - a tree that may cross workspaces;
   - sub-notes that silently lose their sharing when an ancestor is hard-deleted.
2. **Make retention a server rule:** Notes trash is never purged on the server today.
3. **One access rule:**
   - one guard per op, with an explicit level;
   - reads that check access once per request instead of per row;
   - writes that check once per statement.
4. **Tidy the table:**
   - drop dead columns and objects;
   - add the missing foreign keys and the byte-order collation;
   - compact the logs nobody opens;
   - split the rarely-written document content out of the hot `notes` row.

Prod today (catalog plus counts, 2026-10-28) is clean, so every constraint can be added validated: 0 cross-workspace parents, 0 parentless inherit notes, 0 dangling actor ids, 0 expired trash, 0 legacy share values, 2 pinned notes (already copied into favorites), 1 `exposed_notes` row, 0 `note_shares` rows, and a longest log of 39 rows.

## Product behavior & UX

Almost nothing changes for a person. The behaviour that does change, each ratified under *Product answers* (`PQ#`):

1. **Deleting a parent never takes access away from its sub-notes.** This covers account erasure, purge from trash, and any hard delete. Sub-notes that followed the parent's sharing move to the top level and keep exactly who could see and edit them (PQ1). Today purge and move do this; erasure and a plain hard delete don't.
2. **Trash empties itself.** A note in the trash for 30 days is deleted overnight, even if nobody opens Notes (PQ2). After 30 days it can't be restored; today restore is unlimited until someone happens to open Notes (PQ3).
3. **Making something public needs one rule.** Minting a publish link, or moving a note that follows its parent into a published tree, needs edit on the note plus the workspace's "publish" permission. Today the move asks for Full (PQ4).
4. **Pins are gone.** The old per-note pin (`is_pinned`, 2 rows in prod, already copied into Favorites) is removed with its unused `togglePin` hook and the "Pinned ·" snippet. Favorites are the one way to keep a note at hand (PQ5).
5. **Importing a page whose parent isn't in this workspace** fails the import with "A note's parent isn't in this workspace" instead of silently linking across workspaces (PQ6).
6. **Error wording.** A note you can't see and a note that doesn't exist both read "Note not found" (PQ7).
7. **Agent-written notes are compacted overnight.** A note written only through MCP no longer grows its edit history without bound, and nothing visible changes (no PQ).

## Edge cases

- **Erasure.** The erased person's note has a sub-note owned by a teammate that follows its sharing. The sub-note becomes top-level and keeps every grant the chain gave it. The erased person is never granted anything.
- **Purge's cycle-break branch** (a tree with a loop) freezes before it unlinks, like every other path.
- **A note at the top level with "follow parent".** This is impossible by constraint. Any path that would create one freezes it first, and a path that doesn't fails loudly.
- **A batch import with one bad parent** fails as a whole, with the parent's id in the error. Nothing is half-imported.
- **Expired trash whose subtree is partly live:** purge already re-roots the live survivors with their access (NS-3), and the nightly job uses the same path.
- **Restoring a note trashed more than 30 days ago,** before the nightly job runs: refused with "This note was deleted more than 30 days ago".
- **Two tabs compacting at once.** The existing CAS refuses the stale one (#412). The nightly server compaction uses the same CAS and skips a note anyone is viewing (`note_live_viewers`).
- **A replayed outbox batch** (all duplicates) no longer bumps `updated_at`, so Recents order doesn't jump.
- **A view-only API key** still fails every write op. A create-only role now fails at the guard with the right error, instead of passing the guard and failing in the trigger.
- **Old app builds:** meta ops return fewer columns. Every column the shipped app reads is kept (NS-5), so an old tab keeps working.
- **The desktop's dormant REST sync** (`apps/desktop/src-tauri/src/sync/mod.rs`, never started) would lose its write access after NS-1. It is dead code and recorded as such.

## Acceptance criteria

- **AC1.** `anon` holds no privilege on any Notes table or function except `notes_public_subtree`, through `notes-public`. `authenticated` can only SELECT `notes`, `note_updates` and `note_favorites`. Every write goes through a definer op.
- **AC2.** No prod-only legacy object remains callable: `private.user_can_read_note`, `private.user_can_edit_note`, the public-read `exposed_notes`. The prod-only indexes are gone.
- **AC3.** A note's parent, its log rows and its favorites always live in the note's own workspace. This is enforced by foreign keys, so no op can break it.
- **AC4.** After any hard delete of a parent (erasure, purge, cycle break, direct delete), every former inherit-child is top-level, set to custom sharing, and visible to exactly the people who could see it before.
- **AC5.** Trash older than 30 days is purged nightly across all workspaces, with links and registry entries tombstoned. Restoring past 30 days is refused. Stale live-viewer rows are swept.
- **AC6.** Meta ops (rename, move, file, set_meta, archive, unarchive, publish, unpublish, duplicate, create) return only meta columns, never `doc_state` or bodies.
- **AC7.** Every `notes_op_*` checks its level once, through one guard, and each op's effective level matches the matrix in Assumptions 6. "Not found" and "hidden" are the same answer.
- **AC8.** Opening a note's document is one request that checks access once. The notes list is one request whose visibility is computed once per call.
- **AC9.** A 500-row update batch checks access once per note, not once per row. An all-duplicate batch writes nothing to `notes`.
- **AC10.** The legacy objects and columns (`exposed_notes`, `note_shares`, `private.user_owns_note`, `share_scope`, `share_permission`, `tags`, `kind`, `is_pinned`) are gone:
    - erasure still works;
    - the actor columns have foreign keys;
    - `position` sorts in byte order everywhere;
    - `share_mode` is a contract vocabulary.
- **AC11.** A note whose log exceeds 200 rows and that nobody is viewing is compacted overnight. Its document is unchanged, and its bodies are untouched.
- **AC12.** Document content (`doc_state`, `doc_version`, bodies, search vector) lives in `note_bodies`. An edit push no longer rewrites the `notes` row, beyond the one `updated_at`/`edited_*` change, and search, publish, pull and MCP behave exactly as before.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `supabase/tests/notes_grants.test.sql` · "client grants are read-only" | AC1, AC2 | As anon, every Notes table refuses select, insert, update, delete and truncate. As a member, direct insert, update and delete on `notes`/`note_updates` fail while every op still works. The two private helpers and three indexes no longer exist. |
| `supabase/tests/notes_same_workspace.test.sql` · "a tree never crosses workspaces" | AC3 | Import with a parent from another workspace fails with the readable error. A raw cross-workspace parent, log row or favorite is refused by its key. |
| `supabase/tests/notes_reroot_access.test.sql` · "deleting a parent keeps sub-note access" | AC4 | For erasure, purge, the cycle branch and a direct delete, a teammate who saw an inherited sub-note still sees it after, the sub-note is custom and top-level, and the erased person got no grant. |
| `supabase/tests/notes_purge_expired_server.test.sql` · "nightly purge" | AC5 | A 31-day-old trashed note in two workspaces is purged with no actor, its links tombstoned. A 29-day-old one stays. Restore at 31 days is refused. Stale viewers are swept. |
| `supabase/functions/_shared/purge-deleted.test.ts` · "notes step" | AC5 | The Edge purge run calls the notes sweep and reports its count. |
| `supabase/tests/notes_meta_returns.test.sql` · "meta ops return meta only" | AC6 | Each meta op's result has no `doc_state` or body columns, and has every column the app reads. |
| `apps/app/src/lib/runtime.web.notes.test.ts` · "meta results still map" | AC6 | The app maps the lean result to the same note model. |
| `supabase/tests/notes_guard_matrix.test.sql` · "one guard, every op" | AC7 | Owner, editor, viewer, create-only, outsider, view key and edit key against every op give exactly the matrix's outcomes, and hidden equals missing. |
| `supabase/tests/notes_pull_list.test.sql` · "pull and list check once" | AC8 | `notes_pull` returns the log page plus the snapshot from one snapshot and refuses a hidden note. `notes_list_meta` equals the RLS list for 4 people. |
| `supabase/tests/notes_pull_list_perf.test.sql` · "10k list, 1k log" | AC8 | The list p95 at 10k notes is ≤ 80 ms, and pulling a 1,000-row log takes one call. |
| `supabase/tests/notes_apply_updates_statement.test.sql` · "batch writes check once" | AC9 | A 500-row batch inserts, notifies viewers once and enforces edit. An all-duplicate batch leaves `updated_at` alone. A direct write by someone without edit still fails. |
| `supabase/tests/notes_legacy_dropped.test.sql` · "legacy is gone, erasure runs" | AC10 | The legacy objects and columns are absent, erasure completes on a seeded person, the foreign keys null out on delete, and positions sort in byte order. |
| `supabase/functions/_shared/contracts/vocabularies.test.ts` · "share_mode" | AC10 | `share_mode`'s values match the Postgres CHECK. |
| `supabase/functions/_shared/notes-compact.test.ts` · "compaction keeps the document" | AC11 | Merging a snapshot plus 300 log rows gives a document whose text equals the unmerged one. A viewed note is skipped. |
| `supabase/tests/notes_compact.test.sql` · "server CAS" | AC11 | `notes__compact` refuses a stale version and never touches the bodies. |
| `supabase/tests/notes_bodies_split.test.sql` · "content moved, behaviour same" | AC12 | Search, publish subtree, pull, snapshot, seed, duplicate and import give the same results after the split. An edit push changes only `updated_at`/`edited_*` on `notes`. |
| Existing suites (`notes_*`, `rls_matrix_notes`, `search_*`, MCP notes tests) | all | Stay green in every block. |

## Assumptions & technical decisions

1. **Grants (NS-1).**
   - `REVOKE ALL … FROM anon` on `notes`, `note_updates`, `note_shares` and `exposed_notes`.
   - From `authenticated`, `REVOKE ALL` on `notes`, `note_updates`, `note_shares`, `note_favorites` and `exposed_notes`, then `GRANT SELECT` back on `notes`, `note_updates` (the app reads them until NS-7) and `note_favorites`. A verb list would leave Postgres 17's MAINTAIN behind. No client reads `note_shares`, so it keeps nothing. `note_updates_id_seq` loses every client grant (a `setval` could rewind it).
   - Drop the `exposed_notes` public-read policy. Revoke `notes_module_permission` from `authenticated`: no client calls it, and its SQL callers are definers.
   - `DROP FUNCTION IF EXISTS private.user_can_read_note(…)` and `private.user_can_edit_note(…)`. They are prod-only, with no caller.
   - `DROP INDEX IF EXISTS notes_workspace_pinned_idx, notes_workspace_share_scope_idx, idx_notes_workspace_id`. They are prod-only. `(workspace_id, deleted_at)` covers the prefix, and the pinned one rewrites on every `updated_at`.
   - *Rejected:* dropping the tables now. Erasure still deletes from them, so the drop happens with the erasure re-cut in NS-9.
2. **One tree per workspace (NS-2).**
   - Add `UNIQUE (workspace_id, id)` on `notes`.
   - Replace `notes_parent_id_fkey` with `FOREIGN KEY (workspace_id, parent_id) REFERENCES notes (workspace_id, id) ON DELETE SET NULL (parent_id)` (Postgres 15+; prod is 17).
   - Give the same composite key, with `ON DELETE CASCADE`, to `note_updates` and `note_favorites`.
   - `notes_op_import` validates `parentId` against the workspace and against the batch, and raises 22023 "A note's parent isn't in this workspace" (PQ6).
   - `can_access` is not changed: with the key in place, an inherited chain can never cross workspaces, so its "topmost ancestor's workspace" ceiling is equal to the note's own. A test pins that equality.
   - *Rejected:* rewriting `can_access`, the shared 6 kB gate other modules depend on, for an invariant DDL now guarantees.
3. **Re-rooting keeps access everywhere (NS-3).**
   - `CHECK (share_mode = 'custom' OR parent_id IS NOT NULL)`. Prod has 0 violations, so it is added validated.
   - A `BEFORE DELETE` row trigger on `notes`, `notes__freeze_children`, copies what the chain gives each inherit child of `OLD` (live or trashed) into `resource_grants` before the key's SET NULL fires; the SET NULL write itself makes the child `custom` (`notes__orphan_custom`). The trigger never writes the child's row: the same DELETE may remove it next (built in NS-3, see `docs/decisions/notes.md`).
   - The helper gains `p_skip_creator` (a creator not to grant). The delete trigger passes none: the deleted row's creator keeps what they had (Mike, 2026-10-28, NS-3 review), and erasure's own step 7 removes every grant of the erased person.
   - Purge's cycle-break branch calls the same freeze.
   - Account erasure needs no change: its delete now fires the trigger.
   - *Rejected:* adding freeze calls to each delete path, the convention that missed erasure.
4. **Server retention (NS-4).**
   - `notes__purge_expired(p_limit int)`: service-only, with no actor. It picks rows with `deleted_at < now() - 30 days`, using `FOR UPDATE SKIP LOCKED`, groups them by workspace and runs `notes__purge_ids`. It returns counts.
   - It is the same shape as `tasks__purge_expired`, and becomes a step in `supabase/functions/_shared/purge-deleted.ts` next to tasks, with its count added to `purge__preview`.
   - `trash__stamp_deleted_at`-style protection: a BEFORE UPDATE OF `deleted_at` trigger refuses to clear a `deleted_at` older than 30 days (PQ3).
   - The same step deletes `note_live_viewers` rows older than 10 minutes.
   - The client's `notes_op_purge_expired` stays, as a harmless early sweep.
   - The Edge Function is redeployed with the release.
5. **Lean meta results (NS-5).** A composite type `public.notes_meta` holds exactly the columns `noteRowSchema` reads:
   ```
   id, workspace_id, created_by, parent_id, title, icon, is_pinned, position,
   is_archived, published_at, publish_token, doc_version, share_mode,
   workspace_shared, in_inbox, full_width, edited_by, edited_at,
   created_at, updated_at, deleted_at
   ```
   - The 10 meta ops return it, each through DROP + CREATE, with grants re-stated (`.claude/rules/supabase.md`).
   - `is_pinned` stays in the type until NS-9 removes it everywhere at once.
   - *Rejected:* `.select()` on each app call, which leaves MCP and other callers on the full row.
6. **One guard (NS-6).**
   - `notes__require(p_ws, p_note, p_action text /* create|edit|delete|view */, p_trashed bool default false) RETURNS public.notes` (row-locked):
     1. the module key `notes.<action>` through `perm_user_has`, with the API-key scope cap for keys;
     2. `can_access(note, view|edit|full)` by action;
     3. P0002 "Note not found" for missing and hidden alike.
   - `notes__require_module(p_ws, p_action)` covers create and import.
   - It replaces `notes_op__guard` and `notes_op__guard_note`, and the lossy `module_member_permission`/`permissions_notes` mirror for Notes. The mirror stays for the app's display.
   - `perm_enforce_write` stays as the backstop.
   - The publish rule: a new token, or an inherit note entering a published tree, needs `edit` plus `ws.publish` (PQ4).
   - The op → level matrix:
     - **create, import:** create on the module, plus edit on the parent;
     - **duplicate:** view on the source, plus create, plus edit on the parent;
     - **rename, set_meta, unarchive, unpublish, seed_doc, file, archive, apply_updates, save_snapshot:** edit;
     - **publish, move into a published tree:** edit plus publish;
     - **move:** edit, plus edit on the new parent;
     - **trash, restore, purge:** delete (full);
     - **mention, set_favorite:** view.
7. **Read RPCs (NS-7).**
   - **`notes_pull`:** `notes_pull(p_ws, p_note, p_after_id bigint, p_known_version int) RETURNS jsonb {updates: [...≤1000], has_more, doc_version, snapshot?}`, STABLE. Access is checked once, and the result comes from one MVCC snapshot, so the log-first ordering trick goes away.
   - **`notes_list_meta`:** `notes_list_meta(p_ws, p_trash_since timestamptz) RETURNS SETOF public.notes_meta`, filtered by `notes__visible_ids` once, ordered by `position COLLATE "C", id`, capped at 5,000.
   - App `pullDoc`, `listMeta` and the MCP pull move onto them, with a fallback to the current queries while the function is missing (the GS pattern).
   - SELECT grants on `notes` and `note_updates` for `authenticated` are then revoked in NS-11, once nothing reads them directly.
8. **The statement-level write path (NS-8).**
   - `notes_op_apply_updates` inserts with one `INSERT … SELECT FROM jsonb_to_recordset(p_updates) … ON CONFLICT DO NOTHING RETURNING id`.
   - It updates `notes` only when rows were inserted or a body actually changed.
   - On `note_updates`, the per-row `perm_enforce_write` and `notes_live__note_update` become `AFTER INSERT` and `AFTER DELETE … REFERENCING NEW/OLD TABLE FOR EACH STATEMENT` triggers. They check edit once per distinct `note_id` and queue live notices once per note.
   - *Rejected:* keeping row triggers and batching in the op only, which leaves compaction deletes at one check per row.
9. **Legacy removal and integrity (NS-9).**
   - Drop `exposed_notes`, `note_shares` (with its policies and trigger) and `private.user_owns_note`, and re-cut `account_erase_workspace_data` without them.
   - Drop the columns `share_scope`, `share_permission`, `tags`, `kind` (ops stop writing it) and `is_pinned` (with `togglePin`, the snippet, the model field and `notes_meta`'s column; PQ5).
   - Shrink `notes_share_fields_owner_only` to its remaining job: only the owner changes `created_by`.
   - Foreign keys `ON DELETE SET NULL`: `notes.edited_by` → `profiles`, `note_updates.user_id` → `profiles`, `note_updates.actor_key_id` → `workspace_api_keys`.
   - `ALTER COLUMN position TYPE text COLLATE "C"` on `notes` and `note_favorites`.
   - `share_mode` moves to `vocabularies.ts`, with `parse*`/`normalize*`/`is*` and a drift gate. `rows.ts` and the app import it.
   - The dormant desktop REST sync is left untouched and recorded as dead code.
10. **Server compaction (NS-10).**
    - `notes__compact(p_note, p_snapshot_b64, p_upto_id, p_expected_version)`: service-only, with the same CAS as `notes_op_save_snapshot`, never writing bodies.
    - A nightly step in `purge-deleted` picks at most 50 notes with more than 200 log rows, last written more than 10 minutes ago, and nobody in `note_live_viewers`.
    - It merges snapshot plus log through a new `compactFromLog` export of the existing `notes-doc` bundle (`supabase/functions/_shared/notes-doc/`), then calls `notes__compact`. *(Built:* the merge rebuilds a `Y.Doc` and encodes it with `Y.encodeStateAsUpdate`, as the client's fold does, and refuses a log with a row Yjs can't decode, as the client vetoes its fold; it loads at most 5,000 rows a night per note.*)*
    - The client stays the only markdown serialiser (NR-6). Compaction only merges.
11. **The hot/cold split (NS-11).**
    - `note_bodies (note_id uuid PK, workspace_id uuid, doc_state text, doc_version int, body_text text, body_md text, search_tsv tsvector GENERATED …)`, with the composite key to `notes` `ON DELETE CASCADE`, RLS SELECT through `can_access`, no client grants, and the GIN index moved there.
    - One migration does it all:
      - backfills the 129 rows;
      - switches every SQL reader and writer (`notes_pull`, `save_snapshot`, `compact`, `seed_doc`, `apply_updates`, `duplicate`, `import`, `notes__search`, `notes_public_subtree`, the MCP's reads);
      - drops the columns from `notes`.
    - The app reads content only through `notes_pull` (NS-7), so no app change is needed. The `authenticated` SELECT grant on `note_updates` is revoked here.
12. **Tier and verification.** Every block that ships a migration is Tier 2: the validator runs, and `bun run db:matrix` covers new functions.
    - **Migration timestamps:** assigned per block, starting at `20261030100000` and spaced an hour apart, in block order.
    - **Local stack:** each block applies on top of the shared local stack (`psql -1 -f`), never resetting it.
    - **Prod:** nothing reaches prod outside `/ship`.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| NS-1 | **Close the open surface** | Migration `20261030100000`: grants, policy, prod-only helpers and indexes, the `notes_module_permission` grant (Assumption 1). `notes_grants.test.sql`; RLS matrix updated. **Tier 2.** | AC1, AC2 | — |
| NS-2 | **One tree per workspace** | Migration `20261030110000`: composite keys on `notes`, `note_updates` and `note_favorites`; the import parent check (Assumption 2). `notes_same_workspace.test.sql`. **Tier 2.** | AC3 | — |
| NS-3 | **Deleting a parent keeps access** | Migration `20261030121000`: the inherit-needs-parent CHECK, the `notes__freeze_children` trigger, `p_skip_creator`, the cycle-branch fix (Assumption 3). `notes_reroot_access.test.sql`. **Tier 2.** | AC4 | NS-2 |
| NS-4 | **Trash empties itself** | Migration `20261030130000`: `notes__purge_expired`, the restore-after-30-days refusal, the viewer sweep, the `purge__preview` count. The notes step in `_shared/purge-deleted.ts` (Assumption 4). **Tier 2.** | AC5 | NS-3 |
| NS-5 | **Lean meta results** | Migration `20261030140000`: `notes_meta` type, the 10 ops re-declared with grants re-stated. App and MCP mapping tests (Assumption 5). **Tier 2.** | AC6 | NS-1 |
| NS-6 | **One guard** | Migration `20261030150000`: `notes__require`, `notes__require_module`, every op moved onto them, the publish rule unified (Assumption 6). `notes_guard_matrix.test.sql`. **Tier 2.** | AC7 | NS-4, NS-5 |
| NS-7 | **Read RPCs** | Migration `20261030160000`: `notes_pull`, `notes_list_meta`. App `pullDoc`/`listMeta` and the MCP pull on them, with a missing-function fallback (Assumption 7). Behaviour and performance tests. **Tier 2.** | AC8 | NS-6 |
| NS-8 | **Writes check once** | Migration `20261030170000`: set-based `apply_updates`, statement-level triggers on `note_updates`, no-op skip (Assumption 8). **Tier 2.** | AC9 | NS-6 |
| NS-9 | **Legacy out, integrity in** | Migration `20261030180000`: drops, the erasure re-cut, the owner-only trigger shrink, actor keys, `COLLATE "C"`, the `share_mode` contract; `is_pinned` out of the app (Assumption 9). **Tier 2.** | AC10 | NS-7, NS-8 |
| NS-10 | **Compact what nobody opens** | Migration `20261030190000`: `notes__compact`. `compactFromLog` in the notes-doc bundle, the nightly step (Assumption 10). **Tier 2.** | AC11 | NS-4, NS-8 |
| NS-11 | **Split content from the row** | Migration `20261030200000`: `note_bodies`, backfill, every reader and writer switched, columns dropped, the last client SELECT grants revoked (Assumption 11). **Tier 2.** | AC12 | NS-9, NS-10 |

Order:
1. NS-1 and NS-2 run in parallel.
2. NS-3 follows NS-2; NS-5 follows NS-1.
3. NS-4, then NS-6.
4. NS-7 and NS-8 run in parallel.
5. NS-9 and NS-10 run in parallel.
6. NS-11 runs last.

## Out of scope

- Any visible Notes UI change beyond removing the dead pin code.
- `can_access` itself (Assumption 2).
- The desktop's dormant REST sync.
- Bytea storage for documents (base64 text stays; the review's "leave alone").
- The live channel design (NR-7), the client as markdown serialiser (NR-6), the `simple` search config.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are filled and unambiguous.
- [x] **Every acceptance criterion has at least one test**, with its plain-English note.
- [x] **Open questions is empty.** PQ1–PQ7 are ratified (every recommendation accepted), and every technical unknown is decided above.
- [x] **The data model is named and Supabase-first:**
  - new: `notes_meta`, `note_bodies`, `notes__require*`, `notes_pull`, `notes_list_meta`, `notes__purge_expired`, `notes__compact`, the freeze trigger, the composite keys;
  - dropped: `exposed_notes`, `note_shares`, 5 columns, 3 prod-only indexes, 3 prod-only helpers.
- [x] **Module feature:** none. This is a schema change, MCP tools keep their contract, and there is no widget.
- [x] **Execution blocks** are decomposed, sequenced, context-sized and self-contained, each with its own migration timestamp.
- [x] **Design constraints:** no UI apart from removing pin code.
- [x] **Manual-test surfaces:**
  - Notes open, edit and list on web and desktop;
  - publish link;
  - MCP `notes_*`;
  - account deletion on a seeded person (local);
  - the nightly `purge-deleted` run (local invoke).

## Product answers

Ratified by Mike (engineer mode), 2026-10-28, "all rec": every recommendation below is the decision.

- [x] **PQ1.** When a parent is deleted, its sub-notes move to the top level and keep exactly who could see them. → *Rec: yes.*
- [x] **PQ2.** Trash is emptied after 30 days by a nightly job, even if nobody opens Notes. → *Rec: yes, 30 days* (unchanged period).
- [x] **PQ3.** A note trashed more than 30 days ago can't be restored, even before the job runs, the same as tasks. → *Rec: yes.*
- [x] **PQ4.** One rule for going public: edit on the note plus the workspace's publish permission, for both "publish" and "move into a published tree". Today the move needs Full. → *Rec: yes.*
- [x] **PQ5.** Remove the old pin; Favorites replace it. → *Rec: yes.*
- [x] **PQ6.** An import whose page points at a parent outside this workspace fails as a whole, with a readable error. → *Rec: yes.*
- [x] **PQ7.** "Note not found" for both a missing note and one you can't see. → *Rec: yes.*

## Open questions

- [x] (none)
