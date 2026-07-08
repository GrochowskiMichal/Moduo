# Manual test checklist — Calendar CAL-7 (module DoD: MCP manifest + Today widget)

> Generated 2026-07-02 · branch `claude/trusting-shirley-e14fa6` · **Live-verified: the Today widget (dashboard render, strip line, Move-to-today, empty state — no widget errors).** The MCP manifest is unit-tested (registry). The connector (`moduo-mcp/modules/calendar.ts`) is a Deno edge function — **not** in `bun run verify` and no `deno` in this env, so it's syntax-verified by eye (mirrors `links.ts`/`contacts.ts`) and its round-trip is deploy-gated/manual. No web migration.

## Today dashboard widget (AC14)
- [ ] **Do:** on the Grid (dashboard `/`), unlock widgets and add **Today** from the panel → **Expect:** it mounts and shows today's remaining agenda (next-up chip emphasized with an arrow, times on the left), or a calm "Nothing left today" / "Nothing scheduled today" state. _(web / desktop)_
- [ ] **Do:** with an open task scheduled earlier today (elapsed) → **Expect:** a top line "· N unfinished from earlier" + an inline **Move to today**. _(both)_
- [ ] **Do:** click **Move to today** (during working hours 08–18 with a free gap) → **Expect:** the unfinished tasks reschedule into today's gaps; toast "Moved N to today" (or "No room left today." after hours / when full); the widget refreshes. _(both)_
- [ ] **Do:** click an agenda row → **Expect:** it deep-links — a task row opens `/tasks`, an event row opens `/calendar` (the `moduo:entity:open` host listener). _(both)_
- [ ] **Do:** with no runtime / a read error → **Expect:** the widget degrades to the quiet empty state, never a wall. _(both)_

## MCP manifest (AC14)
- [ ] **Do:** (unit) `bun run test -- src/lib/module-registry.test.ts` → **Expect:** the `calendar` manifest is registered with the write ops (create/update/delete_event, schedule_task, move_block, complete_block, roll_forward) and the read resources (list_events, day). _(verify)_
- [ ] **Do:** (post-deploy, desktop) grant an API key `calendar: edit`, list tools → **Expect:** `calendar_list_events`, `calendar_day` (view) + the 7 write tools appear; calls route to the right RPCs and log attributed `module_activity`. _(manual — deploy-gated Deno connector)_

## Attribution / activity (AC14 final walk)
- [ ] **Do:** open a native event's Detail (right panel) → **Expect:** the quiet activity trail renders (from CAL-2) + its EntityHub links. _(both)_
- [ ] **Do:** open an external event's Detail → **Expect:** source attribution + read-only + live Links/Activity. _(both)_

## Edge cases
- [ ] **Do:** deploy gap (calendar tables absent) → **Expect:** the Today widget still renders today's task blocks + strip (rides Tasks reads); events degrade to empty. _(both)_
- [ ] **Do:** DST week → **Expect:** the widget's "today" and the connector's `calendar_day` still frame the right day. _(both)_

## Migrations / data
- [ ] **Do:** confirm migration `20260702170000_module_permissions_api_keys` is applied (it was, 2026-07-02, via MCP) → **Expect:** `calendar/contacts/spine_module_permission` all carry the `module_api_key_id()` branch — **agent writes through calendar AND contacts AND spine ops now work with a scoped key** (they were all dead for keys before; reads were unaffected). _(prod — applied + schedule-from-null round-tripped)_
- [ ] **Do:** (post-connector-deploy) with a `calendar: edit` key, call `calendar_schedule_task` on an **unscheduled** task → **Expect:** the task actually gets scheduled (the op now schedules-from-NULL instead of a phantom-success no-op — round-tripped on prod with the hosted account). _(manual)_

## Known gaps / not-yet-testable
- **The Deno connector is deploy-gated + unverified locally** (no `deno` here; not in `bun run verify`) — same posture as the CT-7/CO-5 connectors. Its tool round-trip (reads compose the day; writes call the shipped RPCs) is a post-deploy manual check. `calendar_day` and `calendar_roll_forward` frame the day in **UTC** (an agent passes a `date`); the app's own day math is local — fine for an agent tool, noted. Roll-forward places sequentially after now (never in the past) but does not avoid meetings — weaker than the app's gap-finder, documented in the tool description.
- **The widget's Move-to-today uses DEFAULT working-hours (08–18)**, not the user's synced calendar prefs (the widget has no userId to read them) — the full-fidelity roll-forward with custom hours + one-Undo lives on the calendar page. The widget's version applies without an undo toast.
- **Wave 2 (Calendar) is complete** with CAL-7 — the full loop, native events, external mirror, focus timer, and the DoD (manifest + widget) all shipped.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
