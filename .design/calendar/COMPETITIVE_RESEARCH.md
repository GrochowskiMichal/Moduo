# Calendar — Competitive Research & Parity Bar

> **Status:** Research synthesis, gathered 2026-06-28 for the Calendar planning round (`/plan`).
> **Purpose:** the evidence base for `.design/calendar/DESIGN_BRIEF.md` and `specs/calendar.md`. The user's bar: **"Morgen is what I use today; Moduo must be at least its level."** This doc pins what "Morgen level" concretely means, and where the schedule-to-completion loop lets us exceed the whole category.
> **Method:** primary-source web research (official docs, guides, changelogs, dev API, pricing) + secondary reviews (G2/Capterra/Trustpilot/Reddit). Confidence + caveats noted inline. Sources at the end.

---

## 0. One-line positioning

| Tool | What it is | Moat | Cost / weakness |
| --- | --- | --- | --- |
| **Morgen** (the bar) | Calendar-first time-blocker over your real accounts | Multi-account sync + transparent **AI Planner** + **Frames** (templated blocks) + native scheduling links | **No execution half** — nothing at block-elapse, no roll-forward, no shutdown |
| **Sunsama** | Calm, ritual-heavy daily planner | The **morning-plan + evening-shutdown ritual**; capacity-aware, anti-overload | Deliberately slow; expensive (~$20–25/mo); weak mobile |
| **Akiflow** | Keyboard-first capture/triage machine | **Universal Inbox** + **command bar** speed | Billing-trust complaints; buggy mobile; some one-way integrations |
| **Motion** | Auto-scheduling AI | Full auto-plan of your day | **Opaque reshuffle = #1 churn cause** — the anti-pattern we refuse |
| **Reclaim** | Smart-block automation | Habits, flexible vs fixed blocks, smart 1:1s | Niche; auto-moves can feel out of control |

**The strategic read:** Morgen wins *planning + connectivity* and ships **nothing** for *execution*. Sunsama/Akiflow wrap a calendar in a *ritual* but are slow/expensive and still don't act *at the moment a block elapses*. **No one owns the in-the-moment, gentle, reversible execution loop.** That is Moduo's wedge — and because Moduo *is* the task manager (not a sync layer over Todoist/Notion), a block and its task stay in lockstep for free.

---

## 1. The Morgen parity checklist (table-stakes to credibly replace Morgen)

Tiered by build cost. **Tier A** = the calendar surface we should match. **Tier B** = meeting-grade detail we should mostly **inherit** by displaying synced provider events read-only, *not* re-author (stays inside the brief's depth ceiling).

### Tier A — calendar surface (match)
- [ ] **Views:** Day, Week, Month, Agenda. (Morgen also has 2-week + custom N-day; nice-to-have.) Keyboard-switchable.
- [ ] **Keyboard-driven UX:** view switch (`D`/`W`/`M`/`A`), today-jump (`T`), prev/next (`←`/`→`), create (`C`), edit (`E`), delete, save (`⌘↵`), copy/paste events, command bar (`⌘K`).
- [ ] **Command bar with natural-language create** — "Standup tomorrow 9am", `@attendee`, `;location`, `/calendar`, duration parse. *(We already ship `chrono-node` + `rrule`.)*
- [ ] **Drag-to-schedule** a task → calendar block; **drag to move**, **resize edges** to change duration; default block duration when none set (Morgen = 30 min).
- [ ] **Per-calendar color + visibility toggle**; calendar "sets" (numbered groups) is a nice-to-have.
- [ ] **Source attribution** — every event shows which calendar/account it's from (Morgen uses the calendar's color; we add an explicit label — the brief calls a wrong-target invite an *instant-uninstall* bug).
- [ ] **Default-target calendar** for new events, overridable per-event.
- [ ] **Today / now indicator**, working-hours shading, dim past events, configurable time resolution, show/hide weekends.

