# Manual test checklist — Email EM-11 (MCP manifest + widget + web tissue view · DoD)

> Generated 2026-07-07 · branch `claude/quirky-goodall-aab1ab` · **Live-verified:** partial — the manifest + widget shaper are unit-proven (`bun run verify` 818 tests green); the widget + web tissue view read the cloud tissue (verifiable on the hosted account); the MCP connector is a Deno function that ships with a **`moduo-mcp` redeploy (MCP-1)** and its keyed round-trip is folded into MCP-1 per the spec. The desktop unread-count push needs the desktop app + a synced account.

## MCP manifest + connector (AC17)
- [x] `emailModuleManifest` registered on its own `email` lane (`permissionKey:"email"`, `activityEntityTypes:["email_thread"]`); ops map to the real `email_op_*` RPCs; metadata-only (no body/send op). Proven by `ops-manifest.test.ts` + the central conformance test.
- [ ] **Do (MCP-1):** redeploy `moduo-mcp` (picks up `modules/email.ts` + the registry entry). → **Expect:** the email tools appear for a key scoped `email:view`/`email:edit`. _(cloud, MCP-1)_
- [ ] **Do (MCP-1):** with an `email:edit` scoped key, call `email_list` (reads tissue threads, metadata only), then `email_snooze` / `email_follow_up` / `email_link` on a ref. → **Expect:** reads return from/subject/snippet + snooze/follow-up state (never a body); writes succeed (the api-key permission branch works — the CAL-7 gotcha); NO body-read or send tool exists; owner-scoped accounts are NOT listed. _(cloud, MCP-1 keyed round-trip)_

## "Inbox & follow-ups" widget (AC18)
- [ ] **Do:** On the dashboard, open the add-widget panel → add **"Inbox & Follow-ups"**. → **Expect:** the widget appears (all 4 registry spots wired: it's offerable, renders, persists). _(both)_
- [ ] **Do:** With ≥1 connected desktop account that has unread mail, view the widget. → **Expect:** an **Unread** section lists each account's address + its unread count (desktop-pushed), sorted most-unread first, with a total. _(both — reads cloud)_
- [ ] **Do:** Snooze a thread to later today (desktop), then view the widget. → **Expect:** a **Returning today** section lists it. _(both)_
- [ ] **Do:** Set a follow-up on a sent thread (desktop), then view the widget. → **Expect:** an **Awaiting reply** section lists it, most-urgent first. _(both)_
- [ ] **Do:** Click any thread row. → **Expect:** it deep-links to `/email` (the `moduo:entity:open` host listener). _(both)_
- [ ] **Do:** View the widget with no accounts/tissue (or pre-any-sync). → **Expect:** a calm empty state ("Inbox zero…" or "Connect email on the desktop app…"), never a crash/wall. _(both)_

## Unread-count push (AC18 / assumption 15)
- [ ] **Do:** On desktop, connect an account and let it sync; open the dashboard (or the web app) and check the widget. → **Expect:** the account appears with its inbox unread count (the desktop pushed it to `email_accounts.unread_count`; owner-scoped). Marking mail read on desktop lowers the pushed count within ~1.5s + next sync. _(desktop → cloud → web)_
- [ ] **Do:** Confirm the push is owner-scoped metadata only — another workspace member does NOT see your accounts/unread (accounts are owner-RLS; only `email_refs` tissue is workspace-visible). _(cloud, AC14)_

## Web read-only tissue view (AC15)
- [ ] **Do:** Open `/email` on the **web** app. → **Expect:** an "open on desktop" note, then **Snoozed** (with "Returns <when>"), **Follow-ups due** (with "Reply by <when>"), and **Recently linked** card sections — each card from/subject/snippet/date + "Continue on desktop". A thread shown under Snoozed/Follow-ups isn't duplicated under Recently linked. _(web)_
- [ ] **Do:** With no tissue at all on web. → **Expect:** the calm "Nothing linked yet" empty state. _(web)_
- [ ] **Do:** Confirm the desktop 3-pane (`/email` on desktop) is unchanged by this block. _(desktop)_

## Known gaps / not verifiable here
- The MCP keyed write round-trip through the connector needs the `moduo-mcp` redeploy — folded into **MCP-1** per the spec (the underlying `email_op_*` api-key branch was already prod-verified in EM-3).
- Per-card **linked-entity chips** on the web tissue cards are deferred (a per-ref link read = an N fan-out; the widget + notifications carry the primary need per DESIGN_BRIEF §8).
- Connector convert-to-task minting is app-only (tasks are client-direct; the tasks connector mints nothing either) — an agent uses `email_link` to connect a thread to an existing task; connector tag-write rides the shared client-direct `tag_links` path and is an MCP-1 follow-up.
