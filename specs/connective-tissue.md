# Spec: Connective Tissue (the Spine) — Wave 0 core

> Status: **Ready to execute** · Owner: maciej · Related briefs: [`.design/connective-tissue/BRIEF.md`](../.design/connective-tissue/BRIEF.md), [`.design/connective-tissue/DESIGN_BRIEF.md`](../.design/connective-tissue/DESIGN_BRIEF.md) · Contract: [`docs/moduo-module-contract.md`](../docs/moduo-module-contract.md) · Architecture: [`docs/data-layers.md`](../docs/data-layers.md) §5
>
> This spec is the **execution contract** over the spine briefs. It does not restate them — the product/UX/visual detail lives in the BRIEF + DESIGN_BRIEF and is referenced by section. This adds acceptance criteria, the tests that prove them, the block decomposition, the resolved technical decisions, and the Definition-of-Ready gate.

## Scope

Build the **Wave-0 spine substrate** — the layer that lets any entity link, attach, relate, and roll up to any other — to the depth Contacts (module #2, the architecture's proof) requires. Concretely: the central `entities` registry, the polymorphic typed `entity_links` keystone, the reusable `EntityHub` roll-up read, the universal drag-payload contract, the `@mention` / `/ref` resolver and neutral `EntityRefChip`, polymorphic `comments`, the generalization of `module_activity` into curated notifications, and deterministic (non-ML) auto-suggested links — each shipped behind the four-pillar module contract (intent ops + actor attribution + activity + manifest) plus an MCP surface and a dashboard widget. Tasks (shipped) is the first existing link consumer; `task_relations` dual-emits into `entity_links` so the link layer is proven before Contacts depends on it.

Why now: the spine is ~60% of every module's true cost and is built **once, alongside the second module** rather than retrofitted into five finished ones (ROADMAP Wave 0; data-layers §5). It is the moat (PRODUCT_BRIEF §4).

**Out of this spec (deferred, build-with-first-consumer):** the Cmd-K **Search mode** and NL **Capture mode**, the dedicated **Universal Inbox screen**, and global cross-module **search** as a destination. The spine BRIEF §9 sequences these as later sub-phases (steps 7–9) and the ROADMAP defers the Universal Inbox's payoff to Wave 5 (Email); Contacts does not need them to prove the architecture. Wave 0 routes unrouted captures into the existing **Tasks Inbox bucket**. See [Out of scope](#out-of-scope).

## Product behavior & UX

Authoritative walkthrough: **DESIGN_BRIEF §Solution + §Key Interactions/Flows (flows 1–6)**. In brief, the spine surfaces only as familiar objects and one-gesture acts — never a graph or schema step (the Anytype guardrail, DESIGN_BRIEF Experience Principle 1):

- **Read the hub.** Selecting any entity renders the same `EntityHub` (right rail `variant="rail"`; center `variant="page"` for hub-shaped objects) — links grouped by `relation_kind` in a fixed order (Open work → Money → Conversations → Notes → Other), each row a one-line snippet projected by the owning module, with counts and "Show all (N)". (DESIGN_BRIEF flow 5; IA table.)
- **Make links four ways, all sub-200ms optimistic:** **drag** one object onto another (drop → `entity_link`, kind from `resolveKind(source,target)`, Sonner toast with Undo + kind-override); **@mention** an entity (neutral chip + `kind=mentions`) or a person (activity row → notification); **/ref** (`/task` `/note` `/contact`) inserts a live `EntityRefChip`; or accept a quiet **auto-suggested** "Link?" the server proposed. (DESIGN_BRIEF flows 1–4.)
- **Links carry meaning** via a closed `relation_kind` set; the kind drives hub grouping and roll-up phrasing. Changing a kind re-groups optimistically (flow 6).
- **Told quietly.** A notification is a `module_activity` row that mentions/assigns *you*, surfaced in the existing NotificationCenter sheet — digest-default, grouped by target then verb, deep-linking, never a red wall (flow 9; Experience Principle 3).

States surface uniformly (empty / loading / optimistic-in-flight / error / conflict / tombstone / permission-denied / large-N) per the matrix below.

## Edge cases

Authoritative matrix: **DESIGN_BRIEF §States & Edge Cases**. Each row below becomes a test or a manual-test surface:

- **Empty hub** — quiet empty-state ("Nothing linked yet. Drag, @mention, or /ref to connect."), never an error tone.
- **Loading** — skeleton rows with reserved height (no layout shift); snippets load lazily per section.
- **Optimistic in-flight** — new row at full opacity immediately; trailing spinner only if the RPC exceeds ~600ms.
- **RPC error** — optimistic row reverts; quiet danger-toned toast with **Retry**; the link is never silently lost.
- **Conflict (async multiplayer)** — a link the partner already created is idempotent via direction-agnostic uniqueness (second create no-ops); concurrent kind-changes are last-write-wins, surfaced in the activity trail.
- **Deleted entity / orphan** — the owning op sets `entities.deleted_at` (tombstone); roll-up rows for tombstoned targets render dimmed as "Deleted [type]" with a "Remove link" action; search and the @/`/`-picker exclude tombstones; no dangling FK (every link FKs the registry).
- **Permission-denied** — `canEdit=false` removes all link gestures (no drop ring, no remove ✕); hub is read-only; a forced RPC fails server-side.
- **Large-N** — sections cap at ~8 rows with "Show all (N)" + counts; hub read is one indexed query over `entity_links` (both ends indexed) + batched snippet projection, never N per-module fan-outs.
- **Self / duplicate link** — self-links blocked; duplicate `(workspace, unordered-pair, kind)` blocked by the unique constraint (idempotent).
- **Cross-module ref to not-yet-synced data** — an email not yet synced from desktop renders a placeholder "Email (syncing…)" row; resolves on `email_refs` arrival.

## Acceptance criteria

- **AC1 — Typed link, both ends polymorphic.** Creating a link between any two registered entities writes one `entity_links` row with a `relation_kind` from the closed set and an `origin`; both ends FK into the `entities` registry. A `relation_kind` outside the closed set is rejected.
- **AC2 — Idempotent + direction-agnostic.** Linking the same pair with the same kind twice (in either direction, including concurrently) yields exactly one live row; the second attempt no-ops without error. Self-links are rejected.
- **AC3 — Server-side permission.** A caller without `edit`+ on the relevant module cannot create/change/delete a link; the op raises and no row changes. Owner→admin, member→their `permissions_*` level normalized (legacy `write`/`read` mapped), else `none`.
- **AC4 — Attributed activity on every mutation.** Every link/comment/notification mutation appends one attributed `module_activity` row (actor resolved server-side from auth context, never client-supplied) in the same transaction as the write.
- **AC5 — Registry upsert in-transaction.** Every entity-creating/renaming op upserts `entities(workspace_id, entity_type, entity_id, label, icon)` in the same transaction; deleting an entity sets `entities.deleted_at` (tombstone) rather than leaving dangling links.
- **AC6 — Hub roll-up read, grouped + current.** Opening an entity renders its links grouped by `relation_kind` in the fixed order, each with a one-line snippet + count, from **one indexed query** (not N per-module fan-outs); tombstoned targets render dimmed with "Remove link"; empty/loading/error states render per the matrix.
- **AC7 — Drag to link.** Dragging a valid source onto a target that `accepts` its type shows a drop affordance; on drop the target's hub inserts the row optimistically under `resolveKind(source,target)`, and a toast offers Undo + a `relation_kind` override; the persisted row stamps `origin='drag'`. A keyboard "Link to…" equivalent exists on every drag-source row.
- **AC8 — @mention / /ref link.** Typing `@`/`/ref` in any text surface opens the registry-backed `MentionPicker`; selecting an entity inserts a **neutral** monochrome `EntityRefChip` (type icon + label, no hue) and writes `entity_link(kind=mentions for @, references for /ref)`; selecting a person writes an activity row targeting them; `/task Foo` with no match offers "Create task 'Foo'" and links it in one action.
- **AC9 — Comment mention → notification.** Adding a comment that `@`-mentions a workspace member writes the comment + an attributed activity row targeting that member; it appears in their NotificationCenter as a grouped, deep-linking card; opening it clears its unread state.
- **AC10 — Quiet, grouped notifications.** Notifications are derived from `module_activity` rows targeting the user, overlaid with `notification_state`, grouped by target entity then verb, digest-default; "mark all read" and per-card mark-on-open work; no per-event interrupt and no red-wall styling.
- **AC11 — Auto-suggest: load-bearing, never auto-applied.** Suggested links are computed server-side from deterministic signals only (shared `tag_links`, `email_refs.from_addr`↔contact email, ±time window); surfaced as a one-tap strip (max one at rest); **Accept** writes a link with `origin='suggest'`; **Dismiss** records a decline that is never re-offered for that pair; nothing is ever linked without a tap.
- **AC12 — MCP + dashboard DoD.** The spine registers a `links` manifest (read: `entities.search`, `links.list`, `links.suggest`; write: the link/comment/notification ops) in `module-registry.ts`, exposed via the `moduo-mcp` edge function; and ships one live dashboard widget ("Recently linked / Needs triage").
- **AC13 — Tasks proves the link layer.** `task_relations` (blocker→blocked) is readable/writable as `entity_links` (`kind=blocks`) without regressing the existing Tasks blocked-by behavior (dual-path during transition).
- **AC14 — Design constraints.** All new UI uses semantic tokens only (no raw hex / arbitrary Tailwind for color/size/radius/font), shadcn-wrapped primitives, neutral ref chips (color reserved for tags + status), density/motion via tokens, and pairs every status/color signal with an icon or label. (Per [Design constraints](#design-constraints-r1r10).)

## Tests that prove them

The agent authors these from the ACs (the designer does not write tests). Cheapest proving layer per the repo's actual harness: **unit** = Vitest (`src/**/*.test.ts(x)`, `describe/it`, jsdom; in CI via `bun run verify`); **component/visual** = Storybook story + Playwright snapshot (`tests/visual/*.spec.ts`, local/manual — visual diffs are *stop-and-ask*, never auto-accepted); **e2e** = Playwright (`e2e/<suite>/*.spec.ts`, local/manual). There is **no SQL unit harness** in-repo, so server-side invariants (AC1–AC5) are proven at the **e2e + manual-test** layer (behavioral round-trip) and the pure-TS halves get unit coverage; this is called out per row.

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/lib/entity-links.test.ts` · "rejects kinds outside the closed set" / "derives a direction-agnostic dedupe key" | AC1, AC2 | The TS validator accepts only the 8 canonical kinds; the unordered-pair+kind key is identical regardless of source/target order, and a self-pair is rejected. |
| `e2e/spine/links.spec.ts` · "create / dup / permission" | AC1–AC3 | Drop-to-link persists across reload; linking the same pair twice leaves one row; a viewer-permission session's link attempt fails and the UI shows no gesture. *(Server-invariant round-trip.)* |
| `src/features/spine/activity.test.ts` · "maps each spine op to a quiet sentence" | AC4 | `links_op_*` / `comments_op_add` / notification ops each render an attributed, muted activity line from their payload (mirrors `tasks/activity.test.ts`). |
| `e2e/spine/registry.spec.ts` · "tombstone on delete keeps the hub clean" | AC5 | Deleting a linked entity flips the roll-up row to a dimmed "Deleted [type]" with "Remove link", and the link no longer resolves in search/@-picker. *(Server-invariant round-trip.)* |
| `src/features/spine/rollup.test.ts` · "groups by relation_kind in fixed order; projects snippets" | AC6 | The roll-up reducer groups links into the fixed section order with counts and one-line snippets; tombstoned targets are flagged. |
| `tests/visual/spine.spec.ts` · "entity-hub — populated / empty / loading / tombstone" | AC6, AC14 | Storybook snapshots of `EntityHub` in each state read correctly and use tokens (no hardcoded color/size). |
| `src/lib/drag-payload.test.ts` · "resolveKind matrix + payload type guards" | AC7 | `resolveKind(email,project)=spawned-from`, `payment→contact=paid-by`, default `references`; `asDragPayload` rejects non-payloads. |
| `e2e/spine/drag-link.spec.ts` · "drag source onto target creates a link (per-frame pointer)" | AC7 | Using per-frame pointer delays (gotchas: dnd-kit), a drag onto a valid target inserts the optimistic row and the toast; Undo removes it; keyboard "Link to…" reaches the same result. |
| `tests/visual/spine.spec.ts` · "entity-ref-chip — task / contact / note" + `src/features/spine/mention.test.ts` · "@ vs /ref vs person branch" | AC8 | The chip is monochrome with a type icon; the resolver writes `kind=mentions` for `@entity`, `references` for `/ref`, and a person-targeted activity row for `@member`; no-match offers create-and-link. |
| `e2e/spine/comment-notify.spec.ts` · "comment @member surfaces a grouped notification" | AC9, AC10 | A comment mentioning a member produces one grouped NotificationCenter card that deep-links and clears unread on open; "mark all read" clears the badge. |
| `src/features/spine/notifications.test.ts` · "groups by target then verb; digest-default" | AC10 | The grouping reducer collapses N activity rows into target→verb cards; no per-event card; unread/read derived from `notification_state`. |
| `src/features/spine/suggest.test.ts` · "deterministic candidates + decline suppression" | AC11 | Candidate scoring fires on shared-tag / address-match / time-window only; a recorded decline removes the pair from future candidates; no auto-apply path exists. |
| `e2e/spine/suggest.spec.ts` · "accept writes origin=suggest; dismiss is remembered" | AC11 | Accepting the strip adds a link tagged `origin='suggest'`; dismissing it and reloading never re-shows it. |
| `src/lib/module-registry.test.ts` · "links manifest registered with read+write surface" | AC12 | The registry includes a `links` manifest whose ops/resources match the RPC names; shape conforms to `ModuleManifest`. |
| `tests/visual/spine.spec.ts` · "recently-linked widget" + `e2e/spine/widget.spec.ts` · "widget deep-links" | AC12 | The dashboard widget renders recent links/needs-triage and each row deep-links to its hub. |
| `e2e/tasks/blocked-by.spec.ts` (extend) · "blocked-by still works via entity_links" | AC13 | The existing blocked-by flow (commit a blocked task offers its frontier) is unchanged while edges read/write through `entity_links` (`kind=blocks`). |

## Assumptions & technical decisions

Each = decision + one-clause rationale (+ the alternative rejected). Durable ones are mirrored in `docs/decisions.md`.

1. **Polymorphic integrity = central `entities` registry** (resolved 2026-06-24, decisions.md). `entity_links` / `comments` / `tag_links` FK into `entities(workspace_id, entity_type, entity_id, label, icon, deleted_at)`, upserted per intent op in the same transaction. → one indexed referential anchor + one search/@-mention/roll-up projection + clean cascade-tombstone. *Rejected:* per-type validation triggers + partial indexes (N fan-out reads per hub/search, bespoke orphan handling).
2. **Canonical `entity_links` shape** (supersedes the divergent sketches in the other module briefs): `source_type, source_id, target_type, target_id, relation_kind, origin, created_by, created_at, deleted_at` + the registry FKs. The notes/email briefs' `src/dst`/`from/to` naming is normalized to `source/target`. *Rejected:* per-module field names (breaks the one-query hub read).
3. **Closed `relation_kind` set @ alpha:** `references` (default) · `spawned-from` · `blocks` · `attachment` · `mentions` · `works-at` · `follow-up` · `paid-by`. Hyphenated wire tokens; adding one is a migration, never a runtime/user action. *Rejected:* user-defined relations (the Anytype trap).
4. **Direction-agnostic uniqueness** via a generated unordered-pair key (`least/greatest` of the two `(type,id)` pairs) + `relation_kind`, enforced by a unique index. *Rejected:* app-side dedupe (races under async multiplayer).
5. **Attachments are `entity_links` with `relation_kind='attachment'`**, not a sibling table (data-layers §5; spine BRIEF Q1). *Rejected:* a separate `attachments` table (duplicate RLS/indexes/hub-read).
6. **Intent ops mirror the Tasks reference exactly:** `SECURITY DEFINER` plpgsql, `SET search_path=public`, a `spine_module_permission(workspace)` + `spine_op__guard(...)` pair, `module_activity_log(...)` for the trail, `REVOKE ALL FROM PUBLIC` / `GRANT EXECUTE TO authenticated` (service_role added with the MCP wiring). Ops: `links_op_create` / `_set_kind` / `_delete`, `comments_op_add`, `notifications_op_mark_read` / `_mark_all_read`, `entities_op_upsert` (helper). *Rationale:* Tasks is the proven pattern (Session 8); reuse beats reinvention.
7. **Auto-suggest is deterministic-only and one-tap.** Candidates from shared `tag_links`, exact `email_refs.from_addr`↔`contacts.emails`/`companies.domains`, and a ±time window, computed in an RPC/edge step; surfaced as a single quiet strip; never auto-applied; declines persisted in `link_suggestion_declines`. If it can't beat coin-flip on real data it is **cut, not shipped as theater** (spine BRIEF Q4) — and its absence does not block the spine. *Rejected:* ML/embedding suggestion, silent auto-link.
8. **`task_relations` → `entity_links` is dual-path during transition**, not a big-bang cutover: Tasks writes/reads `kind=blocks` edges through `entity_links` while the legacy table is backfilled, so the blocked-by feature never regresses (AC13). *Rejected:* hard migration before Contacts depends on the link layer.
9. **Cmd-K Search/Capture, Universal Inbox screen, global search are deferred** out of this spec (build-with-first-consumer; spine BRIEF §9 steps 7–9; ROADMAP). Wave 0 routes unrouted captures to the **Tasks Inbox bucket**. *Rationale:* the Contacts proof doesn't need them; keeps this spec bounded and gate-passable now.
10. **No SQL unit harness exists**, so AC1–AC5/AC13 server invariants are proven by **e2e round-trip + the manual-test checklist**; pure-TS logic (validation, dedupe-key, resolveKind, grouping, suggestion scoring, activity sentences) carries Vitest unit coverage. *Rationale:* prove each AC at the cheapest layer that actually exists in-repo.
11. **`comments` and `notification_state` are spine-owned and polymorphic** (FK into `entities`), with NotificationCenter re-rendered from grouped activity (DESIGN_BRIEF Component Inventory). *Rejected:* per-module comment/notification stores.
12. **Drag e2e uses per-frame pointer delays** (gotchas: dnd-kit drops same-tick synthetic events); the universal contract lives in `src/lib/drag-payload.ts`, generalizing the existing `TaskDragData`. *Rationale:* the only reliable way to live-verify dnd-kit.

## Execution blocks

Each block is sized to complete within one `/execute` context budget, is a vertical slice where possible, and is self-contained (its behavior + ACs + tests). A fresh session can resume any block from this spec + `docs/decisions.md`.

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **Registry + link substrate (DB + runtime)** | Migration: `entities`, `entity_links` (registry FKs, direction-agnostic unique, both-end indexes), `link_suggestion_declines`; helpers `spine_module_permission` / `spine_op__guard` / `entities_op_upsert`; ops `links_op_create` / `_set_kind` / `_delete`; grants + RLS (mirror Tasks); runtime methods (`runtime.web.ts` + tauri composite) for link CRUD + `entities.search`; the TS `relation_kind` validator + dedupe-key. | AC1–AC5 | — |
| 2 | **EntityHub roll-up + components** | Lift `PropertyRow`/`Field`/`Mirror` to shared; `EntityHub` / `EntityHubSection` / `EntityHubRow` (variants rail/page); the one-query roll-up read + per-module snippet-projector registry; fixed section order, counts, "Show all (N)"; empty/loading/error/tombstone states; Storybook stories. | AC6, AC14 | 1 |
| 3 | **Universal drag-payload contract** | `src/lib/drag-payload.ts` (`DragPayload`, `DropLinkTarget`, `useDragPayload`, `resolveKind`); generalize `TaskDragData`; drop → optimistic `links_op_create` + Sonner toast (Undo + kind override); keyboard "Link to…" equivalent. | AC7, AC14 | 1, 2 |
| 4 | **@mention / /ref resolver + EntityRefChip** | `MentionPicker` (Command+Popover over registry), neutral `EntityRefChip`, Lexical `EntityRefNode`, SlashCommandPlugin `/task` `/note` `/contact`; entity-mention → `kind=mentions`, person-mention → activity row, `/ref` → `references`, no-match → create-and-link. | AC8, AC14 | 1, 2 |
| 5 | **Comments + notification/activity generalization** | `comments` table + `comments_op_add`; notification derivation from `module_activity` + `notification_state` + `notifications_op_mark_read` / `_mark_all_read`; NotificationCenter grouped/deep-linked cards (replace raw JSON rendering). | AC9, AC10, AC4, AC14 | 1 |
| 6 | **Deterministic auto-suggest + strip** | RPC/edge candidate computation (shared tag / address / time-window); `LinkSuggestionStrip` one-tap accept (`origin='suggest'`) / dismiss (`link_suggestion_declines`); max one at rest; never auto-applied. | AC11, AC14 | 1, 2 |
| 7 | **Tasks adoption + MCP manifest + dashboard widget (DoD)** | `task_relations` dual-path through `entity_links` (`kind=blocks`) with no blocked-by regression; `links` manifest in `module-registry.ts` + `moduo-mcp` exposure; "Recently linked / Needs triage" dashboard widget. | AC12, AC13, AC14 | 1, 2, 3, 5 |

## Out of scope

- **A user-facing graph / node-edge / canvas view**, a generic-entity model, or a schema editor in the UI (hard guardrail; DESIGN_BRIEF Out of Scope).
- **User-defined `relation_kind`** (closed set at alpha).
- **Cmd-K Search mode, NL Capture mode, the dedicated Universal Inbox screen, and global cross-module search as a destination** — deferred to their first consumer / Wave 5 (Assumption 9); Wave 0 routes unrouted captures to the Tasks Inbox bucket.
- **A separate `attachments` table** (attachments are `entity_links`); **per-type chip colors**; a **saved-search query DSL**; **real-time co-editing / live cursors / chat**; a **built-in LLM or AI-styled suggestion UI** (MCP-only; plain strip).
- **Contacts hub *content*** (people/companies model, auto-rollup specifics) — that is [`specs/contacts.md`](./contacts.md); this spec defines the reusable `EntityHub` it consumes.
- **Notes cloud-sync (Yjs↔Postgres)** — Wave 3. **`email_refs` desktop→Supabase sync** is a Wave 1/2 prerequisite specced in data-layers §6, not here; until it lands, email rows render the "syncing…" placeholder.

## Design constraints (R1–R10)

New UI obeys `DESIGN_RULES.md` and uses `src/styles/tokens.css` only — the `moduo-design-quality` skill enforces this on the diff:
- **Tokens only (R10):** no raw hex / arbitrary Tailwind for color, spacing, radius, or font. Any color-bearing *data* (none introduced by the spine) would route through `--label-*` / status tokens, never new hex.
- **Accent discipline (R5):** `EntityRefChip` is **neutral monochrome** (type icon + label); the pink `--primary`/`--ring` accent appears only on the one primary action / selection / focus ring. No per-entity-type hue.
- **Density + motion via tokens (R7, R6):** rows consume `--row-h`/`--pad-*`/`size-icon-*`; drop-ring, optimistic insertion, and toasts go through `--motion-*` so `prefers-reduced-motion` holds.
- **Primitives wrap shadcn (R4):** Command, Popover, Sheet, Card, Badge, Separator, ScrollArea, Tooltip, ContextMenu, Sonner — reused, never rolled by hand.
- **Color is never the only signal:** `relation_kind` is conveyed by section heading + type icon, not color; notification unread pairs badge with a count.
- **Sentence case (R8)** in all copy.

---

## Definition-of-Ready gate

> **/execute must not start a block until this is all true.**

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are filled and unambiguous (behavior/edge reference the DESIGN_BRIEF's authoritative sections; ACs are numbered + testable).
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, each with its plain-English note (AC1–AC14 mapped; server-invariant rows flagged as e2e/manual per Assumption 10).
- [x] **Open questions is empty** — the spine BRIEF's Q1–Q7 and data-layers' open architecture questions are resolved and recorded under *Assumptions & technical decisions*.
- [x] **Data model is named and Supabase-first** — `entities`, `entity_links`, `comments`, `notification_state`, `link_suggestion_declines` (+ `email_refs` as an external prerequisite); migrations identified per block; mirrors the Tasks RLS/op pattern.
- [x] **Module feature wiring enumerated** — links/attach/drag/@mention/`/ref`/notifications/activity/tags are *this module's contract* (DESIGN_BRIEF §Spine wiring); MCP tools listed (`entities.search`, `links.list`, `links.suggest` + write ops); dashboard widget defined ("Recently linked / Needs triage") — per `docs/moduo-module-contract.md`.
- [x] **Execution blocks** decomposed (7), sequenced with dependencies, each context-sized and self-contained.
- [x] **Design constraints acknowledged** — tokens-only, shadcn-wrapped, neutral chips, the relevant `DESIGN_RULES.md` rules (R4/R5/R6/R7/R8/R10).
- [x] **Manual-test surfaces identified** for the `/wrap` checklist: link create/dedupe/permission round-trips, tombstone-on-delete, drag-to-link (per-frame pointer), @/`/`-ref insertion, comment→notification, suggestion accept/decline, and the blocked-by-via-`entity_links` regression — across web + desktop runtimes.

**Ready to execute.** Blocks in order: 1 → 2 → (3 ∥ 4 ∥ 5 ∥ 6) → 7.

## Open questions

- [ ] (none)
