# Contacts v4 — competitive read and UX rules (2026-10-16)

Companion to the proposed Contacts v4 decision in [docs/decisions/contacts.md](../../docs/decisions/contacts.md). Full write-up with sources: https://claude.ai/artifact/TkKB2iTxT5s8UMqzFHeMmB (private artifact, "Contacts UX Research"). Clickable prototype: https://claude.ai/artifact/5LDZMqBUqvNpF2vxZA5RX2.

## What each tool gets right

- **Attio**: lists (one person in several, each with its own stage and note, kanban per list, time-in-stage target); derived signals (last interaction, connection strength from recency × frequency, strongest connection = which teammate); contextual ⌘K and single-key shortcuts; six pinned highlights per record; timeline filter remembered per object. Heavy: users meet objects/attributes/lists/entries on day one.
- **Twenty**: side-panel peek on row click with "Open" to the full page; views with saved filters, sorts, field visibility, shared or private; `/` search, ⌘K create/import/views; kanban by any select; inline table editing. Heavy: a widget layout editor for record pages.
- **Folk**: zero setup, groups as tables, add a pipeline on a group later, one-click capture from social pages. Heavy: enrichment credits, sequences.
- **Clay**: the Review tab (daily "who to reconnect with" with the reason), quick capture, a timeline that fills itself.
- **Dex**: keep-in-touch cadence per person as the hero.
- **HubSpot**: three columns (details · timeline · associations) because scrolling slows people down. Heavy: property sprawl, lifecycle stage.
- **Pipedrive**: every deal has a next activity; rotting per stage. Heavy: red.
- **Apple/Google Contacts**: A–Z with index, favorites, recent interactions on the card, auto-saved "other contacts".
- **Reddit 2026**: messy UI, manual entry, several screens to reach history, stale data.

## Ten rules (applied in the prototype)

1. Nothing is typed that the system can know (last touch, warmth, knows-them-best, suggested relationship with reason, suggested people).
2. One screen, no clicking through: peek beside the list, ⌘↩ for the page, ↑↓ walks people.
3. No data model to learn: People, Companies, Groups, Pipeline. A group is a list with an optional stage.
4. Relationship is the classifier; warmth is derived; no status or lifecycle stage.
5. Capture is one sentence from anywhere (⌘K parses name, email, phone, links, how met, relationship).
6. Every open thing has a next step, quietly (amber, never red).
7. Review, don't dashboard: Needs you has a card-at-a-time Review mode with keyed actions.
8. Lenses add whole slices; off means gone, data kept (Personal / Network / Business presets).
9. Keyboard first, discoverable always (j k ↩ esc · t l e d x · g+letter · 1 2 3 · ?).
10. Pin the four facts, hide the form; edit in place.

## Open for the designer

Peek vs page as default · Groups vs Deals (fold or keep) · how far derived relationship suggestions go with today's signals · cadence defaults per relationship · private records in Work.
