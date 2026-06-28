# Spec: Contacts v2 — the iOS/Folk-grade contact page

> Status: **In progress** (Batch 1 shipped) · Owner: maciej · Supersedes the UI/data shape of [`specs/contacts.md`](./contacts.md) (CO-1…CO-5 base stays; this evolves it) · Briefs: [`.design/contacts/DESIGN_BRIEF.md`](../.design/contacts/DESIGN_BRIEF.md), [`.design/contacts/REDESIGN.md`](../.design/contacts/REDESIGN.md)
>
> Written 2026-06-28 from a research round (iOS Contacts/Cardhop · Folk/Attio/Notion/HubSpot/Google · Monica/Dex/Clay) + designer testing feedback. The research lives in [`.design/contacts/REDESIGN.md`](../.design/contacts/REDESIGN.md).

## Why

The CO-1…CO-5 contact page works but reads thin and rigid. The research through-line: **the record should fill itself** (the spine auto-rolls up linked work — our moat), the page should be a calm **iOS-style single card** (not a right-panel-dependent layout), and depth should be **opt-in per context** (typed multi-value fields + custom fields) so the same page serves a student and a recruiter without bloat. We explicitly do **not** become a sales CRM (no pipelines/deal stages).

## Locked decisions (this session, 2026-06-28)

1. **The right panel is not essential.** All contact controls (details, quick actions, suggestions, delete) live **on the contact page** as one scrollable iOS-style card. The right rail reverts to optional *cross-module* context, hidden for Contacts by default.
2. **Inline edit on the card** (view ↔ edit mode), iOS-style. The new-contact **modal stays a light quick-add**; you flesh someone out on their page.
3. **Status is optional** — default **none** ("just a saved contact"). Status is a renamable label you *may* set, never a forced pipeline slot. Tags are the primary flexible grouping.
4. **Data model:** typed fields, not flat text. Multi-value channels (emails/phones/addresses/urls/dates) as **JSONB arrays of `{label, value, primary}`**; user-defined **custom fields** as a `custom jsonb` blob + a `contact_field_defs` table (definitions only). **No EAV, no dynamic columns.** Keep the flat `email` column as the dedupe/suggestion fast-path. GIN-index the JSONB.
5. **Custom-field scope: workspace-global for V1** (per-segment/collection is a later upgrade once collections exist).
6. **Favorites: a per-workspace `is_favorite` flag** for V1 (per-user later if needed) — a star + a pinned Favorites section, not a tag.
7. **Attach note → a spine link to a real Notes entity** (`contacts_op_link … 'note'`); `notes_inline` stays a one-line scratch.
8. **Share contact → vCard 4.0 (.vcf) export**, client-side (+ export-all). Import already exists.
9. **Email this contact →** resolve primary email, hand off to the Mail module composer; **placeholder `mailto:` until Mail ships** (never a dead button).
10. **Companies are editable peer records** (create + edit), mirroring contacts.

## The redesigned contact page (iOS + Attio hybrid)

Header (avatar · name · title · → company · ☆ favorite · ⋯ edit/share/delete) → **action row** (Email · Message · New task · Schedule · Note, wired to the spine) → **derived last-touch line** → grouped fields (phones/emails/addresses/urls labelled + click-to-act · birthday/dates · relationships · tags · optional status · custom fields) → **linked work** (spine roll-up: tasks/notes/files/emails) → **activity timeline** (auto-built). View mode = read + click-to-act; **Edit** toggles inline editing with iOS-style add-row + label-picker.

## Cross-app rules established here

- **No-results vs nothing-yet empty states.** A non-empty filter that matches nothing renders **"No results"** (search icon + the query), never the empty-collection copy. Applies to every filterable list (Contacts done; other surfaces adopt as touched).
- **One segmented switch.** The Tasks Plan/Focus toggle and the Contacts People/Companies toggle are the same `SegmentedControl`, **content-width** (segments fill the box — no dead click space), neutral.

