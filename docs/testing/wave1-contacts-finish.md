# Manual test checklist — Wave 1 Contacts finish (CO-3 · CO-4 · CO-5)

> Generated 2026-06-27 · branch `t/maciej/wave1-contacts-finish` · **Live-verified:** no — `bun run verify` green (249 unit tests + typecheck + lint), but Storybook/Supabase are unreachable in this worktree and the migrations aren't applied here, so every server round-trip + visual below is **first-discovery for you**. Deploy the two new-ish migrations first (see Migrations/data).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where. All on `/contacts`.

## CO-3 — CSV import (the adoption gate)
- [ ] **Do:** Open `/contacts` as an editor → click the **Import** (upload) icon in the directory header. → **Expect:** a 3-step dialog opens on a "Drop a CSV here, or click to choose" drop zone. _(both)_
- [ ] **Do:** Drop (or choose) a CSV whose first row is headers (e.g. `Name,Email,Company,Title`). → **Expect:** it advances to **column-map**; each column has a guessed field (Name→Name, Email→Email, etc.); a sample value shows under each. _(both)_
- [ ] **Do:** Change a column's mapping via its dropdown (e.g. set a stray column to "Don't import"). → **Expect:** the mapping updates; **Continue** is disabled only if no column maps to a name. _(both)_
- [ ] **Do:** Click **Continue**. → **Expect:** the **dedupe preview** lists every row with a badge — New / Merge / Duplicate / Skipped — and a summary ("X new · Y merge · …"); a row with a blank name shows **Skipped · Missing name**. _(both)_
- [ ] **Do:** Include a row whose email matches an existing contact. → **Expect:** that row previews as **Merge** (not a second contact). _(both)_
- [ ] **Do:** Include two rows with the same email. → **Expect:** the second previews as **Duplicate** (skipped), not a second New. _(both)_
- [ ] **Do:** Click **Import N contacts**. → **Expect:** dialog closes, a "Contacts imported" toast ("N added · M merged"), and the directory lands populated (new people + any new companies from the Company column). _(both)_

## CO-4 — Linking, suggestions, follow-up, company union
- [ ] **Do:** Select a contact → look at the **right context strip**. → **Expect:** Quick actions (Add follow-up, Link existing…, Set company) + a Details list; for a viewer (no edit) the actions + suggestions are hidden. _(both)_
- [ ] **Do:** Click **Add follow-up**. → **Expect:** a "Follow-up added" toast; an ordinary task **Follow up with <name>** appears under the hub's **Open work** group and the last-touch line's open-task count ticks up. No "deal" object is created. _(both)_
- [ ] **Do:** Click **Link existing…**, search, pick a task/note. → **Expect:** it appears as a single row in the hub roll-up (right section by type). _(both)_
- [ ] **Do:** Click **Set company**, pick an existing company (or type a new name → "Create company"). → **Expect:** the company is linked (works-at) and set as the contact's company; re-opening shows it. _(both)_
- [ ] **Do:** If a suggestion strip appears at the top of the right strip, click **Link**. → **Expect:** the link is added (attributed to Contacts); a works-at→company accept also sets the company. Click **Dismiss** on another → it's not re-offered. _(both)_
- [ ] **Do:** Select a **company** in the directory. → **Expect:** the company hub shows a **People** group (its members) + a unioned roll-up of those people's work (tasks/notes) one level up + the company's activity. People rows deep-link to the person. _(both)_

## CO-5 — MCP manifest + "Needs attention" widget
- [ ] **Do:** On the Dashboard, unlock + add the **Needs Attention** widget from the widgets panel. → **Expect:** it lists contacts with an overdue follow-up / no touch >14d (active) / stale lead >30d, each with a neutral icon + quiet detail text (never red). Empty → "Nothing needs attention." _(both)_
- [ ] **Do:** Click a row in the widget. → **Expect:** it deep-links toward that contact (fires `moduo:entity:open` — note the host listener is a known shared gap, see below). _(both)_
- [ ] **Do:** (MCP, if a connector key is configured) call `contacts_list` / `contacts_search` / `contacts_create` etc. → **Expect:** people/companies returned + created; view-scope keys see only the read tools. _(connector)_

## Edge cases
- [ ] **Do:** Import a CSV with no header / a malformed file. → **Expect:** a quiet "didn't look like a CSV with a header row" message, no crash. _(both)_
- [ ] **Do:** As a **viewer** (tasks permission = view), open a contact. → **Expect:** no Import icon, no right-strip actions/suggestions, read-only hub. _(both)_
- [ ] **Do:** A follow-up task due **today** (not yesterday) for a user in a non-UTC timezone. → **Expect:** it does **not** show as overdue (the timestamptz→local-date fix). _(both)_
- [ ] **Do:** A company with a works-at-linked person who is **not** denormalized (no company_id). → **Expect:** they still appear in the company's People group. _(both)_

## Migrations / data
- [ ] **Do:** Apply `supabase/migrations/20260627140000_contacts_import.sql` (the `contacts_op_import` RPC) to the Moduo project; regenerate `src/types/supabase.ts`. → **Expect:** CSV import round-trips (CO-3 was unverifiable here — Supabase MCP on the wrong org). _(server)_
- [ ] **Do:** Confirm the CO-1 (`…contacts_module.sql`) + spine migrations are deployed (CO-4/CO-5 depend on `contacts`, `entity_links`, `tasks`). → **Expect:** the directory, hubs, suggestions, and the needs-attention widget read real data instead of degrading to empty. _(server)_
- [ ] **Do:** Deploy the `moduo-mcp` edge function (it now registers the `contacts` connector module). → **Expect:** the contacts MCP tools are live for scoped keys. _(connector)_

## Known gaps / not-yet-testable
- **Not live-verified in this worktree** — Storybook renders nothing here and the Supabase MCP is on the wrong org, so all server round-trips + visual baselines are your first pass. Capture visual baselines with `bun run e2e --update-snapshots` on the canonical env after deploy.
- **Drag-an-entity-onto-the-contact-hub** is deferred (needs a page `DndContext` + live-verify; dnd drags are unsimulable here). The other three link gestures cover AC5.
- **`moduo:entity:open` has no host listener yet** — the widget/chips fire the right event but nothing routes it to a hub (shared CT-4/CT-7 deferral). Clicking a needs-attention row is currently inert until that listener lands.
- **Needs-attention idleness keys off the default status ids** (`active`/`lead`) — a renamed status won't trip no-touch/stale-lead; thresholds are constants (later configurable).
- **Last-touch is a `updatedAt` proxy** (CO-2 deferral) — it doesn't reflect edits to *linked* entities.
- `setCompany` is two writes (link + FK) — non-atomic; a combined op is a future refinement.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
