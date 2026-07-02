# Spec: Contacts v3 fix pack

> Status: **In progress — FX-1/2/3 done 2026-07-02, FX-4…FX-9 remain** · Owner: maciej · Related briefs: `.design/contacts/BRIEF.md`, `.design/contacts/DESIGN_BRIEF.md`, `.design/contacts/REDESIGN.md`, `specs/contacts-v2.md`
> Source: the 2026-07-02 whole-module critique (session `claude/upbeat-morse-d9e772`), every item ratified by the designer 2026-07-02. Designer decisions this spec locks: **everything ships, priority-ordered** · person↔person = a simple **People section** (typed relations later) · custom fields gain **single-select** (multi-select stays deferred) · the entry modal is **kept and upgraded** (not replaced) · tags live in the **card header** · directory default sort stays **A–Z with a Recent toggle** · modal duplicates **warn but allow** ("Open instead" jump).

## Scope

Repair and round out the Contacts module after the v2 redesign + calm-card pass. Two broken promises get fixed first (deep links that currently dispatch into the void; selection that isn't in the URL), then the missing spine wiring (tags), directory power (filter/search/sort/keyboard), card quick wins, relation-kind sanity + a People section, the entry-modal upgrade, company-page parity, single-select custom fields, and the first live consumer of the drag-to-link machinery. No new module surface — this makes the existing one trustworthy.

## Product behavior & UX

**FX-1 Deep links.** Clicking any linked row, the header company chip, a dashboard-widget row, or an entity chip in a note routes to that entity's page and selects it. Contact/company selection lives in the URL (`/contacts?type=contact&id=…`): refresh keeps your place, back/forward work, links are shareable. The command palette gains "Open Contacts", "New contact", "Import contacts". Task/note/email refs navigate to their module page (fine-grained selection inside those modules is their own follow-up).

**FX-2 Tags.** A quiet tag-chip row sits in the card header under the subtitle line (both contact and company). Click opens the existing TagPicker (same tags as Tasks — workspace-global); chips show hue + name; removing detaches, never deletes the tag.

**FX-3 Directory.** Under search: a status filter (chips/menu, includes "No status") and — once tags exist — a tag filter. Search matches name, email, title, company name, phone (people) and name, domains, website (companies). Row secondary line becomes "title · company" when both exist. A small sort toggle: A–Z (default, letter index) ↔ Recent (by last touch; letter headers hide). Arrow keys move a highlight through the visible list, Enter opens, ⌘F/`/` focuses search. The segmented control shows counts ("People 12").

**FX-4 Card quick wins.** The header status pill is a click-to-open dropdown in view mode (optimistic, no edit mode needed). Hovering an email/phone/url row reveals a copy icon (reserved space, fade-in per R6); click copies + toast. The last-touch line prefers real interactions (linked email/task/meeting/note activity) over record edits — "updated" appears only when nothing else exists. A birthday row gains a quiet derived caption ("in 3 weeks") within 60 days.

**FX-5 Relation sanity + People.** A dedicated **People** section on the contact page lists linked people (avatar + name + status dot, click to open) — person links stop landing in "Other". Person↔person links are always `references` under the hood: the suggestion engine and drag matrix must never produce `attachment` between people (the observed "Ben Okafor · Attachment" bug), and the "Change relation" menu offers only kinds sensible for the endpoint pair (e.g. `paid-by` only when one end is a payment/invoice, `works-at` only for contact↔company).

**FX-6 Entry modal.** The New-contact dialog gains: a **Company** field (find-or-create picker); typing an email whose domain matches a company shows a one-tap "Add to Acme Corp?" hint; a **duplicate warning** row when email matches exactly or the name is near-identical ("Looks like Jane Cooper — Open instead?") that never blocks creation; **"Add another"** (⌘Enter or a checkbox) that saves and clears for rapid entry; the paste-to-autofill becomes a real secondary control and fills **all** parsed emails/phones (create, then patch the full lists). The dialog's dead "edit" mode is removed (the card edits inline). On the Companies tab, `+` opens a **New company** dialog (name, website, domains).

**FX-7 Company parity.** The company header gains the contact's anatomy: action row (Add task · Link), a `⋯` menu with **Delete company** (new op; contacts keep existing but their company chip clears), and tags (from FX-2). The People section gains "+ Add person" (opens the contact modal pre-set to this company). Union roll-up rows inherited from a member get a quiet "· via Jane Cooper" caption.

**FX-8 Single-select fields.** "Add field" offers text / number / url / **select**; select asks for its options inline (comma-entry, editable later). Edit mode renders a Select; view mode renders the value as plain text in the details card. Deleting a def leaves stored values untouched (existing behavior).

**FX-9 Drag-to-link.** Within /contacts: directory rows are draggable; the hub card is a drop target. Drop a person on a company's hub (or vice versa) → works-at; person on person → references. The drop toast (existing spine machinery) confirms with Undo + kind override. First end-to-end consumer of CT-3.

## Edge cases

- **URL id points at a deleted/foreign contact** → hub shows the existing "select one" empty state + a quiet toast "That contact no longer exists"; URL param cleared.
- **Entity-open for a type with no page mapping** (e.g. `payment` pre-Finance) → no-op plus a "Not available yet" toast; never a crash.
- **Keyboard nav with an active filter** → highlight moves through the *visible* list only; filter change resets highlight; Enter with no highlight does nothing.
- **Recent sort with never-touched contacts** → they sort last (by name); no letter headers in Recent mode.
- **Duplicate warning false positive** → warning is informational; "Add contact" stays enabled; "Open instead" abandons the draft (confirm-free — the draft is one field typically).
- **Add-another mid-error** → on failure the form keeps values and shows the error; nothing clears.
- **Paste parse finds nothing** → fields stay as typed; no error state (paste is best-effort).
- **Delete company with members** → contacts survive; their `company_id` clears + works-at links to it are removed; registry tombstoned; roll-ups render the tombstone rule if anything still points at it.
- **Select def with options removed later** → a stored value not in the options still renders (as text) and stays selectable in the Select (appended, like status does).
- **Drag self-drop / already-linked pair** → the spine guards reject; toast explains ("Already linked"); no duplicate edge (direction-agnostic uniqueness).
- **Copy affordance on keyboard** → the copy button is focusable and visible on focus (mirrors hover-reveal rules).
- **Permission read-only** → filters/sort/keyboard/search all work; tag picker, status dropdown, copy stays (read-safe), modal/drag/delete hidden as today.

## Acceptance criteria

- **AC1** — Clicking a linked row, header company chip, dashboard-widget row, or note entity chip opens that entity: contact/company select on /contacts via URL params; task/note/email at least navigate to their module page. Refresh and back/forward preserve contact selection.
- **AC2** — Palette lists Open Contacts / New contact / Import contacts; the latter two work from any page.
- **AC3** — Contacts and companies can be tagged from the card header; chips render hue+name; detach ≠ delete; the same workspace tags as Tasks.
- **AC4** — Directory filters by status (and tag once FX-2 lands), searches across the widened field set, shows "title · company" secondaries, offers A–Z↔Recent sort (A–Z default), and is fully arrow/Enter navigable.
- **AC5** — Status changes from the header pill in view mode, optimistically, with rollback+toast on failure.
- **AC6** — Email/phone/url rows copy to clipboard from a hover/focus-revealed affordance.
- **AC7** — Last-touch prefers interaction activity over record edits; birthday shows "in N days/weeks" within 60 days.
- **AC8** — Linked people render in a People section (not "Other"); no gesture (suggest/drag/link/change-kind) can produce `attachment` or `paid-by` between two people; the change-relation menu is endpoint-pair-constrained.
- **AC9** — The modal: company find-or-create; domain→company hint; duplicate warn-with-open-instead (never blocks); Add another; paste fills all parsed emails/phones onto the created contact; Companies tab `+` creates a company.
- **AC10** — Company page: Add task + Link actions, delete via `⋯` (contacts survive, company_id cleared), "+ Add person" pre-linked, "via <person>" captions on inherited union rows.
- **AC11** — A select custom field can be defined with options, set on a contact via Select, and renders in view mode; values not in options still render.
- **AC12** — Dragging a directory row onto a hub creates the resolveKind link with the Undo/override toast; self-drop and duplicate links are rejected with feedback.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/lib/entity-open.test.ts` · route mapping | AC1 | Each entity type maps to the right page URL; unknown types map to null (no-op). |
| `src/features/contacts/directory-query.test.ts` · search fields | AC4 | The search matcher hits name/email/title/company/phone for people and name/domain/website for companies. |
| `src/features/contacts/directory-query.test.ts` · status/tag filter + sort | AC4 | Filtering returns only matching rows; Recent sort orders by last touch with never-touched last. |
| `src/features/contacts/rollup.test.ts` · interaction-weighted last touch | AC7 | A record edit never beats a linked-task/email activity for the last-touch verb. |
| `src/features/contacts/dates.test.ts` · birthday countdown | AC7 | "in 3 weeks" style caption appears only within 60 days, handles year wrap. |
| `src/features/spine/kind-constraints.test.ts` · pair matrix | AC8 | Allowed relation kinds per endpoint-type pair: contact↔contact excludes attachment/paid-by/works-at; contact↔company includes works-at; etc. |
| `src/lib/drag-payload.test.ts` · contact↔contact resolveKind | AC8, AC12 | Person-on-person drags resolve to `references`, never `attachment`. |
| `src/features/contacts/dedupe.test.ts` · modal dup probe | AC9 | Exact-email and near-name inputs flag the right existing contact; distinct people don't. |
| `src/features/contacts/parse-contact.test.ts` · multi-value fill | AC9 | A pasted signature with 2 emails + 1 phone produces a patch carrying all of them. |
| `src/features/contacts/company.test.ts` · provenance captions | AC10 | Union rows carry the member they came from; the company's own rows carry none. |
| `src/features/contacts/field-defs.test.ts` · select options | AC11 | Option parsing/serialization round-trips; a value missing from options is preserved. |
| Storybook stories (hub header tags/status, directory filters, modal dup state, company parity) | AC3/4/5/9/10 | Visual states exist for review; interactive behavior is manually verified per the wrap-up checklist. |
| `e2e/contacts/deeplink.spec.ts` · URL selection | AC1 | Navigating to `/contacts?type=contact&id=X` opens X; refresh keeps it. |

## Assumptions & technical decisions

- **URL selection** = TanStack Router search params on the contacts route (`validateSearch` → `{ type?: 'contact'|'company', id?: string }`), first use of search params in the app; selection state moves from `useState` to the URL (single source). Rejected: keeping state + syncing — two sources drift.
- **Entity-open listener** installs in `src/components/app/app-chrome.tsx` (where global window-event wiring already lives): one listener → route map (`contact/company → /contacts?type&id`, `task → /tasks`, `note → /notes`, `email → /email`, else no-op+toast). The map lives in a pure `src/lib/entity-open.ts` for testability. Fine-grained task/note selection is those modules' follow-up (they're state-only today).
- **Palette** stays a static list (three new `Action` entries); fuzzy "go to contact <name>" waits for the spine's unified search (out of scope).
- **Tags reuse the Tasks tag ops as-is** (`runtime.tasks.attachTag/detachTag/upsertTag` are already entity-type-generic; `tag_links.entity_type` is an open string, no migration). Contacts passes `'contact'|'company'`. Rejected: per-module tag ops — pointless duplication.
- **Recent sort key** = the directory bundle's cheap proxy (`updatedAt`) at first render; no per-contact roll-up fan-out for sorting (the same CO-5 proxy decision). Recorded limit: a link made from the other side won't bump Recent order until the row updates.
- **Keyboard nav** is roving-highlight state in `ContactDirectory` (not focus-moving) with `aria-activedescendant`; `/` focuses search (palette owns ⌘K).
- **Status quick-change** reuses `contacts_op_set_details` with `{status}` — no new op.
- **Kind constraints** are a pure client matrix (`allowedKinds(sourceType, targetType)`) used by the change-relation menu, drag resolve, and suggestion accept; the server's closed 8-kind set is untouched. The observed contact↔contact "attachment" must be root-caused during FX-5 (suspects: server `links_suggest.suggestedKind` or the accept path) and fixed at the source, plus an explicit `contact>contact → references` entry in `EXPLICIT_KINDS`.
- **Modal**: dup probe reuses `dedupe.ts` matchers against the loaded bundle (client-side, zero reads); domain→company hint reuses `companies.domains`; multi-value paste = `contacts_op_create` then one `contacts_op_set_details` patch (two awaits, non-atomic — same accepted pattern as setCompany); dead `mode="edit"` removed.
- **Delete company** = new migration `companies_op_delete(workspace, company)` mirroring `contacts_op_delete` (tombstone registry entry + activity) **plus** clearing `contacts.company_id` for members and removing works-at edges to it, one txn. Runtime `contacts.deleteCompany`.
- **Select fields** store options in the existing `contact_field_defs.options text[]` (already in schema + model + `contacts_op_add_field_def`) — no migration.
- **Drag-to-link** wires the existing CT-3 hooks (`useDragPayload`, `useDropLinkTarget`, `createLinkWithToast`) inside a page-level `DndContext` on /contacts only; cross-page drag is out of scope. Drag e2e is unsimulable in worktrees (gotchas) → manual-test surface.
- Contacts keeps riding the **Tasks permission lane** (unchanged).

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **FX-1 Deep links + URL selection + palette** | entity-open listener + pure route map, `?type&id` search params on /contacts, palette entries | AC1, AC2 | — |
| 2 | **FX-2 Tags on contacts & companies** | header chip row + TagPicker on both hubs, riding the existing tag ops | AC3 | — |
| 3 | **FX-3 Directory power** | status/tag filters, widened search, title·company secondary, Recent toggle, keyboard nav, counts | AC4 | FX-2 (tag filter only) |
| 4 | **FX-4 Card quick wins** | view-mode status dropdown, hover-copy, interaction-weighted last touch, birthday caption | AC5, AC6, AC7 | — |
| 5 | **FX-5 Relation sanity + People section** | People section, kind-constraint matrix everywhere, contact↔contact bug root-caused + fixed | AC8 | — |
| 6 | **FX-6 Entry modal upgrade + New company** | company field, dup warn, domain hint, add-another, multi-value paste, company-create dialog, dead edit mode removed | AC9 | — |
| 7 | **FX-7 Company parity** | action row, delete-company migration+runtime+UI, +Add person, via-captions | AC10 | FX-6 (modal presets) |
| 8 | **FX-8 Single-select custom fields** | options editor, Select edit, view rendering | AC11 | — |
| 9 | **FX-9 Drag-to-link on /contacts** | DndContext, draggable rows, hub drop target, toast | AC12 | FX-5 |

Suggested order = the table order (it matches the designer's ratified priority). FX-2/4/5/6/8 are independent of FX-1 and can be picked up in parallel lanes if sessions allow.

## Out of scope

- Typed person↔person relations (introduced-by / reports-to / spouse) — People section only at alpha.
- Multi-select / checkbox custom fields; per-segment field visibility.
- Status-label rename UI (settings-level; statuses stay renamable-by-edit only).
- Avatar upload / gravatar; company favorites; merge-duplicates op + UI (still deferred from v2).
- "Create note & link" from the contact (Notes has no web create op — desktop redb only); note *linking* stays.
- Fuzzy "go to contact" in the palette (waits for spine unified search); notifications/reminders for birthdays (caption only).
- Any pipeline/stage machinery (standing non-goal).

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** filled and unambiguous.
- [x] **Every AC has at least one test** with a plain-English note.
- [x] **Open questions is empty** — all product calls ratified by the designer 2026-07-02; all technical unknowns researched (recon: tags ops generic, palette static, no search-param precedent, listener home = app-chrome, drag machinery unused-but-ready, no delete-company op).
- [x] **Data model Supabase-first**: one new migration (`companies_op_delete`); everything else rides existing tables/ops (`tag_links` open entity_type, `contact_field_defs.options`).
- [x] **Module contract**: spine wiring enumerated (links/attach/drag/@mention exist; tags land here; notifications/activity/MCP/widget already shipped in CO-5).
- [x] **Execution blocks** decomposed, sequenced, context-sized, recoverable.
- [x] **Design constraints**: tokens-only, shadcn primitives, R1–R10 acknowledged (hover-reveal per R6, accent policy per R5, sentence case per R8).
- [x] **Manual-test surfaces identified**: deep links, keyboard nav, drag (unsimulable in worktrees), copy affordance, modal flows → `docs/testing/<branch>.md` per session.

**Ready to execute.**

## Open questions

- [ ] (none)
