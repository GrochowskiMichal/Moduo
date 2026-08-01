# Spec: Import & migration — Notion notes + email history depth

> Status: **In progress** — IM-1 + IM-2a + IM-2b shipped (IM-1 & IM-2a/2b on 2026-07-29/30). Email: **AC7 + AC9 partial**, see Open questions. Notes: AC1–AC5 done. · Owner: maciej · Block ids: **IM-1 … IM-5** (Wave D, dogfood lane)
> Supersedes the placeholder `/s1 IMPORT` line in [`specs/BUILD_ORDER.md`](./BUILD_ORDER.md) Wave D.

## Scope

Get the designer **cold turkey onto Moduo** — his stated goal is to force real daily use to prove the app works. He is migrating off **Notion** (notes), **Morgen** (calendar + its own tasks) and **Spark** (email).

Research collapsed this from an "importer epic" into a much smaller, sharper feature. The `/s1` interview (2026-07-29) plus a three-agent audit established:

- **Notion** — ~350 markdown pages, **no databases worth importing** (one Claude-generated fragrance DB stays in Notion). The importer already exists; it needs hardening against a real export.
- **Tasks** — live in **Morgen's own store**. The designer will **re-enter them by hand** ("not a lot to import"). **No task importer is built here** (deferred to IM-4).
- **Calendar** — 5 Google + 2 CalDAV accounts, surfaced *through* Morgen but **owned by the providers**. He wants **no history**. Moduo already connects all of these. **Nothing to build.**
- **Spark** — owns none of his mail (IMAP client). He uses **archive, not snooze**, so the `Later`-folder data-loss trap does not apply to him. **Nothing to build** beyond a courtesy checklist (IM-5).
- **Email history** — he wants **~12 months, with the amount selectable**, because he searches for year-old invoices, order confirmations and game keys. **This is the only substantial engineering in the migration**, and it is much larger than "add a picker" (see Assumptions 4–7).

So: **one notes block, three email blocks, two deferred blocks.**

## Product behavior & UX

### Notes import (IM-1)

The user exports from Notion (Settings → Export → Markdown & CSV, include subpages) and drops the **downloaded zip exactly as it arrives** into Moduo's note importer. Moduo unwraps it, previews the page tree, and imports on confirm. Pages keep their hierarchy and their original sibling order. Non-page files (CSVs, images) are reported as skipped, not silently dropped. Re-running the same import does not duplicate anything.

States: **empty** (drop zone) → **parsing** (a real zip takes seconds) → **preview** (indented tree + a per-kind summary: "350 pages · 3 files skipped") → **importing** (determinate progress for >50 pages) → **done** (toast with counts, and a listing of what was skipped and why).

### Email history depth (IM-2a/b/c)

When connecting a mailbox, the user chooses how far back to sync: **3 months · 6 months · 12 months · Everything**, defaulting to **12 months**. The choice is changeable later per account in Settings → Integrations.

The mailbox becomes usable **immediately** — recent mail syncs first, then older mail fills in backwards in the background with visible, cancellable progress. Increasing the depth later backfills the gap rather than starting over; decreasing it stops fetching but **never deletes** already-synced mail.

States: **choosing** (picker, default 12 months) → **initial sync** (recent mail, app usable) → **backfilling** (determinate "syncing March 2026 · 4,200 of ~29,000") → **complete** → **error** (per-account, retryable, never wedges other accounts).

## Edge cases

> **Verified 2026-07-29 by driving the shipped `readZipMarkdown` + `planMdZipImport` over the designer's real export** (368 entries). Findings below are measured, not predicted; several risks I originally listed turned out to be unfounded and were removed.

