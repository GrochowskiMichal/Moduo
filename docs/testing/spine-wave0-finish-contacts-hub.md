# Manual test checklist — spine Wave 0 finish (CT-6, CT-7) + Contacts hub (CO-2)

> **✅ Migration status (reconciled 2026-08-14 · DOC-1): APPLIED to prod.** The "the two new migrations are unapplied here" note below is stale — OPS-1 + OPS-2 (2026-07-29) applied and verified every migration file in the repo. **The migration-gated rows are runnable now** — but this covers migrations only: any MCP `tools/list` row still waits on the `moduo-mcp` redeploy (`MCP-1`, still open). Status of record: [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md).

> Generated 2026-06-27 · branch `claude/quizzical-moser-dc04b6` · **Live-verified: no** — Storybook render + the Supabase project are both unreachable from this worktree (docs/gotchas.md), and the two new migrations are unapplied here. Everything below is first-discovery for the runner. The pure logic (suggest/recent/blocks-bridge/contact-rollup/module-registry — 40 new unit tests) is green via `bun run verify`.

## 0. Apply migrations first (everything else depends on this)
- [ ] **Do:** apply `supabase/migrations/20260627120000_spine_link_suggestions.sql` + `20260627130000_tasks_relations_to_links.sql` to the Moduo Supabase project, then regenerate `src/types/supabase.ts`. → **Expect:** both apply cleanly; `links_suggest` / `links_op_decline_suggestion` / the `tasks_relations_mirror_to_links` trigger exist; the backfill seeded a `blocks` `entity_links` row for every existing `task_relations` pair. _(both)_

## CT-6 — deterministic auto-suggest (mostly dark-shipped)
- [ ] **Do:** as an **editor**, call `links_suggest(workspace, 'contact', <contactId>)` for a contact whose email domain matches a company's `domains[]`. → **Expect:** the matching company comes back as a candidate; an already-linked or previously-declined pair does **not**. _(RPC / both)_
- [ ] **Do:** accept a suggestion (`links_op_create(..., origin => 'suggest')`), then re-run `links_suggest`. → **Expect:** the link persists with `origin='suggest'`; the pair no longer appears. _(RPC)_
- [ ] **Do:** `links_op_decline_suggestion(...)` a pair, then re-run `links_suggest`, then reload. → **Expect:** the pair never returns; declining again is a no-op (idempotent). _(RPC)_
- [ ] **Do:** as a **viewer** (no edit), call `links_suggest`. → **Expect:** it raises (edit-gated); the UI shows no strip. _(RPC)_

## CT-7 — Tasks adoption + MCP + dashboard widget
- [ ] **Do:** open Tasks, add a **blocker→blocked dependency** between two tasks; commit the blocked task. → **Expect:** blocked-by works exactly as before (offers the unblocked frontier + "Commit anyway") — **no regression**. _(both)_
- [ ] **Do:** after adding that dependency, inspect `entity_links`. → **Expect:** a live `relation_kind='blocks'` row (blocker→blocked) exists, both task entities are registered in `entities`. Removing the dependency tombstones that blocks edge. _(DB / both)_
- [ ] **Do:** open the Dashboard, unlock, drag in the **"Recently Linked"** widget. → **Expect:** it lists the workspace's most recent links newest-first ("source → target · kind"); a tombstoned end shows "Deleted [type]". _(web)_
- [ ] **Do:** click a row's endpoint in the widget. → **Expect:** it dispatches `moduo:entity:open` — **but nothing navigates yet** (no host listener; see Known gaps). _(web)_
- [ ] **Do:** with a `links`-scoped MCP key, call `tools/list` on `moduo-mcp`. → **Expect:** `links_search_entities` / `links_list` / `links_suggest` (view) + `links_create` / `links_set_kind` / `links_delete` / `comments_add` (edit) appear; a round-trip `links_create` works. _(MCP)_

