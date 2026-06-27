# Manual test checklist — CT-6 deterministic auto-suggest + strip

> Generated 2026-06-27 · branch `claude/suspicious-hypatia-725798` · **Live-verified:** no — Storybook/app render is blocked in this worktree and the migration is unapplied (Supabase MCP on the wrong org); this whole pass is first-discovery, run it after deploying the migration. The pure scorer is proven by 15 unit tests (`bun run test`).

> **Prerequisite for everything below:** apply `supabase/migrations/20260627120000_spine_link_suggestions.sql` to the Moduo Supabase project and regenerate `src/types/supabase.ts`. Until then `runtime.spine.suggestLinks` 404s and the strip simply shows nothing (graceful-degrade by design). The strip is **not mounted in any page yet** (EntityHub has no live host) — to exercise the UI before CT-7/CO-2 wires it in, mount `<LinkSuggestionStrip>` driven by `useLinkSuggestions` next to an EntityHub instance, or drive `runtime.spine.suggestLinks` from the console.

## Suggest read — shared-tag signal
- [ ] **Do:** Tag two contacts (or a contact + a note) with the same tag, then call `runtime.spine.suggestLinks({ workspaceId, entityType:'contact', entityId:<A> })`. → **Expect:** one candidate row for entity B with `shared_tag_count ≥ 1`, `address_match:false`, `suggested_kind:'references'`. → _both_
- [ ] **Do:** Add a second shared tag to the same pair and re-query. → **Expect:** `shared_tag_count` rises (and the TS score with it, capped at 3 shared tags). → _both_
- [ ] **Do:** Remove all shared tags and re-query. → **Expect:** that pair no longer appears (no signal = no suggestion; no theater). → _both_

## Suggest read — contact↔company email-domain signal
- [ ] **Do:** Create a company "Acme" with domain `acme.com`, a contact with email `jane@acme.com`, then `suggestLinks` on the contact. → **Expect:** a candidate for the company with `address_match:true`, `suggested_kind:'works-at'`. → _both_
- [ ] **Do:** `suggestLinks` on the company instead. → **Expect:** the contact is suggested back (symmetric), `works-at`. → _both_
- [ ] **Do:** Change the contact's email to `jane@other.com` and re-query. → **Expect:** the company is no longer suggested. → _both_

## Accept / dismiss (one-tap, AC11)
- [ ] **Do:** In the strip (or via the hook), tap **Link** on a suggestion. → **Expect:** a new `entity_links` row for the pair with `origin = 'suggest'` and the suggested `relation_kind`; the strip advances to the next suggestion (or disappears if none). → _both_
- [ ] **Do:** Re-query `suggestLinks` after accepting. → **Expect:** the now-linked pair is gone (already-linked exclusion). → _both_
- [ ] **Do:** Tap **dismiss** (×) on a suggestion, then reload and re-query. → **Expect:** a `link_suggestion_declines` row exists for the pair; it is **never re-offered** — not in either direction. → _both_
- [ ] **Do:** Confirm exactly **one** suggestion shows at rest even when several candidates exist. → **Expect:** strongest-scored only; the next appears after accept/dismiss. → _both_

## Edge cases
- [ ] **Do:** As a member whose `permissions_tasks` is `view`/`none`, load the host surface. → **Expect:** no strip at all (gestures hidden), and a forced `declineSuggestion`/`createLink` RPC fails server-side. → _both_
- [ ] **Do:** Force `suggestLinks` to error (e.g. before the migration deploys). → **Expect:** no strip, no error toast — the host surface is unaffected (graceful-degrade). → _both_
- [ ] **Do:** Tombstone (delete) a suggested target, then re-query. → **Expect:** the deleted entity is not suggested (the read joins live `entities` only). → _both_
- [ ] **Do:** Query with a focus entity that shares a tag with itself only / has no candidates. → **Expect:** empty result, no strip; self is never suggested. → _both_

## Migrations / data
- [ ] **Do:** Apply `20260627120000_spine_link_suggestions.sql`; confirm `links_suggest` and `links_op_decline_suggestion` exist. → **Expect:** both created; `links_suggest` is SECURITY INVOKER (member RLS scopes the read), `links_op_decline_suggestion` is SECURITY DEFINER + guarded. → _server_
- [ ] **Do:** As an anon (signed-out) client, attempt both RPCs. → **Expect:** denied — anon EXECUTE is revoked. → _server_
- [ ] **Do:** Call `links_op_decline_suggestion` twice for the same pair. → **Expect:** idempotent (one `link_suggestion_declines` row, no error); no `module_activity` row is written (declines are personal, not workspace events). → _server_

## Known gaps / not-yet-testable
- **`email_refs.from_addr` signal is intentionally absent** — `email_refs` doesn't exist yet (deferred Wave 1/2 desktop-sync prerequisite). Only shared-tag + contact↔company domain signals are live; the email-message signal slots into `links_suggest` when sync lands.
- **time-window is a booster only** — the server never emits a candidate on time proximity alone, so you can't observe a standalone "created around the same time" suggestion (by design — anti-theater).
- **Strip not wired into a page** — EntityHub still has no live consumer; the strip + hook land in a host with CT-7 / CO-2. Until then this is component/console testing only.
- **Live-verify blocked in the worktree** (Storybook render fails; app+Supabase unreachable) and the **migration is unapplied here** — every row above is post-deploy first-discovery.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