- **🔴 Notion ships a zip inside a zip, and this is fatal today.** The real export is `Export-<uuid>.zip` containing `Export-<uuid>-Part-1.zip` containing the files. `readZipMarkdown` filters entries to `.md|.markdown|.txt` *before* anything else, so the nested zip is discarded and it returns `[]`. **Measured: dropping the file as downloaded imports 0 of 350 notes, with no error.** Large workspaces add `Part-2`, `Part-3`… — all parts must be accepted.
- **🔴 Non-page entries are dropped by the READER, so they can't be reported.** The same extension filter discards the export's 3 CSVs and 15 PNGs before the planner sees them, so `plan.skipped` is empty and the user is told nothing was skipped. **Measured: 18 entries silently vanished.** The reader must pass non-markdown entries through (or classify them) so the summary can count them.
- **🟡 A few pages produce no title.** **Measured: 4 of 350 land as "Untitled"** — files whose name cleans to empty *and* whose body has no leading heading. Acceptable, but the count belongs in the import summary rather than appearing as mystery notes.
- **🟢 UNFOUNDED — the wrapper folder does not create phantom parents.** `Export-<uuid>/Private & Shared/` has no matching `.md`, and the planner parents by *name match*, so those levels simply don't become notes. **Measured: filesystem depth 9 → note-tree depth 7, exactly the 2 wrapper levels, with 29 correct root-level notes.**
- **🟢 UNFOUNDED — deep nesting survives.** **Measured: all 350 pages placed, depth 0–7, no orphans.**
- **🟢 UNFOUNDED — the 32-hex suffix strips cleanly.** **Measured: 0 of 350 titles leak an id.**
- **🟢 UNFOUNDED — non-ASCII filenames are fine.** 62 of the entries contain them (Polish diacritics). `fflate` decodes them correctly; only the macOS CLI `unzip` chokes, which is not a path the app uses.
- **🟢 ALREADY FIXED — sibling ordering.** NOTE-FIX-1 landed `importPositions`; **measured: 350 positions assigned, 0 blank.**
- **Re-running an import** — no duplicates (id-stable), and a partially-failed import resumes.
- **Email: a folder with fewer messages than the requested window** — completes, doesn't error.
- **Email: `uid_validity` changes mid-backfill** (server recreated the mailbox) — must not delete already-backfilled history.
- **Email: quitting the app mid-backfill** — resumes from where it stopped, never restarts from zero.
- **Email: two devices syncing the same account** — each keeps its own local depth; neither truncates the other.
- **Email: the user lowers depth from 12 to 3 months** — fetching stops; existing mail stays.
- **Email: messages with no `Date` header** — must not orphan an index row on every refetch.
- **Email: an account errors mid-backfill** — that account shows the error; the others keep going.

## Acceptance criteria

