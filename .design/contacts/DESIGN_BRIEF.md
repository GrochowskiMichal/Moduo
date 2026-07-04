# Moduo — Contacts (Light CRM) Design Brief

> **⟶ v2 redesign (2026-06-28):** the post-alpha contact-page redesign (iOS/Folk-grade card, typed multi-value + custom fields, favorites, vCard share, attach-note, letter index) is in [REDESIGN.md](./REDESIGN.md) (design reference) + [`specs/contacts-v2.md`](../../specs/contacts-v2.md) (build contract). Read those for current direction; the sections below are the original Wave-1 brief.
>
> **Status:** Design brief — Module #2, and the connective-tissue spine's first full consumer. The spine is built **first** (Wave 0); Contacts is built second (Wave 1) on top of it, which is what forces the spine to be real. Deepens the product brief at [.design/contacts/BRIEF.md](./BRIEF.md) into the design/interaction/data layer.
> **Pairs with:** [docs/PRODUCT_BRIEF.md](../../docs/PRODUCT_BRIEF.md) (§4 the moat), [docs/data-layers.md](../../docs/data-layers.md) (§4 module contract, §5 spine), [docs/ROADMAP.md](../../docs/ROADMAP.md) (wave order), [docs/moduo-module-contract.md](../../docs/moduo-module-contract.md) (four-pillar DoD), [.design/foundation/DESIGN_BRIEF.md](../foundation/DESIGN_BRIEF.md), [.design/connective-tissue/DESIGN_BRIEF.md](../connective-tissue/DESIGN_BRIEF.md) (the spine this consumes), [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md).
> **Dependency note:** Contacts owns no link machinery. It **consumes** the spine: the entities registry, `entity_links`, the closed `relation_kind` set, `EntityHub`/`EntityRefChip`, the drag-payload contract, and the suggestion engine all belong to [the spine brief](../connective-tissue/DESIGN_BRIEF.md) and are referenced, not re-specified, here.
> **Reuse note:** Tasks is the only shipped module whose *design* this extends. The `/crm` stub, `/grid`, notes/email/calendar/mindmap visuals are throwaway — reuse only the design system (tokens + shadcn primitives) and the Tasks patterns (detail panel, intent ops, activity, manifest).

---

## 1. Problem

The solo operator runs their business in a spreadsheet. They have tried real CRMs — HubSpot, Salesforce, ClickUp CRM — and bounced off every one: *"oriented to corporate/enterprise. Overkill."* The bottom-of-market incumbent is therefore the spreadsheet, and the spreadsheet has exactly one failure mode: **nobody updates it.** Within weeks the rows are stale, the user stops trusting them, and then stops opening the file.

In the user's own voice the job is: *"Let me see everything going on with this person or company in one place, without me having to log it."* Note what they did **not** ask for: a pipeline, a deal stage, a lead score, a forecast. They asked for a **lens** onto work that already exists — the email they sent this morning, the unpaid invoice, the two open tasks, the meeting next week. Every one of those already lives somewhere in Moduo. The friction is that today it is scattered across modules and the human is the only join key.

The deeper design problem: **light CRMs die from "data no one trusts."** Any contact record that depends on manual upkeep rots. So the record cannot be a data-entry surface. It must be a *read* — current by construction, never by discipline.

---

## 2. Solution (as an experience)

You open Contacts to a dense, Linear-style list of people and companies on the left. You click **Acme Corp**. The center pane is not a form — it is the **contact hub**: a name you can edit in place, a status pill, and a single quiet line of truth at the top — *"Last touch: emailed 3 days ago · 2 open tasks · 1 invoice unpaid."* You never typed any of it.

Below that, the contact's whole history, **grouped by relationship**: an *Emails* group (the thread you replied to this morning, already here because Email synced its metadata), a *Tasks* group (the follow-up you created, the open work), *Notes*, *Events*, *Payments* — each a one-line inline snippet that deep-links to its source. Nothing is a backlink dump; everything is grouped and captioned by *why* it's linked.

On the right, a quiet **Suggested-links** strip: *"Link this email from jane@acme.com to Acme?"* — one tap, and the roll-up thickens. Below it, tags and two quick actions: set status, add a follow-up. "Add follow-up" spawns a normal task, pre-linked back to Acme; it appears under *Open items* before you've finished blinking.

