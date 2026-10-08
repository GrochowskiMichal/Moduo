# Manual test checklist — calendar: workspace switch leak + edits/deletes that never saved

> Generated 2026-10-08 · branch `t/maciej/calendar-switch-leak` · **Live-verified:** no. The hook tests cover every case below; nobody has clicked through them yet (see Known gaps).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.
> You need two workspaces you can edit, each with a few native (Moduo) events. A slow network makes the switch cases easy to hit: browser devtools → Network → "Slow 3G" on web.

## Edits and deletes reach the server
- [ ] **Do:** open a native event, delete it from the confirm dialog, then reload the page → **Expect:** it stays gone after the reload. Before this fix it came back. _(both)_
- [ ] **Do:** delete another event, click **Undo** in the toast, then reload → **Expect:** the event is back, and still there after the reload. _(both)_
- [ ] **Do:** drag an event to a new time, then reload → **Expect:** it stays at the new time. _(both)_
- [ ] **Do:** rename an event in its detail panel, then reload → **Expect:** the new title is kept. _(both)_
- [ ] **Do:** go offline (devtools → Network → Offline), rename an event, go back online → **Expect:** "Couldn't update the event." and the old title comes back. _(web)_

## Workspace switch shows only the current workspace
- [ ] **Do:** open Calendar in workspace A, then switch to workspace B → **Expect:** none of A's events, calendars in the left rail or "showing N of M" notice appear, not even for a moment; B's events load in. _(both)_
- [ ] **Do:** on Slow 3G, create an event in A and switch to B straight away → **Expect:** B never shows it, neither as a pending row nor after it saves. Switch back to A → **Expect:** the event is there, once. _(web)_
- [ ] **Do:** delete an event in A, switch to B, click **Undo** in the toast → **Expect:** B's list doesn't change. Switch back to A → **Expect:** the event is restored. _(both)_
- [ ] **Do:** click the refresh button by the sync label in A, switch to B while it spins → **Expect:** B shows only B's events and calendars once it settles. _(desktop, or web with a Google calendar connected)_

## Same-workspace behaviour that must not change
- [ ] **Do:** on Slow 3G, create an event and immediately jump several months ahead and back → **Expect:** the event stays visible the whole time and ends up there exactly once. _(web)_
- [ ] **Do:** open a link to an event in the workspace you're already in (a widget row or a notification) → **Expect:** it opens that event's day and detail. _(both)_

## Edge cases
- [ ] **Do:** have an admin remove your Tasks access in a workspace while you have its Calendar open → **Expect:** the list empties and any "showing N of M" notice disappears; nothing reappears when a save you started earlier finishes. _(both)_

## Migrations / data
- [ ] None. This is client-only; no schema, RPC or edge-function change.

## Known gaps / not-yet-testable
- Not live-verified. The edits/deletes bug was found and pinned by hook tests (React's own rule for when it runs a state update), not seen in the running app; the first section above is the real-world check.
- Busy blocks (other members' free/busy) follow the workspace through #279, which has its own checklist.