## CO-2 — Contacts directory + ContactHub ("the great moment")
- [ ] **Do:** visit `/crm`. → **Expect:** redirects to `/contacts` (CO-1). _(both)_
- [ ] **Do:** open `/contacts`. → **Expect:** the directory rail lists **people and companies**; the People/Companies/All segmented filter + search narrow the list; densities read tight. _(both)_
- [ ] **Do:** select a contact. → **Expect:** the center hub shows an editable header (name + status), a quiet **"Last touch: … · N open tasks"** line, the roll-up **grouped by section** (Open work / Money / Conversations / Notes / Other) with inline snippets, and the activity trail. **There is NO "log activity" button anywhere.** _(both)_
- [ ] **Do:** change the contact's **status** in the header. → **Expect:** it persists (re-reads); status renders as a **colored dot + label** (never color alone); a forced failure shows a toast. _(both)_
- [ ] **Do:** rename the contact in the header (edit + blur/Enter). → **Expect:** the 2xl title field is full-height (not clamped to a control rung — the S1 fix), the name persists, the directory row updates. _(both)_
- [ ] **Do:** change a contact's status, then look at the last-touch line. → **Expect:** it reads e.g. "Last touch: set status just now" — **not** "No activity yet" (the B1 fix: a contact's activity trail now reads `module='contacts'`, not the old tasks-pinned query). _(both)_
- [ ] **Do:** from a contact's hub, use the link row "…" menu to change a relation kind or remove a link. → **Expect:** the roll-up re-groups / the row disappears; a toast on failure. _(both)_
- [ ] **Do:** select a **company** in the directory. → **Expect:** a minimal company hub (name + roll-up + activity). The People-union group + right context strip are CO-4 (not present yet). _(both)_

## Edge cases
- [ ] **Empty:** a workspace with no contacts → directory + hub show quiet teaching empty-states, no fake rows. _(both)_
- [ ] **Empty roll-up:** a brand-new contact with no links → the spine "Nothing linked yet" teaching state, last-touch reads "No activity yet" only if truly untouched. _(both)_
- [ ] **Permission-denied:** a viewer (Tasks lane = view) → contacts render read-only; header fields + link gestures disabled; ops fail server-side regardless. _(both)_
- [ ] **Tombstone:** delete an entity linked to a contact → its roll-up row dims to "Deleted [type]" with "Remove link", never a broken link. _(both)_
- [ ] **Deploy gap:** before the migrations apply, the new RPC reads degrade quietly (suggest strip absent; recent-links widget empty) — no wall. _(both)_

## Migrations / data
- [ ] **Do:** confirm the `tasks_relations_mirror_to_links` trigger fires on a fresh dependency (not just the backfill). → **Expect:** a new `task_relations` insert immediately produces the mirrored `blocks` edge in the same transaction. _(DB)_
- [ ] **Do:** confirm adding a dependency does **not** create a new `module_activity` row (the mirror logs none, by design). → **Expect:** the blocked-by trail is unchanged from before. _(DB)_

## Known gaps / not-yet-testable
- **`moduo:entity:open` has no host listener** — the dashboard widget (and CT-4's EntityRefChip) dispatch the right deep-link event but nothing routes it to a hub yet. Clicking is currently inert (recorded in docs/gotchas.md; a shared app-shell follow-up).
- **CT-6's `LinkSuggestionStrip` is dark-shipped** — the component + RPC exist and are unit/RPC-testable, but it's mounted on no live surface; it lands above the hub when CO-4 wires the right context strip.
- **Tasks aren't searchable/@mention-able yet unless in a dependency** — CT-7 registers a task into `entities` only via the dependency trigger; full per-task registry adoption is a follow-up.
- **Last-touch is an on-the-fly approximation** — it does not reflect later edits to *linked* entities (only the contact's own activity + link-creation times); a materialized view is deferred (decisions.md CO-2 (b)).
- **No live-verify in this worktree** — Storybook render is broken and the Supabase project is unreachable here, so all visual snapshots + server round-trips are first-discovery for the runner.
