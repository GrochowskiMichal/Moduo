# Design Brief: Connective Tissue (the Spine)

> **Status:** Foundational — the Wave 0 spec. Built **first**, once, alongside Contacts (module #2): the spine ships as the substrate and Contacts is its first full consumer (Tasks is the first existing module to gain link capability). This brief is the authoritative cross-cutting contract every other module's design consumes.
> **Pairs with:** [PRODUCT_BRIEF.md](../../docs/PRODUCT_BRIEF.md) (§4 the moat) · [data-layers.md](../../docs/data-layers.md) (§4–5 the spine) · [ROADMAP.md](../../docs/ROADMAP.md) (Wave 0) · [.design/connective-tissue/BRIEF.md](./BRIEF.md) (product brief this deepens) · [moduo-module-contract.md](../../docs/moduo-module-contract.md) (intent ops / actors / activity / manifest) · [DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md) · [.design/foundation/DESIGN_BRIEF.md](../foundation/DESIGN_BRIEF.md) · [.design/contacts/DESIGN_BRIEF.md](../contacts/DESIGN_BRIEF.md) (the first consumer)

---

## Problem

A solo operator runs their business across five tabs and remembers, by hand, which thing relates to which. The email about the launch lives in Spark; the task it spawned lives in Linear; the client it's for lives in a spreadsheet; the invoice lives in a finance app; last week's call note lives in Notion. Nothing links, so the user *is* the link — and that memory rots.

In the user's voice:

> "I shouldn't have to remember where things are. When I open a client, I want to see *everything* — the open tasks, the invoice I sent, the email thread, last week's call note — already there, current, without me having logged a single connection."

> "I dropped that email onto the project. Why doesn't it just *become* a task linked to the email? Every other tool makes me retype it."

Two failure modes bound this problem. **Folk/Notion-light CRMs die** because the graph is manually maintained and upkeep rots — a contact page nobody trusts. **Anytype dies** the other way: it surfaces the graph as an abstract "generic entity / Relations" model with a steep learning curve, so the connective power never reaches a normal user. The spine has to deliver Anytype's connectedness with Linear's immediacy and Folk's trustworthiness — *without* a graph view, *without* a schema step, and *without* manual logging.

For the maintainer, there's a second problem: today only `task_relations` (task↔task) exists. Every other module would otherwise reinvent links, attachments, mentions, refs, notifications, and search — five times. The spine is ~60% of every module's true cost; building it once, before Contacts, is the only affordable path.

## Solution

The spine is the layer that lets **any entity link, attach, relate, and roll up to any other**, surfaced as familiar objects and one-gesture acts — never as a database to design.

The experience, end to end:

- **You read the hub.** Click a contact, a project, a task — the right rail (or, for hub-shaped objects, the center pane) shows a roll-up of *everything linked*, **grouped by relationship** (Open work / Money / Conversations / Notes), each row a one-line snippet you read without clicking. This is the same `EntityHub` component everywhere: in the Tasks detail panel, on a Contact page, on a Note.
- **You make links as a side-effect of work**, four ways, all sub-200ms optimistic: **drag** one object onto another; **@mention** an entity or a person in any text; **/ref** (`/task`, `/note`, `/contact`) to insert a live linked chip while typing; or accept a quiet **auto-suggested** "Link?" the server proposed from cheap signals.
- **Links carry meaning.** Every link has a `relation_kind` from a closed set — `references`, `spawned-from`, `blocks`, `attachment`, `mentions`, `works-at`, `follow-up`, `paid-by`. The kind is what lets the hub group and what makes the roll-up readable ("Invoice #1043 · paid-by ⏳").
- **You capture without choosing a destination.** Cmd-K → capture mode → natural language ("call Acme re: invoice tomorrow 2pm") parses into a task with a contact link and a time, committed optimistically; if unroutable it lands in the **Tasks Inbox** bucket. (The dedicated Universal Inbox *screen* is deferred to the Email wave — Wave 5.)
- **You're told quietly.** A notification is a `module_activity` row that mentions or assigns *you*, surfaced in the existing NotificationCenter sheet, digest-default, grouped by target then verb, deep-linking to the exact spot. No red wall.
- **You find anything.** Global cross-module search is folded into Cmd-K: one query, type-aware results, each result a drag source and a @/`/`-ref target.

The polymorphism is an implementation fact. The user only ever sees an inbox, a list, a page, a card, a chip.

## Experience Principles

**1. Connected, never abstract.** *(Tension: a universal link layer wants to surface as a generic-entity/graph model — the Anytype trap — but users need familiar objects.)* The moat NEVER renders as a node-edge canvas or a "define your object type" step. Links appear as typed roll-up rows with snippets, neutral inline chips, and one-gesture affordances. `relation_kind` is a **closed set at alpha** (no user-defined relations) precisely so the act stays legible. Polymorphism lives in the schema, not the UI.

**2. Links are a side-effect, not a chore.** *(Tension: a trustworthy graph needs many links, but manual logging rots.)* Every link is created in the flow of doing something else — dropping, mentioning, writing, or accepting a suggestion. No link gesture costs more than one action, and every one is optimistic (sub-200ms felt). Auto-suggest is *load-bearing* (real deterministic signals) but **never auto-applied** — the user stays the author of their graph, and declines are remembered so the affordance never nags.

**3. Quiet by default, present when summoned.** *(Tension: cross-module activity is the moat, but uncurated cross-module notifications are a top incumbent complaint that poisons the moat.)* The hub, the activity trail, and notifications are **mirrors, not walls** — factual, grouped, digest-default, monochrome, never alarming. Color stays reserved for tags and status; ambient info is muted-foreground. The spine is felt as calm coverage ("it's all here, current") rather than a stream of interrupts.

## Aesthetic Direction

- **Philosophy:** The spine has almost no chrome of its own — it is *connective tissue*, visible only as roll-up rows, chips, a suggestion strip, and palette results threaded through other modules. Its aesthetic job is restraint: make connections legible without ever drawing attention to "linking" as a feature.
- **Tone:** Calm, factual, monochrome. A hub roll-up reads like a quiet ledger, not a dashboard. Inheriting the foundation: near-black canvas (`bg-background`), the `bg-card` panel ladder, one pink accent (`--primary`) reserved for primary actions only.
- **References:** **Things 3** (the calm, snippet-rich list), **Linear** (mono + one accent, the activity trail's restraint), **Spotify** (the surface ladder behind the hub panel). **Folk** for the contact-as-hub roll-up shape — but quieter.
- **Anti-references:** No graph/canvas view (Anytype). No AI-sparkle or gradient treatment on auto-suggest — it is a plain one-tap strip, not a "magic" moment (the pink AI disc is the *only* AI styling moment and the spine does not touch it). No per-type chip colors (no rainbow of entity types). No red notification wall. No Material FABs for "+ link".

## Existing Patterns This Extends

The spine extends only the **Tasks** module's shipped patterns plus the cross-cutting chrome (palette, notifications, tags). The `/crm` stub, `/grid`, and the notes/email/calendar/mindmap visuals are throwaway — this brief reuses none of their designs, only the design system (tokens + shadcn primitives) and the Tasks patterns below.

| Pattern / file | How the spine extends it |
| --- | --- |
| **Tasks detail panel** — `src/features/tasks/ui/task-detail-panel.tsx` | The Collections sections (Tags / Subtasks / Blocked-by) and the Activity trail generalize into the reusable **`EntityHub`** roll-up. The `PropertyRow` stack, ghost inline edits, quiet ambient `Mirror`, and `Field` label pattern carry over verbatim. |
| **TagChip / TagPicker** — `src/components/tag-chip.tsx`, `tag-picker.tsx`, `tag_links` (polymorphic ✅) | The new **`EntityRefChip`** mirrors TagChip's borderless inline *layout* but is **monochrome** — no `data-label`, no hue (type icon + label only). `tag_links` is the model for `entity_links`: polymorphic `(entity_type, entity_id)`, and is reused as a primary auto-suggest signal. |
| **GlobalCommandPalette** — `src/components/app/global-command-palette.tsx` (opened via `moduo:palette:open`) | Gains a **Search** mode (cross-module results) and a **Capture** mode (NL parse). Existing nav/settings groups stay; results become drag sources + ref targets. |
| **NotificationCenter** — `src/components/notification-center.tsx` (right Sheet, bell + unread badge, workspace/global scope) | Notifications become `module_activity` rows targeting you, overlaid with `notification_state`. Replace the raw `eventType`/`JSON.stringify(payload)` rendering with verb-grouped, target-grouped cards that deep-link. Keep the Sheet, badge, scope toggle. |
| **Lexical `SlashCommandPlugin`** — `src/features/notes/editor/plugins/SlashCommandPlugin.tsx` | Add `/task`, `/note`, `/contact` to the `COMMANDS` list (group "Refs"); selecting one opens the **MentionPicker** resolver and inserts a live **`EntityRefNode`** (a new Lexical decorator node rendering `EntityRefChip`). |
| **`module_activity` + intent-op RPCs** (`tasks_op_*`) — `…_module_activity_intent_ops.sql` | Every spine mutation is an intent op (`links_op_create`, `links_op_set_kind`, `links_op_delete`, `comments_op_add`, `notifications_op_mark_read`) — permission guard + mutation + activity log + entities-registry upsert, one transaction. |
| **Module manifest / registry** — `src/lib/module-manifest.ts`, `src/lib/module-registry.ts` | The spine registers a `links` manifest (read resources: `links.list`, `links.suggest`, `entities.search`; write ops: create/set-kind/delete). Other modules gain link capability by upserting into the `entities` registry and emitting `entity_links` — no per-module link wiring. |
| **FeaturePanelsShell** — `src/components/app/feature-panels-shell.tsx` | Hub pages compose this shell; the `EntityHub` lives in the right rail for any module and in the center pane for hub-shaped objects (Contacts). |
| **shadcn primitives** — `src/components/ui/` | Command, Popover, Sheet, Card, Badge, Separator, ScrollArea, Tooltip, Sonner, ContextMenu, DropdownMenu — all reused, none rolled by hand. |

## Information Architecture

The spine adds **one persistent surface concept** (the hub roll-up, which is not a route — it lives inside other modules) and **no new top-level routes in Wave 0**. The `/crm` stub repurposes to `/contacts` in Wave 1 and is the first dedicated hub *page*.

| Where | What lives there |
| --- | --- |
| **Right rail (any module)** | `EntityHub` for the selected object, generalizing the Tasks detail panel: title → ghost description → `PropertyRow` stack → **link roll-up grouped by `relation_kind`** → ambient mirrors → comments → activity trail. |
| **Center pane (hub-shaped objects)** | The same `EntityHub` rendered large — for Contacts (Wave 1), a contact page IS the roll-up. The component is identical; only the container differs (`variant="rail" | "page"`). |
| **Cmd-K palette (global)** | Search mode (cross-module results) + Capture mode (NL → Tasks Inbox when unrouted). Opened via `moduo:palette:open` or the bottom pill's Search. |
| **NotificationCenter (right Sheet, global)** | Bell trigger in the top bar; cross-module notification cards, scope toggle, mark-all-read. |
| **Inline (any text surface)** | `@mention` popover, `/ref` slash menu, `EntityRefChip` rendering. |
| **Auto-suggest strip** | A quiet one-row affordance at the top of the hub roll-up ("Link to thread 'Re: timeline'?" · Link · Dismiss). |
| **Deferred to Wave 5** | The dedicated **Universal Inbox screen** (its own route) — captures + email + mentions + unlinked suggestions. Wave 0 routes unrouted captures into the Tasks Inbox bucket instead. |

## Component Inventory

The hub roll-up is **one reusable component, `EntityHub`, owned by the spine.** Every module — Tasks today, Contacts as the first full consumer — renders the same component; consumers select a `variant` and supply per-type snippet projectors, they do not re-implement it. (Contacts' brief names its center-pane usage `ContactHub` for that page's composition, but the grouped roll-up inside it is this `EntityHub` / `EntityHubSection`, not a parallel build.)

| Component | Exists / Modify / New | Notes |
| --- | --- | --- |
| **`EntityHub`** | **New** (generalizes task-detail-panel; spine-owned) | The one reusable roll-up. Props: `entity: {type, id}`, `variant: "rail" | "page"`. Renders grouped link sections (by `relation_kind`), inline snippets, counts, the suggestion strip, comments, activity. Each row is a drag source + link target. |
| **`EntityHubSection`** | **New** | One `relation_kind` group: heading + count + ordered `EntityHubRow`s. Reuses the `Field` / uppercase-label pattern from task-detail-panel. |
| **`EntityHubRow`** | **New** | Type icon + label + one-line snippet + ambient meta (date/status). Click deep-links; draggable; `…` opens ContextMenu (change kind / unlink / open). |
| **`EntityRefChip`** | **New** (mirrors `TagChip` layout) | **NEUTRAL** inline chip: type icon + label, monochrome. No `data-label`, no hue. Used in prose (via `EntityRefNode`), in `@mention` results, in property values. Resolves label/icon from the entities registry. |
| **`MentionPicker`** | **New** (composes `Command` + `Popover`) | Triggered by `@` or `/ref`. Searches the entities registry (people + entities), type-aware, keyboard-first. Returns `{type, id, label, icon, snippet}`. |
| **`EntityRefNode`** | **New** (Lexical decorator node) | Live-rendering ref inside Lexical; renders `EntityRefChip`, resolves label from the registry, click deep-links. Persists `{type, id}`, not the label. |
| **`LinkSuggestionStrip`** | **New** | One-tap quiet affordance at the hub top. Server-derived candidates; Link (accept) / Dismiss (remembered). No sparkle. |
| **`DropLinkTarget` / `useDragPayload`** | **New** (`src/lib/drag-payload.ts`) | The universal contract: source emits `DragPayload`; target declares `accepts` + a `resolveKind(source, target)`. Drop → optimistic `entity_link` + Sonner toast (undo + kind-override chip). |
| **SlashCommandPlugin** | **Modify** | Add `/task` `/note` `/contact` (group "Refs"); wire to `MentionPicker` + `EntityRefNode`. |
| **GlobalCommandPalette** | **Modify** | Add Search mode (cross-module) + Capture mode (NL parse). |
| **NotificationCenter** | **Modify** | Verb/target-grouped cards, deep-links, `notification_state` overlay. Keep Sheet + bell + scope toggle; swap raw JSON rendering. |
| **`CaptureForm`** | **New** (inside palette Capture mode) | NL parse preview → editable chips for parsed entity/time → commit (optimistic) into Tasks Inbox + pre-filled `entity_links`. |
| **Sonner toast (undo + kind chip)** | **Exists, extend usage** | Drop-to-link confirmation with Undo and an inline `relation_kind` override. |
| **Command / Popover / Sheet / Card / Badge / Separator / ScrollArea / Tooltip / ContextMenu** | **Exists** | Reused as-is. |
| **`PropertyRow` / `Field` / `Mirror`** | **Exists** | Lifted out of task-detail-panel into shared use by `EntityHub`. |

## Key Interactions / Flows

Every link gesture is an **optimistic local write reconciled by an intent-op RPC; sub-200ms felt is a P0 bar.** On RPC failure, the optimistic row reverts and a quiet error toast offers Retry.

1. **Drop to link.** User drags an email card onto a project card. → On drag start, the source emits a `DragPayload`; valid drop targets (declaring `accepts: ["email"]`) get a 2px `--ring` outline. On drop: the project's hub inserts the email row **immediately** (optimistic), under the group from `resolveKind(email, project)` = `spawned-from`; a Sonner toast appears: *"Linked email → project · spawned-from"* with **Undo** and an inline `relation_kind` chip to override. `links_op_create` reconciles; on return the row stamps `origin='drag'`. *(Stretch toast action: "Also make a task?" → spawns a task pre-linked to both.)*

2. **Mention to connect.** In a note, user types `@Acme`. → `MentionPicker` popover opens, filtered live against the registry; selecting "Acme Corp" inserts a neutral `EntityRefChip` in the prose and writes `entity_link(note, contact, kind=mentions)` optimistically. Acme's hub now shows the note under **Notes** with a snippet — no extra step. A person-mention (`@Mike`) instead writes a `module_activity` row targeting Mike → his NotificationCenter.

3. **/ref while writing.** User types `/task` in a note. → SlashCommandPlugin shows the Refs group; choosing it opens `MentionPicker` scoped to tasks; selecting inserts an `EntityRefNode` (live chip) and `entity_link(note, task, kind=references)`. Typing `/task Ship la…` with no match offers **"Create task 'Ship la…'"** → creates the task (intent op) and links it in one action.

4. **Accept a suggestion.** Opening a task whose linked email address matches a contact shows a `LinkSuggestionStrip`: *"Link to thread 'Re: timeline'?"* → **Link** writes `entity_link(…, origin='suggest')` optimistically and the strip collapses; **Dismiss** records the decline (suppressed for that pair). Never auto-applied; never more than one suggestion shown at rest.

5. **Read the hub.** User clicks any entity. → `EntityHub` renders sections in a fixed relation order (Open work → Money → Conversations → Notes → Other), each row a snippet projected by the owning module. Each row is itself a drag source and link target — the spine is recursive. Section headers carry counts; long sections collapse with "Show all (N)".

6. **Change a link's kind.** User opens an `EntityHubRow`'s `…` ContextMenu → "Change relation" → picks from the closed `relation_kind` set. → Row re-groups optimistically; `links_op_set_kind` reconciles; the change appends an activity row.

7. **Capture, route later.** Cmd-K → Capture mode → "invoice Acme $4,200 due Fri". → NL parse shows a preview with editable chips (contact: Acme · amount · due Fri). Commit creates a task in the **Tasks Inbox** bucket with `entity_link(task, contact, kind=references)` and the due date, optimistically. If a referenced entity is ambiguous, the chip stays unresolved and the task lands in Inbox for one-tap routing later.

8. **Search across modules.** Cmd-K → type. → Results group by `entity_type` (Tasks / Notes / Contacts / …), each row type-iconed; Enter deep-links, drag starts a link, and a result can be dropped into an open hub.

9. **Triage notifications.** Bell → NotificationCenter Sheet. → Cards grouped by target entity then verb ("Acme Corp — 2 mentions, 1 assignment"); each deep-links to the exact link/comment and clears its `notification_state.read_at` on open. Digest-default; quiet.

## States & Edge Cases

| State | Behavior |
| --- | --- |
| **Empty hub** | No links: a quiet `empty-state` — "Nothing linked yet. Drag, @mention, or /ref to connect." Never an error tone. |
| **Loading** | Roll-up sections show 2–3 skeleton rows (ScrollArea height reserved to avoid layout shift). Snippets load lazily per section via each module's projector. |
| **Optimistic in-flight** | New row renders at full opacity immediately; a faint trailing spinner only if the RPC exceeds ~600ms. |
| **RPC error** | Optimistic row reverts; quiet danger-toned toast with **Retry**. The link is never silently lost. |
| **Conflict (async multiplayer)** | A link the partner already created is **idempotent** via direction-agnostic uniqueness — the second create no-ops; the row simply appears. Concurrent kind-changes: last-write-wins, surfaced in the activity trail. |
| **Deleted entity / orphan** | On delete, the owning intent op sets `entities.deleted_at` (tombstone). Roll-up rows for tombstoned targets render **dimmed** as "Deleted [type]" with the link still visible (so the user understands the gap), and offer "Remove link". Search and the @/`/`-picker exclude tombstoned entities. No dangling FK — every link FKs the registry. |
| **Permission denied** | If `canEdit` is false (RLS / `workspace_members.permissions_*`), link gestures are absent (no drop ring, no remove ✕), the hub is read-only, and a hidden RPC attempt fails server-side. Matches the Tasks panel's `canEdit` gating. |
| **Large-N** | A hub with hundreds of links: sections cap at ~8 rows with "Show all (N)"; counts always shown. Hub read is **one indexed query** over `entity_links` (both ends indexed) + batched snippet projection — never N per-module fan-outs. Search is paginated. |
| **Self / duplicate link** | Self-links blocked; duplicate `(workspace, pair, pair, kind)` blocked by the unique constraint (idempotent). |
| **Cross-module reference to not-yet-synced data** | Email refs not yet synced from desktop render a placeholder row "Email (syncing…)"; resolves on `email_refs` arrival. |

## Data Model (Supabase-first)

Source of truth is Supabase. All mutations go through intent-op RPCs (permission guard + mutation + `module_activity` + **entities-registry upsert**, one transaction). RLS scopes every table by `workspace_id` via `workspace_members`.

```sql
-- CENTRAL polymorphic registry — the referential anchor for the whole spine.
entities (
  workspace_id   uuid not null,
  entity_type    text not null,            -- 'task'|'note'|'contact'|'company'|'payment'|'invoice'|'email'|'event'|...
  entity_id      uuid not null,
  label          text not null,            -- denormalized title for search + @mention + roll-up resolution
  icon           text,                     -- type glyph hint (resolved client-side to a lucide icon)
  deleted_at     timestamptz,              -- tombstone → cascade dimming, search exclusion
  primary key (workspace_id, entity_type, entity_id)
)
-- UPSERTED by every module intent op in the same transaction as its own mutation.

-- THE keystone. One table, typed, polymorphic both ends. FKs into entities.
entity_links (
  id            uuid pk,
  workspace_id  uuid not null,
  source_type   text not null, source_id uuid not null,
  target_type   text not null, target_id uuid not null,
  relation_kind text not null,             -- CLOSED set @ alpha:
                                           --   references|spawned-from|blocks|attachment|
                                           --   mentions|works-at|follow-up|paid-by
  origin        text not null,             -- drag|mention|ref|suggest|manual  (trust + dedupe)
  created_by    uuid not null,             -- actor (Pillar 2)
  created_at    timestamptz default now(),
  deleted_at    timestamptz,
  foreign key (workspace_id, source_type, source_id) references entities,
  foreign key (workspace_id, target_type, target_id) references entities
)
-- direction-agnostic UNIQUE on (workspace, least/greatest of the two pairs, kind);
-- index (workspace, source_type, source_id) AND (workspace, target_type, target_id) for hub roll-ups.

comments (                                  -- polymorphic, one host among many for mentions
  id, workspace_id, entity_type, entity_id, -- FK → entities
  body, author_id, created_at, deleted_at,
  mentions uuid[]                           -- member ids → notifications
)

notification_state (                        -- read-state overlay on module_activity
  user_id, activity_id, read_at, dismissed_at,
  primary key (user_id, activity_id)
)

email_refs (                                -- desktop syncs metadata; email participates in links everywhere
  id, workspace_id, message_id, thread_id, account, from_addr, subject, date, snippet
)
-- on insert, also upserts entities(entity_type='email', label=subject) so email is mentionable/linkable on web.

link_suggestion_declines (                  -- "remember my no"
  workspace_id, user_id, source_type, source_id, target_type, target_id,
  primary key (workspace_id, source_type, source_id, target_type, target_id)
)
```

**Closed `relation_kind` set (canonical, shared by every module):** `references` · `spawned-from` · `blocks` · `attachment` · `mentions` · `works-at` · `follow-up` · `paid-by`. `references` is the default when a gesture implies no stronger kind. Hyphenated tokens are the wire format. Adding a kind is a schema change, never a runtime/user action at alpha.

**Polymorphic-integrity decision — central `entities` registry.** *(Resolved 2026-06-24 and now consistent across [docs/decisions.md](../../docs/decisions.md), `data-layers.md` §"Open architectural questions", and ROADMAP Q5 — all already reflect the registry; this brief is the authoritative shape.)* Each module already runs an intent op per mutation; adding one tiny `entities` upsert in that same transaction is cheap (a single-row PK upsert, no fan-out). In return we get **(1) one indexed referential anchor** — `entity_links`, `comments`, and `tag_links` FK into the registry, so deletes are clean and there are no dangling polymorphic references; **(2) one place to drive search + the @mention/`/ref` picker + roll-up label resolution** (the registry's `label`/`icon` is the single projection, not N per-module reads); **(3) cascade/tombstone-on-delete** via `deleted_at`, which is what makes the orphan state above tractable. The alternative — per-type validation triggers + partial indexes — costs **N per-module fan-out queries** on every hub read and every search, duplicates index strategy across 6 modules, and leaves orphan handling bespoke. Decide it now so it isn't retrofitted into finished modules.

**Definition of done (per the module contract):** the spine ships **intent ops** (`links_op_create` / `_set_kind` / `_delete`, `comments_op_add`, `notifications_op_mark_read` / `_mark_all_read`, `entities_op_upsert` helper) · **actor attribution** on every op · **`module_activity`** rows for every mutation (the substrate notifications derive from) · a **`links` manifest** in `module-registry.ts` (read: `entities.search`, `links.list`, `links.suggest`; write: the ops above) · **MCP tools** exposing those ops via the `moduo-mcp` edge function (so an agent can link/search across modules) · a **dashboard widget** ("Recently linked" / "Needs triage" — recent `entity_links` + unrouted captures, grouped). Auto-suggest candidates are computed server-side from deterministic signals (shared `tag_links`, matching `email_refs.from_addr` ↔ contact, ±time window) in an RPC/edge step; if it can't beat coin-flip on real data, it's cut, not shipped as theater.

## Responsive Behavior

This is a desktop Tauri app (min 1024×700); no mobile.

- **≥ 900px:** Three-pane `FeaturePanelsShell`. The `EntityHub` lives in the right rail (`variant="rail"`) for task/note/etc. selections, and in the center (`variant="page"`) for hub-shaped objects (Contacts, Wave 1). Rails resizable, widths persisted per-feature; min 12% / max 40%.
- **< 900px (split-screen):** Right rail collapses into a `Sheet`; the hub renders inside it unchanged. Cmd-K and NotificationCenter are already overlay/Sheet surfaces — unaffected. Same desktop design, rails closed by default.
- **Drag across panes** works at all widths; drop targets are pane-local. When a rail is collapsed to a Sheet, dropping is done via the open Sheet or via @mention/`/ref` instead.
- **No icon-rail mode, no layout transforms above 1920px** — hub content stays in the rail/center column at its bounded width.

## Accessibility

- **Focus:** every link affordance (drop target, ref chip, picker item, suggestion strip, notification card) has a `:focus-visible` 2px `--ring` with 2px offset; mouse focus stays quiet. Dialog/Sheet/Popover restore focus on close (shadcn/Radix default).
- **Keyboard:** the entire spine is operable without a pointer. `@`/`/ref` pickers are `Command`-driven (arrow/enter/escape). **Drag has a keyboard equivalent** — every drag source row exposes a "Link to…" action (Enter on a focused row → `MentionPicker` to choose the target), since drag-only would exclude keyboard users. Suggestion strip: Tab to Link/Dismiss. Notification cards: Enter to open + mark read.
- **Contrast:** WCAG 2.1 AA for hub rows, snippets, chips, and notification text on `bg-card`/`bg-popover`. Snippet text uses `text-muted-foreground` verified at AA.
- **Reduced motion:** drop-target ring, optimistic row insertion, and toast entrance honor `prefers-reduced-motion` (durations collapse to 0 via the motion tokens). No bypassing with hardcoded durations.
- **Color is never the only signal:** `relation_kind` is conveyed by the **section heading text** (the grouping) plus a type icon per row — never by color. The `EntityRefChip` is monochrome by design; the type icon (not color) distinguishes a task from a contact. Status colors keep their paired icon/label. Notification unread state pairs the badge color with a count and a card weight difference.
- **Screen readers:** ref chips announce type + label ("task: Ship Q3 landing page"); hub sections are labeled landmarks; the unread badge has an `aria-label` count.

## Out of Scope

- **A user-facing graph / node-edge / canvas view.** The moat never surfaces as a graph. (Hard guardrail.)
- **A generic-entity model or schema editor in the UI.** No "define your object type" step; `entity_type` set is code-owned at alpha.
- **User-defined `relation_kind`.** Closed set at alpha; revisit post-alpha.
- **The dedicated Universal Inbox screen.** Deferred to Wave 5 (Email); Wave 0 routes unrouted captures to the Tasks Inbox bucket.
- **Real-time collaborative editing / live cursors / a chat module in the spine.** Async multiplayer only; coordination = comments + @mentions + notifications. *(Chat + calls is now a separate module planned for the Duo/Team plans — decided 2026-10-02, not yet specced — so it is out of the spine's scope, not the product's. See [decisions.md](../../docs/decisions.md).)*
- **A built-in LLM or AI-styled suggestion UI.** AI is MCP-only; auto-suggest is a plain deterministic strip, no sparkle/gradient.
- **A separate `attachments` table.** Attachments are `entity_links` with `relation_kind='attachment'`.
- **Per-type chip colors / a per-entity-type accent palette.** Chips are neutral; color stays reserved for tags + status.
- **Saved-search query language.** Cmd-K search is type-aware but not a query DSL at alpha.
- **Contacts hub *content*** (people/companies model, auto-rollup specifics) — that's Wave 1's brief at [.design/contacts/DESIGN_BRIEF.md](../contacts/DESIGN_BRIEF.md). This brief defines the reusable `EntityHub` it consumes.
- **Notes cloud-sync (Yjs↔Postgres)** — Wave 3; note links become multiplayer-safe then. `email_refs` desktop→Supabase sync is a Wave 1/2 prerequisite, specced in [data-layers.md §6](../../docs/data-layers.md), not here.

---

Key files referenced (all absolute):
- `/Users/maciej/Documents/Coding/moduohyb/.design/connective-tissue/BRIEF.md` (product brief deepened here)
- `/Users/maciej/Documents/Coding/moduohyb/.design/contacts/DESIGN_BRIEF.md` (the spine's first full consumer)
- `/Users/maciej/Documents/Coding/moduohyb/src/features/tasks/ui/task-detail-panel.tsx` (the panel `EntityHub` generalizes)
- `/Users/maciej/Documents/Coding/moduohyb/src/components/tag-chip.tsx` (layout `EntityRefChip` mirrors, monochrome)
- `/Users/maciej/Documents/Coding/moduohyb/src/components/app/global-command-palette.tsx` (gains Search + Capture modes)
- `/Users/maciej/Documents/Coding/moduohyb/src/components/notification-center.tsx` (cards become activity-derived + grouped)
- `/Users/maciej/Documents/Coding/moduohyb/src/features/notes/editor/plugins/SlashCommandPlugin.tsx` (add `/task` `/note` `/contact`)
- `/Users/maciej/Documents/Coding/moduohyb/src/lib/module-manifest.ts` (the `links` manifest shape)

**Cross-doc status (reconciled):** this brief's central-`entities`-registry decision is now consistent across [docs/decisions.md](../../docs/decisions.md) (2026-06-24), [docs/data-layers.md](../../docs/data-layers.md) §"Open architectural questions", and ROADMAP Q5 — the earlier "trigger validation + partial indexes" framing has already been superseded in all of them. The Contacts brief adopts the registry identically. The execution contract is in [specs/connective-tissue.md](../../specs/connective-tissue.md).
