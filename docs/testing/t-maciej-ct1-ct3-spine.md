# Manual test checklist — spine foundation (CT-1 + CT-2 + CT-3)

> **✅ Migration status (reconciled 2026-08-14 · DOC-1): APPLIED to prod.** The "Migration not applied to prod by this session … applying to prod is your deploy step" note below is stale — OPS-1 + OPS-2 (2026-07-29) applied and verified every migration file in the repo. **There is no deploy step left here; the rows are runnable now.** Status of record: [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md).

> Generated 2026-06-25 · branch `t/maciej/ct-1-link-substrate` · **Live-verified:** partial.
> CT-1's DB layer was fully exercised on **real Postgres 17** (the moduohyb prod DB) inside a **rolled-back transaction** — all 15 AC1–AC5 checks passed and prod was left byte-clean. CT-2/CT-3 pass `bun run verify` (typecheck + lint + 151 unit tests) and compile in the Storybook bundler; their *rendered* UI and *wired* drag couldn't be live-verified here (pre-existing Storybook `preview.tsx` load fault + no wired consumer yet — see Known gaps).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.
> Spec: [specs/connective-tissue.md](../../specs/connective-tissue.md).

## Migration / data (CT-1) — apply first
- [ ] **Do:** Apply `supabase/migrations/20260625120000_spine_entity_links.sql` to the moduohyb project (via your deploy pipeline or `supabase db push`). → **Expect:** `entities`, `entity_links`, `link_suggestion_declines` tables exist; functions `links_op_create/_set_kind/_delete`, `entities_op_upsert/_ensure/_tombstone`, `spine_module_permission`, `spine_pair_key`, `spine_op__guard` exist. _(prod DB)_
- [ ] **Do:** Run `get_advisors(security)` after applying. → **Expect:** no new "RLS disabled" findings on the 3 new tables (they have RLS + member-SELECT policies; writes are op-only by design — an advisor note about no INSERT/UPDATE/DELETE policy is expected and intentional). _(prod DB)_
- [ ] **Do:** Regenerate `src/types/supabase.ts` against the applied schema. → **Expect:** the 3 tables + new RPCs appear; `bun run typecheck` still green. _(local)_

## Spine link ops (CT-1) — already validated on real PG17 (rolled back), re-confirm post-apply
- [ ] **Do:** As an editor/owner, call `runtime.spine.createLink({ source:{type:'task',id}, target:{type:'note',id}, relationKind:'references', origin:'drag' })`. → **Expect:** one `entity_links` row, `created_by` = you, registry has both endpoints, one `module_activity` row (`module='links'`, `op='links.create'`). _(both)_
- [ ] **Do:** Call `createLink` again for the same pair, then again with source/target swapped. → **Expect:** still exactly one live link (idempotent + direction-agnostic). _(both)_
- [ ] **Do:** Attempt `createLink` with the same source and target entity. → **Expect:** rejected ("An entity cannot link to itself"). _(both)_
- [ ] **Do:** As a **view-only** member (workspace `permissions_tasks = 'read'`), attempt any link op. → **Expect:** rejected server-side ("You don't have edit access to links"). _(both)_
- [ ] **Do:** `tombstoneEntity` one endpoint, then `searchEntities`. → **Expect:** the tombstoned entity no longer appears in search; its link still resolves via `listLinks` (no dangling). _(both)_

## EntityHub roll-up (CT-2)
- [ ] **Do:** Open Storybook (`bun run storybook`) → `Spine/EntityHub` → **Populated**. → **Expect:** links grouped into fixed sections **Open work → Money → Conversations → Notes → Other**, each row = type icon + label + relation-kind meta, counts shown. _(Storybook — blocked, see Known gaps)_
- [ ] **Do:** View **Empty / Loading / Tombstone / ShowAll / ReadOnly / ErrorState / PageVariant** stories. → **Expect:** empty teaching state; skeleton rows (no layout shift); tombstoned row dimmed "Deleted [type]" + "Remove link"; long section collapses behind "Show all (N)"; read-only hides the row actions menu; error shows Retry; page variant is roomier. _(Storybook — blocked)_
- [ ] **Do:** When wired into a surface, open an entity's hub and use a row's "…" → **Change relation** / **Remove link**. → **Expect:** row re-groups / disappears optimistically; reconciled by `setLinkKind`/`deleteLink`. _(both — no wired consumer yet)_

## Drag-to-link (CT-3)
- [ ] **Do:** When a surface wires `useDragPayload`/`useDropLinkTarget`, drag one entity onto another that accepts its type. → **Expect:** a drop affordance on valid targets only; on drop a Sonner toast "Linked X → type · Kind" with **Undo** + an inline kind override; the persisted link has `origin='drag'`. _(both — no wired consumer yet)_
- [ ] **Do:** Click Undo in that toast; then try the kind override. → **Expect:** Undo removes the link and dismisses the toast only on success (errors keep the toast + report); kind override re-types the link. _(both — no wired consumer yet)_

## Edge cases
- [ ] **Do:** Link a not-yet-registered entity (drag carrying a stale label) onto a live one. → **Expect:** the endpoint is registered if absent, but a *stale* label never overwrites an existing authoritative label, and a tombstoned endpoint is never silently revived (validated on PG17). _(both)_
- [ ] **Do:** Two members create the same link concurrently (async multiplayer). → **Expect:** one live row (the partial unique index dedupes); the second create no-ops. _(both)_

## Known gaps / not-yet-testable
- **Storybook renders nothing in this worktree** — `Failed to fetch dynamically imported module: /.storybook/preview.tsx` (affects existing stories too, e.g. `components-tag-chip--default`; not introduced by this work). Visual-snapshot baselines for `tests/visual/spine.spec.ts` are therefore a deliberate human capture (`bunx playwright test --project=visual --update-snapshots`) once that's fixed.
- **No wired consumer yet** for the EntityHub or the drag contract — they're the reusable spine layer; the first live surface lands with CT-4 (@mention/ref) / CT-7 (Tasks adoption) / Contacts. CT-3's AC7 keyboard "Link to…" half also waits on CT-4's MentionPicker.
- **Migration not applied to prod by this session** — branching needs the Pro plan, so CT-1 was validated via a rolled-back prod transaction instead of a dev branch; applying to prod is your deploy step.
- **`bun run verify` does not cover the DB** — the spine SQL is proven by the rolled-back PG17 round-trip above, not by CI.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