## Data model (V1 migration)

Add to `contacts` (and `companies` where noted): `is_favorite boolean` (contacts), `custom jsonb DEFAULT '{}'` (both), and migrate/add multi-value JSONB: `emails`, `phones`, `addresses`, `urls`, `dates` as `[{label,value,primary}]` (dates: `{label,value}`); keep flat `email`. New table `contact_field_defs (id, workspace_id, key, label, type, options, position)` — defs only. GIN indexes: `custom jsonb_path_ops`; an expression/mirror index for cross-email dedupe. New ops (SECURITY DEFINER, guard + write + activity): `contacts_op_toggle_favorite`, `contacts_op_set_custom_field`, extend `contacts_op_update` (+ `companies_op_*` edit). vCard export is client-only. Relationships/attached-notes/linked-work use the existing `entity_links` substrate — no new columns.

## Execution batches

- **Batch 1 — quick fixes** · **DONE 2026-06-28** · `t/maciej/wave1-contacts-finish`: status double-dot fix (drop the trigger's extra dot; `SelectValue` already mirrors the item) · search bar right-edge aligned to rows (`pr-2`) · "Add follow-up" → "Add a follow-up task" · no-results empty state (the cross-app rule) · left/right rail **min-width 240px** floor (shell) · People/Companies switch made **content-width** (fixes the dead-click resize bug; matches the Tasks switch).
- **Batch 2 — data model + page restructure** · **DONE 2026-06-29** · migration `20260628140000_contacts_v2` (applied to prod): multi-value JSONB (`emails`/`phones`/`addresses`/`urls`/`dates`) + `custom` blob + `contact_field_defs` + `is_favorite` + status default `''`; ops `set_details`/`set_favorite`/`companies_op_set_details`/`add`+`delete_field_def`; create/update/import rewritten for jsonb; `links_suggest` reads jsonb. Inline-edit card (view/edit) replaced the right panel; CompanyHub editable; quick-add form kept light.
- **Batch 3 — iOS adds** · **DONE 2026-06-29**: favorites (directory star + pinned section + card star) · A–Z letter separators (`letter-index.ts`) · vCard share/export (`vcard.ts` + download) · attach-note (link a Notes entity) · email-this (mailto) · relationships (contact↔contact via the link picker) · custom-fields view/edit + add/delete defs on the card.
- **Batch 4 — delighters** · **DONE 2026-06-29**: **Reconnect** dashboard widget (`reconnect.ts` + `runtime.contacts.reconnect`, updated_at proxy) · dedupe **detection** banner in the directory (`dedupe.ts`) · paste-to-add (`parse-contact.ts`) in the quick-add form.

### Deferred (recorded)
- **Dedupe MERGE** — the banner detects + jumps to a duplicate, but combining two contacts needs a `contacts_op_merge` (re-point links/blobs) — a focused follow-up.
- **`multi_select`/`select` custom fields** via the card flatten to a comma string (the card only creates text/number/date/url); rich pickers later.
- **Address is single-line** `{label,value}` (not structured street/city/…); **vCard lines aren't 75-octet folded** (every real parser accepts unfolded).
- **Per-segment custom fields** (Folk-style) — V1 defs are workspace-global.
- Last-touch (and Reconnect) use the `updated_at` proxy, not cross-entity activity (CO-2 deferral).

## Out of scope (unchanged)

Sales pipelines / deal stages / forecasting / lead scoring · Notion-style arbitrary-database UI · abstract node-edge graph · heavy data-broker enrichment · the full Mail/Finance modules (Contacts only links to them). Per [PRODUCT_BRIEF](../docs/PRODUCT_BRIEF.md) non-goals.

## Open questions

- [ ] Letter index: a full A–Z scrubber rail vs. just sticky section headers at alpha (lean: section headers first, scrubber if the list gets long).
- [ ] Relationships UX: reuse the generic link picker vs. a dedicated "related people" affordance.
