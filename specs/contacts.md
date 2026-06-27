# Spec: Contacts (Light CRM) — Wave 1

> Status: **Ready to execute** · Owner: maciej · Related briefs: [`.design/contacts/BRIEF.md`](../.design/contacts/BRIEF.md), [`.design/contacts/DESIGN_BRIEF.md`](../.design/contacts/DESIGN_BRIEF.md) · Spine it consumes: [`specs/connective-tissue.md`](./connective-tissue.md) + [`.design/connective-tissue/DESIGN_BRIEF.md`](../.design/connective-tissue/DESIGN_BRIEF.md) · Contract: [`docs/moduo-module-contract.md`](../docs/moduo-module-contract.md)
>
> This spec is the **execution contract** over the Contacts briefs — it does not restate them. The product/UX/visual/IA detail (and an exemplary edge-case matrix) live in the DESIGN_BRIEF and are referenced by section. This adds acceptance criteria, the tests that prove them, the block decomposition, the resolved technical decisions, and the Definition-of-Ready gate.

## Scope

Ship a **light CRM** — people and companies as hub entities whose pages stay current automatically because every linked email, task, note, event, and payment rolls up onto them, with **zero manual logging**. Contacts is module #2 and the spine's proof: it owns almost no native depth (~90% roll-up), so it is the cheapest way to prove the connective tissue is real. Scope is **Folk-lite** (DESIGN_BRIEF §Aesthetic/§Out of scope): people + companies, a renamable status, auto-rolled history, one linked follow-up task, tags + saved filters, and CSV import. It deliberately does **not** build pipelines, deal stages, forecasting, or lead scoring — "a deal is just a task or note linked to a contact."

Hard dependency: the **Wave-0 spine** ([`specs/connective-tissue.md`](./connective-tissue.md)) — the `entities` registry, `entity_links`, `EntityHub`/`EntityRefChip`, the drag-payload contract, and the auto-suggest engine. Contacts **consumes** these; it does not re-implement them.

## Product behavior & UX

Authoritative walkthrough: **DESIGN_BRIEF §2 (Solution as an experience), §6 (IA — 3-pane), §8 (Key interactions, flows 1–8)**. In brief:

- **Directory (left rail).** A dense, Linear-style list of people **and** companies (avatar/monogram + name + secondary line + status dot), a People/Companies/All segmented filter, search, saved filters, and `+` new. Density via tokens.
- **Contact hub (center, the great moment).** Selecting a row renders the spine's `EntityHub` (`variant="page"`) composed for a contact: an editable header (in-place title `Input`, status `Select`, and the quiet `LastTouchLine` — "Last touch: emailed 3 days ago · 2 open tasks · 1 invoice unpaid"), then the **link roll-up grouped by `relation_kind`** with inline snippets, then the contact's own activity trail. **There is no "Log activity" button** — the record is a *read* over `entity_links` + `module_activity`, current by construction.
- **Context strip (right).** A quiet Suggested-links strip (consuming the spine engine), Tags (`TagPicker`), Quick actions (Set status, Add follow-up, Link existing…), and contact meta.
- **Link both directions** via the spine's four gestures (drag-onto / `@mention` / `/ref` / one-tap suggestion accept); every path writes the same `entity_links` row.
- **Company → people.** A company hub shows a *People* group (members via `works-at`) plus the union of their linked work rolled up one level higher.

All writes are **optimistic, sub-200ms (P0)**, reconciled by an intent-op RPC; on failure the optimistic state reverts with a Sonner toast (often Undo).

## Edge cases

Authoritative matrix: **DESIGN_BRIEF §9 (States & edge cases)**. Each becomes a test or a manual-test surface:

- **Empty (no contacts)** — directory + hub show an `EmptyState` ("Import your contacts" / "Add one"); no fake demo rows.
- **Empty roll-up (new contact, no links)** — the spine's teaching empty-state with the link affordances, not a blank pane.
- **Loading** — directory skeleton rows respecting `--row-h`; hub header renders from the cached row immediately while the roll-up shows a thin shimmer (stale-while-revalidate; never block the header).
- **Error (write)** — optimistic state reverts; toast "Couldn't save status — retry?" with Undo/Retry; failed reads show a quiet per-group "Couldn't load history — retry", never a full-pane error.
- **Conflict (async multiplayer)** — last-write-wins on scalar fields (status/name) with a quiet activity entry attributing the other actor; links are additive/idempotent (spine uniqueness); no live-cursor UI.
- **Deleted entity / orphan link** — a deleted linked entity resolves via the registry to an inert "Deleted [type]" tombstone snippet with "Remove link"; never a broken clickable link.
- **Permission-denied** — `canEdit=false` disables header fields, hides QuickActions + suggestions, makes the roll-up/activity read-only; ops are guarded server-side regardless.
- **Large-N (hundreds of contacts / a heavy contact)** — directory virtualizes rows; roll-up uses the spine's single indexed `entity_links` join + per-group "Show all (N)"; promote last-touch/open-items to a materialized view only if profiling misses 200ms (do not pre-optimize).
- **Degraded modules (Finance/Email not yet shipped)** — the roll-up engine is entity-type-agnostic; payment/email groups simply don't appear until those modules sync refs.
- **Import: malformed CSV / unmappable columns** — the column-map step flags unrecognized columns (→ ignore or tags); rows missing a name preview as errors and are skipped, never silently dropped.

## Acceptance criteria

