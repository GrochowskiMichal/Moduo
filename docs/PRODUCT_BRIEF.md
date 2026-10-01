# Moduo — Product Brief

> **Status:** Canonical product definition. Written 2026-06-24, informed by a market/user research sweep (Reddit, YouTube, G2/Capterra, HN, ProductHunt) with adversarial fact-checking. Supersedes the scope assumptions in the 2026-06 *Moduo Briefing* Notion note (see §12 for the deltas).
> **Pairs with:** [ROADMAP.md](./ROADMAP.md) (what to build, in what order), [data-layers.md](./data-layers.md) (how it's wired), [moduo-architecture-vocabulary.md](./moduo-architecture-vocabulary.md) (terminology).
> **For agents:** this is the "why" and the guardrails. Read it before designing any module. When a decision here changes, edit this file first, then code.

---

## 1. What Moduo is

**Moduo is a lightweight, all-in-one workspace that unifies tasks, notes, calendar, contacts, finance, and email into one fast app — and links them all together.** It competes with Notion/ClickUp on breadth, but deliberately *without* their heaviness (no Notion-style databases to build, no setup project). The bet is not "another notes app" or "another task app" — it is the **one place a solo operator or a ≤5-person team runs their whole working life**, where an email becomes a task that's linked to a client who has an unpaid invoice that shows up on your calendar.

**The thesis is validated, not speculative.** Users articulate this exact product unprompted and repeatedly:

> *"My goal is to use only one app for my personal organization. Is there such an app?"*
> *"Recommendations for a single app… to manage customer contacts, projects and tasks, and notes and documents for a solopreneur."*
> *"I often find it hard to find the information I need quickly because the context is split across all these different apps."*

The market is asking for Moduo by name. **The work is execution and trust, not market education.**

---

## 2. Who it's for

| Segment | Why Moduo | Priority |
| --- | --- | --- |
| **Solo business owners / freelancers** | Run the whole business in one app; replace a duct-taped stack (Spark + Morgen + Notion + Linear + a finance app + a spreadsheet CRM). The dogfood persona — *this is the founder.* | **Primary** |
| **Partner / founder pairs & ≤5-person teams** | Shared workspace, light async multiplayer, ambient "who's on what." | **Primary (close 2nd)** |
| **Students (free tier)** | Tasks + calendar + notes + light finance, free, fast, works offline-ish later. Top-of-funnel + goodwill. | **Free tier** |

Moduo is **modular enough to serve several groups** (a calendar-only user can hide Tasks), but the alpha is tuned for the solo/partner operator. Mobile, large teams, and enterprise are out of scope.

---

## 3. Why now (the core insight)

Three pains converge, and every incumbent only solves one:

1. **App-switching + context fragmentation.** Information is split across 5–10 tools; nothing links. (Independently documented: knowledge workers toggle apps ~1,200×/day, ~4 hrs/week reorienting — HBR 2022.)
2. **Subscription fatigue**, sharpest among solo/≤5 founders. Per-seat and seat-minimum pricing draw the angriest complaints in the category.
3. **The execution gap** — the "feels like Motion but isn't built for *completing* tasks" pattern. The whole time-blocking field (Motion, Morgen, Sunsama, Akiflow, Routine) makes the day *look* organized but abandons the user at the moment of doing.

Moduo answers all three *at once* — and that intersection is uncontested.

---

## 4. The moat: the connective tissue (the "spine")

**Moduo's defensibility is not any single module. It is the layer that lets any entity link/attach to any other** — and that surfaces as felt value, not abstraction. Three research findings make this the strategic center of gravity:

- **No competitor reaches the full graph.** Motion, Sunsama, and Akiflow all proved the consolidation thesis, but their graphs stop at work-execution entities (tasks/projects/docs/people). **None has contacts, finance, or a real email entity in the graph.** Moduo's `email→task`, `payment→contact`, `note→task`, `time→invoice→client` links across *all* modules are the territory they structurally cannot reach.
- **Auto-rollup is the fix for "data no one trusts."** The #1 reason light CRMs and DIY systems die is that manual upkeep rots. A contact page that **auto-rolls-up every linked email/task/note/payment with zero manual logging** is the only way to keep an all-in-one's data trustworthy at small-team scale. This is why the tissue is a fix, not a gimmick.
- **It must never look like a graph.** The moat fails the moment "link anything to anything" surfaces as a generic-entity/relation-schema paradigm (the Anytype trap — a steep, widely-cited learning curve where the overloaded word "Relations" confuses new users). Keep email/task/note/contact as **familiar, visibly distinct objects**; expose linking as **drag-onto, @-mention, /ref**, with **auto-suggested** links — never a "define your object type" step. Links carry **type + context** (`email→task` = "spawned from"), and rollups are **grouped by relationship with inline snippets** — not Obsidian's flat backlink pile. *Deliver Anytype's connectedness with Linear's immediacy.*

See [data-layers.md §5](./data-layers.md) for the ~10 spine systems and their target data shapes.

---

## 5. Positioning pillars

Four claims Moduo can make that incumbents structurally cannot:

1. **"The only place these connect."** Email, money, contacts, tasks, notes, calendar in one relationship graph. Lead with the connective payoff, not "fewer subscriptions" (the savings story is the honest *justification*; the tissue is the *reason to believe*).
2. **"Instant, native, never lags."** Tauri (native webview, not Electron) is a real, marketable structural advantage. Heavy incumbents visibly lose on speed (ClickUp users report ~30s loads on large lists/views; Notion is slow on mobile and large databases). *Caveat (verified): frame as "instant interactions, no waiting on big lists/large workspaces," not "ClickUp always takes 30s to open one task."* Benchmark against Todoist/Linear, never Notion. Speed is a launch-blocking quality bar (see §8, ROADMAP perf budgets).
3. **"Works the day you sign up — you don't build it, you use it."** No databases to design, no template hunt, no maintenance tax. Configurability is a liability to hide, not a selling point. The dashboard ships **pre-populated and useful**, never an empty canvas.
4. **"Fair pricing, and your data is yours."** Pay for exactly who you have, **no seat minimums** (the loudest, best-documented pricing pain — Monday's 3-seat minimum specifically); a genuinely usable **free student tier**; and **lossless export as a launch-day trust guarantee** ("your data is yours, even if we die"). MCP-only AI that never trains on your data.

---

## 6. Modules & depth ceilings (deliberately light, never mediocre)

The existential risk (see §11) is the **weakest-leg trap**: if one module is mediocre, users bolt on a separate app and the unification collapses. So "light" has a floor — **every module must clear a credible per-category bar and have at least one "this is actually great" moment.**

| Module | Depth ceiling ("as good as, no further") | The "one great moment" |
| --- | --- | --- |
| **Tasks** | Linear-light + focus mode *(built, 5/5)* | Focus/Execute mode; the schedule-to-completion loop (§ROADMAP) |
| **Notes** | Notion-ease minus databases / Obsidian-minus-local-first (markdown, embeds, `/task` `/note` refs) | Note checkboxes that are real, schedulable tasks |
| **Calendar** | Morgen-lite (time-blocking + drag-to-schedule) + Calendly-like booking links | **Close the loop**: complete a task from inside its time-block; done/push/shrink/drop when a block elapses |
| **Contacts** | Folk-lite (people/companies as hubs) | Click a contact → see *everything* linked (auto-rolled-up, zero logging) |
| **Finance** | Midday-lite, **CSV-first, no bank layer at alpha** | One widget: "You made $X last month — here's where it went" |
| **Email** | Spark replacement, **desktop-first hybrid** (Rust IMAP engine; metadata→cloud) | Convert email → task auto-linked to the contact, never leave the inbox |
| **Dashboard** | iPadOS-style live, interactive, cross-module widgets | Pre-populated on first open; cross-module/entity tiles |

---

## 7. Design principles (load-bearing)

Carried from the original brief, sharpened by research:

- **Quiet and minimal until the user decides otherwise.** Breadth must *default* to feeling minimal (paper-calm), or users go back to pen and paper. Density/text-size are a customization axis (densest end = Linear-level), not a fixed target.
- **Decisions live with the designer, not the user.** Opinionated defaults; hide configurability. (This is the direct antidote to "system-building as procrastination," the #1 behavioral failure mode of flexible all-in-ones.)
- **Design for graceful slippage, not robotic adherence.** Falling behind is the *normal* case. One-tap "reflow my day," a gentle overdue queue (never a wall of red), a simple "day-fullness" signal. The category's biggest *emotional* pain is guilt.
- **Links feel like a side-effect of work, never a schema task.** (See §4.)
- **Notifications: quiet, grouped-by-entity, digest-by-default.** Cross-module notifications are central to the moat — and uncurated notifications are a top incumbent complaint. Get curation right from day one or the moat poisons itself. "Light multiplayer" = ambient glanceable shared state, **not a chat tier**. *(Amended 2026-10-02: the Duo/Team plans will add a chat + calls module — see §9. This ambient layer stays as it is, and the chat spec has to keep chat inside this quiet-notification bar.)*
- **AI stays quiet and connective.** MCP-only, no built-in model; never sprinkle AI styling across modules (hold the single deliberate pink "AI disc"). Market "bring your own AI, we never train on your data" as a **trust** feature. (AI-everywhere currently reads as a data-harvesting tell.)
- **Capture is frictionless and destination-free.** A bare title is a complete task; metadata is optional enrichment, never a gate. Global sub-second quick-capture into an inbox; route/link later.

---

## 8. The alpha bar

**Full-suite alpha** (user's decision, 2026-06-24): every module reaches ~tasks-level completion before the public alpha. This is effectively a 1.0-scoped alpha with a long runway — so:

- **Dogfood each module the moment it hits the bar**, rather than waiting for the whole suite. The roadmap is sequenced so the founder can drop a competitor app at the end of each wave.
- **Speed and reliability are launch-blocking.** Hard perf budgets (sub-200ms task open / search / view-switch) and conflict-free recurring/time-block sync are P0 quality bars, not nice-to-haves — because a single sync bug corrupts *multiple* linked modules' trust at once.

---

## 9. Non-goals & anti-patterns (what Moduo deliberately is NOT)

- **No Notion-style databases / relation schemas.** "Nothing to over-engineer" is a feature.
- **No abstract "generic entity" / graph view** the user must learn. (Anytype trap.)
- **No zero-based / envelope budgeting, no guilt-coded red "overspent" states.** Be the retrospective-clarity tool, not the discipline enforcer. (YNAB's red is "soul-crushing.")
- **"No chat module, keep Slack" — reversed 2026-10-02 (Maciej + Mike).** A communication module (chat + calls) is planned for the Duo (2 seats) and Team (3+ seats) plans, built to solve Slack/Discord's problems and to compete with Slack on features — specced and built later ([ROADMAP](./ROADMAP.md), Q14). What still holds: coordination *on the work* stays async — comments + @mentions + notifications + ambient state. *(Tension, kept on purpose: the 2026-06-24 alpha strategy said async-only multiplayer; chat/calls is the deliberate real-time exception, for its spec to reconcile.)*
- **No AI-everywhere sparkle.** MCP-only.
- **No auto-seizing scheduler.** If scheduling assistance ships, it's suggestion-based, reversible, and reason-annotated ("moved because your 2pm ran over") — "we schedule *with* you, not *at* you." (Motion's opaque auto-reshuffle is its #1 churn cause.)
- **No fake integration.** Email/calendar are first-class in-app panes, never iframes or "opens in a new tab" (Notion's current failure), never oversold one-way sync marketed as two-way (Akiflow complaint).
- **No all-or-nothing onboarding.** Onboard like a single-purpose tool (start with Tasks); reveal modules progressively.

---

## 10. Differentiation summary (the uncontested ground)

The crowded center is **tasks + calendar + notes**. Moduo's open seams, from the landscape analysis:

1. **The schedule-to-completion loop** — bridge a scheduled block to actual completion (only possible because tasks and calendar share one app).
2. **The full cross-module entity graph** — including email, finance, contacts (the pack can't reach this).
3. **Native speed** (Tauri vs Electron).
4. **A real free / no-minimum price.**

That intersection is Moduo's territory.

---

## 11. Top risks (full list + mitigations in [ROADMAP.md §Open Questions & Risks](./ROADMAP.md))

- **Weakest-leg trap** — one mediocre module sinks the thesis. *Mitigation: per-module quality bar + the "one great moment"; harden the weakest leg before adding the next; lean on tissue + lossless export so value is "the only place these connect," not "best notes app."*
- **Re-creating the maintenance tax** — too many empty configurable surfaces. *Mitigation: opinionated defaults, seeded entities, pre-populated dashboard, progressive disclosure.*
- **Surfacing the moat as an abstraction** (Anytype). *Mitigation: familiar objects, one-gesture/auto links, no graph view.*
- **Cloud-first vs the privacy/PKM crowd.** *Mitigation: lossless export at launch, surface the local-first "lite" roadmap, MCP-only/no-training framing, price below the resentment line.*
- **Performance regression from the cloud pivot.** *Mitigation: optimistic local writes, perf budgets as P0.*
- **Notification overload poisoning the moat.** *Mitigation: entity-grouped, digest-default, one-click mute.*

---

## 12. Delta from the 2026-06 *Moduo Briefing* note (Tasks+Calendar discussion with Mike)

That note remains valid for its Tasks/Calendar mechanics (Plan/Execute modes, buckets, capture, drift, commit-not-schedule) and is **left untouched**. But several of its product/business assumptions are **deliberately revised** by this brief — flagged here so the two don't silently contradict:

| Old note said | Now (this brief) |
| --- | --- |
| **Solo only for v1; team/collab out of scope** | **Light async multiplayer at alpha** (shared workspace, ambient state — to build Moduo with a partner) |
| **Free product is the full product for v1** | **Tiered**: genuinely usable free student tier + fair per-seat (no minimums) paid |
| **No AI in v1** | **AI via MCP only** (no built-in model) — the app is *accessible by* agents |
| **Gantt deferred entirely** | **Lightweight Timeline/roadmap view** planned (bars on a date axis, dependency links, drag-to-reschedule — not MS Project) |
| **Tasks & Calendar are separate modules** | **Still separate**, but tightly looped — the schedule-to-completion loop is now the flagship differentiator |
| Scope ≈ Tasks + Calendar | **Six modules + the connective-tissue spine** is the alpha |

---

*Evidence for every claim here lives in the research corpus (Notion: Projects → Moduo → Alpha Plan → Research Insights). Where a competitor weakness is cited, it has been adversarially fact-checked — use the verified framing, not the marketing hype.*
