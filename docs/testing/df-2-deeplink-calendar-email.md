# DF-2 — Deep-link selection: Calendar + Email

Branch: `t/maciej/df-2-deeplink-calendar-email` · extends DF-1's `moduo:entity:open` route map + URL-held selection to Calendar (`?event=`) and Email (`?thread=` + a one-shot in-app event).

**What changed (one line):** clicking an event or email thread anywhere in the app (dashboard widget row, linked chip, notification) now lands on that exact event/thread instead of dead-ending on the calendar's current week / the unfiltered inbox.

Legend: **W** = web · **D** = desktop · **B** = both.

## Calendar (`?event=`)

- [ ] **Widget/chip deep-link jumps weeks** (W/B): with the calendar on a week that does *not* contain a given event, open that event from a dashboard "Today" widget row (or any linked event chip). → The grid navigates to the event's day (mini-month highlights it), the right panel opens on **Detail** showing that event, and the URL shows no leftover `?event=`. *(Live-verified on web 2026-07-11: Jul 6–12 → Jul 20–26, detail panel opened.)*
- [ ] **Cold URL load** (W/B): paste `…/calendar?event=<eventId>` into a fresh tab (signed in). → Same result — navigates to the event's day + opens its detail once the calendar finishes loading; the `?event=` param clears after. *(Live-verified on web 2026-07-11.)*
- [ ] **Stale / deleted event id** (W/B): open a calendar deep link whose event was deleted (or a bogus id). → A quiet "Couldn't find that event" toast; you stay on the calendar; no crash; the param clears. *(Live-verified on web 2026-07-11.)*
- [ ] **Selected occurrence is highlighted** (D, best-effort): after a deep link, the event's chip on the grid carries the selected treatment. *(Grid chips don't render in the preview tool — confirm visually on desktop.)*

## Email (`?thread=`)

- [ ] **Desktop: deep-link selects + scrolls the thread** (D — manual, not web-observable): from the dashboard email widget (a snoozed-due / follow-up row) or a linked-email chip, open a thread. → The email page selects that thread (reader opens), resets to **All inboxes** scope so it's visible, and scrolls its row into view. The `?thread=` param clears.
- [ ] **Desktop: thread not in the inbox** (D — manual): deep-link a thread that has been archived / isn't in the synced inbox. → Quiet "Couldn't find that email" toast; no crash.
- [ ] **Web: routes to the tissue card** (W): open `…/email?thread=<refId or threadId>` for a linked/snoozed/follow-up email. → The web read-only view scrolls that thread's tissue card into view and briefly rings it (~2s). *(Live-verified on web 2026-07-11 via a seeded ref + the one-shot event: card present, highlight applied then cleared.)*
- [ ] **Web: not among linked emails** (W): deep-link a thread that isn't in the web tissue sections (snoozed / follow-ups / recently-linked). → Quiet "Open Moduo on desktop to read this email" toast; no crash. *(Live-verified on web 2026-07-11.)*
- [ ] **One-shot in-app event** (B): a surface that dispatches `moduo:email:open-thread` `{ id }` while already on `/email` selects the thread without a router round-trip (same resolution as `?thread=`). *(The public seam for future callers — DF-23 mention/ref, etc. Live-verified on web 2026-07-11.)*

## Regression sweep (the shared DF-1 route map changed)

`src/lib/entity-open.ts`'s `EntityOpenTarget` now carries `intentId` and a generic `search`. Re-confirm the DF-1 paths still work:

- [ ] **Tasks deep-link** (B): open a task from the dashboard Tasks widget / a contact rollup / a note `/task` chip → lands selected on `/tasks`, refresh keeps it. *(DF-1 behavior — should be unchanged.)*
- [ ] **Contacts / company deep-link** (B): open a contact or company from a widget/chip → `/contacts?type&id` selects it. *(FX-1 behavior — unchanged.)*
- [ ] **Note deep-link** (B): open a note from a chip → `/notes?id` selects it. *(NO-3 behavior — unchanged.)*
- [ ] **Id-less "open my inbox"** (B): the email widget header "open" affordance still lands on the plain inbox (no `?thread=`).

## Known gaps / notes

- The **desktop email path** (select + scroll the real thread list) is inherently unverifiable on web (email is desktop-gated) — its resolution logic is unit-tested (`resolveEmailThreadTarget`), the wiring is typecheck-clean; the manual desktop pass above is the confirmation.
- **Test-data leftover:** live-verify seeded one email ref in the "Claude Test S2" workspace ("DF-2 email deep-link probe", thread_key `df2-probe-thread-001`) that could **not** be removed — the `email_op_ref_remove` RPC (migration `20260704190000_email_ref_remove.sql`) is **not deployed to prod**, and direct deletes are RLS-blocked. It shows as a harmless "Recently linked" card until that migration deploys. The probe calendar event was soft-deleted cleanly.
- Calendar occurrence-chip highlight for **recurring** events uses the series-start occurrence key; exotic recurrences may open the detail without a matching chip highlight (detail panel is the definitive selection).