- **AC1 — People & companies as first-class entities.** Creating a person or company writes a `contacts`/`companies` row and upserts the `entities` registry (`entity_type` `contact`/`company`) in the same transaction; both are addressable by `(entity_type, entity_id)` and immediately linkable/mentionable.
- **AC2 — The auto-rollup hub (the great moment).** Opening a contact renders, with no manual logging, a `LastTouchLine` (last-touch = most-recent activity timestamp across links; open-items = linked tasks where status≠done + unpaid linked payments) and a history **grouped by `relation_kind`** with inline snippets and deep-links — derived purely from `entity_links` + `module_activity`, never stored. No "log activity" affordance exists anywhere in the hub.
- **AC3 — Status: renamable label, never a pipeline.** A contact has a flat status from a renamable default set (Lead / Active / Dormant / Archived); changing it is optimistic (<200ms) via `contacts_op_set_status` (guard + write + activity). Labels can be renamed in settings but never gain stages, required transitions, or automation.
- **AC4 — Follow-up = the CRM action.** "Add follow-up" creates an ordinary task via the existing `tasks_op_commit` and links it back via `contacts_op_link` (`relation_kind='follow-up'`); it appears under the hub's *Open items* immediately (optimistic) and ticks the `LastTouchLine` open-items count. No new "deal" object is created.
- **AC5 — Link existing work, both directions, one row.** Linking from the contact (`/ref`, drag an email/task/note onto the hub, or "Link existing…") and from the other side (drag a contact onto a task/event, `@mention` a contact in a note) both write the **same** `entity_links` row via the spine; the snippet appears in the relevant roll-up group optimistically.
- **AC6 — CSV import (the adoption gate).** Dropping a CSV opens a 3-step dialog (drop → column-map → dedupe-preview → import); import runs as one attributed, activity-logged `contacts_op_import`; the directory lands populated (no blank canvas). Dedupe matches on email first, then normalized name+company, and **always previews** merge/skip/create — never silently merges or duplicates. Rows missing a name are previewed as errors and skipped.
- **AC7 — Auto-suggested links, one-tap, never silent.** The context strip surfaces the spine's deterministic suggestions (email domain→company, email address→person, shared tag, ±time window); **Accept** writes an `entity_links` row via `contacts_op_link` and thickens the roll-up; **Decline** is remembered (`link_suggestion_declines`) and never re-offered. Nothing is auto-linked.
- **AC8 — Company → people union.** A company hub renders a *People* group (members via `works-at`) plus the union of those people's linked work one level higher; setting a person's company writes the `works-at` `entity_links` row **and** the denormalized `contacts.company_id` (link canonical, FK convenience).
- **AC9 — Module-contract DoD.** All invariant-bearing mutations go through `contacts_op_*` RPCs (guard + mutate + `entities` upsert + `module_activity`, one transaction); a `contactsModuleManifest` (read: `contacts.list`, `contacts.get` with roll-up, `contacts.search`; write: create/update/set_status/link/unlink/import) is registered in `module-registry.ts` and exposed via MCP; the activity trail renders in the hub; and the **"Needs attention" dashboard widget** ships live.
- **AC10 — Route is a rename, not a new top-level route.** `/crm` becomes `/contacts` (router + `FeatureLayoutKey` `"crm"`→`"contacts"`), with a redirect `/crm`→`/contacts` for stale deep-links; the throwaway `CrmPage` is replaced by `ContactsPage` composing `FeaturePanelsShell`. (Honors the "no new top-level routes without confirming" rule — `/contacts` is the planned destination of `/crm`.)
- **AC11 — Needs-attention surfacing.** The dashboard widget lists contacts with an overdue follow-up (past due date), no touch in > 14 days (active), and a stale-lead count (leads untouched > 30 days); each row deep-links to the hub; counts are quiet (muted-foreground + icon, never a red guilt wall).
- **AC12 — Design constraints.** All UI uses semantic tokens only, shadcn-wrapped primitives, **neutral** entity-ref chips, status as **color + label** (color never the only signal), density/motion via tokens, sentence case. (Per [Design constraints](#design-constraints-r1r10).)

## Tests that prove them

The agent authors these from the ACs. Layers (same harness as the spine spec): **unit** Vitest, **component/visual** Storybook+Playwright (local; visual diff = stop-and-ask), **e2e** Playwright (local). Server-side invariants are proven at e2e + manual-test; pure-TS logic gets unit coverage.

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/contacts/rollup.test.ts` · "last-touch + open-items derivation; grouping by relation_kind" | AC2 | From a fixture of links + activity, the reducer computes the right last-touch timestamp, open-items count (tasks≠done + unpaid payments), and grouped history order. |
| `tests/visual/contacts.spec.ts` · "contact-hub — populated / empty-rollup / loading / permission-denied / tombstone" | AC2, AC12 | Storybook snapshots of `ContactHub` in each state; no "log activity" control present; tokens only; status shows color **+** label. |
| `e2e/contacts/hub.spec.ts` · "open a contact → grouped roll-up with zero logging" | AC2 | Navigating to a seeded contact renders the `LastTouchLine` and grouped roll-up from linked data without any manual entry. |
| `src/features/contacts/status.test.ts` · "renamable labels; no stage machine" | AC3 | Status normalization accepts renamed labels and exposes no transition/automation API. |
| `e2e/contacts/status.spec.ts` · "set status is optimistic + reverts on failure" | AC3 | Changing status updates the pill <200ms; a forced RPC failure reverts with a toast. |
| `src/features/contacts/followup.test.ts` · "follow-up calls tasks_op_commit + contacts_op_link(follow-up)" | AC4 | The follow-up flow emits a task-commit and a `follow-up` link payload; no new deal entity is created. |
| `e2e/contacts/followup.spec.ts` · "add follow-up appears under Open items" | AC4 | Adding a follow-up shows the task under the hub's Open items immediately and increments the open-items count. |
| `e2e/contacts/link.spec.ts` · "link from both directions writes one row" | AC5 | Dragging an entity onto the hub and `@mentioning` the contact elsewhere both produce a single roll-up row (idempotent). *(Per-frame pointer for the drag; spine contract.)* |
| `src/features/contacts/import.test.ts` · "column-map guess + dedupe (email then name+company) + malformed skip" | AC6 | The importer guesses mappings, flags email/name+company duplicates for preview, and previews name-less rows as skipped errors. |
| `tests/visual/contacts.spec.ts` · "import-dialog — map / dedupe-preview" + `e2e/contacts/import.spec.ts` · "CSV import populates the directory" | AC6 | The dialog steps render correctly and a real CSV import lands the directory populated, dedupe previewed. |
| `src/features/contacts/suggest.test.ts` · "accept writes a link; decline is remembered" | AC7 | Accepting a suggestion emits a `contacts_op_link`; declining records the pair so it is not re-offered. |
| `src/features/contacts/company.test.ts` · "company union + works-at writes link and company_id" | AC8 | Company roll-up unions its people's links; setting a company writes both the `works-at` link and `company_id`. |
| `src/lib/module-registry.test.ts` (extend) · "contacts manifest registered with read+write surface" | AC9 | The registry includes `contactsModuleManifest` whose op RPC names match the migration; shape conforms to `ModuleManifest`. |
| `e2e/contacts/route.spec.ts` · "/crm redirects to /contacts; ContactsPage renders" | AC10 | Visiting `/crm` lands on `/contacts` with the 3-pane shell; the layout key is `"contacts"`. |
| `src/features/contacts/needs-attention.test.ts` · "overdue / no-touch>14d / stale-lead>30d" + `tests/visual/contacts.spec.ts` · "needs-attention-widget" | AC11, AC12 | The query selects the right contacts at the threshold boundaries; the widget renders them quietly (icon+label, no red wall) and deep-links. |

## Assumptions & technical decisions

Each = decision + one-clause rationale (+ alternative rejected). Durable ones mirrored in `docs/decisions.md`.

1. **Polymorphic integrity = the spine's central `entities` registry** (not solved locally). Contacts upserts `entities` in each op and FKs its links through it; it adopts the registry verbatim from the spine spec. *Rejected:* a Contacts-local link/validation scheme (the stale "trigger vs registry" framing in the BRIEF — now resolved).
2. **`entity_links` is spine-owned; Contacts owns only `contacts` + `companies`.** Typed kinds used: `works-at`, `follow-up`, `references` (default), `mentions`, `attachment`; reads `paid-by`/`blocks`/`spawned-from` from other modules. *Rejected:* bespoke contact link tables (data-layers §5).
3. **Person↔company: both, link canonical.** Write the `works-at` `entity_links` row (canonical, keeps the spine uniform) **and** set `contacts.company_id` (denormalized, fast list render). *Rejected:* a special-cased FK the rest of the spine doesn't understand.
4. **Roll-up is a read, never stored.** `contacts.get` returns the row + a derived bundle (links via `entity_links` → resolved via `entities` → snippet via the owning module's projector, grouped by `relation_kind`, ordered by recency). Start on-the-fly behind the 200ms bar with caching/revalidation; **promote to a materialized last-touch/open-items view only if profiling misses the bar** — do not pre-optimize. *Rejected:* eager stored aggregates (the maintenance-tax/staleness failure mode).
5. **Status default set** Lead / Active / Dormant / Archived, **renamable in settings, never stage-with-rules.** *Rejected:* a configurable funnel (the enterprise-CRM gravity well; preserves the "preserve customization" principle without the pipeline trap).
6. **CSV dedupe** matches email first, then normalized name+company; **always merge-preview, user confirms.** *Rejected:* silent merge or silent duplicate (how spreadsheets rot).
7. **"Needs attention" thresholds** (defaults; later configurable): overdue follow-up = past due date; no-touch > **14 days** for active contacts; stale lead = lead untouched > **30 days**. *Rationale:* sensible quiet defaults that need no designer input; encoded as constants so they're easy to tune. *Rejected:* asking the designer for a number the product can default.
8. **Saved filters are serialized status/tag queries** (no per-contact storage; lean on `user_preferences`-style serialization), a tiny `contact_saved_filters` table only if profiling/UX warrants. *Rejected:* a new storage primitive up front.
9. **`contacts.notes_inline` is a one-line scratch only**; rich notes live in the **Notes** module (Wave 3), linked. *Rejected:* a fat contact record duplicating Notes.
10. **Email/Finance roll-up groups degrade gracefully** — the entity-type-agnostic engine renders whatever is linked; payment/email groups appear for free when Finance/Email sync refs. Email↔contact links need only `email_refs` metadata sync (data-layers §6), **not** the full mail client. *Rejected:* blocking Contacts on later modules.
11. **Ops mirror the Tasks reference exactly** (`contacts_op_create` / `_update` / `_set_status` / `_link` / `_unlink` / `_import`): `SECURITY DEFINER`, `spine`/`contacts` permission + `contacts_op__guard`, `module_activity_log`, the standard grants; the follow-up reuses `tasks_op_commit` (no new task code). *Rationale:* proven Session-8 pattern.
12. **Route repurpose, not addition** — `src/app/router/route-tree.tsx` (`crmRoute` ~L88–92, `CrmPage` import ~L11, child at ~L111) → `contactsRoute`/`ContactsPage`/`/contacts`; `src/features/layout/panel-events.ts` `"crm"` `FeatureLayoutKey` (L8/L32/L42) → `"contacts"`; add `/crm`→`/contacts` redirect. *Rationale:* honors the no-new-top-level-routes rule (CLAUDE.md #7); `/contacts` is `/crm`'s planned destination.

## Execution blocks

Each block is sized to one `/execute` context budget, vertical-slice where possible, self-contained, and resumable from this spec + `docs/decisions.md`. **Cross-spec dependency:** all blocks depend on the spine spec's blocks as noted (Contacts consumes, never rebuilds, the spine).

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **Contacts schema + ops + route** | Migration: `contacts`, `companies` (RLS mirror Tasks); ops `contacts_op_create` / `_update` / `_set_status` / `_link` / `_unlink` (guard + write + `entities` upsert + activity); runtime methods; route rename `/crm`→`/contacts` + `"crm"`→`"contacts"` layout key + redirect; `ContactsPage` scaffold composing `FeaturePanelsShell`. | AC1, AC3, AC10 | spine #1 (registry+links) |
| 2 | **Directory + ContactHub (the great moment)** | `ContactDirectory` (list, People/Companies/All segmented, search, density rows) + `ContactRow`; `ContactHeader` (in-place edit) + `LastTouchLine`; `ContactHub` composing the spine `EntityHub` (`variant="page"`) with contact snippet projectors + `ActivitySection`; the roll-up read (last-touch/open-items derivation); empty/loading/error/permission/tombstone states; Storybook stories. | AC2, AC12 | 1, spine #2 (EntityHub) |
| 3 | **CSV import (the adoption gate)** | `ContactImportDialog` (drop → column-map → dedupe-preview → import); `contacts_op_import` (one attributed op); dedupe (email then name+company, merge-preview); malformed-row handling. | AC6 | 1 |
| 4 | **Linking + suggestions + company union + follow-up** | Link both directions via the spine (drag/`@`/`/ref`/`LinkEntityPicker`); `SuggestedLinksStrip` (consume spine engine: accept→`contacts_op_link`, decline remembered); company *People* group + union roll-up + `works-at`/`company_id`; "Add follow-up" (`tasks_op_commit` + `contacts_op_link` `follow-up`). | AC4, AC5, AC7, AC8 | 2, spine #3 (drag), #4 (mention/ref), #6 (suggest) |
| 5 | **MCP manifest + "Needs attention" widget (DoD)** | `contactsModuleManifest` (read: list/get/search; write: the 6 ops) in `module-registry.ts` + MCP exposure; `ContactsNeedsAttentionWidget` (overdue follow-up / no-touch>14d / stale-lead>30d, quiet, deep-linking). | AC9, AC11, AC12 | 1, 2, spine #7 (dashboard host) |

## Out of scope

- **Sales pipelines, deal stages, kanban, forecasting, quota, lead scoring** (a "deal" is a task/note linked to a contact); **marketing automation / sequences / web forms / enrichment**; **custom fields** (fixed fields + tags + saved filters only); **status stages with automation**; **long-form notes inside the contact** (Notes module, linked); **a node-edge graph view**; **owning any spine machinery** (consumed from the spine spec); **real-time co-editing / live cursors / chat**; **built-in AI** (MCP-only); **the full web Email client and Finance/Payments** (Contacts depends only on `email_refs` metadata; payment roll-up degrades gracefully); **mobile/tablet + light-mode tuning** (desktop-dark only at alpha). (DESIGN_BRIEF §13.)

## Design constraints (R1–R10)

Obeys `DESIGN_RULES.md` / `tokens.css`; `moduo-design-quality` enforces on the diff. The contacts DESIGN_BRIEF (§4, §12) is already a token-discipline model — the spec inherits it:
- **Tokens only (R10):** no raw hex / arbitrary Tailwind for color/spacing/radius/font. Status uses the fixed status tokens (`--success`/`--warning`/`--danger`/`--info`); tags use the 8 `[data-label]` hues; **entity-ref chips are monochrome** (no hue). No color-bearing data introduces new hex.
- **Accent discipline (R5):** the pink `--primary` appears once per view at most (the primary action); selection uses `--selected-bg`/`--selected-border`; everything else neutral.
- **Density + motion via tokens (R7, R6):** directory/hub rows consume `--row-h`/`--pad-*`/`size-icon-*` (Linear-level at the dense end); roll-up reveals + status changes go through `--motion-*` so reduced-motion holds.
- **Primitives wrap shadcn (R4):** command, popover, dialog (import), select/date-field (ghost), property-row, badge, avatar, scroll-area, segmented-control, tabs, sonner, context-menu, tooltip, separator, empty-state — reused, none rolled by hand. New `*.stories.tsx` for any new primitive.
- **Color is never the only signal:** status = color **+** label (+ tooltip on the dense dot); tags = hue **+** name; ref chips = type icon **+** label; the last-touch "unpaid" mirror is icon + text, never a bare red dot.
- **Sentence case (R8)** throughout.

---

## Definition-of-Ready gate

> **/execute must not start a block until this is all true.**

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are filled and unambiguous (behavior/edge reference the DESIGN_BRIEF's authoritative §2/§6/§8/§9; ACs numbered + testable).
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note (AC1–AC12 mapped; server-invariant rows flagged e2e/manual).
- [x] **Open questions is empty** — the BRIEF's §8 open questions and DESIGN_BRIEF decisions are resolved and recorded under *Assumptions & technical decisions* (incl. the stale "trigger vs registry" framing → registry).
- [x] **Data model is named and Supabase-first** — `contacts`, `companies` (owned) + the shared spine tables (consumed); migrations identified per block; RLS mirrors Tasks.
- [x] **Module feature wiring enumerated** — links/attach/drag/@mention/`/ref`/notifications/activity/tags (DESIGN_BRIEF §spine wiring); MCP tools listed (`contacts.list`/`get`/`search` + the 6 write ops); dashboard widget defined ("Needs attention") — per `docs/moduo-module-contract.md`.
- [x] **Execution blocks** decomposed (5), sequenced with dependencies (incl. cross-spec deps on the spine blocks), each context-sized and self-contained.
- [x] **Design constraints acknowledged** — tokens-only, shadcn-wrapped, neutral chips, status color+label, the relevant `DESIGN_RULES.md` rules (R4/R5/R6/R7/R8/R10).
- [x] **Manual-test surfaces identified** for the `/wrap` checklist: open-contact-zero-logging, status optimistic+revert, add-follow-up, link both directions, CSV import + dedupe-preview + malformed, suggestion accept/decline, company union, `/crm`→`/contacts` redirect, needs-attention thresholds — across web + desktop.

**Ready to execute.** Blocks in order: 1 → 2 → (3 ∥ 4) → 5, gated on the spine spec's blocks 1–7 as noted.

## Open questions

- [ ] (none)
