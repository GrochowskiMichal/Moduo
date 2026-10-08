# Moduo — Finance (Midday-lite, CSV-first) Brief

> **Status:** ✖ **Not planned** (Maciej, 2026-10-07) — there is no finance module on the roadmap; not soon, possibly never. Kept for reference only: don't plan, design for, or cite it as upcoming work. *(Was: "Planned — alpha", then post-alpha from 2026-07-04.)*
> **Pairs with:** [PRODUCT_BRIEF.md](../../docs/PRODUCT_BRIEF.md), [ROADMAP.md](../../docs/ROADMAP.md), [data-layers.md](../../docs/data-layers.md), [moduo-module-contract.md](../../docs/moduo-module-contract.md). Depends on Contacts (the spine proof), Email metadata (`email_refs`), and the revived Time-tracking engine.

## 1. What it is & the job-to-be-done

A retrospective-clarity finance surface for solo and partner businesses: import transactions from a CSV, tag them to clients and categories, send invoices, and answer the one question the founder actually asks at month's end — *"How much did I make last month, and where did it go?"* — without opening a spreadsheet or a bank-sync wizard.

The job is **not** "do my accounting." It is "tell me where I stand, and let me bill people, without the maintenance tax." Moduo's unfair edge is that finance is *linked*: a transaction knows its client, an invoice knows its contact, a receipt email knows its transaction. That cross-module tissue is something QuickBooks structurally cannot do.

User's own framing (founder, paraphrased): *"I don't want a discipline enforcer that yells at me in red. I want to glance and know I'm fine — and I want the receipt to already be on the transaction by the time I look."*

## 2. Depth ceiling & explicit non-goals

**Ceiling:** Midday-lite. CSV-first import, manual + rule-based tagging, lifecycle-tracked invoicing, a few decisive widgets. No bank layer at alpha.