### Tier B — meeting-grade (inherit read-only at first; author later/never)
- [ ] Attendees / invitations / **RSVP** handling.
- [ ] **Video-conf auto-links** (Zoom / Google Meet / Teams / Webex).
- [ ] **Multi-timezone** (Morgen: up to 10 saved zones, `z`-hover overlay, time-zone assistant).
- [ ] **Rich recurrence authoring** (count/until/by-month-day UIs). Brief non-goal: *don't rebuild Google's rrule UI* — lean on imported recurrence + Tasks' existing engine.
- [ ] All-day events, multiple custom alerts per event, location venue suggestions.

### Connectivity (providers Morgen supports — our external-sync target)
- Google Calendar (personal/work/shared/team) · Outlook / Microsoft 365 / Exchange Online (Graph; **not** on-prem Exchange) · Apple/iCloud (CalDAV) · Fastmail (OAuth) · generic **CalDAV** (Yahoo, Zoho, Nextcloud, fruux…) · **ICS subscription feeds** (holidays/sports — desktop only).
- **Morgen has no native calendar of its own** — it *requires* an external account. **Moduo's native Supabase events are an edge:** Moduo works with zero accounts connected, then layers external sync on top.
- **Sync cadence:** Morgen background-syncs ~hourly unless manually refreshed; edits write through to the source immediately. Privacy model: no calendar data on Morgen's servers **unless** you opt into cloud sync (required for mobile + scheduling links).

---

## 2. Task ↔ calendar model (how the dragged thing behaves)

Morgen (and Sunsama/Akiflow) connect *external* task tools two-way; **Moduo owns the task**, so this is simpler and tighter for us. Patterns worth copying:

- **Scheduled vs unscheduled is visually explicit.** Morgen: a scheduled task is *"void of color with an empty checkbox"* — distinct from colored events. **Take-away:** a Moduo time-block backed by a task should read differently from an external meeting.
- **Drag-to-schedule creates a block; duration from the task's estimate, else a default.**
- **Complete-from-block:** tick the checkbox *on the calendar block* → completes the task. Morgen syncs completion back to the source and the task leaves the panel but the checked block stays on the calendar. **This is the single strongest execution feature Morgen has — and our floor.**
- **Editing the block's duration edits the task's planned time** (Sunsama) — a tidy two-way that keeps estimate ≈ block.
- **Multiple sessions for one task:** Morgen supports splitting a task into several scheduled sessions ("schedule more time"). Relevant to our **Shrink** (keep remainder) action.

---

## 3. The execution-loop gap — our moat, with receipts

What happens *after* the plan is made. This is where the category is weak.