- **AC1** — A Notion export dropped in **exactly as downloaded** (a zip containing `…-Part-N.zip`) imports its pages; the user never has to unzip anything by hand.
- **AC2** — Imported pages keep their **hierarchy** and a **stable sibling order** (both verified working today — this AC is a regression guard, not new work).
- **AC3** — Non-page entries (CSV, images, unknown types) are **skipped and reported with counts**, never silently dropped and never imported as empty notes.
- **AC4** — Re-running the same import **creates no duplicates**; a partially-failed import resumes cleanly.
- **AC5** — An import of ≥350 pages shows **determinate progress** and completes without truncation; the summary reports untitled/skipped counts.
- **AC6** — At connect time the user picks a history depth (**3 / 6 / 12 months / Everything**, default 12); the mailbox is usable before the backfill finishes.
- **AC7** — Mail **older than the previous 90-day limit** is synced up to the chosen depth, and is searchable locally.
- **AC8** — The depth is changeable **per account** afterwards; **increasing** it backfills only the gap, **decreasing** it never deletes already-synced mail.
- **AC9** — A backfill is **resumable** (survives quit/restart), **cancellable**, and shows determinate progress.
- **AC10** — A `uid_validity` change, a reconcile pass, or an IDLE delta **never deletes** mail inside the chosen depth window.
- **AC11** — With a 12-month, multi-account store (~30k+ envelopes), routine sync and list operations stay responsive — no full-table rescan per sync round.
- **AC12** — A failing account surfaces its own error and **does not** block other accounts' sync.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/notes/import.test.ts` · "unwraps a nested Notion Part-N zip" | AC1 | A zip whose only entry is another zip yields the inner zip's markdown, not zero notes. |
| `src/features/notes/import.test.ts` · "accepts multi-part exports" | AC1 | `Part-1` + `Part-2` dropped together produce one merged tree. |
| `src/features/notes/import.test.ts` · "strips the export wrapper folder" | AC2 | `Export-<uuid>/Private & Shared/Page.md` imports as a root page, not a child of two phantom notes. |
| `src/features/notes/import.test.ts` · "preserves hierarchy to 9 levels" | AC2 | A deeply nested fixture keeps every parent→child edge. |
| `src/features/notes/import.test.ts` · "assigns deterministic sibling positions" | AC2 | Imported siblings get ordered lexorank positions, not all `""`. |
| `src/features/notes/import.test.ts` · "classifies skipped entries by kind" | AC3 | CSV/image/unknown entries are counted per kind and never emitted as notes. |
| `src/features/notes/import.test.ts` · "is idempotent across two runs" | AC4 | Importing the same plan twice yields the same note count. |
| `e2e` / manual · "import the real 350-page export" | AC5 | The designer's actual export imports fully with visible progress. |
| `src-tauri` unit · `sync::tests::depth_window_from_choice` | AC6, AC7 | A depth choice maps to the right `SINCE` date and UID floor. |
| `src-tauri` unit · `sync::tests::backfill_resumes_from_floor` | AC9 | A cursor with a recorded floor resumes backwards instead of restarting. |
| `src-tauri` unit · `sync::tests::full_reset_preserves_in_window_history` | AC10 | A `uid_validity` change does not prune rows inside the configured depth. |
| `src-tauri` unit · `sync::tests::lowering_depth_never_deletes` | AC8 | Reducing depth stops fetching but removes nothing. |
| `src-tauri` unit · `storage::tests::envelope_order_key_stable_without_date` | AC10 | A date-less message refetched twice does not orphan a second index row. |
| `src-tauri` unit · `storage::tests::list_envelopes_uses_prefix_scan` | AC11 | Listing one folder does not deserialize the whole envelope table. |
| `src-tauri` unit · `storage::tests::accounts_v1_old_shape_still_loads` | AC8 | An account blob written before the depth field still deserializes (does not wipe accounts). |
| `src/features/email/…` unit · "per-account sync error isolation" | AC12 | One account in `error` leaves the others syncing. |
| Manual (desktop) · `docs/testing/<branch>.md` | AC6–AC12 | Real Gmail + IMAP round-trip: pick 12 months, watch backfill, quit mid-run, resume, cancel, change depth. |

## Assumptions & technical decisions