| Non-goal | Why |
| --- | --- |
| **Bank-sync at alpha** | Plaid/Teller/GoCardless = security review, token vault, per-region coverage, ongoing breakage. Opt-in third-party/webhook import is **post-alpha**, behind the same import pipeline as CSV. |
| **Zero-based / envelope budgeting** | That is a discipline tool. Moduo is a clarity tool. Different product. |
| **Guilt-coded red "overspent" states** | Design for graceful slippage. No red walls, no shame UI. Spending shows as fact, not failure. |
| **Full double-entry accounting** | No ledgers, no chart-of-accounts, no journal entries. We hand clean data to the user's accountant; we don't replace them. (QuickBooks Solopreneur *does* now have accountant access — we don't compete on bookkeeping depth.) |
| **Tax filing / calculation engine** | Tax-reserve is a *heuristic set-aside widget*, not a filing tool or a jurisdiction tax engine. |
| **Receipt OCR / line-item extraction** | We auto-*attach* receipt emails (metadata match). We don't OCR the PDF at alpha. |

## 3. The "one great moment"

**A single zero-setup widget that answers "How much did I make last month, and where did it go?" — and a receipt email that has already attached itself to the right transaction, linked to the client and the invoice, before you went looking.**

Two halves, both spine-powered:

1. **Money-flow overview** — in / out / net for the period, top categories, top clients, drawn from imported transactions with no chart-of-accounts to configure. It works the moment one CSV lands.
2. **Receipt auto-match** — an inbound email tagged "receipt" (vendor, amount, date in metadata) matches an existing transaction and attaches itself as an `entity_link`, carrying through to the client and any related invoice. Midday's receipt auto-match is a credible hook worth borrowing — we treat it as a promising mechanic to nail, not a proven crowd-pleaser, and we keep manual attach one drag away for every miss.

The moment lands *because* of the spine. No standalone finance app can pre-attach the receipt to the client and the invoice, because it doesn't have the client or the invoice.

## 4. Must-have features

Each: what it is — the insight behind it — how it wires into the spine.

| Feature | One line | Evidence / insight | Spine wiring |
| --- | --- | --- | --- |
| **Money-flow overview widget** | In/out/net + top categories + top clients for a period. | The founder's actual month-end question; ClickUp/Notion are slow *on big lists / large workspaces* — a fast, pre-computed glance is the contrast. Sub-200ms is a P0 bar. | Reads transactions; rolls up by `contact` link and category; lives on the dashboard. |
| **CSV-first import with column mapping** | Map columns once; pre-built mappings for **QuickBooks / Lunch Money / Mint** exports. | Incumbents' bad exports become a *switching incentive* — "paste your QuickBooks CSV and you're in." No bank-sync risk at alpha. | Each imported row becomes a `transaction` entity, immediately link-able and tag-able. |
| **Business/personal + per-client tagging, bulk rules** | Per-row business/personal flag and per-client tag; rules ("payee contains X → client Y, category Z"). | Tying money to a *Contact* is pure connective tissue QuickBooks can't do. Rules kill the maintenance tax. | Transaction→Contact is a typed `entity_link`; tags via polymorphic `tag_links`; rules re-apply on import. |
| **Custom categories from day one** | User-defined categories, not a fixed taxonomy. | Solo businesses have idiosyncratic spend; a locked taxonomy is the thing people fight. | Workspace-scoped `finance_categories`; category roll-ups feed the widget. |
| **Invoicing with tracked lifecycle** | Draft → sent → viewed → paid / overdue, linked to the contact. | Invoicing is the revenue side of "how much did I make"; lifecycle visibility is what spreadsheets lack. | Invoice→Contact `entity_link`; status transitions are intent ops that write activity. |
| **No invoice-volume cap on free/entry tier** | Free and entry tiers never cap invoice count. | Capping invoices punishes exactly the solo user we want; uncapped is a clean differentiator vs. metered incumbents. | Entitlement flag only; no per-invoice gating in ops. (See [billing_entitlements.md](../../docs/billing_entitlements.md).) |
| **Overdue invoice auto-surfaces** | An overdue invoice raises a task/notification on the contact. | Chasing is the part solos drop; the system should remember, quietly. | Overdue transition emits `module_activity` → notification + an `entity_link` to a generated follow-up task on the contact hub. |
| **Time-tracking → invoice line items** | Pull tracked time into invoice lines. | Revives the paused time-tracking engine *minimally* — just enough to bill. The fabricated "30–45 min/week" stat is **not** used as a selling point. | Time entries link to Contact/project; selected entries become invoice lines (entity_links from invoice → time entries). |
| **Tax-reserve / "safe to pay yourself" widget** | Set-aside % heuristic; shows reserved vs. spendable. | Answers the solo's quiet anxiety without being a tax engine or a budget. | Reads net income roll-up; pure widget, no new write model beyond a stored reserve %. |
| **Native multi-currency (client-side math)** | Transactions and invoices in any currency; conversion done client-side. | Solo/partner businesses bill internationally; this is table-stakes that incumbents gate or bolt on. | Currency + rate stored per row; roll-ups normalize to workspace base currency in the widget. |
| **Auto-match receipt emails** | Inbound receipt email attaches to its transaction. | The "one great moment." Needs email metadata, which the desktop engine already syncs as `email_refs`. | Match heuristic creates an `attachment`-kind `entity_link` email_ref → transaction → contact → invoice. |

## 5. Key flows / interactions

1. **First-run import (zero blank canvas).** User drops a CSV. If it matches a known shape (QuickBooks/Lunch Money/Mint), mapping auto-fills; otherwise a one-screen column mapper. Rows land as transactions, the overview widget populates instantly. Onboarding lands them in a *working* state with real numbers.
2. **Tagging pass.** User bulk-selects rows, assigns business/personal + client + category, and optionally "save as rule." Next import applies rules automatically. Optimistic local writes; reconcile on op return.
3. **Receipt arrives.** Email flagged as a receipt is matched to a transaction; a quiet activity line appears on the transaction ("Receipt attached"). Misses are one drag from manual attach.
4. **Send an invoice.** Compose → pick contact (resolves from Contacts) → optionally pull time entries as lines → send. Status auto-advances sent → viewed → paid; overdue surfaces a follow-up.
5. **Month-end glance.** Open the dashboard. Overview widget + tax-reserve widget answer the question in one look. Drill into a category or client → filtered transaction list, each row linked back to its contact/invoice/receipt.

Interaction rules: drag-anything-onto-anything (drag a transaction onto a contact to link, drag a receipt onto a transaction to attach); `/ref` an invoice or transaction inside a note or task; sub-200ms for every tag, filter, and widget read.

## 6. Spine wiring

| Spine system | Finance participation |
| --- | --- |
| **Links / attachments** | `transaction↔contact`, `invoice↔contact`, `invoice↔time_entry`, `email_ref↔transaction` — all typed `entity_links`. Receipts attach as `kind='attachment'`. Finance is a heavy link *consumer*, like Tasks. |
| **@mentions** | In invoice notes and transaction comments, `@member` resolves to workspace members (partner businesses ≤5). |
| **/refs** | `/invoice`, `/transaction` insert typed references in notes/tasks; reverse roll-up shows where a transaction is mentioned. |
| **Notifications** | Overdue invoice, large uncategorized import, receipt matched → quiet, grouped, digest-default events off `module_activity`. Never red walls. |
| **Activity** | Every state-changing op (`finance.send_invoice`, `finance.mark_paid`, `finance.attach_receipt`, `finance.apply_rules`) appends an attributed `module_activity` row; the trail renders ambiently in the transaction/invoice detail surface. |
| **Tags** | Reuses polymorphic `tag_links` (`entity_type='transaction'|'invoice'`); business/personal and client tags share the universal tagging layer. |
| **MCP tools** | Read: `list_transactions`, `get_money_flow`, `list_invoices`, `get_invoice`. Write (intent ops): `finance.import_csv`, `finance.tag_transaction`, `finance.apply_rules`, `finance.create_invoice`, `finance.send_invoice`, `finance.mark_paid`, `finance.attach_receipt`. Registered via a `ModuleManifest` in `module-registry.ts`; read-only (`view`) by default for keys, `admin` never key-grantable. |
| **Dashboard widget** | The money-flow overview *is* the headline widget; tax-reserve is a second. Both interactive, both definition-of-done. Finance "lives largely as dashboard widgets + a finance surface." |

## 7. Data model sketch (Supabase-first)

All tables workspace-scoped, RLS via `workspace_members`, intent-op RPCs (`finance_op_*`) for invariant-bearing mutations. Money stored as integer minor units + currency code; no floats.

```
finance_transactions (
  id uuid PK, workspace_id uuid → workspaces,
  occurred_on date, description text, payee text,
  amount_minor bigint, currency text,            -- native currency
  base_amount_minor bigint,                       -- normalized, client-computed
  direction text CHECK ('in'|'out'),
  category_id uuid → finance_categories NULL,
  is_business boolean DEFAULT true,
  import_batch_id uuid → finance_imports NULL,
  owner_id uuid, created_at, deleted_at
)

finance_categories (
  id uuid PK, workspace_id uuid, name text, kind text NULL, archived_at
)

finance_imports (
  id uuid PK, workspace_id uuid, source text,     -- 'csv'|'quickbooks'|'lunchmoney'|'mint'
  mapping jsonb, row_count int, created_at, owner_id
)

finance_rules (
  id uuid PK, workspace_id uuid, priority int,
  match jsonb,                                     -- e.g. {"payee_contains":"AWS"}
  set jsonb,                                       -- {"category_id":…,"contact_id":…,"is_business":false}
  created_at, owner_id
)

finance_invoices (
  id uuid PK, workspace_id uuid, number text,
  status text CHECK ('draft'|'sent'|'viewed'|'paid'|'overdue'|'void'),
  currency text, total_minor bigint,
  issue_date date, due_date date, sent_at, viewed_at, paid_at,
  owner_id, created_at, deleted_at
)

finance_invoice_lines (
  id uuid PK, invoice_id uuid → finance_invoices,
  description text, qty numeric, unit_minor bigint, line_minor bigint,
  time_entry_id uuid NULL                          -- provenance when pulled from tracking
)

finance_settings (
  workspace_id uuid PK, base_currency text, tax_reserve_pct numeric, ...
)
```

**Polymorphic links (the spine, not finance-local):** `transaction↔contact`, `invoice↔contact`, `invoice↔time_entry`, `email_ref↔transaction` live in the shared **`entity_links`** table (typed `relation_kind`), addressed by `(entity_type, entity_id)` — *not* as finance-specific FK columns. Tags via shared `tag_links`. Activity via shared `module_activity`. This keeps finance a normal spine citizen.

## 8. Module-specific open questions

| Question | Recommendation |
| --- | --- |
| Transaction→Contact: dedicated FK column or `entity_links`? | **`entity_links`.** Keep finance polymorphic-by-default; the only exception worth a column is `category_id` (intra-module, high-cardinality filter). |
| Multi-currency: store rate per transaction, or normalize only at read time? | **Store native amount + currency on the row; compute & cache `base_amount_minor` client-side at write** using the day's rate. Read-time normalization re-fetches rates and breaks historical accuracy. Rate source TBD (manual + a free daily feed at alpha). |
| Receipt match confidence threshold & UX for misses. | **Auto-attach only on high-confidence (amount + date window + payee/vendor) matches; everything else surfaces as a quiet "possible match" suggestion**, never an auto-link. One drag attaches manually. Protects trust in the headline moment. |
| Invoice numbering — per workspace sequence vs. free-form. | **Auto-increment per workspace with an editable field.** Solos want it automatic; some need to match an existing scheme. |
| Tax-reserve: single global % or per-category? | **Single global % at alpha**, stored in `finance_settings`. Per-category reserve is budgeting-adjacent — defer. |
| Where does the overdue→task generation live? | **Inside `finance_op_mark_overdue`** (or a scheduled catch-up pass), emitting activity + an `entity_link` to a Tasks-created follow-up. Avoid a client-side cron. |
| CSV de-duplication on re-import. | **Hash `(occurred_on, amount_minor, payee, account)` per import batch and warn on likely dupes** rather than silently merging — let the user decide. |

## 9. Dependencies & sequencing notes

- **Build order:** Finance is a *spine consumer*, so it must come **after** the spine primitives (`entity_links`, drag-payload contract, comments/notifications) — which land alongside **Contacts**, the architecture's proof and the ideal second module. Finance is a strong third: it stresses the link layer (transaction↔contact↔invoice↔receipt) more than any other module.
- **Hard deps:**
  - **Contacts** — every meaningful finance link terminates at a contact; without it, transactions and invoices have nothing to link to.
  - **Email metadata (`email_refs`)** — the receipt auto-match (the great moment) needs the desktop engine's metadata sync to Supabase. Manual attach works without it; auto-match does not.
  - **Time-tracking (minimal revival)** — only the slice needed to turn tracked time into invoice lines. Do *not* rebuild the full paused module; expose just enough to bill.
- **Sequencing within Finance:**
  1. Schema + RLS + `finance_op_import_csv` / `finance_op_tag_transaction` + the money-flow widget (delivers the "import a CSV, see your month" half of the moment with zero other modules beyond Contacts).
  2. Rules + custom categories + multi-currency normalization.
  3. Invoicing lifecycle + overdue→task + notifications.
  4. Time-tracking line items.
  5. Receipt auto-match (gated on `email_refs`).
- **Definition of done** (per module contract): invariant-bearing mutations behind `finance_op_*` RPCs; every op writes attributed `module_activity`; the trail renders in transaction/invoice detail; a `ModuleManifest` is registered; the money-flow dashboard widget ships live. Post-alpha: opt-in third-party/webhook bank import behind the same import pipeline.

Brief grounded against `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/docs/moduo-module-contract.md` and `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/docs/data-layers.md`.
