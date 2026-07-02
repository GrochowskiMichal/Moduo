# Manual test checklist — CAL-2: Native events end-to-end

> Generated 2026-07-02 · branch `t/maciej/cal-2-native-events` · **Live-verified:** partial — every grid interaction verified on the web preview with stubbed RPCs; **the migration is deploy-ready but UNAPPLIED** (Supabase MCP is on the wrong org), so everything marked **[post-deploy]** needs the migration applied first.
> Run top-to-bottom; check off as you go.

## ⚠ Deploy steps (do these first, in order)

- [ ] **Pre-check:** run `SELECT count(*) FROM calendar_events WHERE workspace_id IS NULL;` on prod. These legacy exploratory rows become **invisible** after the migration (throwaway by our read; if the count looks like real data someone cares about, stop and decide before applying).
- [ ] **Apply** `supabase/migrations/20260702130000_calendar_module.sql` to the Moduo project.
- [ ] **Regenerate** `src/types/supabase.ts` afterwards.
- [ ] Smoke: `SELECT calendar_module_permission('<workspace-uuid>');` as an authed member → `edit`/`admin`.

## Draw-to-create (AC3) — verified live pre-deploy; re-run post-deploy for persistence

- [ ] **Do:** Click-drag vertically on empty grid → **Expect:** a ghost follows, snapping to 15 min (hold ⌥ → 5 min); release → inline title input inside the chip + a popover (time range, All day, calendar "Moduo", Repeat) _(web)_
- [ ] **Do:** Plain click (no drag) on empty grid → **Expect:** a 30-minute ghost _(web)_
- [ ] **Do:** Type a title, Enter → **Expect [post-deploy]:** the event saves, chip turns the primary tint, survives reload, and is visible to another workspace member after their refresh _(both)_
- [ ] **Do:** Type a title, press **Esc** → **Expect:** ghost discards, NO event is created (this was a validator-caught bug — re-check it) _(web)_
- [ ] **Do:** Click away with an empty title → **Expect:** discards (no untitled litter); with a typed title → saves _(web)_
- [ ] **Do:** Edit the popover's time inputs → **Expect:** the ghost chip moves to match before you save _(web)_

## Repeats (AC5)

- [ ] **Do:** In the popover, Repeat → preset "Weekly" → save → **Expect [post-deploy]:** the chip appears on that weekday in every visible week; a small repeat glyph shows on the chip _(both)_
- [ ] **Do:** Repeat → Custom → type **"every tuesday and thursday at 9"** → **Expect:** live echo "→ weekly on Tue & Thu · 9:00 AM"; the ghost jumps to 9:00; Set + Enter saves; the event renders Tue+Thu at 9:00 _(web)_
- [ ] **Do:** Custom → type garbage ("whenever I feel like it") → **Expect:** "Couldn't read that — try 'every tuesday at 9' or pick a preset."; Set disabled; nothing saves _(web)_
- [ ] **Do:** Try "every other friday" and "first monday of the month" → **Expect:** correct echoes; correct expansion _(web)_

## Edit, move, delete (AC4)

- [ ] **Do:** Drag an event chip's body → **Expect:** live preview with time readout, snaps 15 min, drops on the new slot (works across days); optimistic <200ms _(web)_
- [ ] **Do:** Drag the top/bottom 6px edge → **Expect:** duration resize, min 15 min _(web)_
- [ ] **Do:** Wheel-scroll the grid mid-drag → **Expect:** the drop lands where the preview shows (not offset by the scroll) _(web)_
- [ ] **Do:** Single-click a chip → **Expect:** quick popover (title · day/time · repeat summary · "Moduo" · Open · Delete) _(web)_
- [ ] **Do:** Open → **Expect:** right-panel Detail: title (inline edit), Starts/Ends (edits commit on blur/Enter — typing a year digit does NOT fire a save), All day, Repeats ("Edits apply to the whole series." under a repeating rule), Notes, **Links** (EntityHub — attach a contact/task), **Activity** trail with attributed rows, Delete _(web)_
- [ ] **Do:** Delete a repeating event (popover, Detail, or select chip + Delete key) → **Expect:** "Delete this repeating event? All occurrences go with it." → confirm → all occurrences vanish _(web)_
- [ ] **Do [post-deploy]:** Check the event's Activity after create/edit/delete → **Expect:** attributed `calendar.event_*` rows (who + when), and the event is @-mention/linkable (registered in `entities`) _(both)_

## States & degradation (AC13 half)

- [ ] **Do:** BEFORE applying the migration, open `/calendar` → **Expect:** page renders as the task-lens calendar; drawing an event shows the ghost, saving rolls back with an honest error toast; nothing blanks _(web)_
- [ ] **Do:** As view-only member → **Expect:** no draw, no drag, chips still clickable read-only _(both)_

## Mirror plumbing (lands with CAL-6, op shipped now)

- Nothing user-facing yet. Post-deploy sanity if curious: `calendar_op_mirror_events` exists, is owner-scoped, returns `{upserted, removed, skipped}`.

## Known gaps / not-yet-testable

- **All server round-trips are deploy-gated** (migration unapplied from this environment) — the ops are syntax-checked (pgsql-parser) and pattern-mirrored from contacts, but RLS/guards/registry/activity are unproven until a live round-trip. That's the standard CT-5/CO-1 posture.
- External (mirrored) chips + attribution untestable until CAL-6 connects an account.
- Provider all-day events arriving as UTC midnights will spill one extra day east of UTC — CAL-6's mirror mapper must normalize provider all-day values to local dates (recorded in events.ts).
- The event popover's anchor doesn't follow a scroll while open (closes on outside click anyway) — cosmetic.
- Desktop (Tauri) untested; the new namespace is cloud-delegated so behavior should match web.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
