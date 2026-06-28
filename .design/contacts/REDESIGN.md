# Contacts — redesign reference (v2)

Design-facing companion to the build contract [`specs/contacts-v2.md`](../../specs/contacts-v2.md). Distilled from a 2026-06-28 research round across iOS Contacts/Cardhop, Folk/Attio/Notion/HubSpot/Google Contacts, and Monica/Dex/Clay.

## The one insight

Personal CRMs are **loved when the record fills itself** (Clay/Mesh, Dex auto-build the timeline) and **abandoned from data-entry friction** (Monica's manual forms). Moduo's spine already auto-fills (linked tasks/notes/emails roll up). So the contact page's hero is the **auto-built timeline + a few human fields**, never a form to maintain. That's the moat made visible.

## Principles for the page

- **One calm iOS-style card**, not a right-panel-dependent layout. Everything on the page.
- **Typed fields, not flat text** (Attio): emails/phones as `{label, value, primary}` — that's what powers click-to-act, primary logic, enrichment.
- **Progressive disclosure** (iOS "add field"): default card = name · company/title · email · phone · notes. Everything else behind an add-field affordance.
- **Depth is opt-in per context** (Folk): a recruiter's Status/Source/Resume are custom fields, not base-schema bloat. Keep the default ~6–8 visible fields.
- **Serve student ↔ recruiter** from the same page: the casual user sees the minimal record; the recruiter adds custom fields. No pipelines either way.

## Page anatomy (target)

1. **Header** — avatar (initials fallback) · name · title · → company · ☆ favorite · ⋯ (edit / share / delete).
2. **Action row** — Email · Message · New task · Schedule · Note. iOS's launcher row, **repointed at Moduo verbs** (wires into the spine), not a phone dialer.
3. **Last-touch line** — derived ("emailed 3 days ago · 2 open tasks"), never entered.
4. **Fields** — phones/emails/addresses/urls (labelled, click-to-act) · birthday + dates · relationships (introduced-by / reports-to, as contact↔contact links) · tags · optional status · custom fields.
5. **Linked work** — the spine roll-up (tasks / notes / files / emails) — what Google Contacts & raw Notion lack.
6. **Activity timeline** — auto-built, reverse-chron.

View mode = read + click-to-act; **Edit** toggles inline editing (iOS add-row + label-picker).

## Field model (iOS parity target)

- **Name**: first/last (+ optional prefix/middle/suffix/nickname behind add-field).
- **Multi-value, each with a label** (preset + custom, persisted): phone, email, address (structured), url, social.
- **Dates**: birthday (special) + anniversary/custom → optional quiet reminders.
- **Related people**: spouse / reports-to / introduced-by — spine contact↔contact links shown as a list (no abstract graph).
- **Custom fields**: text / number / date / single-select / multi-select / url (workspace-global defs V1).

## Steal / skip

**Steal:** typed multi-value + per-value labels · "add field" progressive disclosure · the action-button row (repointed) · Cardhop's notes-as-timestamped-log + natural-language/paste-to-add · iOS letter index + Favorites + vCard share · Folk's per-context custom fields · Clay/Dex's derived "haven't talked in N" nudge + a "Reconnect" surface.

**Skip:** deal stages / pipelines / forecasting (sales-CRM line we won't cross) · Notion-style arbitrary-DB UI · abstract node-edge graph · heavy data-broker enrichment · Monica's 45 life-event templates (admired, abandoned).

## Backlog ideas (Batch 4)

"Haven't talked in N" nudge · **Reconnect** dashboard widget · passive dedupe/merge banner · paste-an-email-signature → parsed contact.

Sources captured in the research run (Folk/Attio/HubSpot/Google docs, Monica/Dex/Clay reviews, Apple Contacts guides, Postgres JSONB-vs-EAV literature).
