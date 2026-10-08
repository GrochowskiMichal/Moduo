# Spec: Attachments (platform + Tasks surfaces)

> Status: **Draft — awaiting designer approval** (AT-1 can start now; no open questions) · Owner: maciej · Source: [`.design/tasks-dogfood/REVIEW.md`](../.design/tasks-dogfood/REVIEW.md) T11 + rounds 3/3b (attachments-only, doubled limits, error handling) · Comp: [`ui-proposal.html`](../.design/tasks-dogfood/ui-proposal.html) §5/§6 · First consumer: [`tasks-v2.md`](./tasks-v2.md) · Reuse later: Notes, comments, Chat

## Scope

People need to put screenshots and files on tasks. **Attachments only — no inline images in task descriptions** (decided 2026-10-07; inline images belong in Notes).

This delivers:
- private, per-workspace storage with per-plan limits;
- a resilient upload pipeline (previews, HEIC, retries, pending uploads that survive restarts);
- calm error handling at the limits;
- a Storage settings section;
- the attachment UI on tasks;
- the paperclip mark on every task surface.

The storage layer is polymorphic (`entity_type`), so Notes, comments and Chat can reuse it later.

**Landing rule:** `maciej` only — no pushes or merges to `develop` until Maciej says so (2026-10-07).

## Product behavior & UX

- **Adding files.** Paste or drop **anywhere on a task** and the file becomes an attachment:
  - the detail panel, including its description editor;
  - the capture modal;
  - a list row or board card (incl. files dragged from macOS Finder);
  - the panel's "+" tile / file picker.
- **Where they show.**
  - **Detail panel:** a thumbnail strip right under the description. Images get thumbnails; other files get a type-icon tile with name + size.
  - **Viewer:** click a thumbnail for full size, ←/→ between attachments, Download, Copy (images), Delete.
- **The mark.** Every task surface shows a quiet **📎 N** (12 px paperclip + count, muted, hidden at 0, same slot in the quiet-counts group):
  - list row
  - board card
  - timeline bar (wide bars; tooltip on narrow ones)
  - Queue / Up next / In flight
  - Calendar task block
  - Home widget row
  - task line in a note
  - ⌘K result
  - capture chip

  Rows and cards never show thumbnails.
