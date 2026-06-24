# Moduo — Contacts (Light CRM) Brief

> **Status:** Planned — Module #2, the spine's proof-of-concept. Near-pure connective tissue: a contact's value *is* the roll-up of linked work.
> **Pairs with:** [PRODUCT_BRIEF.md](../../docs/PRODUCT_BRIEF.md), [ROADMAP.md](../../docs/ROADMAP.md), [data-layers.md](../../docs/data-layers.md) (§5 spine), [moduo-module-contract.md](../../docs/moduo-module-contract.md).

---

## 1. What it is & the job-to-be-done

A light CRM: **people and companies as hub entities** whose pages stay current automatically because every linked email, task, note, event, and payment rolls up onto them. The user runs a solo or partner business and is tired of "running my business in a Google Sheet" — but every real CRM they've tried is "oriented to corporate/enterprise. Overkill." HubSpot, Salesforce, ClickUp CRM: all overkill. The actual bottom-of-market incumbent is **the spreadsheet**, and the spreadsheet's failure mode is that nobody updates it.

Job-to-be-done, in the user's words: *"Let me see everything going on with this person or company in one place, without me having to log it."* The contact record is not a data-entry chore; it is a **lens onto work that already exists** elsewhere in Moduo.

This is also the module where the spine stops being a slide and becomes a feature. Contacts has almost no native depth of its own — its value is ~90% roll-up. If the tissue works, Contacts feels magical with very little module code. If it doesn't, Contacts is an empty address book. That makes it the right second module to build: it proves the spine or exposes its gaps cheaply.

---

## 2. Depth ceiling & explicit non-goals

**Ceiling: Folk-lite.** People and companies as linkable hubs, a status field, auto-rolled history, light segmentation by tag/status. Enough to replace the spreadsheet and the "where did we leave off with this client" mental load. No more.

| In scope | Out of scope (non-goals) |
| --- | --- |
| People + companies as entities | Sales **pipelines** / deal stages / kanban |
| Status field (e.g. Lead → Active → Dormant) | **Forecasting**, revenue projection, quota |
| Auto roll-up of linked work | Enterprise CRM (custom objects, workflows, lead scoring) |
| One linked follow-up task = the "CRM action" | Marketing automation, email sequences, drip campaigns |
| CSV import of contacts/leads | Web forms, lead capture, enrichment-from-the-internet |
| Tags + saved filters | Multi-pipeline, territories, team assignment rules |

The line: **Contacts tracks relationships, not deals.** A "deal" in Moduo is just a task or a note linked to a contact. We deliberately do not build a pipeline object — that is the enterprise-CRM gravity well that makes every competitor "overkill."

---

## 3. The one great moment

**The auto-rollup contact page that stays current with zero manual logging.**

You open a contact. Without ever having typed a "log," you see: last touch ("emailed 3 days ago"), open items ("2 tasks, 1 invoice unpaid"), and a reverse-chronological history that *is* the linked emails, tasks, notes, events, and payments — each rendered as an inline snippet, grouped by relationship. You replied to their email this morning from the Email module; the contact's "last touch" already reflects it. You created a follow-up task; it's already on their page under "Open items."

The insight this defends against: **light CRMs die from "data no one trusts."** Manual upkeep rots — within weeks the spreadsheet is stale and the user stops believing it, then stops using it. Auto-rollup is not a gimmick; it is the *only* mechanism that keeps a light CRM trustworthy without a maintenance tax. The moment lands the instant the user realizes they will never again update a contact by hand.

---

## 4. Must-have features

Each: one line → the insight/evidence → how it wires into the spine.

| # | Feature | Insight / evidence | Spine wiring |
| --- | --- | --- | --- |
| 1 | **People & companies as entities** | The two object types every light CRM needs; people belong to companies. | New `entity_type` values `contact` and `company`, addressable by `(entity_type, entity_id)` — first-class spine citizens from day one. A person↔company is itself an `entity_links` row (`relation_kind = works_at`). |
| 2 | **Auto-updating record (last-touch / open-items / history)** | The great moment; the fix for "data no one trusts." Stale records kill light CRMs. | Reads, never writes the source: the page **queries `entity_links` + `module_activity`** filtered to this contact and renders linked emails/tasks/notes/events/payments. Last-touch = most recent activity timestamp across links. Open items = linked tasks where status≠done + unpaid linked payments. |
| 3 | **Status field + linked follow-up task** | This *is* the light CRM with minor additions — a relationship state plus a next action. Avoids building a pipeline. | Status is a native column on `contacts`. The follow-up is an ordinary task created via `tasks_op_commit` and linked back via `entity_links` (`relation_kind = follow_up`). "Deals" never become a new object. |
| 4 | **Auto-suggested links** | Reduces the linking gesture to one tap; the roll-up is only as good as the links feeding it. Suggestions seed the graph so the page is rich on day one. | An email from `jane@acme.com` suggests linking to contact Jane and company Acme (domain match); a task mentioning a contact name suggests the link. Surfaced as a one-tap "Link" affordance — accepted suggestion writes an `entity_links` row. Match logic lives server-side, off email/task metadata already in Supabase. |
| 5 | **Contact / lead CSV import** | "Stop running your business in a Google Sheet" — the literal switching cost from the incumbent. Migration is the adoption gate. | Import maps columns → `contacts`/`companies` rows; optional column → tags. Landing users in a **working, populated state** (no blank canvas), consistent with onboarding strategy. Importer is an intent op (`contacts.import`) so it's actor-attributed and activity-logged. |
| 6 | **Tags + saved filters** | Light segmentation ("clients", "warm leads") without inventing a pipeline. | Rides existing polymorphic `tag_links` (already cross-module). Saved filters are status/tag queries — no new storage primitive. |