There is **no "Log activity" button anywhere**, because there is nothing to log. The record is a query over `entity_links` + `module_activity`, rendered. The moment Contacts lands is the moment the user realizes they will never update a contact by hand again — and that this is the *only* mechanism that keeps a light CRM honest.

This is also the spine's proof. Contacts has almost no native depth — it is ~90% roll-up. If the connective tissue works, Contacts feels magical on a few hundred lines of module code. If it doesn't, Contacts is an empty address book. Building it second forces the spine to be real.

---

## 3. Experience principles

**1. The record is a read, never a chore. (Resolves: trustworthy data vs. zero maintenance tax.)**
Last-touch, open-items, and history are *derived* from `entity_links` + `module_activity` at view time — never stored, never manually entered. The UI has no field whose only job is to be kept current by a human. The contact is current by construction. The single editable surface (name, status, emails/phones, a one-line scratch) is small and obviously optional.

**2. Relationships, not deals. (Resolves: "a real CRM" expectation vs. the enterprise gravity well.)**
Contacts tracks relationships, not a pipeline. A "deal" is just a task or note *linked* to a contact — we never instantiate a pipeline object, a stage machine, or automation. Status is a flat, renamable label (Lead/Active/Dormant/Archived), not a funnel. The ceiling is Folk-lite; the moment we add stages-with-rules we become the overkill we're displacing.

**3. Links feel like a side-effect of work, never a schema task. (Resolves: deep connectedness vs. the Anytype "define your object type" trap.)**
People and companies are *familiar objects* — an address-book row and a company card — never nodes in a visible graph. Linking happens by the spine's four gestures — drag-onto, `@mention`, `/ref`, and one-tap accept of an auto-suggestion. Inline entity-ref chips are **neutral** (type icon + label, monochrome — color stays reserved for tags + status). Roll-ups are grouped-by-relationship with snippets, never a flat backlink pile.

---

## 4. Aesthetic direction

Inherits the foundation wholesale — this module introduces **zero** new aesthetic ideas, only new content shapes.

- **Philosophy:** refined, content-first, dark-canvas operator tool. Calm, confident, intentional. The contact hub should read like a well-set page of someone's working relationship — Things-3 calm in the layout, Linear rigor in the list, Spotify's surface ladder for depth.
- **Tone:** quiet. The hub's top line is *factual*, never alarming — "1 invoice unpaid" is `muted-foreground` text with an icon, never a red wall (the same ambient-mirror discipline as the Tasks detail panel's drift/blocked mirrors). Overdue follow-ups surface in the dashboard widget as a gentle queue, not a guilt counter.
- **Color discipline:** single pink accent (`--primary`) on black/gray, used once per view at most (the primary action). Status uses the **fixed status colors paired with a label** (color is never the only signal). Tags use the 8 `data-label` hues. Entity-ref chips are monochrome. No per-entity-type color (this matches the spine: chips carry no hue).
- **References:** Linear (the people/company list, mono + one accent), Things 3 (the unhurried hub), Folk (the "contact = rolled-up relationship" model), Spotify (surface ladder: `background` canvas → `card` panes → `popover` menus).
- **Anti-references:** Salesforce/HubSpot dense bordered forms and pipeline kanban; Material FABs; the Anytype generic-entity/relation-schema view; AI-sparkle/gradient treatments; skeuomorphic rolodex/business-card textures. **No node-edge graph view, ever.**

---

## 5. Existing patterns this extends

Contacts extends only the **Tasks** module's shipped patterns plus the spine's reusable primitives. The `/crm` stub, `/grid`, and the notes/email/calendar/mindmap visuals are throwaway — no design is reused from them, only the design system (tokens + shadcn primitives) and the Tasks patterns below.

