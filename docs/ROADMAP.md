# Moduo — Roadmap & Next Steps

> **Status:** The plan of record toward the full-suite alpha. Written 2026-06-24 from the alpha research + strategy round.
> **Pairs with:** [PRODUCT_BRIEF.md](./PRODUCT_BRIEF.md) (why), [data-layers.md](./data-layers.md) (how it's wired), [improvement-plan.md](./improvement-plan.md) (the session-by-session execution log — this roadmap sits *above* it).
> **For agents:** build in wave order. Each module's definition-of-done includes its spine wiring, MCP tools, and dashboard widget (see [data-layers.md §4–5](./data-layers.md)). Don't start a module before its wave unless explicitly told. **Open questions in §"Open Questions & Risks" gate parts of this plan — check there before building anything marked ⚠.**

---

## Build philosophy (read first)

1. **Spine-with-the-second-module.** Tasks (done) is module #1 and the first link consumer. Build the spine *primitive* alongside **Contacts** (module #2) — not in a vacuum, not after module #6. Modules 3–6 then adopt the spine natively. The spine is ~60% of every module's real cost; building it once and reusing beats retrofitting 5 finished modules.
2. **Dogfood as you go.** Full-suite alpha is the public bar, but the founder should *drop a competitor app at the end of every wave.* Each wave below names that milestone.
3. **Weakest-leg-first.** An all-in-one dies if any module reads as mediocre. Harden the weakest leg before adding the next module. Every module needs one "this is actually great" moment.
4. **Speed & reliability are P0, not polish.** Sub-200ms core interactions and conflict-free sync are launch-blocking — a single sync bug corrupts multiple linked modules' trust at once.
5. **Ship the spine wiring with each module, not later.** A module isn't done when its CRUD works — it's done when it links, attaches, drags, @-mentions, notifies, logs activity, tags, exposes MCP tools, and ships a dashboard widget.

---

## The waves

> Effort is relative (S/M/L/XL). "Drop:" = the competitor app the founder can stop opening once the wave lands. Full per-idea scores are in the [Scored Backlog](#scored-backlog) appendix.

### Wave 0 — Spine core + platform foundation
**Goal:** the connective tissue exists and is testable with Tasks + the next module; the app is fast, exports cleanly, and onboards into a working state.
**Build:**
- **Spine core:** `entity_links` (polymorphic, typed) · entity hub roll-up (grouped by relation, inline snippets) · drag-anything-onto-anything · @-mentions (entities + people) · `/task` `/note` `/contact` inline refs · auto-suggested links.
- **Guardrail:** keep each module a familiar object (inbox/list/page/card) — **no abstract "generic entity" UI.**
- **Platform:** pre-populated zero-setup default workspace · progressive single-module onboarding (start in Tasks) · perf budgets enforced as P0 · optimistic local writes over cloud-first sync · first-class importers (Notion/Todoist/Calendar/CSV/IMAP) · lossless full-data export · MCP connector generalized to per-module registration · actor attribution + visible activity feed · the iPadOS-style **dashboard shell** (live tiles, pre-populated; modules add widgets as they land).
**Heavier spine services** (build when their first consumer exists, not all up-front): global quick-capture command bar, Universal Inbox, curated/grouped/quiet notifications, global cross-module search. *(Capture + search can come early; the Universal Inbox gets its full payoff once email lands in Wave 5; notifications get theirs once @mentions/multiplayer are live.)*
**Dogfood milestone:** not yet a competitor-killer — this is the foundation the rest stands on.

### Wave 1 — Contacts (the spine proof + light CRM) ⚠ depends on Wave 0 spine core
**Goal:** prove the tissue end-to-end and ship the light CRM nobody else offers cleanly.
**Build:** people & companies as hubs (Folk-lite) · **auto-updating contact records** (last-touch / open items / history roll up from linked emails/tasks/notes/events/payments — zero manual logging) · auto-suggested links · contact/lead CSV import ("stop running your business in a Google Sheet").
**The great moment:** click a contact → see *everything* linked, grouped, current.
**Why #2:** Contacts is almost pure tissue (near-zero standalone value), so it's the cheapest module *and* the best architecture proof. Add a status field + a linked follow-up task = the light CRM.
**Drop:** the spreadsheet CRM.

### Wave 2 — Calendar + the schedule-to-completion loop (the flagship differentiator)
**Goal:** the one thing no incumbent can match without becoming heavy.
**Build:** drag-to-schedule tasks onto the calendar · **task time-block completion loop** (when a block elapses: done / push / shrink / drop; complete the task from inside the block) · roll-forward incomplete tasks · one-tap "reflow my remaining day" (graceful slippage, gentle overdue queue) · day-fullness signal (arithmetic, no AI) · multi-source calendar accounts with source attribution + default-target picker · focus-mode time write-back to the block · zero-metadata task model · opt-in pre-assembled daily-plan + evening-shutdown ritual (skippable, never gating).
**The great moment:** the day self-corrects — finish inside a block, unfinished work rolls forward, no wall of red.
**Drop:** Morgen (and the Sunsama-style ritual). Tasks becomes "Linear-light that actually runs your day."
**Fast-follow (post-core, ⚠ Q9):** Calendly-like booking links.
**Fast-follow — CalDAV/ICS read-only (dogfood-blocking, surfaced 2026-07-03, planned same day → CAL-8a/CAL-8b in BUILD_ORDER):** the designer's primary calendars live on non-Google/Outlook hostings (CalDAV/ICS, basic-auth — **no OAuth registration needed**, so this does NOT wait for the Wave-5 credentials pass). The CAL-6 mirror pipeline (accounts/mirror op/rail/attribution/visibility) is provider-agnostic and already shipped; CAL-8 adds the desktop CalDAV/ICS fetcher (Rust), the pure ical→mirror mapper (ical.js, occurrence expansion), and the connect dialog (presets: iCloud · Fastmail · Nextcloud · Other; grouped per-calendar rail rows; ICS feeds included; https-only). Spec: `specs/calendar.md` AC15–AC18 + assumptions 13–21. Until this lands, Morgen can't actually be dropped — it gates dogfooding the Wave-2 loop.

### Wave 3 — Notes rebuild (+ cloud-sync, the multiplayer enabler)
**Goal:** a make-or-break leg cleared without database heaviness; notes become a planning surface and go cloud-synced.
**Build:** fast markdown editor (Lexical) with embeds + `/task` `/note` `/contact` refs · instant note creation (no destination/property decision) · **note checkboxes that are real, schedulable tasks** · note-in-note embedding · **Supabase cloud-sync** (Yjs↔Postgres — ⚠ Q6) so notes are shareable.
**The great moment:** a checkbox in a note is a first-class task that schedules and completes.
**Drop:** Notion (for docs/notes). Enables sharing notes with a partner (multiplayer).

### Wave 4 — Finance (Midday-lite, CSV-first, no bank layer) ⚠ time-tracking + email metadata deps (Q8, Q10)
**Goal:** answer "How much did I make last month, and where did it go?" in one app.
**Build:** **money-flow overview widget** ("You made $X — here's where it went," zero setup) · CSV-first transaction import with column mapping (+ pre-built QuickBooks/Lunch Money/Mint mappings) · per-row business/personal + per-client tagging with bulk rules · custom categories · **invoicing with tracked lifecycle** (sent→viewed→paid/overdue, linked to the contact) · no invoice cap on free/entry tier · overdue-invoice auto-surfaces as a task/notification on the contact · time-tracking → invoice line items (revive the paused module — Q10) · tax-reserve / "safe to pay yourself" widget · retrospective clarity, **not** zero-based budgeting · native multi-currency · auto-match receipt emails to transactions (needs email metadata — Q8) · recurring/quarterly-tax dates auto-appear on the calendar.
**The great moment:** a receipt email auto-attaches to the transaction, linked to the client and the invoice.
**Drop:** the finance-app gap (the duct-taped PayPal + Clockify + spreadsheet stack). *This is the founder's #1 personal pain — high dogfood pull.*

### Wave 5 — Email (desktop-first hybrid, Spark replacement)
**Goal:** the unique territory the task/calendar/note pack can't reach — a real email engine in the tissue.
**Build:** email as a true **in-app pane** (Rust IMAP engine; **not** an iframe) across the 6 accounts · metadata→Supabase so email links into the tissue on every client · **convert email → task in one gesture, auto-linked to the contact** · email follow-up tracking (snooze→task/notification with back-link) · feeds the Universal Inbox.
**The great moment:** convert an email to a task linked to its sender, never leaving the inbox.
**Drop:** Spark. *Most expensive module — desktop-first deliberately avoids building/operating a web mail backend at alpha (see [data-layers.md §6](./data-layers.md)).*
**Shared-infra note (2026-07-03):** the Google/Microsoft **OAuth app registration + credentials** for email is the same consent-screen/app-registration pass the calendar mirror needs — do it once here with both calendar + mail scopes, and the calendar external-sync round-trip (engine shipped in Wave 2/CAL-6b, verified except for real creds) becomes a 15-minute checkbox inside this wave. If external calendars are wanted during the **dogfood** period before Wave 5, the registration alone can be pulled forward as a standalone ~1-hour setup — nothing else about email needs to move.

### Cross-cutting (runs across all waves)
- **GTM/trust:** per-seat **no-minimum** pricing + free student tier (⚠ Q3) · consolidation savings calculator on the landing page · "your data is yours" lossless export as a launch feature · surface the local-first "lite"/offline roadmap · (maybe) JetBrains-style perpetual-fallback license.
- **Multiplayer:** ambient glanceable shared state (who's on what / what changed) in dashboard widgets — **not** chat, not mandatory status updates.
- **Quality mandate:** every module clears its category bar + one great moment before the next wave starts.
- **MCP:** each module ships its read/write tools as part of definition-of-done (near-zero marginal cost — keep this). A **dedicated hardening pass (`MCP-1` in [specs/BUILD_ORDER.md](../specs/BUILD_ORDER.md)) runs pre-alpha**, not now: connector redeploy + a keyed write round-trip per module (the 2026-07-02 api-key gotcha proved reads can pass while writes are silently dead).
- **Housekeeping:** legacy/dead code is removed in explicit sweep blocks between waves (`CLEAN-1` in BUILD_ORDER — calendar's retired store is first), not ad-hoc inside feature blocks.

---

## Sequencing rationale (the short version)

- **Spine first (with Contacts), not last** → avoids the 5× retrofit cost; Contacts is the cheapest proof.
- **Calendar before Notes/Finance/Email** → the completion loop is the single biggest differentiator and a daily dogfood win (replaces Morgen).
- **Notes before Finance** → Notes is a make-or-break leg *and* the cloud-sync work unlocks multiplayer; do it before the heavier finance/email lifts.
- **Email last** → most expensive, desktop-first, least differentiated in isolation; but its metadata sync may need to land *early* (Q8) so Finance's receipt-matching works.
- **In-product Timeline/roadmap view** (the lightweight "Gantt" — bars on a date axis, dependency links, drag-to-reschedule) is a Tasks feature that rides the existing dependency + scheduling data; slot it in Wave 2 or shortly after. *(Planning for this roadmap itself lives in Notion's Timeline view.)*

---

## Scored Backlog

Personal value (P) = dogfood pull for a solo founder. Business value (B) = acquisition/retention/differentiation/monetization for ≤5 + students. 1–5 each; effort S/M/L/XL.

### Wave 0 — Spine core + platform
| Idea | Module | Type | P | B | Effort |
| --- | --- | --- | --- | --- | --- |
| Cross-module entity link graph (link-anything) | spine | epic | 5 | 5 | XL |
| Entity hub roll-up (grouped by relation, snippets) | spine | feature | 5 | 5 | L |
| Drag-anything-onto-anything | spine | feature | 4 | 4 | L |
| @-mentions of entities and people | spine | feature | 4 | 4 | M |
| Slash-command inline entity creation (/task /note) | spine | feature | 4 | 4 | M |
| Typed/semantic relationships on links | spine | feature | 4 | 4 | M |
| Auto-suggested cross-module links | spine | feature | 4 | 4 | L |
| Keep modules visibly distinct — no generic-entity UI | spine | tiny | 3 | 4 | S |
| Global cross-module search | spine | epic | 5 | 4 | L |
| Global quick-capture command bar (NL parsing) | spine | epic | 5 | 5 | L |
| Curated, grouped, quiet-by-default notifications | spine | epic | 4 | 4 | L |
| iPadOS-style dashboard of live cross-module widgets | dashboard | epic | 5 | 5 | L |
| Pre-populated, zero-setup default workspace | platform | epic | 4 | 5 | M |
| Progressive single-module onboarding | platform | feature | 3 | 5 | M |
| Performance budgets enforced as P0 (sub-200ms) | platform | epic | 5 | 5 | L |
| Optimistic local writes over cloud-first sync | platform | feature | 4 | 4 | M |
| First-class importers (Notion/Todoist/Cal/CSV/IMAP) | platform | epic | 4 | 5 | L |
| Lossless full-data export | platform | feature | 3 | 4 | M |
| MCP connector exposing every module's intent ops | spine | epic | 4 | 4 | L |
| Actor attribution + visible activity feed | spine | feature | 3 | 4 | M |
| Each module needs one "this is actually great" moment | platform | feature | 4 | 4 | L |
| Density & text-size customization axis | platform | feature | 3 | 3 | M |
| Keep AI quiet and connective (no sparkle) | platform | tiny | 2 | 3 | S |

### Wave 1 — Contacts
| Idea | Module | Type | P | B | Effort |
| --- | --- | --- | --- | --- | --- |
| Light CRM: people & companies as hubs (Folk-lite) | crm | epic | 5 | 5 | L |
| Auto-updating contact records from activity | crm | feature | 4 | 5 | M |
| Contact/lead CSV import | crm | tiny | 3 | 4 | S |

### Wave 2 — Calendar + completion loop
| Idea | Module | Type | P | B | Effort |
| --- | --- | --- | --- | --- | --- |
| Task time-block completion loop (done/push/shrink/drop) | calendar | feature | 5 | 5 | M |
| Drag-to-schedule tasks onto the calendar | calendar | feature | 5 | 4 | M |
| One-tap "reflow my remaining day" (no guilt) | calendar | feature | 5 | 4 | M |
| Roll-forward incomplete tasks | tasks | feature | 5 | 4 | M |
| Multi-source calendar accounts + default-target | calendar | feature | 4 | 4 | M |
| Assistive, transparent, reversible scheduling | calendar | feature | 4 | 4 | M |
| Opt-in daily-plan + evening-shutdown ritual | calendar | epic | 4 | 5 | L |
| Day-fullness signal | calendar | tiny | 3 | 3 | S |
| Zero-metadata task model (bare title usable) | tasks | feature | 4 | 3 | S |
| Focus-mode time write-back to the block | tasks | tiny | 3 | 2 | S |
| Calendly-like booking links (fast-follow) | calendar | feature | 3 | 4 | L |

### Wave 3 — Notes
| Idea | Module | Type | P | B | Effort |
| --- | --- | --- | --- | --- | --- |
| Markdown notes with embeds + entity refs (no DBs) | notes | epic | 5 | 5 | L |
| Note checkboxes that are real, schedulable tasks | notes | feature | 5 | 4 | M |
| Instant note creation (no destination/property) | notes | feature | 4 | 4 | S |

### Wave 4 — Finance
| Idea | Module | Type | P | B | Effort |
| --- | --- | --- | --- | --- | --- |
| Finance "money flow" overview widget | dashboard | epic | 5 | 5 | M |
| CSV-first transaction import w/ column mapping | dashboard | epic | 4 | 4 | L |
| Invoicing with tracked lifecycle (sent→paid/overdue) | dashboard | epic | 4 | 5 | L |
| Per-row business/personal + per-client tagging | dashboard | feature | 4 | 4 | M |
| Auto-match receipt emails to transactions | dashboard | feature | 4 | 4 | L |
| Time tracking that feeds invoice line items | dashboard | epic | 4 | 4 | L |
| Tax-reserve + "safe to pay yourself" widget | dashboard | feature | 3 | 4 | M |
| Native multi-currency on transactions | dashboard | feature | 3 | 4 | M |
| Retrospective spending clarity, NOT zero-based budgeting | dashboard | feature | 3 | 3 | M |
| Overdue-invoice auto-surfaces as task on the contact | dashboard | feature | 4 | 4 | S |
| Custom expense categories/tags from day one | dashboard | tiny | 3 | 3 | S |
| No invoice volume cap on free/entry tier | dashboard | tiny | 2 | 4 | S |
| Finance CSV mapping from QB/Lunch Money/Mint exports | dashboard | tiny | 3 | 3 | S |
| Recurring/quarterly-tax dates → calendar + notifications | calendar | tiny | 3 | 3 | S |

### Wave 5 — Email
| Idea | Module | Type | P | B | Effort |
| --- | --- | --- | --- | --- | --- |
| Email module as a true in-app pane (Spark replacement) | email | epic | 5 | 5 | XL |
| Convert email → task in one gesture, auto-linked to contact | email | feature | 5 | 5 | M |
| Email follow-up tracking (never lose a follow-up) | email | feature | 4 | 4 | M |
| Universal Inbox (captures + email + mentions + notifs) | spine | epic | 5 | 5 | L |

### Cross-cutting — GTM / multiplayer
| Idea | Module | Type | P | B | Effort |
| --- | --- | --- | --- | --- | --- |
| Per-seat pricing, no seat minimums + free student tier | platform | epic | 2 | 5 | M |
| Ambient "glanceable shared state" for light multiplayer | dashboard | feature | 3 | 4 | M |
| Tasks/contacts CSV import (lift the "everything spreadsheet") | tasks | tiny | 3 | 4 | S |
| Consolidation savings calculator (landing page) | platform | tiny | 1 | 4 | S |
| Surface the free local-first "lite"/offline roadmap | platform | tiny | 2 | 3 | S |
| Subscription-with-perpetual-fallback licensing | platform | feature | 1 | 3 | M |

---

## Open Questions & Risks

The user asked for a numbered list of questions to make this plan **bulletproof**, with recommendations where I'm confident. Items marked **⚠ NEED YOU** genuinely require a decision; items marked **✅ REC (confident)** I'll proceed on unless overridden.

### Resolved (2026-06-24, after user review)
- **Build sequence (Q1): CONFIRMED** — spine → Contacts → Calendar → Notes → Finance → Email.
- **Pricing (Q3): DEFERRED — blocked on a cost model.** Can't price without knowing run-cost; this does **not** block the build. TODO before setting tiers: a cost / unit-economics model (Supabase + the desktop email engine + infra, per active workspace and per free-tier student).
- **Polymorphic integrity (Q5): RESOLVED → revised to a central `entities` registry.** A lean index (`workspace_id, entity_type, entity_id, label, icon, deleted_at`) upserted by each module's intent op in the same transaction; `entity_links`/`comments`/`tag_links` FK into it. Chosen over trigger+partial-indexes because it makes cross-module search / @mention / roll-up **one indexed query instead of N per-module fan-outs** and gives clean cascade-tombstone on delete, for the cost of one tiny extra upsert per mutation. Authoritative spec: [.design/connective-tissue/DESIGN_BRIEF.md](../.design/connective-tissue/DESIGN_BRIEF.md).
- **Assistive scheduling (Q12): RESOLVED (refined)** — allow a *constrained, transparent, reversible* auto-arrange limited to **focus blocks within buckets**; delegate richer / "smart" scheduling to an **external AI via the MCP connector**. NOT a Motion-style opaque auto-reshuffle of the whole calendar.
- **Perpetual-fallback license (Q13): DEFERRED** — lossless export is committed at launch; the license model is decided later.

Still genuinely open: a concrete **pricing/tier table** (needs the cost model first).

### A. Strategy & scope
1. **Build-sequence sign-off** — spine → Contacts → Calendar → Notes → Finance → Email. **✅ REC (confident):** proceed. The only live alternative is *Calendar before Contacts* (calendar is the bigger dogfood pull). I still put Contacts first because it's the cheapest spine proof and de-risks the whole architecture before the heavier calendar build. **⚠ NEED YOU:** override only if you'd rather feel the calendar win sooner than de-risk the spine.
2. **Internal-dogfood milestone vs public alpha** — full-suite alpha is the *public* bar, but should we cut an explicit "private dogfood build" you + Mike run from end of Wave 2? **✅ REC (confident):** yes — start living in it after Calendar; it shortens the feedback loop without changing the public bar.
3. **Pricing & free-tier specifics** — price point, free-vs-paid split, student-tier scope, per-seat model. **⚠ NEED YOU.** Research says: no seat minimums, genuinely usable free tier, anchor the paid price *below* the ~$15 "feels like $4" resentment line, don't gate connective features behind enterprise tiers. I can draft a concrete tier table once you give a target price band.

### B. Architecture & data (gate the spine — cheap now, expensive later; full detail in [data-layers.md](./data-layers.md))
4. **`entity_links` shape** — one universal typed table vs. separate `links`/`attachments`. **✅ REC (confident):** one polymorphic table with a `relation_kind` enum; attachments are `kind='attachment'`.
5. **Polymorphic integrity** — how to keep `(entity_type, entity_id)` referentially sane. **⚠ NEED YOU (lean):** I lean trigger-based validation + partial indexes over a central `entities` registry table (simpler, fewer writes). Worth a 30-min architecture decision before building.
6. **Notes CRDT ↔ Postgres** for cloud-sync — store the Yjs doc as a blob + derived searchable fields, vs. shred to rows. **✅ REC (confident):** blob + derived fields (keeps the editor fast, search works, avoids a lossy shred).
7. **Drag-payload contract** — the typed "any entity → any drop target" shape and where it lives. **✅ REC (confident):** a single typed contract in `src/lib/`; every module declares what it emits and what it accepts.

### C. Module-specific
8. **Email metadata sync vs. Finance receipt-matching** — receipt auto-match (Wave 4) needs email metadata in the cloud, but the full email client is Wave 5. **✅ REC (confident):** land a *lightweight email-metadata sync* early (late Wave 1 / during Wave 2) so Finance's receipt-match and email-linking work app-wide before the full client ships.
9. **Calendly-like booking links** — alpha or post-alpha? **✅ REC (confident):** calendar-core fast-follow, not core-alpha (it adds a public surface + availability/timezone complexity). Good paid-tier hook.
10. **Time-tracking revival** — it's paused but load-bearing for Finance (time→invoice). **✅ REC (confident):** revive it minimally as part of Wave 4 (cloud-migrate just what invoicing needs), not as a standalone module.
11. **Notes "embed a note in a note"** — you asked "if possible." **✅ REC (confident):** yes, it's in the ceiling; it's a natural Lexical/editor feature and reinforces the tissue.
12. **Assistive scheduling at alpha?** **✅ REC (confident):** none beyond drag-to-schedule + reflow. Any auto-suggestion is post-alpha and must be transparent/reversible/reason-annotated (Motion's opaque reshuffle is its #1 churn cause). **⚠ NEED YOU:** confirm you don't want even opt-in suggestions at alpha.

### D. GTM & trust
13. **Lossless export + (maybe) perpetual-fallback license** — commit publicly at launch? **✅ REC (confident):** yes to lossless export as a launch-day trust feature. **⚠ NEED YOU:** perpetual-fallback licensing (JetBrains-style) is a maybe — decide later.
14. **Multiplayer scope** — shared-workspace async, no chat module, ambient state only. **✅ REC (confident):** confirmed direction; flagging so it's explicit. Notes cloud-sync (Wave 3) is the hard dependency.

### Risks & mitigations (from the research; mitigations are commitments, not hopes)
- **Weakest-leg trap** ("all-in-ones have all mediocre pieces"). → Per-module quality bar + one great moment; harden the weakest leg before adding the next; sell tissue + lossless export, not "best notes app."
- **Maintenance tax / blank-canvas onboarding.** → Opinionated defaults, seeded/typed entities, pre-populated dashboard, progressive disclosure. Danger zone is *mid-flexibility*.
- **Moat-as-abstraction** (Anytype). → Familiar objects, one-gesture/auto links, no graph view.
- **Scheduling that seizes control** (Motion). → Assistive/reversible/reason-annotated only; manual placement final; design for graceful slippage.
- **Cloud-first vs privacy/PKM crowd.** → Lossless export at launch, surface local-first "lite" roadmap, MCP-only/no-training framing, price below resentment line.
- **Migration / all-or-nothing adoption.** → Onboard like a single-purpose tool; first-class importers; public "your data is exportable" commitment.
- **Notification overload poisoning the moat.** → Entity-grouped, digest-default, one-click mute, quiet defaults from day one.
- **Performance regression from the cloud pivot + cross-module fragility.** → Optimistic local writes, perf budgets as P0, conflict-free recurring/time-block sync as a launch-blocking bar.
- **Shallow/fake integration** (email-in-a-new-tab; oversold one-way sync). → Email/calendar are first-class in-app panes wired into the tissue.

*(Several competitor "facts" were adversarially fact-checked — when writing marketing or briefs, use the verified framing: ClickUp/Notion speed is "slow on big lists/large workspaces" not "30s per task"; QuickBooks Solopreneur DOES now have accountant access — don't claim otherwise; Monday's 3-seat minimum is real and specific to Monday; Notion shipped "AI before offline" but it's not that "no one wanted AI." Full verdicts in the Research Insights page.)*