---

## 5. Key flows / interactions

1. **First run (import).** User drops a CSV → column mapper → preview → import. They land on a contacts list already full of their real people/companies. Zero blank canvas.
2. **Open a contact (the moment).** List → contact page. Top: name, company, status pill, last-touch. Body: roll-up grouped by relationship (Emails / Tasks / Notes / Events / Payments), each an inline snippet with a deep-link to the source. No "log activity" button anywhere — there is nothing to log.
3. **Set status + add follow-up.** Inline status dropdown (optimistic, sub-200ms). "Add follow-up" → quick-create task pre-linked to this contact; it immediately appears under Open items.
4. **Link existing work.** From the contact: `/ref` or drag an email/task/note onto the page. From the other side: drag a contact onto a task, or `@mention` a contact in a note. Either direction writes the same `entity_links` row.
5. **Accept a suggestion.** A "Suggested links" strip on the page (or an inbox-style nudge): "Link this Acme email to Acme?" → one tap → roll-up updates.
6. **Company → people.** Open a company; see its people, plus the *union* of their linked work rolled up one level higher.

All writes optimistic; sub-200ms interaction bar is P0. Roll-up reads are cached and revalidated.

---

## 6. Spine wiring

Contacts is the spine's first consumer-of-everything — it touches nearly every spine system, which is exactly why it's the proof.

| Spine system | How Contacts uses it |
| --- | --- |
| **Links (`entity_links`)** | The whole module. `contact`/`company` are polymorphic ends. Typed kinds: `works_at`, `follow_up`, `attachment`, plus default `related`. Roll-up = query links where either end is this contact. |
| **Attachments** | Files/emails/payments attach to a contact via `entity_links` (`kind=attachment`) — same path, no bespoke store. |
| **Drag-anything** | Contact is both a **drag payload** (drop onto a task/calendar event/note to link) and a **drop target** (drop an email/task/payment onto the page). Declares what it consumes via the one drag-payload contract. |
| **@mentions** | `@`-mentioning a contact in a note/comment/task creates a typed link and the contact appears in that entity's roll-up. (Member mentions still resolve to workspace members; contact mentions resolve to `contact` entities — disambiguated in the picker.) |
| **/refs** | `/ref` in any editor inserts a live reference to a contact/company; the reference is a link, so it feeds roll-up + notifications. |
| **Notifications** | Ride `module_activity`. A contact-scoped event that involves you (follow-up due, payment on a linked client overdue) becomes a grouped, digest-default notification deep-linking to the contact. No new notification primitive. |
| **Activity trail** | Every intent op appends to `module_activity` with `entity_type ∈ {contact, company}`. The contact's own history view is partly *its own* activity, partly rolled-up linked-entity activity. |
| **Tags** | Existing polymorphic `tag_links`; add `contact`/`company` to covered `entity_type`s. |
| **MCP tools** | Manifest registered in `module-registry.ts`. Read: `contacts.list`, `contacts.get` (with roll-up), `contacts.search`. Write (intent ops): `contacts.create`, `contacts.update`, `contacts.set_status`, `contacts.link`, `contacts.import`. Each backed by a `contacts_op_*` RPC, permission-checked + activity-logged in one transaction. |
| **Dashboard widget** | "Needs attention" widget: contacts with an overdue follow-up or no touch in N days, plus stale-lead count. Live, interactive, against the dashboard contract. Definition-of-done. |

---

## 7. Data model sketch (Supabase-first)

New tables (RLS workspace-scoped, mirroring the Tasks pattern). Note the spine tables (`entity_links`, `tag_links`, `module_activity`) are **not** owned by Contacts — Contacts is a participant.