| Pattern | File / token | How Contacts uses it |
| --- | --- | --- |
| **FeaturePanelsShell** (3-pane, resizable, sheets <900px) | `src/components/app/feature-panels-shell.tsx` | The `/contacts` page composes it: left list, center hub, right strip. `feature="contacts"` (renamed `FeatureLayoutKey`). |
| **Tasks detail panel** (title `Input`, ghost `Textarea`, `PropertyRow` stack, full-width Collections, quiet mirrors, Activity trail) | `src/features/tasks/ui/task-detail-panel.tsx` | The Tasks panel is also the seed of the spine's `EntityHub`; Contacts' hub header reuses the in-place title `Input` + `PropertyRow` stack + ghost fields verbatim in shape, and the right strip reuses `Field`/`Mirror`. |
| **`EntityHub` / `EntityHubSection` / `EntityRefChip`** (spine-owned) | spine brief — `src/lib/…` | The grouped roll-up. **Consumed, not rebuilt** — see §7. |
| **Intent ops** (`tasks_op_*`: guard + mutate + activity in one txn) | `supabase/migrations/…_module_activity_intent_ops.sql`, `src/features/tasks/ops-manifest.ts` | `contacts_op_*` mirror the exact shape; the follow-up flow calls the existing `tasks_op_commit`. |
| **Module manifest / registry** | `src/lib/module-manifest.ts`, `src/lib/module-registry.ts` | New `contactsModuleManifest` in `src/features/contacts/ops-manifest.ts`, registered for MCP. |
| **TagPicker + TagChip** (polymorphic via `tag_links`) | `src/components/tag-picker.tsx`, `src/components/tag-chip.tsx` | Tags on contacts/companies — add `contact`/`company` to covered `entity_type`s. |
| **SlashCommandPlugin** | `src/features/notes/editor/plugins/SlashCommandPlugin.tsx` | The spine adds `/contact` to its Refs group; Contacts is the resolver target — selecting it inserts a live neutral `EntityRefChip` backed by an `entity_links` row. |
| **global-command-palette** (`moduo:palette:open`) | `src/components/app/global-command-palette.tsx` | "Go to contact…", "New contact", "Import contacts" entries; contact results in the spine's unified search. |
| **NotificationCenter** (right Sheet, bell + unread badge, scope toggle) | `src/components/notification-center.tsx` | Contact-scoped notifications (follow-up due, linked invoice overdue) ride `module_activity`; no new primitive. |
| **shadcn primitives** | `src/components/ui/*` | `command` (pickers), `popover`, `dialog` (import), `select`/`date-field` ghost variants, `property-row`, `badge`, `avatar`, `scroll-area`, `segmented-control`, `tabs`, `sonner` (undo toasts), `tag-input`, `empty-state`, `context-menu`, `tooltip`, `separator`. |
| **Density / tokens** | `src/styles/tokens.css` (`--row-h`, `--ctrl-h*`, `--pad-*`, `--icon-*`, `data-label`) | List rows respect density (comfortable/compact/dense → 28px rows at densest, Linear-level). No bespoke spacing. |

---

## 6. Information architecture

**Route:** repurpose the throwaway `/crm` stub into **`/contacts`**.

- `src/routes/pages/crm-page.tsx` → renamed/replaced by `src/routes/pages/contacts-page.tsx` (composes `FeaturePanelsShell`).
- `src/app/router/route-tree.tsx` (`crmRoute`, ~lines 88–92; import at line 11): path `/crm` → `/contacts`, `CrmPage` → `ContactsPage`. Add a redirect `/crm` → `/contacts` for any stale deep-links. **This is a rename of an existing route, not a new top-level route** (honors the "no new routes without confirming" rule — `/contacts` is the planned destination of `/crm`).
- `src/features/layout/panel-events.ts`: rename the `"crm"` `FeatureLayoutKey` to `"contacts"` (and its `defaults` entry); update `routeToFeatureLayout` (`/contacts` → `"contacts"`).
- New feature dir: `src/features/contacts/` (hook `use-contacts-module.ts`, `ui/`, `ops-manifest.ts`, `model.ts`, `rollup.ts`).

**Three panes (the FeaturePanelsShell slots):**

| Pane | Width | Contents |
| --- | --- | --- |
| **Left — Directory** | ~20% (`--width-rail`) | Dense list of people **and** companies, one row each (avatar/monogram + name + secondary line + status dot). A segmented control or filter header: **All / People / Companies**. Saved filters (by status / tag) as a small saved-views list above the list. Search input at top. New-contact `+` icon-button. |
| **Center — Contact hub** | ~60% | The spine's `EntityHub` (`variant="page"`) composed for a contact: editable header (title `Input`, status `Select`, the last-touch/open-items line), then the **link roll-up grouped by `relation_kind`** with inline snippets, then the contact's own activity trail. This is the one great moment. |
| **Right — Context strip** | ~20% (`--width-rail`) | Quiet **Suggested-links** strip (top), **Tags** (`TagPicker`), **Quick actions** (Set status, Add follow-up, Link existing…), and contact meta (emails, phones, created/updated). |

