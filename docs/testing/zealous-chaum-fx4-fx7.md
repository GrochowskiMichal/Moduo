# Manual test checklist — Contacts v3 fix pack FX-4…FX-7

> Generated 2026-07-02 · branch `claude/zealous-chaum-0d9005` · **Live-verified:** no — `bun run verify` green (typecheck + lint + 440 unit tests) and the worktree source compiles + serves in a real rsbuild dev build (HTTP 200), but UI/round-trip live-verify was not run: the worktree has no installed deps for the bound preview sandbox, the hosted test trial is likely expired (paywall), and `companies_op_delete` is deploy-gated. Every AC's pure logic is unit-tested; this checklist is the render/round-trip confirmation.
> Run top-to-bottom on **web** (contacts is Supabase-direct on both surfaces). Requires **edit** permission on the workspace.

## FX-4 — Card quick wins (contact page)
- [ ] **Do:** Open a contact, click the status pill in the header (view mode, not edit). → **Expect:** A dropdown opens listing No status + Lead/Active/Dormant/Archived (+ any custom); picking one flips the pill immediately (optimistic) and persists on reload. _(web)_
- [ ] **Do:** Pick a status, then kill the network and pick another. → **Expect:** The pill rolls back to the prior status and a "Couldn't change status" toast appears (optimistic rollback). _(web)_
- [ ] **Do:** On a contact with no status, click "Set status" in the header. → **Expect:** Same dropdown; choosing a status sets it. A view-only member sees a plain badge / nothing, no dropdown. _(web)_
- [ ] **Do:** Hover (or Tab to focus) an email / phone / URL row in the details card. → **Expect:** A copy button fades in at the row's right edge (space was reserved — the value doesn't shift); clicking copies the raw value and shows a "Copied" toast. Address rows have no copy button. _(web)_
- [ ] **Do:** Open a contact whose last real interaction (a linked task/note, a comment) is older than its most recent record edit (a rename / status change). → **Expect:** The last-touch line reads the *interaction* verb + time (e.g. "linked 3 days ago"), not "updated". Only a contact with no interactions at all reads "updated …". _(web)_
- [ ] **Do:** Add a "birthday" date within the next 60 days (edit mode → Dates), save. → **Expect:** In view mode the birthday row shows a quiet caption "in N days" / "in N weeks" / "today"/"tomorrow"; a birthday >60 days out shows no caption. _(web)_

## FX-5 — Relation sanity + People section
- [ ] **Do:** Link two people (contact ↔ contact) via "Link…" on a contact, then open the "⋯ → Change relation" on that linked row. → **Expect:** The menu offers only "References" and "Mentions" — NOT Attachment / Paid by / Works at / Blocks (the "Ben Okafor · Attachment" bug can no longer be created). _(web)_
- [ ] **Do:** On a contact↔company row, open "Change relation". → **Expect:** "Works at" is offered. On a payment↔contact row, "Paid by" is offered. _(web)_
- [ ] **Do:** Link a person to another person. → **Expect:** They appear under a new **People** section on the contact page (avatar + name + status dot, click opens them) — NOT in "Other". Non-person links still group under Tasks/Notes/etc. _(web)_
- [ ] **Do:** Accept an auto-suggested link between two people (if surfaced). → **Expect:** The created link is `references`, never `attachment`. _(web)_