```
contacts
  id              uuid pk
  workspace_id    uuid  fk → workspaces            -- RLS scope
  company_id      uuid? fk → companies             -- denormalized convenience;
                                                   --   canonical relation is an entity_links row
  display_name    text
  emails          text[]                           -- for email auto-suggest (domain/address match)
  phones          text[]
  status          text                             -- lead | active | dormant | archived (configurable labels)
  notes_inline    text?                            -- a short free-text scratch; rich notes live in Notes module + link
  created_by      uuid  fk → auth.users            -- actor attribution
  created_at      timestamptz
  updated_at      timestamptz

companies
  id              uuid pk
  workspace_id    uuid  fk → workspaces
  name            text
  domains         text[]                           -- powers email→company auto-suggest
  status          text?
  created_by, created_at, updated_at               -- as above

-- SPINE (shared, already-planned; Contacts adopts, does not own):
entity_links
  id              uuid pk
  workspace_id    uuid
  source_type     text  -- 'contact' | 'company' | 'task' | 'email' | 'note' | 'event' | 'payment'
  source_id       uuid
  target_type     text
  target_id       uuid
  relation_kind   text  -- 'related' | 'works_at' | 'follow_up' | 'attachment' | 'mention'
  created_by, created_at
  -- polymorphic both ends; the roll-up engine reads THIS table by (type,id)

tag_links        -- existing polymorphic table; add entity_type 'contact','company'
module_activity  -- existing append-only trail; Contacts writes entity_type 'contact','company'
```

**Roll-up is a read, not stored state.** `contacts.get` returns the contact row plus a derived bundle: linked entities (via `entity_links`), each resolved to a snippet by its owning module, grouped by `relation_kind`, ordered by activity recency — with last-touch and open-items computed on the fly (or via a cached materialized view if profiling demands it). Nothing is written to keep a contact "current"; it is current by construction.

Polymorphic integrity follows the spine-wide decision (trigger validation vs. central `entities` registry) — Contacts does not solve it locally; it inherits whatever §5/Open-Questions lands.

---

## 8. Module-specific open questions

| Question | Recommendation |
| --- | --- |
| **Person↔company: native FK (`contacts.company_id`) or `entity_links` row?** | **Both, with `entity_links` canonical.** Keep `company_id` as a denormalized convenience for fast list rendering, but write the `works_at` link too so company roll-up and the spine stay uniform. Avoids a special-cased relationship the rest of the spine doesn't understand. |
| **Roll-up performance** — N linked entities across 5 modules, each needing a snippet. | Start with on-the-fly `entity_links` join + per-module snippet resolver; ship behind the sub-200ms bar with caching/revalidation. Promote to a **materialized "last-touch / open-items" view** only if profiling shows the live query misses the bar. Don't pre-optimize. |
| **Auto-suggest match strength** — how aggressive? | **Suggest, never auto-link.** Domain/address match for emails (high precision), name match for tasks/notes (lower — suggest only, one-tap accept). Silent auto-linking risks wrong links → the exact "data no one trusts" failure. Always a human one-tap confirm. |
| **De-duplication on import** | Match on email address first, then normalized name+company. Default to **merge-preview, user confirms**; never silently merge or silently duplicate. Stale duplicates are how spreadsheets rot. |
| **Status: fixed enum or user-configurable labels?** | Ship a sensible default set (Lead / Active / Dormant / Archived); allow **renaming** labels but **not** building stages with automation. Renaming is cheap and respects the "preserve customization" principle; stages-with-rules is the pipeline trap (non-goal). |
| **Where does a contact's long-form note live?** | In the **Notes module**, linked — not duplicated into `contacts`. Keep `contacts.notes_inline` only for a one-line scratch. Reinforces the spine over a fat contact record. |

---

## 9. Dependencies & sequencing notes

- **Hard dependency: spine core must be built first.** Contacts is ~90% roll-up; it cannot exist before `entity_links` (the keystone), the drag-payload contract, and the comments/@mention layer. Per [data-layers.md](../../docs/data-layers.md) §5, these spine primitives are built **once, alongside the second real module — which is Contacts.** So in practice: build the spine *as part of* this module, with Contacts as its first full consumer. This is the architecture's proof; do not ship Contacts on bespoke link tables.
- **Tasks (done) is already a link consumer** — the follow-up-task flow reuses `tasks_op_commit`; no new task work needed beyond the link.
- **Email metadata sync** ([data-layers.md](../../docs/data-layers.md) §6) must expose `email_refs` (id, thread, from, subject, date, account) on all clients for email↔contact links and auto-suggest to work web + desktop. Contacts roll-up of emails depends on this metadata existing, not on the full mail client. Sequence email-metadata-sync before, or in lockstep with, Contacts.
- **Finance/Payments** is a later module — payment roll-up and "unpaid invoice" open-items degrade gracefully until Finance ships. Build the roll-up engine payment-agnostic (it just renders whatever entity types are linked), so Finance lights up for free when it lands.
- **Definition of done (module contract):** intent-op RPCs + actor attribution + `module_activity` writes + `ModuleManifest` in `module-registry.ts` + MCP tools + the "Needs attention" dashboard widget. Not done until all are present.
- **Sequencing within the module:** (1) `contacts`/`companies` tables + RLS + intent ops; (2) adopt `entity_links` + roll-up read engine; (3) CSV import (the adoption gate, must be early); (4) auto-suggest; (5) MCP manifest + dashboard widget.

Grounding files: `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/docs/data-layers.md` (spine §5, email §6, open questions), `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/src/lib/module-manifest.ts` (manifest shape), `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/docs/moduo-module-contract.md` (four-pillar contract).