Below 900px the side panels collapse to sheets (shell behavior, unchanged). For a **company**, the center hub gains a *People* group (its members via `works-at`) and rolls up the **union** of those people's linked work one level higher.

---

## 7. Component inventory

The grouped roll-up is the spine's **one reusable component, `EntityHub`** (with `EntityHubSection` / `EntityHubRow`), owned by [the spine brief](../connective-tissue/DESIGN_BRIEF.md). Contacts **consumes** it as the center pane (`variant="page"`) and supplies the per-type snippet projectors for the types it links — it does **not** re-implement the roll-up. `ContactHub` below is the page-level composition (header + hub + activity), not a parallel roll-up build; `SuggestedLinksStrip` and `EntityRefChip` are likewise spine components Contacts renders.

| Component | Exists / Modify / New | Notes |
| --- | --- | --- |
| `ContactsPage` | New (replaces `CrmPage`) | Composes `FeaturePanelsShell` with the three contact slots. |
| `ContactDirectory` (left list) | New | `scroll-area` of `ContactRow`s; `segmented-control` for People/Companies/All; saved-filter list; search `Input`; `+` `icon-button`. Density via `--row-h`. |
| `ContactRow` | New | `avatar` (monogram fallback) + name + secondary line (company/email) + status dot (status color + tooltip label). `context-menu`: set status, add follow-up, archive, delete. |
| `SavedFilterList` | New | Status/tag query chips; "+ Save current filter". No new storage primitive — a saved filter is a serialized status/tag query (lean toward `user_preferences`-style serialization at alpha; a tiny `contact_saved_filters` table only if profiling warrants). |
| `ContactHub` (center) | New — page-level composition over the spine `EntityHub` | `ContactHeader` + `LastTouchLine` + the spine's `EntityHub` (`variant="page"`, grouped `EntityHubSection`s) + `ActivitySection`. The roll-up itself is the spine component, not new code. |
| `ContactHeader` | New | In-place `Input` for name; `Select` (ghost) for status; `PropertyRow` stack for company (`works-at`), emails, phones; ghost `Textarea` for `notes_inline` one-line scratch. |
| `LastTouchLine` | New | Quiet ambient mirror (reuses the Tasks `Mirror` shape): "Last touch: emailed 3 days ago · 2 open tasks · 1 invoice unpaid". `muted-foreground`, icons, never red. |
| `EntityHub` / `EntityHubSection` / `EntityHubRow` | **Spine (consumed)** | The grouped-by-`relation_kind` roll-up + snippet rows. Contacts passes `entity={type:"contact"|"company", id}` and registers snippet projectors. |
| `RollupSnippetRow` projector | New (Contacts' contribution) | The contact module's per-type snippet resolver feeding `EntityHubRow` (one-line snippet + deep-link + relative timestamp). Hover reveals "unlink" (removes the edge, never the entity — mirrors Tasks' `RelatedTaskRow`). |
| `EntityRefChip` | **Spine (consumed)** | **Neutral** monochrome chip (type icon + label, no hue). Resolves label/icon from the entities registry. Rendered for `/ref`, `@mention`, inline contact references. |
| `SuggestedLinksStrip` | **Spine (consumed)** | One-tap "Link?" affordances (server-derived). Accept → `contacts_op_link`; Decline → remembered (dismissed, never re-suggested). |
| `QuickActions` | New | Set status (`Select`/`dropdown-menu`), **Add follow-up** (`button`, primary), Link existing… (opens the spine entity picker). |
| `LinkEntityPicker` | New (composes the spine `MentionPicker`/`command`) | `command` palette filtered to linkable entities (search across the registry); also the target of drag-onto. |
| `ContactImportDialog` | New | `dialog` with 3 steps: drop CSV → column-map (`select` per column) → dedupe-preview → import. Calls `contacts_op_import`. |
| `TagPicker` / `TagChip` | Exists | Reused as-is; extend `entity_type` coverage to `contact`/`company`. |
| `PropertyRow`, `Select`, `Input`, `DateField`, `Textarea` (ghost) | Exists | Reused verbatim. |
| `global-command-palette` entries | Modify | "Go to contact", "New contact", "Import contacts". |
| `NotificationCenter` | Exists | No code change beyond `module_activity` rows; renders contact-scoped notifications. |
| `ContactsNeedsAttentionWidget` | New | Dashboard widget (DoD). Contacts with overdue follow-up / no touch in N days / stale-lead count. Live, deep-links to the hub. |
| `EmptyState` (directory / hub) | Exists | First-run empty state CTAs to import or create. |

---

## 8. Key interactions & flows

All writes are **optimistic, reconciled by an intent-op RPC; the sub-200ms felt bar is P0** (same contract as the spine). Server reconciliation is silent on success; on failure the optimistic state rolls back with a `sonner` toast (often with **Undo**).

**1. First run → CSV import (the adoption gate).**
User opens `/contacts` → empty state: "Import your contacts" / "Add one". They click Import → `ContactImportDialog`. Drop CSV → app parses headers, auto-guesses column mapping (name/email/company/phone/tags) shown in `select`s → **dedupe-preview** lists matches (email first, then normalized name+company) with per-row merge/skip/create choices → Confirm. UI: import runs via `contacts_op_import` (one attributed, activity-logged op); progress in the dialog; on done, the directory is populated and the dialog closes to the list. **No blank canvas.** Dedupe never silently merges or duplicates.

**2. Open a contact (the moment).**
Click a `ContactRow` → center hub renders. **State change:** selection sets the URL search param (`?id=`); the hub keys on it (resets header drafts, like the Tasks panel keys on `task.id`). **Feedback:** the `LastTouchLine` and roll-up render from cached roll-up data instantly (<200ms; revalidated in the background). Roll-up groups appear by relation, snippets ordered by recency. No "log" affordance exists.

**3. Set status (optimistic, inline).**
In the header, change the status `Select` → optimistic pill update <200ms → `contacts_op_set_status` (guard + write + activity). On failure: revert + toast. Status options are the workspace's renamable labels (default Lead/Active/Dormant/Archived). Renaming a label is a settings-level edit, never inline stage-building.

**4. Add a follow-up (the "CRM action").**
QuickActions → "Add follow-up" → inline quick-create (title + optional due `DateField`). Submit → calls **`tasks_op_commit`** (a normal task — no new task code) and **`contacts_op_link`** with `relation_kind = follow-up`. **Feedback:** the task appears under the hub's *Tasks → Open items* group immediately (optimistic), and `LastTouchLine`'s open-items count ticks up. A `follow-up` link with a due date drives the dashboard widget + a digest notification.

**5. Link existing work (both directions, one row).**
From the contact: `/ref` in any editor, **drag** an email/task/note onto the hub (it is a drop target declaring what it `accepts` via the spine's one drag-payload contract), or "Link existing…" → `LinkEntityPicker`. From the other side: drag a contact onto a task/event, or `@mention` a contact in a note. **Every path writes the same `entity_links` row** via the spine. Optimistic: the snippet appears in the relevant roll-up group at once.

**6. Accept / decline a suggestion.**
`SuggestedLinksStrip`: "Link this email from jane@acme.com to Acme?" Accept (one tap) → `contacts_op_link`, roll-up thickens, suggestion clears. Decline → the suggestion is **remembered as declined** (the spine's `link_suggestion_declines` row) and never re-offered. Suggestions are **never auto-applied** — silent linking is the exact "data no one trusts" failure.

**7. Company → people.**
Open a company → hub shows a *People* group (members via `works-at`) plus the union of their linked work rolled up one level. Drag a person onto a company (or set company in a person's header) → writes a `works-at` `entity_links` row **and** sets the denormalized `contacts.company_id` (canonical = the link; FK = fast-list convenience).

**8. Saved filters.**
Apply status/tag filters on the directory → "Save current filter" names it; it appears in `SavedFilterList`. Clicking it re-applies the query. Pure query, no per-contact storage.

---

## 9. States & edge cases

| State | Behavior |
| --- | --- |
| **Empty (no contacts)** | Directory + hub show `EmptyState`: "Import your contacts" (primary) / "Add one". No fake demo rows. |
| **Empty roll-up (new contact, no links)** | Hub renders header + the spine's "Nothing linked yet. Drag, @mention, or /ref to connect." empty state with the link affordances. Teaching, not blank. |
| **Loading** | Directory: skeleton rows respecting `--row-h`. Hub: header from the cached row immediately; roll-up groups show a thin loading shimmer while the link+snippet join resolves (stale-while-revalidate — never block the header). |
| **Error (write)** | Optimistic state reverts; `sonner` toast "Couldn't save status — retry?" with Undo/Retry. Reads that fail show a quiet inline "Couldn't load history — retry" per group, never a full-pane error. |
| **Conflict (async multiplayer)** | Last-write-wins on scalar fields (status, name) with a quiet activity entry attributing the other actor; links are additive (the spine's direction-agnostic uniqueness makes concurrent creates idempotent — union, no conflict). On refresh, the hub reflects the merged state; no live-cursor UI (async multiplayer only). |
| **Deleted entity / orphan link** | A linked entity that's been deleted resolves via the entities registry to a **tombstone snippet** ("Deleted [type]") that is inert (no deep-link); the spine's tombstone-on-delete keeps the FK clean. The roll-up never shows a broken/clickable dead link, and offers "Remove link". |
| **Permission-denied** | `canEdit=false` (mirrors Tasks): header fields disabled, no QuickActions, suggestions hidden, roll-up + activity read-only. Intent ops are guarded server-side regardless. |
| **Large-N (hundreds of contacts / a heavy contact)** | Directory virtualizes rows. Roll-up: the spine's single indexed `entity_links` join + per-module snippet resolver, paginated per group ("Show all (N)"). If profiling misses the 200ms bar, promote last-touch/open-items to a materialized view — **do not pre-optimize** (per the brief's open question). |
| **Degraded modules (Finance/Email not yet shipped)** | The roll-up engine is **entity-type-agnostic** — it renders whatever types are linked. Payment/email groups simply don't appear until those modules sync their refs. No special-casing; Finance "lights up for free" when it lands. |
| **Import: malformed CSV / unmappable columns** | Column-map step flags unrecognized columns (mappable to "ignore" or "tags"); rows missing a name are previewed as errors and skipped, not silently dropped. |

---

## 10. Data model (Supabase-first)

Contacts owns only `contacts` and `companies` (RLS workspace-scoped, mirroring Tasks). The spine tables — `entities`, `entity_links`, `module_activity`, `tag_links`, `link_suggestion_declines` — are **shared and owned by [the spine brief](../connective-tissue/DESIGN_BRIEF.md)**; Contacts is a participant, not an owner, and adopts their definitions verbatim (shown abbreviated here for reference).

```
contacts
  id            uuid pk
  workspace_id  uuid fk → workspaces           -- RLS scope
  company_id    uuid? fk → companies           -- denormalized convenience; canonical = works-at link
  display_name  text
  emails        text[]                         -- powers email→contact auto-suggest
  phones        text[]
  status        text                           -- lead | active | dormant | archived (labels renamable)
  notes_inline  text?                          -- one-line scratch; rich notes live in Notes, linked
  created_by    uuid fk → auth.users           -- actor attribution
  created_at, updated_at  timestamptz

companies
  id            uuid pk
  workspace_id  uuid fk → workspaces
  name          text
  domains       text[]                         -- powers email→company auto-suggest
  status        text?
  created_by, created_at, updated_at

-- SPINE (shared; owned by the spine brief; Contacts adopts, does not own) ───────

entities                                       -- the central polymorphic REGISTRY (see note)
  workspace_id  uuid
  entity_type   text   -- 'contact'|'company'|'task'|'email'|'note'|'event'|'payment'|...
  entity_id     uuid
  label         text   -- resolved display label (for search, @mention, roll-up)
  icon          text   -- type icon key (neutral chip)
  deleted_at    timestamptz?                   -- tombstone (orphan-safe roll-ups, cascade)
  PRIMARY KEY (workspace_id, entity_type, entity_id)

entity_links                                   -- THE keystone; polymorphic both ends, typed
  id            uuid pk
  workspace_id  uuid
  source_type, source_id   text/uuid           -- FK into entities
  target_type, target_id   text/uuid           -- FK into entities
  relation_kind text   -- CLOSED set @ alpha (shared, canonical):
                       --   references(default)|spawned-from|blocks|attachment|
                       --   mentions|works-at|follow-up|paid-by
  origin        text   -- drag|mention|ref|suggest|manual
  created_by, created_at

tag_links                  -- existing polymorphic; add entity_type 'contact','company'
module_activity            -- existing append-only trail; Contacts writes 'contact','company'
link_suggestion_declines   -- spine table; Contacts' "remember my no" rides it
```

**Closed `relation_kind` set (canonical, owned by the spine, identical across modules):** `references` · `spawned-from` · `blocks` · `attachment` · `mentions` · `works-at` · `follow-up` · `paid-by`. Contacts uses `works-at` (person↔company), `follow-up` (the CRM action), `references` (default link), `mentions` (note/@), `attachment`, and reads `paid-by`/`blocks`/`spawned-from` from other modules. Hyphenated tokens are the wire format.

**Why a central `entities` registry — supersedes the earlier trigger+partial-index decision.** *(Identical decision to the spine brief; stated here because Contacts is where it earns its keep, but it is owned by the spine. Resolved 2026-06-24 and now consistent across [docs/decisions.md](../../docs/decisions.md), `data-layers.md` §"Open architectural questions", and ROADMAP Q5.)* The hub must, in one query, (a) find every link touching this contact and (b) resolve each linked entity to a *snippet label + type icon* — and search and the `@mention` picker need the same. Without a registry that is **N per-module fan-out queries** plus per-type FK validation scattered across modules, and clean deletes require N cascade triggers. A lean central `entities(workspace_id, entity_type, entity_id, label, icon, deleted_at)` — **UPSERTED by each module's intent op in the same transaction** as its own mutation — turns that into **one indexed query**, gives `entity_links`/`tag_links`/comments a single FK target, powers search + the `@mention` picker + roll-up label resolution from one place, and makes deletes clean (tombstone-on-delete cascades). The cost is one tiny extra upsert per mutation — cheap now, expensive to retrofit across finished modules.

**Roll-up is a read, never stored state.** `contacts.get` returns the row + a derived bundle: links via `entity_links` → resolved via `entities` → snippet via the owning module's resolver, grouped by `relation_kind`, ordered by recency. Last-touch = max activity timestamp across links; open-items = linked tasks (status≠done) + unpaid linked payments. Nothing is written to keep a contact "current."

**Person↔company:** write the `works-at` `entity_links` row (canonical, keeps the spine uniform) **and** set `contacts.company_id` (denormalized, fast list render). Both; link canonical.

**Auto-suggest** is the spine's engine, fed by Contacts' fields: email **domain** match → company (`companies.domains`), email **address** match → person (`contacts.emails`), shared tag, ±time window. High-precision signals (domain/address) suggest confidently; name matches suggest weakly. Always one-tap human confirm; declines remembered. Never auto-applied.

**Intent ops (`contacts_op_*` — guard + mutate + `entities` upsert + `module_activity` in one txn):**

| Op | RPC | Summary |
| --- | --- | --- |
| `contacts.create` | `contacts_op_create` | Create a person or company; upserts the registry, logs activity. |
| `contacts.update` | `contacts_op_update` | Edit name / emails / phones / company_id / notes_inline. |
| `contacts.set_status` | `contacts_op_set_status` | Change relationship status. |
| `contacts.link` | `contacts_op_link` | Write an `entity_links` row (incl. accepting a suggestion); typed `relation_kind`. |
| `contacts.unlink` | `contacts_op_unlink` | Remove a link edge (never the entity). |
| `contacts.import` | `contacts_op_import` | Bulk import with dedupe; one attributed, activity-logged op. |

**MCP tools (manifest in `src/features/contacts/ops-manifest.ts`, registered in `module-registry.ts`):** read — `contacts.list`, `contacts.get` (with roll-up bundle), `contacts.search`; write — the six ops above. The follow-up flow reuses the existing `tasks_op_commit`.

**Definition of done (module contract, four pillars):** intent-op RPCs + actor attribution + `module_activity` writes + `ModuleManifest` registered + MCP tools + the **"Needs attention" dashboard widget**. Not done until all are present. RLS workspace-scoped on `contacts`/`companies` (and Contacts' rows in the shared spine tables), mirroring the Tasks policies.

---

## 11. Responsive behavior

- **≥900px:** full 3-pane `FeaturePanelsShell` (directory / hub / context strip), resizable with persisted widths. Min window 1024×700 (app-wide).
- **<900px:** left directory and right strip collapse to **sheets** (shell-handled). The hub becomes the single visible pane; a top-bar control toggles the directory sheet (left) and context sheet (right). Same toggle/restore logic the shell already implements for Tasks.
- The directory list, hub rows, and snippets all respond to the **density** axis (`--row-h`, `--pad-*`) — comfortable → dense (Linear-level at the dense end). No hardcoded heights.
- Mobile/tablet is **out of scope** (desktop-only, app-wide).

---

## 12. Accessibility

- **Focus:** every interactive element (rows, status select, link affordances, suggestion accept/decline, import controls) has the shadcn `:focus-visible` ring (`focus-visible:ring-2 ring-ring`). Hover-revealed unlink buttons are reachable and visible on focus (mirrors Tasks' `RelatedTaskRow`).
- **Keyboard:** directory is arrow-navigable; Enter opens the hub. `/` or the palette for search; `c` (or the palette) to create. Roll-up snippets and deep-links are tab-reachable. The drag-to-link gesture has the spine's keyboard equivalent ("Link to…" on a focused row). Import dialog is fully keyboard-operable (`dialog` focus trap).
- **Contrast:** all text via semantic tokens (`foreground` / `muted-foreground`) meeting AA on `card`/`background`. Snippets in `muted-foreground` are body-size, not sub-minimum.
- **Reduced motion:** roll-up reveals, group collapse, and suggestion accept honor `prefers-reduced-motion` via the motion tokens — no bypassing with hardcoded durations.
- **Color is never the only signal:** **status** = status color **+ label** (and a tooltip on the dot in the dense list); **tags** = hue **+ name**; **entity-ref chips** are monochrome **+ type icon + label** (no reliance on color at all); the last-touch "unpaid" mirror is **icon + text**, never a bare red dot.

---

## 13. Out of scope (prevent scope creep)

- **Sales pipelines, deal stages, kanban, forecasting, quota, lead scoring.** A "deal" is a task/note linked to a contact — no pipeline object, ever.
- **Marketing automation, email sequences, drip campaigns, web forms, lead capture, internet enrichment.**
- **Custom fields at alpha.** Fixed fields (name, status, emails, phones, one-line scratch) + tags + saved filters only. No user-defined schema (that is the Anytype/Notion-database trap).
- **Status *stages with automation/rules*.** Labels are renamable; they do not gain triggers, required transitions, or a funnel.
- **Long-form notes inside the contact.** Rich notes live in the **Notes module**, linked. `contacts.notes_inline` is a one-line scratch only.
- **A node-edge graph view / generic-entity browser.** The moat surfaces only as familiar objects + grouped roll-ups (the spine's hard guardrail).
- **Owning any spine machinery.** `entity_links`, the `entities` registry, the closed `relation_kind` set, `EntityHub`/`EntityRefChip`, the drag-payload contract, and the suggestion engine are defined and owned by the spine brief; Contacts consumes them.
- **Real-time collaborative editing, live cursors, in-app chat.** Async multiplayer only; coordination = comments + `@mentions` + notifications.
- **Built-in AI / model.** AI is MCP-only via the registered manifest.
- **The full web Email client and the Finance/Payments module.** Contacts depends only on **email metadata sync** (`email_refs`: id, thread, from, subject, date, account — data-layers §6) for email↔contact links; payment roll-up degrades gracefully until Finance ships.
- **Mobile / tablet layouts; light-mode visual tuning.** Desktop-dark only at alpha.

---

Files referenced (all absolute): briefs — `/Users/maciej/Documents/Coding/moduohyb/.design/contacts/BRIEF.md`, `/Users/maciej/Documents/Coding/moduohyb/.design/connective-tissue/DESIGN_BRIEF.md` (the spine consumed here); patterns to extend — `/Users/maciej/Documents/Coding/moduohyb/src/features/tasks/ui/task-detail-panel.tsx`, `/Users/maciej/Documents/Coding/moduohyb/src/features/tasks/ops-manifest.ts`, `/Users/maciej/Documents/Coding/moduohyb/src/lib/module-manifest.ts`, `/Users/maciej/Documents/Coding/moduohyb/src/components/app/feature-panels-shell.tsx`; route to repurpose — `/Users/maciej/Documents/Coding/moduohyb/src/routes/pages/crm-page.tsx`, `/Users/maciej/Documents/Coding/moduohyb/src/app/router/route-tree.tsx` (lines 88–92, import line 11), `/Users/maciej/Documents/Coding/moduohyb/src/features/layout/panel-events.ts` (the `"crm"` `FeatureLayoutKey`); tokens — `/Users/maciej/Documents/Coding/moduohyb/src/styles/tokens.css`.