| Capability | Morgen | Sunsama | Akiflow | **Moduo target** |
| --- | --- | --- | --- | --- |
| Mark task **done from inside a block** | ✅ | ✅ | ✅ | ✅ (floor) |
| **Block-elapsed** behavior (a nudge when a block's end passes) | ❌ none | ❌ | ❌ | ✅ **at-elapse triage chip: Done · Push · Shrink · Drop** — quiet, inline, never a modal/red |
| Mid-task **split / reschedule remaining** | ✅ manual (4.0) | partial | — | ✅ (our **Shrink**), but *offered proactively*, not only on right-click |
| **Roll-forward** incomplete work to next open time | ❌ (by design: *scheduled ≠ due*) | ✅ **auto at midnight** (toggle to guided) | ⚠️ surfaces yesterday's misses in the ritual; drag to tomorrow | ✅ **one-gesture, user-initiated** roll-forward (splits the difference: Sunsama-loved but not silent, Morgen-respectful but not absent) |
| Surface a missed block as gentle queue (no red wall) | ❌ | ⚠️ auto-archives chronic stragglers | ⚠️ | ✅ **gentle overdue queue, never red, never "you failed"** |
| **Capacity / day-fullness** signal | ❌ | ✅ yellow/red planned-vs-capacity counter | ⚠️ time-slots bound category time | ✅ **arithmetic fullness bar** (committed vs working-hours window) — *no AI*, which already beats Morgen's nothing |
| **Reflow** remaining day on slip (preview + **undo**) | ⚠️ AI Rescheduling Assistant *suggests* (one-click), not automatic | — | — | ✅ **reflow with preview + reason-annotation + one undo token** |
| **Evening shutdown / reflection** ritual | ❌ confirmed absent | ✅ the gold standard | ✅ configurable | ✅ **opt-in, pre-assembled, ≤2 min, skippable, never gating** |
| **Morning plan** ritual | ✅ AI Planner (approval-gated) | ✅ guided multi-step | ✅ | ✅ **opt-in pre-assembled draft day** (post-v1) |

**Design constraint we inherit from Morgen's philosophy:** Morgen deliberately treats *scheduled ≠ due* — a missed block is **not** overdue, **not** failure — which is *why* it has no roll-forward. We diverge (we roll forward), so our roll-forward and at-elapse chip must stay **genuinely guilt-free** or we reintroduce exactly the anxiety Morgen designed out. The win is *gentle proactivity*, not nagging.

---

## 4. The ritual patterns (for our Phase-2 plan/shutdown — steal the loved parts, fix the tax)

Both Sunsama and Akiflow wrap the calendar in morning + evening rituals. The brief's plan: **pre-assemble** these so we keep the loved habit loop but kill the 15–20 min/day manual tax.

**Sunsama morning ("Plan your day"):** reflect on yesterday's incompletes → pull tasks from sources/backlog/objectives → **predicted-workload vs capacity** check (defer/backlog if over) → order/timebox → optionally share plan to Slack.
**Sunsama evening ("Wrap up"):** progress + what you worked on → reflection/journaling → **"Done for the day" detach screen**. ~5–10 min. Skipped shutdown becomes step 1 of tomorrow.
**Carry-over:** Sunsama **auto-rolls** incompletes at midnight (setting toggles auto vs guided); chronically-deferred tasks **auto-archive** (a nudge). Akiflow surfaces yesterday's misses atop the next ritual + drag-to-tomorrow.
**Capacity:** Sunsama sets a daily hour capacity, auto-estimates task times from history, shows a **yellow→red** workload counter. Akiflow's **Time Slots** bound category time.
**Akiflow command bar** (`⌘E` global, `⌘K` in-app): `>` time-slot · `#` project · `*` tag · `!` priority · `@` guests · `//` description; NL dates. The fastest create/triage surface in the category — a model for our command-bar create.

> **Moduo's ritual must be opt-in and never gating** (PRODUCT_BRIEF graceful-slippage principle). Sunsama's strength is *also* its complaint (slow, forced). We pre-assemble so the default path is "glance & accept," not "spend 15 minutes."

---

## 5. Anti-features (do NOT copy)

- **Motion's opaque auto-reshuffle** — silently rearranges your day; the single biggest churn complaint in the category (one reviewer logged it rescheduling **11 times in a day**; "AI Calendar Anxiety" is a named r/productivity phenomenon). Our rule (decisions.md 2026-06-24): *no assistive scheduling at alpha; any later auto-arrange is transparent / reversible / reason-annotated.* Note Morgen's AI Planner is the **good** kind (preview → tune → commit, approval-gated, "never moves a task without your approval") — proof that *transparent* assist retains; our reflow/ritual should feel like the front edge of that, not Motion's seizure.
- **Forced, slow rituals** (Sunsama's friction) — keep ours pre-assembled and skippable.
- **Re-authoring Google's meeting stack** (RSVP/recurrence/timezone UIs) — inherit read-only; don't rebuild (depth ceiling).
- **Billing-trust traps** (Akiflow + Motion's loudest complaint — charged-after-cancel) — orthogonal to build, but a reminder that trust/export is the GTM moat.

### 5.1 The self-correction trust spectrum (the load-bearing design lesson)

Motion vs. Reclaim vs. Morgen map a clean spectrum, and it tells us *exactly* how our reflow / roll-forward must behave:

| | Mechanism | Trust |
| --- | --- | --- |
| **Motion** | opaque · silent · **global** auto-apply (one change cascades 3–4 days) | lowest — #1 churn |
| **Reclaim** | transparent · **local** auto-defend (moves only the *one* conflicting block, no cascade) + reversible | medium |
| **Morgen** | transparent · **propose-then-approve** (nothing changes without consent) | highest control |

**The rule for Moduo's loop:** every self-correcting move must be **legible** (show *why* — "moved because 2pm ran 20m long"), **local** (move the one thing; never re-optimize the whole day), and **consented/reversible** (preview + one undo token). Reflow is a *proposal with reasons*, never a silent global rewrite. This is in the brief's feature #4/#7 already — the research makes it non-negotiable.

---

## 6. Pricing context + Morgen's complaints = Moduo's wedges

- **Morgen:** **killed its free plan on 2025-03-17**; now **Pro-only — $30/mo monthly, $15/mo annual** ($180/yr); Team $25 / $10-seat annual (min 2). 14-day trial, no card, 30-day money-back. All AI/automation (AI Planner, **Morgen Assist** = calendar-propagation / auto-travel-time / buffer-time) bundled into the one tier; "Kai" AI-assistant is waitlist. Trustpilot 4.4/5 but **26% 1-star, mostly billing/price**.
- **Sunsama:** ~**$20/mo annual** (~$200–240/yr), no free tier. **Akiflow:** ~**$19/mo annual**, no free plan. **Motion/Reclaim:** ~$19/mo & ~$8–15/seat; Reclaim has a real free tier.
- **The category is $15–30/mo with no/weak free tiers.** Moduo's all-in-one + genuine free tier + lossless export is a real GTM wedge.

**Morgen's three loudest complaints are precisely Moduo's structural advantages — lean into these in the brief:**
1. **"Task management is barebones — a viewing layer, not a manager."** Morgen pairs with Todoist/Notion/Linear. **Moduo *is* the task manager** — block ↔ task in lockstep, no two-app drift, completion needs no sync-back. This is the whole thesis (brief §1).
2. **"Cross-device sync is hourly / manual-refresh."** Structural Morgen gripe. **Moduo is Supabase-first with optimistic local writes** — sub-200ms, reconciles live. (Perf is a P0 launch bar — ROADMAP.)
3. **"No free plan; $30/mo."** **Moduo ships a usable free tier + lossless export** as launch-day trust features.

*(Also note praise we must match: Morgen's calendar aggregation "just works," the UI is "polished in a way Google/Outlook/Apple aren't," and support is loved. The bar isn't just features — it's that connecting accounts is dead-simple and the surface is visibly nicer than the incumbents.)*

---

## 7. Confidence & caveats

- **High confidence (primary-source quotes):** Morgen's view/account/event/shortcut/sync feature set; the *scheduled ≠ due / no roll-forward / no shutdown* absences; Sunsama/Akiflow ritual + carry-over mechanics.
- **Negative evidence (searched, found absent):** Morgen evening review / block-elapse behavior — high confidence but inherently "not found" rather than denied.
- **Uncertain / verify in-app before building against:** exact Morgen "set default calendar" setting location; full recurrence UI option set; persistent mini-month vs bottom-left quick-nav; current free-tier scheduling allowances (sources conflict, plans restructured); true offline behavior; Sunsama numbered rollover-count badge; Akiflow Snooze→"Time Frames" migration (in flux).
- **Not found / treat as unsupported in Morgen:** native Asana/Jira/GitHub/Trello task integrations (Zapier-only); on-prem Exchange.

## Sources
Morgen: morgen.so {/, /integrations, /ai-planner, /frames, /tasks-and-monotasking, /pricing}, morgen.so/guides {the-starter-guide, manually-time-block, inbox-upcoming-today-overdue, navigate-your-calendar, essential-shortcuts, command-bar, scheduling-links, multiple-time-zones, color-coding, getting-started}, docs.morgen.so/events, changelog.morgen.so + headwayapp (4.0, rescheduling-assistant), per-provider integration pages, Webex app-hub. · Sunsama: help.sunsama.com/docs {daily-planning, task-rollover, auto-rescheduling, planned-and-actual-times, calendar-integration}, sunsama.com/features/daily-planning-and-shutdown, roadmap.sunsama.com changelog. · Akiflow: product.akiflow.com/help {command-bar, time-slots, rituals}, akiflow.com/features {rituals, inbox-calendar}, /integrations, changelog. · Reviews: G2, Capterra, Trustpilot, ProductHunt, efficient.app, thebusinessdive.com, dhruvirzala.com, ellieplanner.com.
