# Manual test checklist — CO-1 (Contacts schema/ops/route) + CT-5 (comments/notifications)

> **✅ Migration status (reconciled 2026-08-14 · DOC-1): APPLIED to prod.** The "the two new migrations can't be applied from this env … apply + exercise post-deploy" framing below is stale — OPS-1 + OPS-2 (2026-07-29) applied and verified every migration file in the repo. **There is no apply step left; the rows are runnable now.** Status of record: [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md).

> Generated 2026-06-26 · branch `claude/blissful-sinoussi-0a13fb` · **Live-verified:** no — the two new migrations can't be applied from this env (Supabase MCP is on the wrong org; no local stack) and the preview sandbox binds to another worktree. All server-invariant checks below are first-discovery for you; the client-only route/nav checks are low-risk and covered by `bun run verify` + the validator pass.
>
> **Prereq for everything under "needs migration":** deploy `supabase/migrations/20260626120000_contacts_module.sql` and `20260626130000_spine_comments_notifications.sql` to the Moduo Supabase project, then regenerate `src/types/supabase.ts`. Until then, the Contacts ops + the derived notification feed are inert (the app degrades gracefully — see the notification checks).

## Contacts — route rename (client-only, testable now)
- [ ] **Do:** open `/contacts` → **Expect:** the 3-pane shell renders with a centered empty state ("Your contacts live here…") and a contact glyph; left/right panels present _(both)_
- [ ] **Do:** visit a stale `/crm` deep-link → **Expect:** redirects to `/contacts` (URL replaced, no 404) _(both)_
- [ ] **Do:** check the module nav / sidebar → **Expect:** the entry reads "Contacts" with the contact icon (not "CRM"/folder), and routes to `/contacts` _(both)_
- [ ] **Do:** toggle left/right panels on `/contacts`, reload → **Expect:** the panel state persists under the new `"contacts"` layout key _(both)_

## Contacts — create / status / company (needs migration)
- [ ] **Do:** create a person (name + email) via the runtime/op → **Expect:** a `contacts` row **and** an `entities` row (`entity_type='contact'`) appear in one transaction; the person is immediately searchable in the @mention/link picker (AC1) _(both)_
- [ ] **Do:** create a company → **Expect:** a `companies` row **and** an `entities` row (`entity_type='company'`); company is addressable/linkable (AC1) _(both)_
- [ ] **Do:** set a contact's status to "Active", then "Archived", then back to "Lead" → **Expect:** each change succeeds with no stage gate / ordering rule; an attributed `contacts.set_status` activity row is written (AC3) _(both)_
- [ ] **Do:** set a status to a renamed/custom label (e.g. "Prospect") → **Expect:** accepted and stored as `prospect`; renders with a label + neutral tone (color is never the only signal) (AC3) _(both)_
- [ ] **Do:** update a contact's primary email twice (incl. a case variant like `A@x.com` then `a@x.com`) → **Expect:** `emails[]` keeps known addresses without case-variant duplicates _(both)_

## Contacts — linking (needs migration)
- [ ] **Do:** link a contact to a task via `contacts.link` (e.g. relation `follow-up`) → **Expect:** one `entity_links` row (idempotent — linking the same pair again no-ops), attributed `contacts.link` activity; the link shows in the entity's hub roll-up _(both)_
- [ ] **Do:** unlink that link via `contacts.unlink` → **Expect:** soft-deleted (Undo-friendly); re-running it no-ops _(both)_
- [ ] **Do:** attempt `contacts.unlink` on a link with **no** contact/company endpoint (e.g. a task↔note edge) → **Expect:** raises "This link is not owned by Contacts." (no cross-module deletion) _(both)_

## Comments + notifications (needs migration)
- [ ] **Do:** as user A, add a comment on an entity that @-mentions user B → **Expect:** a `comments` row + an attributed `comments.add` activity row carrying B's id in `mentioned_user_ids` (AC9) _(both)_
- [ ] **Do:** as user B, open the notification bell → **Expect:** one grouped, human-readable card ("A commented: …"), **not** raw JSON; deep-link hint shows the target type; relative time renders (AC9, AC10) _(both)_
- [ ] **Do:** as B, click the card → **Expect:** it marks read (card de-emphasizes, badge decrements) and navigates to the target's module surface (AC10) _(both)_
- [ ] **Do:** as B, click "Mark all read" → **Expect:** badge clears across both the spine and legacy feeds _(both)_
- [ ] **Do:** confirm the actor is not self-notified → **Expect:** A does **not** see a notification for A's own comment mention _(both)_

## Edge cases
- [ ] **Do:** open the bell **before** the migration is deployed → **Expect:** the `notifications_list` RPC 404s but is swallowed — the bell still shows the legacy workspace feed (invites/membership), no crash, no empty break _(both)_
- [ ] **Do:** confirm existing workspace invite/membership notifications still appear after the rewrite → **Expect:** rendered as readable cards (not raw JSON), not regressed _(both)_
- [ ] **Do:** add many comments mentioning B on one entity → **Expect:** they collapse into one digest card with a `×N` count and "and N others" attribution, not N separate cards (AC10) _(both)_
- [ ] **Do:** as a viewer-permission user, attempt a contacts op → **Expect:** the op raises server-side ("You don't have edit access to Contacts") _(both)_

## Migrations / data
- [ ] **Do:** apply both migrations on a scratch/branch DB first → **Expect:** clean apply; `contacts`, `companies`, `comments`, `notification_state` tables exist with member-SELECT RLS + op-only writes; ops are `SECURITY DEFINER`, granted to `authenticated`, revoked from `anon` _(server)_
- [ ] **Do:** regenerate `src/types/supabase.ts` after apply → **Expect:** the new tables/RPCs appear; no type drift in the runtime methods _(server)_

## Known gaps / not-yet-testable
- **No live DB round-trip from this session** — the Supabase MCP here is connected to the wrong org and there's no local stack, so AC1/AC3/AC9/AC10 server invariants were not exercised; the SQL mirrors the proven Tasks/spine op pattern verbatim and was statically reviewed. Apply + exercise post-deploy.
- **Deep-link lands on the module index, not the exact entity** — entity-focus route params are CO-2; the card navigates to `/contacts`/`/tasks`/etc. and discards the entity id for now (by design this block).
- **The directory + ContactHub (the "great moment") are not built** — CO-1 ships only the page scaffold/empty state; CO-2 builds the populated UI.
- **No Storybook/preview live-verify** — preview sandbox binds to a different worktree and Storybook doesn't render here (see gotchas).
