# Moduo

> Input for the founder skills (`.claude/skills/founder-*`). Every skill in the pack reads this file.
> Drawn from [docs/PRODUCT_BRIEF.md](../docs/PRODUCT_BRIEF.md), [docs/ROADMAP.md](../docs/ROADMAP.md), [docs/decisions/billing.md](../docs/decisions/billing.md) and [.design/tasks-dogfood/research-2026-10/segments.md](../.design/tasks-dogfood/research-2026-10/segments.md). Draft 2026-10-19. Anything marked **TBD** is for Maciej and Mike to fill in. The skills are told not to invent those values.

- **What it is:** a fast, lightweight workspace that puts tasks, notes, calendar, contacts, email and (for 2+ seats) chat in one app, and links them. An email becomes a task that's linked to the client, and the client's page shows everything about them without anyone logging it.
- **Who it is for:** solo service businesses (freelancers, consultants) and partner pairs or teams of up to 5 who run their work across a patched-together stack (Spark + Morgen + Notion + Todoist/Linear + a spreadsheet CRM). Students get a free tier as top-of-funnel. **Which of these to lead with is the open question.** The wedge pitches in [wedges/](./wedges/) exist to test it.
- **What it sells, at what price** (decided 2026-10-06, not yet tested with buyers):
  - Free: 1 workspace, 1 seat, web and desktop.
  - Pro: $12/month, 1 seat.
  - Duo: $20/month for 2 seats; unlocks chat.
  - Team: $15/seat/month, 3-seat minimum; unlocks chat.
  - Trial: 14 days with no card, 30 days if a card is added.
  - Yearly prices: **TBD**.
- **Where and how:** online. Tauri desktop app plus a web app, synced through Supabase; email is desktop-first. Currently **invite-only**, Stripe is in test mode, and the macOS build is development-signed. Today a friend can't install it (Wave D, `/s1 ALPHA`). Acquisition channel: **TBD** (there's a landing page with a waitlist).
- **Budget and constraints:**
  - Team: two founders (Maciej: design and product; Mike: engineering), building and dogfooding it themselves.
  - Monthly run cost per active workspace and per free user: **TBD**. Roadmap Q3 says pricing is "blocked on a cost model". `/founder-cfo` is the tool for that model.
  - Cash, runway, time available per week, revenue target: **TBD**.
  - Deliberately not doing: mobile, enterprise, Notion-style databases, a finance module (dropped 2026-10-07), AI built into the app (MCP only).

## What's already built (so the pack doesn't pitch vapourware)

Shipped: Tasks (list / board / timeline, focus mode); Contacts with auto-rollup; Calendar with the schedule-to-completion loop (done / push / shrink / drop when a block ends, reflow my day) and CalDAV/ICS; Notes (checkboxes are real tasks); Email (Rust IMAP engine, email → task linked to the sender); Dashboard; Universal Inbox; quick capture; cross-module search; lossless export; chat v2 for Duo/Team; MCP connector (hardening pass `MCP-1` still open).

**Not yet:** Outlook email; desktop Google/Outlook calendar OAuth (built, not proven end-to-end with real credentials); booking links; calls; a "waiting on client" task status; a client-visible status link; time tracked per client.

## The competing wedges

Each pitch in [wedges/](./wedges/) is the same product, aimed at a different first customer, with a different promise and plan. See [wedges/README.md](./wedges/README.md) for how to run them through `/founder-consumer --quick` and how to compare the results.

1. **[client-hub](./wedges/client-hub/)**: solo freelancers and consultants. "Every client in one place." Pro, $12.
2. **[day-loop](./wedges/day-loop/)**: people who time-block their day and have churned off Motion/Sunsama/Morgen. "A plan that survives the day." Pro, $12.
3. **[duo](./wedges/duo/)**: co-founder and partner pairs. "One workspace for both of you, chat included." Duo, $20 for two.
4. **[studio](./wedges/studio/)**: agencies and studios of 3–5. "One workspace for the studio." Team, $15/seat, 3-seat minimum.

## Open questions the pack should answer

- Which wedge has the fewest fatal objections and the clearest "what would flip a no"? (`/founder-consumer` per wedge.)
- Does $12 / $20 / $15-per-seat fall inside the acceptable price range for the winning wedge? (`/founder-pricing`; it needs the panel's price answers.)
- What does an active workspace cost to run, and what does the free tier cost? (`/founder-cfo`; the unit is a paid seat-month.)
- What's the cheapest real test before going public? (`/founder-launch`. For a subscription, that's a founding-member offer paid up front.)