## FX-6 — Entry modal upgrade + New company
- [ ] **Do:** Directory "+" (People tab) → New contact dialog. Type a name; set a **Company** via "Set company" (search an existing one, or type a new name → "Create …"). Add contact. → **Expect:** The contact is created filed under that company (header company chip shows it; it appears in the company's People) — a newly-typed company is created too. _(web)_
- [ ] **Do:** In the modal, type an email whose domain matches an existing company's domains (e.g. `x@acme.com` when Acme has domain acme.com) and leave Company empty. → **Expect:** A one-tap "Add to Acme Corp?" hint appears; clicking it sets the company. _(web)_
- [ ] **Do:** In the modal, type the email or name of an existing contact. → **Expect:** A non-blocking "Looks like <name> — Open instead" row appears; "Add contact" stays enabled; "Open instead" jumps to the existing contact and abandons the draft. _(web)_
- [ ] **Do:** Fill the modal and click **Add another** (or press ⌘/Ctrl+Enter). → **Expect:** The contact saves, the form clears for the next entry (Company is kept for rapid same-company entry), focus returns to Name, the dialog stays open. Plain Enter / "Add contact" saves and closes. _(web)_
- [ ] **Do:** Open "Paste a signature to autofill", paste a block with **2 emails + 1 phone**, then Add contact. → **Expect:** The created contact carries BOTH emails (primary first) and the phone — open the card and confirm both emails are present. _(web)_
- [ ] **Do:** Directory Companies tab → "+". → **Expect:** A **New company** dialog (name / website / domains); creating one selects it. The People-tab "+" still opens the contact dialog; CSV Import only shows on the People tab. _(web)_

## FX-7 — Company page parity
- [ ] **Do:** Open a company. → **Expect:** An action row with **Add task** and **Link**; a header **⋯ menu** with **Delete company**; a tag-chip row (from FX-2). _(web)_
- [ ] **Do:** Company → "Add task". → **Expect:** A follow-up task "Follow up with <Company>" is created and linked to the company (shows under the company's Tasks roll-up). "Link…" attaches an existing entity. _(web)_
- [ ] **Do:** Company People section → "+ Add person". → **Expect:** The New-contact dialog opens pre-set to this company; adding the person files them under it. _(web)_
- [ ] **Do:** On a company whose member (person) has linked work, look at the company's rolled-up work rows. → **Expect:** Rows inherited from a member show a quiet "· via <person name>" caption; the company's own directly-linked rows show none. _(web)_
- [ ] **Do (after migration deploy):** Company ⋯ → Delete company (confirm). → **Expect:** The company is removed, its members SURVIVE with their company chip cleared, works-at links dropped, selection clears (Back doesn't land on the dead company). _(web)_

## FX-8 — Single-select custom fields (contact card, edit mode)
- [ ] **Do:** Edit a contact → "Add field" → set type **select** → a "Options, comma-separated" input appears; type `EMEA, APAC, AMER`, name it "Region", Add. → **Expect:** Add is disabled until both a name and ≥1 option exist; the field is created. _(web)_
- [ ] **Do:** In edit mode, set the Region field via its dropdown, Done. → **Expect:** View mode shows "Region  APAC" as plain text in the details card. _(web)_
- [ ] **Do:** Re-add a "Region" field with options that omit a value already stored on a contact (or edit the def), then edit that contact. → **Expect:** The stored value still appears in the dropdown (appended) and renders in view mode — never silently dropped. _(web)_
- [ ] **Do:** In edit mode, open the Region dropdown and pick "None". → **Expect:** The value clears (empty), the row disappears from view mode. No Radix "empty value" crash. _(web)_

## FX-9 — Drag-to-link on /contacts
- [ ] **Do:** Select a company; drag a person's row from the directory onto the company hub. → **Expect:** A "Linked <person> → company · Works at" toast with **Undo** and a kind-override dropdown; the person appears in the company's People. _(web)_
- [ ] **Do:** Select a contact; drag another person's row onto it. → **Expect:** Linked as **References** (never Attachment); the person appears in the contact's **People** section. _(web)_
- [ ] **Do:** Drag a row and drop it outside any hub (on the rail, header, or empty center). → **Expect:** Nothing happens — no stray link. _(web)_
- [ ] **Do:** Drag the currently-selected contact's own row onto its own hub. → **Expect:** "You can't link something to itself" toast, no link. _(web)_
- [ ] **Do:** Drag a person already linked to the selected entity onto it again. → **Expect:** "Already linked" toast — no duplicate, no misleading Undo. _(web)_
- [ ] **Do:** Click a directory row (don't drag). → **Expect:** It still selects normally; the favorite star still toggles; keyboard nav still works. _(web)_
- [ ] **Do:** As a view-only member, try to drag a row. → **Expect:** No drag (rows aren't draggable); the hub shows no drop ring. _(web)_
- [ ] **Note (recorded limitation):** dropping a person on a company creates the works-at link (person shows in People) but does **not** set the contact's header company chip — that still needs the card's "Set company". Not a bug.

## Edge cases
- [ ] **Do:** Modal duplicate warning false positive (a real new person who shares a name). → **Expect:** Warning is informational; "Add contact" works. _(web)_
- [ ] **Do:** Paste a blob that parses nothing. → **Expect:** Fields stay as typed, no error. _(web)_
- [ ] **Do:** View-only member on a contact/company page. → **Expect:** Status pill is a plain badge (no dropdown), no copy is fine, no modal/delete/add-person affordances. _(web)_

## Migrations / data
- [ ] **Do:** Apply `supabase/migrations/20260702160000_companies_delete.sql` to the Supabase project and regenerate `src/types/supabase.ts`. Then run the FX-7 Delete-company check above. → **Expect:** RPC `companies_op_delete` exists, guarded (edit perm), soft-deletes + clears members' `company_id` + drops works-at edges + tombstones the registry, one txn. **Until applied, Delete company returns an RPC error (expected).**

## Known gaps / not-yet-testable
- Full UI/round-trip live-verify not run (see header). The pure logic behind every AC is unit-tested (kind-constraints, dates/birthday, dedupe probe, parse multi-value, interaction-weighted last touch, company provenance, contact↔contact resolveKind).
- `companies_op_delete` is deploy-gated (Supabase MCP not authorized in this session) — Delete company is unverifiable until the migration lands.
- Drag-to-link onto a hub is **FX-9** (a later block), not covered here.