- **Limits** (decided, per **workspace owner's plan**, pooled across every workspace that owner has):

  | Plan | Per file | Storage |
  | --- | --- | --- |
  | Free | 20 MB | 2 GB |
  | Pro | 200 MB | 50 GB |
  | Duo | 200 MB | 100 GB |
  | Team | 500 MB | 50 GB × paid seats |

  - Founder accounts get Team limits with a 1 TB pool.
  - Pooling is per owner, not per workspace — Pro allows unlimited workspaces, so per-workspace limits would multiply.
- **Images are prepared at upload; nothing is lost.**
  - The **original is kept** (screenshots stay pixel-exact).
  - Images longer than **4096 px** on the long edge are scaled down.
  - Phone photos have location/camera data removed (with the orientation applied).
  - **HEIC becomes JPEG** wherever the app can read it (the desktop app and Safari), so everyone can open it. Elsewhere the original is kept as a file without a preview.
  - A small **preview** is made at upload for thumbnails; the original loads only in the viewer.
- **Upload errors** — mirrors, not walls. Facts with numbers and one way forward, never red, never a blocking dialog:
  1. **Too big for the plan.**
     - Checked before uploading.
     - The tile says "recording.mov is 340 MB — your plan allows 200 MB per file". The owner also gets an **Upgrade** link when a higher plan allows it.
     - Images over the limit are scaled down instead of rejected.
     - A multi-file drop attaches what fits and lists the rest in one line.
  2. **Approaching the pool limit.**
     - At **80%** the owner gets one quiet notification and the Storage meter gains emphasis.
     - At **95%** uploaders see "Storage almost full — 47.6 of 50 GB" as their tile's caption (no popup) and the owner gets one more notification.
     - Each level fires once, re-arming after usage drops below 75%.
  3. **Pool full.**
     - New uploads stop. Everything else works — files open/download, tasks stay editable, nothing is deleted.
     - The tile says "Not attached — storage is full (50 / 50 GB)" with **Free up space** (opens the largest-files list) and, for the owner, **Upgrade**.
  4. **Capture never loses the dump.**
     - If an upload can't happen (full, too big, offline), the task is still created.
     - The file waits as "not attached · **Retry**" and attaches by itself when it can, surviving app restarts.
  5. **Downgrade while over the limit.** Nothing is deleted; uploads pause until usage is back under it. The owner sees a banner in Storage settings.
  6. **Network failure.** Automatic retry with backoff; a failed tile offers **Retry**.
- **Deleting.**
  - Deleting an attachment, or the task that holds it, **frees its space immediately**.
  - Files stay restorable for **30 days** (Undo toast, or Tasks' Recently deleted), then are purged.
  - **Undo always works**, even if it pushes the pool over the limit. Then the pool is simply "over limit": uploads pause until space is freed. Getting your work back is never blocked.
  - A task restored after its files were purged shows "File removed after 30 days" tiles (name + size kept).
- **Settings → Storage** (Workspace group):
  - a meter for the owner's pool ("1.2 of 50 GB · shared across 2 workspaces you own");
  - the **largest files** in this workspace (name · task · size · who · when), each with Delete;
  - the owner also sees the over-limit banner.

  Everyone in the workspace can open it; deleting needs edit access to the task.
- **Privacy.** Files are private to the workspace and follow the task's sharing (PERM per-item rules). Links expire (signed URLs).

## Edge cases

- **Shared, then unshared.** A task is shared with you and you upload, then the sharing is revoked: the file stays with the task; you lose access.
- **Workspace ownership transfer** → usage moves to the new owner's pool. If that pushes it over the limit, the pool is "over limit" (nothing deleted).
- **Two uploads race past the limit** → allowed as a small soft overage. The next upload is refused.
- **Declared size ≠ uploaded size** (tampered client) → finalize fails; the object is removed.
- **Upload abandoned mid-way** → the pending row and partial object are swept after 24 h.
- **Same file dropped twice** → two attachments (no dedupe in v1).
- **HEIC:**
  - Desktop app and Safari decode it natively → converted.
  - Chrome/Firefox/Edge on web → the original is kept and shows as a file tile without a preview (no in-browser decoder for now; open question 1).
- **Transparent PNGs** → the preview stays PNG (no black/white matte).
- **Very large non-images** (zip, video) → a file tile; no preview in v1.
- **Offline desktop app restart with pending uploads** → resumes after sign-in restores the session.
- **"Reset local cache" with pending uploads** → blocked with a count, like the notes outbox guard.
- **Account deletion:**
  - files in workspaces the person owned are deleted with those workspaces;
  - files they uploaded into other people's workspaces stay (workspace content) with the uploader cleared.
- **Workspace deletion** → all its attachments are removed from storage.
- **View-only member** → can open and download; no add/delete.

## Acceptance criteria

**AT-1 — Storage, limits, trash (start now)**
- **AT1-1** — Files land in private storage. Only people who can see the task can open them, through expiring links.
- **AT1-2** — An upload over the per-file limit, or past the pool, is refused before bytes are stored. A tampered size is caught at finalize.
- **AT1-3** — Usage is pooled per owner with the plan table above (Team = 50 GB × seats; founder = Team + 1 TB) and moves with ownership transfers.
- **AT1-4** — Deleting a file or its task frees the space immediately. Undo/restore within 30 days brings it back even over the limit. After 30 days it's purged from storage.
- **AT1-5** — Crossing 80% and 95% notifies the owner once per level (re-armed below 75%).
- **AT1-6** — Abandoned uploads are cleaned up after 24 h. Workspace/account deletion removes the right files.
- **AT1-7** — MCP agents can list a task's attachments and get short-lived links (key scope ∩ creator access).
- **AT1-8** — The export bundle includes an attachments manifest.

**AT-2 — Upload pipeline + panel**
- **AT2-1** — Paste/drop into the detail panel or description, or "+", uploads with visible progress. Big files resume after interruptions.
- **AT2-2** — The panel shows the strip under the description and the viewer (←/→, Download, Copy, Delete).
- **AT2-3** — Images get previews. Originals stay pixel-exact except: >4096 px is scaled; photo EXIF/GPS is stripped with orientation applied; HEIC becomes JPEG where the browser can decode it (desktop + Safari); elsewhere the original is kept with a file tile.
- **AT2-4** — Every error state shows its message and action (too big · almost full · full · failed · offline).
- **AT2-5** — Files dragged from Finder reach the app on desktop (`dragDropEnabled: false`). The Notes/Contacts import drop zones work on desktop again.
- **AT2-6** — Pending uploads survive restarts and retry by themselves. "Reset local cache" counts them.

**AT-3 — Everywhere + Storage settings**
- **AT3-1** — Dropping files on a list row/board card (web + desktop) attaches to that task, with a hover highlight on the target.
- **AT3-2** — A screenshot pasted into capture becomes a chip. The task is always created; the chip retries until attached.
- **AT3-3** — The 📎 mark appears on all listed surfaces, hidden at 0.
- **AT3-4** — Settings → Storage shows the pool meter, largest files (Delete) and the over-limit banner. The 80/95% notifications deep-link there.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| SQL · storage policies round-trip | AT1-1 | Upload only via a matching pending row by its uploader; read only with task view access; `storage.objects.name` qualified (gotcha). |
| SQL · `attachments_op_begin` limits | AT1-2, AT1-3 | Per-file + pool checks per tier/seat/founder; the pool spans the owner's workspaces. |
| SQL · `attachments_op_finalize` size check | AT1-2 | A size mismatch or over-limit object → failed + flagged for removal. |
| SQL · ownership transfer recompute | AT1-3 | The pool moves to the new owner. |
| SQL · delete/restore/batch with task | AT1-4 | Space freed on delete; restore re-adds even over the limit; a task restore brings back its batch. |
| `supabase/functions/purge-deleted` test (Deno) | AT1-4, AT1-6 | 30-day purge + 24 h pending sweep delete objects via the Storage API, then rows. |
| SQL · alert levels | AT1-5 | One activity row at 80 and at 95; none repeated; re-armed under 75%. |
| account-erasure tests (Rstest) | AT1-6 | Owned-workspace files removed; others' workspace files kept with uploader cleared. |
| MCP tool test · `tasks_attachments_list` | AT1-7 | Lists names/sizes + 5-min signed links; respects scope. |
| `src/features/settings/advanced.test.ts` · manifest | AT1-8 | The export includes an attachments manifest. |
| `src/lib/uploads/pipeline.test.ts` | AT2-1, AT2-3 | Resize rules, EXIF/orientation handling, preview format choice (WebP if encodable, PNG if alpha, else JPEG), HEIC branch. |
| `src/lib/uploads/queue.test.ts` | AT2-1, AT2-6 | Pending queue persistence, backoff, resume after auth, poison handling, the reset-cache count. |
| `src/lib/uploads/errors.test.ts` | AT2-4 | Each failure maps to the right copy + actions (owner vs member). |
| visual `tests/visual/attachments.spec.ts` | AT2-2, AT2-4 | Strip, viewer, every tile state. |
| manual desktop · Finder drag + import zones | AT2-5 | Finder file → panel/row; Notes and Contacts import drop zones work. |
| `src/features/tasks/ui/row-drop.test.ts` | AT3-1 | Hit-testing the row/card under the pointer; target highlight. |
| `src/features/tasks/capture.test.ts` · paste | AT3-2 | Task created first; the attachment queued; the chip states. |
| `src/features/tasks/row-layout.test.ts` · 📎 | AT3-3 | The count slot on rows/cards/queue; hidden at 0. |
| `src/features/settings/sections/storage-section.test.tsx` | AT3-4 | Meter math, list, delete permission, banner, the deep link target. |

## Assumptions & technical decisions

1. **Bucket** `attachments`: `public = false`, `type = 'STANDARD'` (NOT NULL on hosted). Bucket `file_size_limit = 500 MB` (the highest plan cap); per-plan caps are enforced by ops.
   - Object paths: `{workspace_id}/{attachment_id}/original.{ext}` and `…/preview.{jpg|png|webp}`.
   - **AT-1 must confirm the hosted project's global upload limit is ≥ 500 MB** (raise it in the dashboard if not; Maciej/Mike).
2. **Table** `attachments(id, workspace_id, entity_type, entity_id, uploader_id null, file_name, mime, size_bytes, preview_path null, preview_mime null, width null, height null, status pending|ready|failed, deleted_at null, deleted_reason user|task|bucket null, deleted_batch_id null, created_at, updated_at)`.
   - Visibility via `can_access(entity_type, entity_id, 'view')` (develop's PERM sharing).
   - **All writes through SECURITY DEFINER ops that return the row.** This avoids the insert-then-read-back RLS trap noted in the PERM hotfix.
3. **Upload protocol** (no new edge function for URLs):
   1. `attachments_op_begin(…)` checks access, the per-file limit and the pool (used + pending + size), creates a `pending` row and returns paths.
   2. The client uploads directly; the storage INSERT policy requires a matching pending row whose uploader is `auth.uid()`. Files >6 MB use TUS resumable uploads via `tus-js-client` (Supabase's documented path; new dependency); smaller ones use a standard upload.
   3. `attachments_op_finalize(id)` reads `storage.objects.metadata->>'size'`, validates, flips to `ready`, updates the ledger and emits alerts.

   *Rejected: one bucket per tier — it can't express pooled quotas and complicates paths.*
4. **Pool ledger** `storage_usage(owner_id pk, bytes_used, last_alert_level, updated_at)`. It's maintained by triggers on attachment status/deleted changes, keyed by the workspace's owner, and recomputed on `workspaces.owner_id` change.
   - `storage_limits_for_owner(owner)` derives per-file/total from `plan_tier_rank(profile_plan_tier_text(owner))` and `workspace_seat_cap(owner)` (team only; founder special-cased).
   - `storage_status(workspace_id)` feeds the client's pre-checks and the meter.
5. **Alerts** — `module_activity` rows `attachments.storage_80` / `attachments.storage_95` with `notify_user_ids = [owner]`, written inside the finalize op (an actor context exists there; cron can't write activity).
   - Mapped in `preferences.ts` (so the mute toggle works), with copy in `spine/activity.ts` and a deep link to `/settings?section=storage`.
   - **Not OS notifications** (unreliable on desktop).
6. **Trash** — soft delete with `deleted_reason` + `deleted_batch_id`.
   - A trigger on `tasks.deleted_at` / `buckets.deleted_at` stamps the batch on their attachments; clearing it (restore) restores the same batch.
   - Restores skip quota checks.
   - The daily `purge-deleted` Edge Function (service role; Storage API deletes, never SQL deletes — the 2026-03 delete guard) purges attachments, tasks and buckets deleted >30 days ago, and sweeps pending uploads >24 h. It's shared with tasks-v2 TV-U6.
7. **Client pipeline** (`src/lib/uploads/`, shared):
   - **Decode:** `createImageBitmap`, or `<img>` for HEIC on WebKit.
   - **Scale:** to 4096 px for originals; 1280 px for previews.
   - **Encode:**
     - previews → WebP only where `toBlob('image/webp')` really returns WebP (Chromium; Safari/WKWebView silently return PNG);
     - otherwise PNG when the image has alpha, else JPEG q0.8.
   - **Originals:** kept byte-exact unless scaled, EXIF-carrying JPEG (re-encoded q0.92 with orientation applied), or HEIC (→ JPEG q0.9).
   - **HEIC the browser can't decode** (Chrome/Firefox/Edge on web) → keep the original, no preview, file tile. Detect by attempting the decode, never by user agent. `heic-to` (libheif WebAssembly, LGPL-3.0) stays the known upgrade path if this proves annoying; not now.
8. **Pending queue** = IndexedDB `moduo-uploads` (blob + meta + attempts + `next_retry_at`).
   - Reuses the notes `meta-outbox` replay helpers (network vs poison).
   - Wakes on `online` / `visibilitychange` / boot after auth.
   - `navigator.storage.persist()` is requested when the first upload is pending (web).
   - Joins the "Reset local cache" guard (`countPending…`).
9. **Desktop drops** — `"dragDropEnabled": false` on the main window. HTML5 drops then deliver `File` objects on desktop, the same as web, and the dead Notes/Contacts import drop zones come back. Paths aren't needed because bytes are queued in IndexedDB. *Rejected: native `onDragDropEvent` with path copying into `app_data_dir` — a second code path and the app's first Tauri event subscription.*
10. **Lexical** — the description editor registers a `DRAG_DROP_PASTE` handler that hands files to the attachments service (no image nodes; attachments-only).
11. **Signed URLs** — previews 1 h, originals 10 min (viewer/download), MCP 5 min. Long `Cache-Control` on immutable objects.
12. **MCP** — `tasks_attachments_list(task_id)` (read-only), args in `_shared/contracts/mcp-tool-args.ts`, docs updated.
13. **Live counts** — the `attachments` table joins the Realtime publication (tasks-v2 #10) so 📎 counts update live.

## Execution blocks

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **AT-1** Storage, limits, trash *(start now)* | bucket + policies, `attachments` + ops (begin/finalize/delete/restore), ledger + limits + status RPC, alerts, trash triggers, `purge-deleted` function (+ pending sweep), erasure/workspace-delete hooks, MCP list tool, export manifest; hosted upload-limit check | AT1-1–8 | — |
| 2 | **AT-2** Upload pipeline + panel | `src/lib/uploads` (pipeline, TUS, queue, errors), `dragDropEnabled:false`, Lexical paste/drop handler, panel strip + viewer + tile states | AT2-1–6 | AT-1, TV-U3 |
| 3 | **AT-3** Everywhere + Storage settings | row/card drop targets, capture paste chip, 📎 mark on every surface, Settings → Storage | AT3-1–4 | AT-2, TV-U1, TV-U7 |

## Out of scope

- Inline images in task descriptions.
- Attachments on comments.
- Board cover images.
- Video posters / PDF previews.
- Dedupe.
- Virus scanning.
- Notes/Chat adoption (later; the schema is ready).

---

## Definition-of-Ready gate

- [x] Scope, behavior, edge cases, ACs filled.
- [x] Every AC has a test with a plain-English note.
- [x] Open questions empty.
- [x] Data model named, Supabase-first: `attachments`, `storage_usage`, bucket `attachments`, functions, `purge-deleted`.
- [x] Spine wiring:
  - attach = this;
  - activity/notifications (alerts);
  - MCP tool;
  - dashboard: n/a beyond the 📎 mark in widget rows.
- [x] Blocks sequenced and context-sized.
- [x] Design constraints: tiles/strip/viewer on DS tokens and primitives; R6 fades; no red.
- [x] Manual-test surfaces: desktop Finder drops, the HEIC path, offline restart with pending uploads, limits per plan (test accounts per tier), purge dry run.

**Ready to execute:** AT-1 now; AT-2 and AT-3 follow their dependencies.

## Open questions

- [x] **1 · HEIC from Chrome/Firefox/Edge on the web** — convert in the browser with `heic-to`? → **Decided 2026-10-08: not for now.** Those browsers keep the original and show a file tile without a preview; the desktop app and Safari convert natively. `heic-to` is the upgrade path if it proves annoying.