1. **Notes import stays a client-planned + server-applied flow** (the shipped `notes_op_import` shape): the client plans the tree and mints ids, the RPC applies rows with per-row exception isolation and id-exists idempotency. *Rejected:* a server-side zip parser (Postgres has no business unzipping).
2. **Nested-zip unwrapping is recursive but bounded** (depth ≤ 2, the observed Notion shape) to avoid a zip-bomb path. Files are matched by extension after unwrapping.
3. **Sibling order comes from the export's entry order**, converted to lexorank positions at plan time — Notion's zip has no explicit order field, and entry order is the closest thing to what the user saw. *Rejected:* alphabetical (reorders the user's manual arrangement).
4. **Email depth is a per-device, local setting** stored on `StoredEmailAccount` with `#[serde(default)]`. The redb store is per-machine, so two devices legitimately hold different depths. *Rejected:* the cloud `email_accounts` row / `user_preferences.email` — both would need new Rust↔cloud plumbing for a value that is inherently local. **Critical:** the account blob loader swallows deserialize errors into an empty list, so a non-defaulted new field would silently erase every connected account — hence the explicit round-trip test.
5. **Backfill is driven by `UID SEARCH SINCE <date>`, not a UID count.** The engine currently always fetches the newest 1000 UIDs and *then* discards anything older than 90 days client-side — paying full bandwidth for data it throws away. Deriving the range from the user's chosen date is both correct and cheaper. `uid_search` is already used elsewhere in the sync path; only `SINCE` is new.
6. **The cursor gains a depth floor** (oldest-synced UID / date). Today the cursor records only `last_seen_uid`, so nothing can walk backwards or know how far back the store reaches — this is why raising the limit alone would **not** backfill an existing account.
7. **The full-reset prune must be gated on the configured depth.** It currently deletes every local row outside the just-fetched UID set, so any backfilled history would be erased on the next `uid_validity` change. Depth is treated as a **floor** (a promise about what *is* synced), not a ceiling that evicts.
8. **Read-path performance is a prerequisite, not a nice-to-have.** Listing envelopes deserializes the entire table and is called ~3× per sync round; at 30k+ rows that is the scaling wall, so IM-2a lands before the depth increase that would expose it.
9. **SCALE-1 is a hard dependency of IM-1.** The 1000-row PostgREST cap silently breaks both dedupe and position computation at exactly the scale an importer creates.
10. **NOTE-FIX-1 is a hard dependency of IM-1.** Importing 350 pages that render blank on the next launch is worse than not importing them.
11. **No task importer, no calendar importer, no Spark importer** — see Scope. Recorded so `/s2` does not gold-plate.
12. **AMENDMENT (2026-07-30, IM-2c-a): AC9's progress transport is a cursor-backed status read, not Tauri events.** The spec asked for "Tauri progress events + cancel". Building IM-2c-a found the app has **zero** event emission anywhere in `src-tauri` and **zero** `listen()` on the frontend — it is entirely invoke/poll, so events are new infrastructure rather than a wiring job. More importantly they are the *wrong* transport here: the backfill is a resumable walk that survives quit/restart, and an event stream tells a freshly-launched app nothing. Its state already persists on the sync cursor (`oldest_synced_uid`, `history_floor_ms`, `backfill_complete`, `backfill_last_error` — all added by IM-2b), so a narrow status command reads the truth at any moment. ⚠️ **Do not reuse `email_get_mailbox_status`** for it: that command full-table scans and deserializes every envelope, which at a 12-month depth is the exact AC11 pattern IM-2a removed — polling it would be a live regression. Also: `Progress` already exists (IM-1 shipped it), so the block table's "introduces the app's first Progress primitive" is stale; and **cancel is ~90% delivered by AC8** — lowering the depth stops the walk (the smaller `SINCE` set leaves nothing below the frontier) and deletes nothing, so AC9's cancel shrinks to a labelled affordance for what the picker already does.

Durable decisions get a line in [`docs/decisions.md`](../docs/decisions.md).

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **IM-1 — Notion export hardening** | **Nested/multi-part zip unwrap** (the fatal one) + **non-markdown entries surfaced in the skipped summary**, plus untitled-count reporting, idempotent re-run and determinate progress. Hierarchy, ordering, hex-stripping and non-ASCII names are **already proven working** and only need regression tests. | AC1–AC5 | NOTE-FIX-1 ✓ · SCALE-1 *(soft — see note)* |
| 2 | **IM-2a — Email store read/write path** | Prefix-scan envelope reads (no full-table deserialize), batched per-chunk commits, stable order-index key for date-less messages. No user-visible change; unblocks depth. | AC10, AC11 | OPS-1 |
| 3 | **IM-2b — Backward backfill engine** | Depth floor on the sync cursor, `UID SEARCH SINCE`-derived ranges, resumable backwards walk, depth-gated prune, per-account error isolation. | AC7–AC10, AC12 | IM-2a |
| 4 | **IM-2c — Depth picker + progress UI** | Connect-time picker (3/6/12/Everything, default 12), per-account setting in Settings → Integrations, Tauri progress events, determinate progress + cancel. | AC6, AC8, AC9 | IM-2b |
| 5 | **IM-3 — (deferred) Task importer** | CSV/markdown-checklist task import via a new `tasks_op_import` RPC (the current write path is ~4 round-trips per task and does not register tasks in the spine). For alpha friends, not the designer. | — | SCALE-1 |
| 6 | **IM-4 — (deferred) "Leaving your old app" checklist** | A short pre-migration checklist surface: unsnooze Spark's `Later` folder, drain Send Later, copy signatures/templates, save Teams comments. Cheap, and the only thing that helps for genuinely unexportable data. | — | — |

**Dependency note:** SCALE-1 is a *soft* dependency for the designer's own import — 350 notes is comfortably under the 1000-row cap, so IM-1 can ship first if he wants to migrate sooner. It stays a hard dependency for a shipped importer facing arbitrary workspace sizes.

Sequence: **IM-1** (dogfood-critical, independent) ∥ **IM-2a → IM-2b → IM-2c**. IM-3/IM-4 are post-alpha.

## Out of scope

- **Calendar import of any kind.** 5 Google + 2 CalDAV accounts connect directly; no history wanted.
- **Morgen API connector** for its native tasks/tags — the designer is re-entering tasks by hand.
- **Notion databases**, properties, relations, rollups, views, comments — he has none worth importing.
- **The Notion API** (higher fidelity: views, comments, real relation ids). Only worth it for database-heavy users; revisit if alpha friends need it.
- **Notion images/attachments** — skipped and reported (15 in the sample export).
- **Making the JSON export re-importable** (round-tripping Moduo's own backup) — a real gap, but not on the cold-turkey path.
- **Email body backfill.** Depth governs *envelopes* (headers/subjects/search); bodies stay on-demand + LRU.
- **Paginating the 500-row envelope list.** Deeper sync improves threading and local search; scroll depth is a separate concern.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** filled and unambiguous.
- [x] **Every acceptance criterion has ≥1 test** with a plain-English note (table above).
- [x] **Open questions is empty** — all product forks resolved with the designer 2026-07-29 (E1 depth picker confirmed; E2 task importer deferred); technical unknowns researched via three recon agents + an empirical check against a real Notion export.
- [x] **Data model named** — no new tables. Local: a depth field on `StoredEmailAccount` (redb, `#[serde(default)]`) + a depth floor on the sync cursor. Cloud: unchanged. Notes ride the shipped `notes_op_import`.
- [x] **Module-feature contract:** N/A recorded — this is a migration path into existing modules, not a new module. No new MCP tools, no new dashboard widget; imported rows register in the spine via the existing `notes_op_import` → `entities_op_upsert` path.
- [x] **Execution blocks** decomposed, sequenced, context-sized, self-contained.
- [x] **Design constraints acknowledged:** tokens-only, shadcn primitives; the import progress UI is the app's first determinate progress surface, so it introduces a `Progress` primitive per `docs/DESIGN_RULES.md` R2/R10 rather than a one-off bar.
- [x] **Manual-test surfaces identified:** the real 350-page Notion import; a real Gmail + IMAP 12-month backfill incl. quit/resume/cancel/depth-change — for `docs/testing/<branch>.md`.

**Ready to execute.**

## Open questions

- [ ] **🔴 Does "history depth" mean INBOX only, or INBOX + archive?** Raised by IM-2b (2026-07-30), needs a product call before IM-2c prices the picker. The engine syncs **only** `inbox` — `folder` is hardcoded at every caller and `mailbox_candidates` maps `"inbox" => ["INBOX"]`. But the Scope above justifies the whole feature with a Spark user who **archives** and searches for "year-old invoices, order confirmations and game keys" — mail that lives in Archive / `[Gmail]/All Mail` and syncs at *no* depth. So a 12-month depth picker as specced would not cover the mail it was specced for. Options: (a) depth applies to INBOX + the provider's archive mailbox (roughly doubles sync cost, and for Gmail All Mail is a superset of INBOX); (b) depth is INBOX-only and the invoice case stays served by server-side search escalation (already shipped, `X-GM-RAW` over all folders — needs no local depth at all); (c) a per-folder depth. Until this is answered, **AC7 is unmet for the motivating data**.
- [ ] **🔴 What surface makes deep history reachable?** Also from IM-2b: envelopes now land in the store, but nothing can see them. The list is capped at **500 rows** (out of scope per the note above), instant search filters only the rows already loaded, and the Rust search scans only *cached body text* — which exists solely for messages already opened. So a 12-month backfill currently changes nothing a user can list, thread or search. The out-of-scope note above asserts "deeper sync improves threading and local search"; as built it does not. Either a paginated/scrolling list or a store-backed search query has to land for AC7's "searchable locally" to be true — decide whether that is a new block before IM-2c or part of it.
