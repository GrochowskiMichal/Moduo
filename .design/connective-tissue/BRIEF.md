# Moduo — Connective Tissue (Spine) Brief

> **Status:** Foundational. The moat — built once, alongside Contacts (module #2); Tasks is the first link consumer.
> **Pairs with:** [PRODUCT_BRIEF.md](../../docs/PRODUCT_BRIEF.md) · [ROADMAP.md](../../docs/ROADMAP.md) · [data-layers.md](../../docs/data-layers.md) (§5 the spine) · [moduo-module-contract.md](../../docs/moduo-module-contract.md) (intent ops / actors / activity / manifest)

---

## 1. What it is & the job-to-be-done

The spine is the layer that lets **any entity link, attach, relate, and roll up to any other** — across tasks, notes, calendar, contacts, finance, email — without per-pair bespoke wiring. It is *the* differentiator: not a single great module, but the connective tissue between them.

The job, in the user's words:

> "I shouldn't have to remember where things are. When I open a client, I want to see *everything* — the open tasks, the invoice I sent, the email thread, last week's call note — already there, current, without me having logged a single connection."

> "I dropped that email onto the project. Why doesn't it just *become* a task linked to the email? Every other tool makes me retype it."

The spine is what makes an all-in-one worth more than five tabs. Without it, Moduo is a worse Notion plus a worse QuickBooks. **The connection is the product.**

### Hard guardrail (the Anytype trap)
The spine **never surfaces as an abstract "generic entity" or a graph view.** Users see familiar objects — an inbox, a list, a page, a card, a contact. Links are a one-gesture, *typed and contextual* act ("paid by", "spawned from"), and roll-ups are grouped by relationship with inline snippets — never a flat backlink dump, never a node-edge canvas. The polymorphism is an implementation fact, not a user-facing concept.

---

## 2. Depth ceiling & explicit non-goals

The ceiling is the ~10 cross-cutting systems below — each shipped *thin but excellent*, none of them deep products in themselves.

| Built | Explicitly NOT built |
| --- | --- |
| `entity_links` (typed, polymorphic both ends) | A user-facing graph / node-edge view |
| Entity hub roll-up (grouped, snippet-rich) | A generic "database of everything" / schema editor |
| Drag-anything-onto-anything (one contract) | Real-time collaborative editing, live cursors |
| @-mentions (entities + people) | A chat / messaging module (keep Slack) |
| `/task` `/note` `/contact` inline refs | Arbitrary user-defined relation types at alpha |
| Auto-suggested links (load-bearing, not text-match theater) | A recommendation/ML platform; "AI links everything" gradient-sparkle treatment |
| Quick-capture command bar + Universal Inbox | A second inbox per module; competing capture surfaces |
| Curated/grouped/quiet notifications + activity | Real-time push spam; per-event interrupt notifications |
| Polymorphic tags + global cross-module search | Saved-search query language at alpha |
| MCP tools + dashboard widgets *per module* | A built-in LLM (AI is MCP-only) |

**Non-goals are a feature.** The spine's restraint (typed-not-freeform, hub-not-graph, async-not-realtime) is what keeps it legible and fast.

---

## 3. The one great moment

**Click a contact → instantly see EVERYTHING linked to them, grouped by relationship, current, with inline snippets — and you logged none of it.**

```
  Acme Corp
  ── Open work ───────────────────────────────
     ◻ Ship Q3 landing page         due Fri  ·spawned-from email
     ◻ Send revised quote           overdue
  ── Money ───────────────────────────────────
     $ Invoice #1043   $4,200   sent 12d ago · unpaid   ·paid-by ⏳
  ── Conversations ───────────────────────────
     ✉ "Re: timeline" — "...can we push launch to..."  3d ago
  ── Notes ───────────────────────────────────
     ▤ Kickoff call    "...wants weekly check-ins..."   2w ago
```

Three things make it land and separate it from a backlink list: (1) **grouped by relation_kind**, not a flat list; (2) **inline snippets** so you read without clicking; (3) **zero manual logging** — the links arrived via drag, @mention, /ref, and auto-suggest as the user did normal work. That is the demo that sells the all-in-one.

---

## 4. Must-have features

Each: what it is · the insight behind it · how it wires into the spine.

| Feature | One line · insight · spine wiring |
| --- | --- |
| **Polymorphic `entity_links`** | Typed link between any two `(entity_type, entity_id)` pairs. · The keystone: today only `task_relations` (task↔task) exists; everything else needs the *same* primitive, so build it once. · IS the spine's spine — every other system reads/writes it. |
| **Typed `relation_kind`** | Links carry meaning: `spawned-from`, `paid-by`, `references`, `blocks`, `attachment`, `mentions`. · A flat "is related to" backlink is noise; the *kind* is what lets the hub group and what makes a link readable. · Drives hub grouping, activity copy ("invoice paid by payment"), and notification phrasing. |
| **Entity hub roll-up** | A panel on every entity that groups its links by relation, with inline snippets and counts. · The great moment lives here; competitors make you hunt across tabs. · Pure read over `entity_links` + each module's snippet projector. |
| **Drag-anything-onto-anything** | One universal drag-payload contract; any source emits it, any drop target declares what it consumes. · DnD is the lowest-friction link gesture; today it's per-feature (`tasks/ui/dnd`) — fragmented. · Drop = create `entity_link` (often with a smart `relation_kind`, e.g. email→project ⇒ `spawned-from`). |
| **@-mentions (entities + people)** | Type `@` in any text surface to mention a contact, task, note — or a workspace member. · Mentions are how coordination happens without a chat module. · Entity mention ⇒ `entity_link(kind=mentions)`; person mention ⇒ notification + activity. |
| **`/task` `/note` `/contact` inline refs** | Slash-prefixed inline reference that resolves to a live, linked chip. · Writers think in prose; `/ref` lets them link without leaving the keyboard. · Inserts a typed `entity_link(kind=references)` and a live-rendering chip. |
| **Auto-suggested links** | Surfaces *probable* links from shared tags, matching email/contact addresses, and time-proximity. · Must be **load-bearing, not text-match theater** — a credible signal (cf. Midday's receipt auto-match as a model, not a proven crowd-favorite), shown as a one-tap "Link?" affordance, never auto-applied silently. · Suggested → accepted = one `entity_link`; declines are remembered to avoid nagging. |
| **Quick-capture command bar** | Global hotkey → NL parse → capture now, route later ("call Acme re: invoice tomorrow 2pm"). · Onboarding lands users in a working state; capture must never demand "which module?" up front. · Parsed entities pre-fill `entity_links` (the contact, the time block) on commit. |
| **Universal Inbox** | One destination for unrouted captures, mentions-of-you, and unlinked auto-suggestions. · A single inbox beats N per-module inboxes; it's where "route later" gets resolved. · Triage actions create links / assign / schedule via intent ops. |
| **Curated, grouped, quiet notifications** | A notification = an activity event that mentions/assigns *you*, grouped and digest-default. · Async multiplayer + graceful slippage means **no red-wall guilt, no per-event interrupts.** · Rides `module_activity`; a notification is an activity row that targets you, with read-state + deep-link. |
| **Activity trail** | Append-only, attributed event log per entity, ambient (mirror, not wall). · Agents and partners act across modules — silent writes erode trust. · `module_activity`, already live for Tasks; generalize per module as ops ship. |
| **Polymorphic tags** | Cross-module labels via `tag_links` (already polymorphic). · The cheapest cross-module connective tissue, already half-built. · Shared tags are a primary *signal* for auto-suggest. |
| **Global cross-module search** | One search across every entity type, type-aware results. · The all-in-one promise fails if you must remember which module holds a thing. · Reads all entity projections; results are drag sources and @/`/`-ref targets. |
| **MCP tools per module** | Each module registers read/write intent-op tools to the one connector. · AI is MCP-only; the spine is what makes cross-module agent action coherent. · Manifest entry in `module-registry.ts`; ops gated by scoped `workspace_api_keys`. |
| **Dashboard widgets per module** | Each module ships one live widget against the dashboard contract. · The dashboard is where the spine's roll-ups become a daily home. · Widgets read entity projections + `entity_links`. |

---

## 5. Key flows / interactions

1. **Drop to link.** Drag an email onto a project card → drop creates `entity_link(email, project, kind=spawned-from)`; a toast offers "Also make a task?" → one tap spawns a task pre-linked to both. Sub-200ms optimistic; reconciles on RPC return.
2. **Mention to connect.** In a note, type `@Acme` → contact chip inserted, `entity_link(note, contact, kind=mentions)` written; the contact's hub now shows the note with a snippet, no extra step.
3. **Capture, route later.** Cmd-K → "invoice Acme $4,200 due Fri" → parsed into a finance draft + a contact link + a due date; if ambiguous, lands in Universal Inbox for one-tap routing.
4. **Accept a suggestion.** Opening a task with a contact-matching email shows a quiet "Link to thread 'Re: timeline'?" → tap accepts; decline is remembered.
5. **Read the hub.** Click any entity → roll-up grouped by relation with snippets; each row is itself a drag source / link target — the spine is recursive.
6. **Triage notifications.** A grouped digest ("3 mentions, 1 assignment") → each item deep-links to the target entity at the exact link/comment.

---

## 6. Spine wiring (this module IS the wiring; here it's the contract it offers others)

| System | Contract for every module |
| --- | --- |
| **Links / attachments** | Register your `entity_type`; emit/consume `entity_links`. Attachments are `entity_links` with `relation_kind=attachment` (one table, typed — not a sibling table at alpha). |
| **@mentions** | Provide a search projector (id, type, label, icon, snippet) so your entities are mentionable; render mention chips from the resolver. |
| **/refs** | Same projector powers `/task` `/note` `/contact`; modules declare which slash-keyword maps to their `entity_type`. |
| **Notifications** | Don't build your own. Append `module_activity` with the right actor + target; the spine derives notifications from rows that mention/assign a user. |
| **Activity** | Every intent op appends an attributed `module_activity` row (module contract Pillar 3). |
| **Tags** | Extend `tag_links.entity_type` coverage; reuse the shared `TagPicker`. |
| **MCP tools** | Register read + write intent-op tools in the module manifest (`module-registry.ts`); the one `moduo-mcp` edge function exposes them, scoped by `workspace_api_keys`. |
| **Dashboard widget** | Ship one live widget reading your entity projection + relevant `entity_links`. |

---

## 7. Data model sketch (Supabase-first)

```sql
-- THE keystone. One table, typed, polymorphic both ends.
entity_links (
  id              uuid pk,
  workspace_id    uuid not null,           -- RLS scope
  source_type     text not null,           -- 'task' | 'note' | 'contact' | 'payment' | 'email' | 'event' | ...
  source_id       uuid not null,
  target_type     text not null,
  target_id       uuid not null,
  relation_kind   text not null,           -- 'spawned-from'|'paid-by'|'references'|'blocks'|'attachment'|'mentions'
  origin          text not null,           -- 'drag'|'mention'|'ref'|'suggest'|'manual'  (for trust + dedupe)
  created_by      uuid not null,           -- actor (Pillar 2)
  created_at      timestamptz default now(),
  deleted_at      timestamptz
)
-- direction-agnostic uniqueness on (workspace, source pair, target pair, kind);
-- index both (source_type, source_id) and (target_type, target_id) for hub roll-ups.

comments (
  id, workspace_id, entity_type, entity_id,  -- polymorphic target
  body, author_id, created_at, deleted_at,
  mentions uuid[]                            -- member ids → notifications
)

tag_links ( id, workspace_id, tag_id, entity_type, entity_id )   -- EXISTING, polymorphic ✅

module_activity (                            -- EXISTING (Tasks); generalize
  id, workspace_id, module, entity_type, entity_id,
  verb, actor_id, actor_kind,                -- 'user'|'agent'|'system'
  target_user_id,                            -- set ⇒ notification candidate
  payload jsonb, created_at
)

notification_state (                         -- read-state overlay on activity
  user_id, activity_id, read_at, dismissed_at
)

email_refs ( id, workspace_id, message_id, thread_id, account, from_addr, subject, date, snippet )
                                             -- desktop syncs metadata so email participates in entity_links everywhere
```

**Polymorphic integrity.** No per-type FK is possible across `(entity_type, entity_id)`. **Recommendation:** a lightweight central `entities` registry (workspace-scoped `(entity_type, entity_id, label, deleted_at)`, written by each module's intent ops) that `entity_links`/`comments`/`tag_links` FK into. It gives one referential anchor, one place to drive the @/`/`-mention + search projector, and cascade-on-delete — without leaking a "generic entity" to the UI. Cheaper than per-type validation triggers across N modules, and it sidesteps orphaned links when an entity is deleted. (Alternative if the registry write-amplification proves costly: validation trigger + partial indexes per type — revisit at module #4.)

---

## 8. Module-specific open questions

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | `entity_links` one typed table vs. split `links`/`attachments` | **One table, typed** (`relation_kind=attachment`). Confirmed direction in data-layers §; splitting duplicates RLS, indexes, and hub-read logic. |
| 2 | Polymorphic integrity strategy | **Central `entities` registry table** (see §7). Trigger+partial-index is the fallback; decide for real before module #4 so the choice isn't retrofitted into 4 modules. |
| 3 | Drag-payload contract — shape & location | **Typed contract in `src/lib/`** (e.g. `src/lib/drag-payload.ts`): `{ entityType, entityId, label, snippet, capabilities[] }`; drop targets declare `accepts: entityType[]` and a resolver that returns the `relation_kind`. One contract replaces per-feature DnD. |
| 4 | Auto-suggest: where does it run, and how aggressive? | **Server-derived, client-confirmed.** Compute candidates from cheap deterministic signals (shared tag, address match, ±time window) in an RPC/edge step; surface as a quiet one-tap affordance, **never auto-apply**, and remember declines. Keep it load-bearing — if it can't beat coin-flip on real data, cut it rather than ship theater. |
| 5 | Is `comments` the @mention substrate, or is mention separate from comment? | **Separate concerns.** Mentions can occur in *any* text (note body, task description, comment); the mention resolver writes `entity_link(kind=mentions)` + (for people) an activity/notification row regardless of host surface. Comments are just one host. |
| 6 | Default `relation_kind` inference on drag | **Per source→target pair, declared by the drop target.** email→project ⇒ `spawned-from`, payment→contact ⇒ `paid-by`, note→anything ⇒ `references`. Always overrideable in a hover affordance; never silent-wrong. |
| 7 | Notification grouping granularity | **Digest-default, grouped by target entity then verb**, quiet hours honored. Per-event push only for explicit assignment to you. Matches graceful-slippage / no-guilt posture. |

---

## 9. Dependencies & sequencing notes

- **Built once, with Contacts (module #2).** The spine is ~60% of every module's true cost; retrofitting it into finished modules is far more expensive. Contacts is "almost pure spine" (a hub that rolls up linked work) — the ideal proof and the forcing function for the hub roll-up UI.
- **Tasks is the first link consumer.** Tasks is already Supabase-first with intent ops, `module_activity`, `tag_links`, MCP tools, and a widget. Migrate `task_relations` → `entity_links` (or dual-read during transition) so Tasks proves the link layer before Contacts depends on it.
- **Order within the spine:** (1) `entities` registry + `entity_links` + RLS + intent ops; (2) hub roll-up read + grouping; (3) drag-payload contract; (4) @mention/`/ref` resolver + projector; (5) comments; (6) notifications/activity generalization; (7) quick-capture + Universal Inbox; (8) auto-suggest; (9) global search. Each lands behind the module contract's definition-of-done (ops + activity + manifest + MCP + widget).
- **Cross-module prerequisites:** `email_refs` metadata sync (desktop → Supabase) must exist before email↔contact / email↔task links work on web. Notes must move to Supabase (async multiplayer) before note links are multiplayer-safe.
- **Performance bar:** every link gesture (drop, @mention accept, /ref insert) is an optimistic local write reconciled by an intent-op RPC — **sub-200ms is a P0**, the all-in-one's felt-quality bar.
