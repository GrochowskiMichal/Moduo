# Manual test checklist — Contacts v2 (Batches 1–4)

> Generated 2026-06-29 · branch `t/maciej/wave1-contacts-finish` · **Live-verified:** no (Storybook/app unreachable from the agent env) — but `bun run verify` green (331 unit tests) and the migration `20260628140000_contacts_v2` is **applied to prod**. Refresh the dev server (http://127.0.0.1:8081) to test.
> The v2 build contract is [specs/contacts-v2.md](../../specs/contacts-v2.md).

## The contact card (inline edit)
- [ ] **Do:** open a contact → **Edit** → add multiple emails + phones with labels (work/home), a birthday, a URL → **Done**. → **Expect:** all values persist; the header email/“Email” action uses the primary; reopening shows them. _(both)_
- [ ] **Do:** set **Status → No status**. → **Expect:** no status dot/label shows; reopening stays “No status” (not “Lead”). _(both)_
- [ ] **Do:** Edit → **Add field** (e.g. “Birthday gift”, type text) → enter a value → Done. → **Expect:** the custom field shows in view mode and persists; removing the field (× in edit) drops it. _(both)_
- [ ] **Do:** click the **★** in the header (and the row star in the directory). → **Expect:** the contact appears under the pinned **Favorites** group at the top of the list. _(both)_
- [ ] **Do:** **Share** (header) → **Expect:** a `.vcf` downloads; importing it elsewhere shows name/emails/phones/birthday. _(web)_
- [ ] **Do:** **Email** action with a primary email. → **Expect:** opens a mail compose (mailto). _(both)_
- [ ] **Do:** **Add task** → **Expect:** a “Follow up with …” task appears under the hub’s linked work. **Note** / **Link** → attach an existing note / link a task. _(both)_
- [ ] **Do:** **Set company** (view mode) → pick or create a company. → **Expect:** company shows in the header (click → company page). _(both)_
- [ ] **Do:** **Delete contact** (bottom) → confirm. → **Expect:** removed from the directory. _(both)_

## Directory
- [ ] **Do:** scroll the People list. → **Expect:** **A–Z letter separators**; Favorites pinned on top; the People/Companies switch is compact (no dead click area). _(both)_
- [ ] **Do:** create two contacts with the same email. → **Expect:** a quiet **“N possible duplicates — review”** banner; clicking jumps to one. _(both)_
- [ ] **Do:** search with no match. → **Expect:** “No results”, not “No people yet”. _(both)_

## Companies
- [ ] **Do:** select a company → **Edit** (pencil) → change name/website/email-domains/note → Done. → **Expect:** persists; the People group + unioned work still render. _(both)_

## Quick add + delighters
- [ ] **Do:** **+** (new contact) → click **“Paste a signature to autofill”** → paste an email signature. → **Expect:** name/email/phone/title fill in. _(both)_
- [ ] **Do:** Dashboard → add the **Reconnect** widget. → **Expect:** lists people you’ve gone quiet on (oldest first); clicking opens the contact. _(both)_

## Known gaps / deferred (specs/contacts-v2.md §Deferred)
- Dedupe **merge** isn’t built (banner detects + jumps only).
- `multi_select`/`select` custom fields created via API flatten to a string when edited on the card (card creates text/number/date/url only).
- Addresses are single-line; vCard lines aren’t 75-octet folded (parsers accept it).
- Last-touch / Reconnect use the `updated_at` proxy, not cross-entity activity.
- The MCP `moduo-mcp` edge function needs a redeploy to expose any changed contact tools.

---
*Convention: [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up".*
