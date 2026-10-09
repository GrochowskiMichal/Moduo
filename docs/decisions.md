# Decisions log (index)

One line per locked product or architecture decision, grouped by area, newest first. The full entry lives in the area file linked in each heading. Read this index at session start; open an area file only when your work touches that area.

**Adding a decision:** write the full entry at the top of `docs/decisions/<area>.md` (one bold title sentence, then the why and a pointer to the authoritative doc), then add its title as one line under the matching heading here. If no area fits, use `product`.

> Migration-status clauses inside older entries ("deploy-ready but unapplied") describe the day they were written, not today. Probe the database before treating one as a task. See [decisions/data.md](decisions/data.md).

## Agent workflow, branching, Entire, docs → [decisions/workflow.md](decisions/workflow.md)

- 2026-10-08 · Every `/s2` and `/s3` report opens with a Status line and keeps "to finish this block" apart from findings; one block per session; unlanded work is always pushed.
- 2026-10-08 · `main` and `develop` change only through a pull request whose `static-checks` job passed, and a weekly cloud routine gardens the knowledge files.
- 2026-10-07 · The repo is public, so Entire checkpoints are local-only and never pushed.
- 2026-10-07 · Claude Code is the only harness, on Anthropic models, and AGENTS.md is the single instruction file.
- 2026-08-17 · Agents land bigger chunks on `develop` (standing), Entire default is `develop`, domain values go through `@contracts`.
- 2026-08-14 · DOC-1 (doc reconcile) — the doc set now declares an explicit authority hierarchy, and stale *status* claims are neutralized by banner, not by rewriting history.
- 2026-07-14 · Agent workflow ported to OpenCode + made tool/model-agnostic; `AGENTS.md` is now the single source of truth.
- 2026-07-11 · Onboarding handoff + backend-refactor decision memo written (`docs/onboarding/`), for Mike picking the project back up.
- 2026-07-02 · Session naming convention + title hook.
- 2026-06-25 · Execution ledger + session hardening.
- 2026-06-25 · Claude Code workflow upgrade.

## Permissions, sharing, privacy and erasure → [decisions/permissions.md](decisions/permissions.md)

- 2026-10-08 · A contact can point only at a company you can open, and the refusal never says whether a private company exists.
- 2026-10-08 · A SECURITY DEFINER helper that only other definer functions call is never client-callable, and "Delete forever" works again for edited notes and sub-notes.
- 2026-10-08 · PRIV-2b: deleting an account also wipes our Stripe copy and what the user leaves in other people's workspaces, and the Danger zone and sign-in page say so
- 2026-10-08 · PRIV-2a built: one SQL function erases what a deleted account leaves in other people's workspaces, and member removal is fixed
- 2026-10-08 · PRIV-3: switching app analytics off, or deleting the account, deletes what PostHog holds for the person.
- 2026-10-08 · API keys get None / View / Edit per module, inside the permission model: a key never gets more than its creator, and only its creator can widen it.
- 2026-10-07 · PRIV-2 planned: what a deleted account leaves in other people's workspaces, its Stripe copy, and a privacy@ admin command
- 2026-10-07 · App analytics (PostHog) is opt-in per person: asked after sign-in until answered, off until you say yes, tagged `surface: "app"` in the shared PostHog project, and in the privacy policy.
- 2026-10-07 · Deleting an account also deletes the user's private items in other people's workspaces, and the Danger zone says the plan ends
- 2026-10-07 · Account deletion now erases what the FK cascade can't reach: Stripe, Storage, booking links, integration tokens, waitlist.
- 2026-10-06 · PERM-3…8 + PERM-2b: one `resource_grants` table; access = role ceiling ∩ grant.
- 2026-10-06 · Sharing (PERM-2b…8) ships with two features hidden, and a production write outage fixed.
- 2026-10-06 · PERM-1/2: roles + personal exceptions, enforced in Postgres; Settings → Members and access.
- 2026-10-06 · Permissions: one model for every module; PERM-0 makes calendar + email refs owner-only and API keys act as their creator.
- 2026-07-11 · Workspace role hierarchy + transfer-ownership (follow-up to DF-24) landed

## Billing, plans, trials, waitlist → [decisions/billing.md](decisions/billing.md)

- 2026-10-07 · The Early Founders form is gone for good: `founders-apply` is removed from the repo and deleted from Supabase; `issue-founder-coupon` and `founders_interest` stay, closed to clients
- 2026-10-06 · Chat v1 ships as the 7th tab (`/chat`, ⌘7) for Duo / Team / Founder workspaces.
- 2026-10-06 · Billing runs on the Stripe Sync Engine; Free is a real tier; four plans (Free / Pro $12 / Duo $20 / Team $15-per-seat).
- 2026-10-02 · Moduo is invite-only.
- 2026-10-01 · Landing waitlist goes only through the `waitlist-join` Edge Function; `public.waitlist` is closed to anon/authenticated.
- 2026-07-10 · DF-3 (trial/billing fix pack) landed — the paid-conversion path works end-to-end

## Moduo Meet (video calls) → [decisions/meet.md](decisions/meet.md)

- 2026-10-06 · Moduo Meet: our own video calls on self-hosted LiveKit in Azure Poland Central (/s1 planned, DoR-ready).

## Desktop app, Tauri, releases → [decisions/desktop-release.md](decisions/desktop-release.md)

- 2026-10-07 · Both desktop release channels run one shared workflow, and only the `.dmg` is notarized.
- 2026-10-07 · Rust crates and Rsbuild move to the newest stable, not their pre-releases.
- 2026-10-07 · Desktop Rust is pinned to nightly-2026-10-06, with the parallel front end on.
- 2026-07-13 · DF-19f-quit LIVE-VERIFIED on a real desktop build — the fix works; gate closed.
- 2026-07-13 · Desktop bundle frontend builds with `MODUO_TARGET=desktop` → `dist/`
- 2026-07-13 · DF-19f-quit FIXED — it was shipping non-functional (both the ⌘Q *and* window-close confirmations never fired).
- 2026-07-11 · Proposal C executed — dead Rust graph/embeddings sidecar pruned; `sync` feature-gated behind `lite`.
- 2026-07-09 · Desktop distribution = macOS-first; hands-off updater deferred.
- 2026-07-03 · Calendar CAL-8b landed — CalDAV/ICS connect UX + rail grouping; Wave-2 CalDAV/ICS fast-follow COMPLETE (migration APPLIED to prod + round-tripped same day; live-verify is the designer's desktop pass).
- 2026-07-02 · Calendar CAL-6b landed — desktop sync-writer re-point + cloud-prefs transport; CAL-6 now fully complete (AC12).
- 2026-07-02 · Calendar CAL-6 external-mirror WEB half landed (desktop sync writer + cloud-prefs deferred); no new migration (rides CAL-2's applied `calendar_accounts`/mirror ops).

## Toolchain and libraries → [decisions/toolchain.md](decisions/toolchain.md)

- 2026-10-08 · Subframe is removed.
- 2026-10-08 · Storybook is 10.6.1, with `@storybook/addon-mcp`.
- 2026-10-08 · Claude Code gets TypeScript code intelligence from TypeScript 7's own language server, through a project plugin.
- 2026-10-07 · Biome doesn't lint `landing/**`, and `bun run lint:js` gates CI.
- 2026-10-07 · The rest of the JS libraries move to their newest stable release, with four majors left on the line already in use.
- 2026-10-07 · Drag and drop stays on `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, and `@dnd-kit/utilities` 3.2.2.
- 2026-10-07 · The Lexical pack is 0.52.0, and Yjs is 13.6.33.
- 2026-10-07 · Tailwind CSS and `@tailwindcss/postcss` are both 4.3.3.
- 2026-10-07 · React and React DOM are 19.3.0.
- 2026-10-07 · Unit tests run on Rstest 0.12, not Vitest.
- 2026-07-29 · Biome 2.5.6 adopted as the JS/TS linter + formatter; `lint:js` joins `bun run verify`.
- 2026-07-29 · Compiler-codegen violations fixed app-wide; heavy routes code-split.
- 2026-07-28 · React Compiler v1.0 enabled — automatic memoization across the app.

## Email and import of mail → [decisions/email.md](decisions/email.md)

- 2026-10-06 · The `PUBLIC_STAGING_ALLOWLIST` build-time email gate is removed.
- 2026-07-29 · Import scope collapsed to "Notion notes + email history depth"
- 2026-07-29 · Email history depth is an engine change, not a setting.
- 2026-07-29 · The two pending email migrations are APPLIED TO PROD; `email_op_ref_remove` and the follow-up-due sweep are live
- 2026-07-14 · DF-21d/e/f (Universal Inbox — comment-notify · overdue opt-in · email-due web parity) landed
- 2026-07-13 · DF-21c (Universal Inbox — history modal + Invitations) landed — completes the structural spine of DF-21 (a/b/c)
- 2026-07-13 · DF-21b (Universal Inbox — dismiss + undo) landed
- 2026-07-13 · DF-21a (Universal Inbox — bell → dropdown) landed
- 2026-07-11 · DF-2 (deep-link selection: Calendar + Email) landed
- 2026-07-10 · DF-6 Email daily-use pack landed
- 2026-07-07 · Email EM-11 (MCP manifest + connector + widget + web + unread-push) landed — Wave 5 (Email) COMPLETE
- 2026-07-07 · Email EM-9 (hybrid search) + EM-10 (smart inbox) landed
- 2026-07-04 · Email EM-6 (snooze + follow-ups) + EM-7 (compose + attachments) + EM-8 (convert→task + spine) landed
- 2026-07-04 · Email EM-2 (Gmail OAuth + connect) + EM-4 (threading + inbox shell) + EM-5 (triage) landed
- 2026-07-04 · Email EM-1 (engine security core) + EM-3 (cloud substrate) landed
- 2026-07-04 (pm) · Email (Wave 5) pulled FORWARD — next build, ahead of the Dashboard/Mindmap reworks; spec DoR-ready.
- 2026-07-04 · Alpha (v1) scope adjusted — Finance/Email OUT; Dashboard + Mindmap reworks IN (designer call, mid-`/execute`).
- 2026-07-29 · IM-2a: the email store reads by key prefix and writes per chunk — and the order index stays timestamp-keyed on purpose.
- 2026-07-30 · IM-2b: email history depth is a per-device FLOOR, and the depth state machine keys off the UID generation.
- 2026-07-30 · IM-2c-a: the depth picker ships without progress/cancel, and AC9's transport is amended from Tauri events to a cursor-backed status read.

## MCP connector → [decisions/mcp.md](decisions/mcp.md)

- 2026-10-09 · API keys can expire (optional, 90 days by default in the picker) and Settings flags expired and unused keys; no per-key rate limit.
- 2026-10-08 · The "Moduo for Claude Code" mod was dropped; the connector improvements it came with stay.
- 2026-10-08 · A key's tool list is honest per module: tools that also touch another module need it too, and None means none across modules.
- 2026-07-04 · Notes NO-9 + NO-10 landed — publish-to-web + the DoD (MCP manifest/connector + Recent-notes widget); Wave 3 (Notes) COMPLETE.
- 2026-06-27 · Contacts CO-5 MCP manifest + "Needs attention" widget landed — Wave 1 (Contacts) complete.
- 2026-06-27 · Spine CT-7 Tasks adoption + MCP manifest + dashboard widget landed (Wave 0 spine complete).

## Calendar and booking links → [decisions/calendar.md](decisions/calendar.md)

- 2026-10-08 · Google and Zoom connects are finished by the signed-in app, not by the OAuth callback.
- 2026-10-07 · Emailed links use fixed, allow-listed origins, and public booking is rate-limited.
- 2026-10-02 · A booked meeting is one event, and booking links can be deleted.
- 2026-10-02 · A booking link's video is Google Meet, Zoom, or "Their choice".
- 2026-10-01 · The public booking page is one sentence the guest finishes.
- 2026-10-01 · A booking link can let the guest invite others.
- 2026-10-01 · A booking page shows the host's current profile.
- 2026-10-01 · A linked Google calendar is a real calendar on the web, and booking links use the public host.
- 2026-10-01 · Booking links are host-configured public URLs that write a Google Meet event and a Moduo calendar event.
- 2026-07-11 · DF-11 (Focus session survives navigation) landed
- 2026-07-04 · Notes NO-7b landed — the AC8 spine tail (Notes rail in Contacts/Calendar + drag-into-editor/onto-hub); Wave 3 (Notes) now TRULY complete. No migration.
- 2026-07-03 · Calendar CAL-8a landed — CalDAV/ICS engine + pure ical→mirror mapper (migration `20260703130000` APPLIED to prod 2026-07-03 — authed rolled-back round-trip green: descriptor stores, NULL keeps it, no duplicate; types regenerated byte-identical. Real CalDAV round-trip is the CAL-8 manual checklist).
- 2026-07-03 · Calendar CAL-8 planned (light) — CalDAV/ICS read-only, dogfood-blocking; spec addendum DoR-ready.
- 2026-07-03 · CLEAN-1 landed — legacy calendar dead-code sweep (−1,533 lines, no behavior change; verify + cargo check green).
- 2026-07-02 · Calendar CAL-7 landed (MCP manifest + Today widget) — Wave 2 (Calendar) COMPLETE; plus a cross-module agent-write fix applied to prod.
- 2026-07-02 · Calendar CAL-4 (the loop) + CAL-5 (focus timer) landed — the moat, no migration.
- 2026-07-02 · Calendar CAL-3 right-panel switcher + drag-to-schedule landed; calendar migration APPLIED to prod.
- 2026-07-02 · Calendar CAL-2 native events end-to-end landed (migration deploy-ready, unapplied).
- 2026-07-02 · Calendar CAL-1 page shell + task-lens grid landed.
- 2026-07-02 · Calendar (Wave 2) spec is DoR-ready; v1 scope + the lens architecture locked.
- 2026-06-24 · No assistive scheduling at alpha.

## Notes, Lexical, Yjs, Notion import → [decisions/notes.md](decisions/notes.md)

- 2026-07-29 · 🔎 Notion ships a ZIP INSIDE A ZIP — the shipped notes importer silently imports nothing from a real export.
- 2026-07-29 · NOTE-FIX-1 — imported notes materialize their CRDT at IMPORT time; the headless Yjs builder is no longer deferred.
- 2026-07-11 · DF-23 (@mention + /ref beyond Notes) landed — the LAST spine-lane block
- 2026-07-10 · DF-13 Notes editor baseline + public page reach landed
- 2026-07-04 · NO-9b landed — publish-to-web renderer unblocked via a public SPA route (Option A, designer-picked); Wave 3 (Notes) FULLY COMPLETE.
- 2026-07-04 · NO-9 public renderer BLOCKED by a Supabase platform limit — the `notes-public` edge fn approach is dead; publish-page rendering needs a new approach (designer decision pending).
- 2026-07-04 · Notes NO-6/7/8 landed (multiplayer · right panel + spine · find & interchange).
- 2026-07-04 · Notes NO-5 landed (task lines — the great moment).
- 2026-07-04 · Notes NO-4 landed (editor grammar rework).
- 2026-07-03 · Notes NO-1..NO-3 landed (schema + intent ops · sync engine v2 · rebuilt page shell + tree).
- 2026-07-03 · Notes (Wave 3) spec is DoR-ready; the rebuild's product shape locked.
- 2026-06-27 · Contacts CO-3 CSV import landed ("the adoption gate").
- 2026-07-30 · IM-1: an imported note's id is derived from Notion's page id, not from its path — and uniqueness is guaranteed, not assumed.
- 2026-08-14 · Lexical upgraded 0.40 → 0.49 (all `@lexical/*` packages) — the breaking changes this repo hit and the fixes.

## Contacts → [decisions/contacts.md](decisions/contacts.md)

- 2026-07-02 · Fix pack FX-9 landed (drag-to-link on /contacts) — Wave 1.5 complete.
- 2026-07-02 · Fix pack FX-8 landed (single-select custom fields).
- 2026-07-02 · Fix pack FX-4–FX-7 landed (card wins · relation sanity + People · entry modal · company parity).
- 2026-07-02 · Fix pack FX-1–FX-3 landed (deep links · tags · directory power).
- 2026-07-02 · Contacts v3 fix pack planned (spec ready).
- 2026-07-02 · Contact/Company hub view-mode reorganized (the "calm card" pass).
- 2026-06-29 · Contacts v2 redesign landed (Batches 1–4).
- 2026-06-27 · Contacts CO-4 linking + suggestions + company union + follow-up landed.
- 2026-06-27 · Contacts CO-2 Directory + ContactHub landed ("the great moment").
- 2026-06-26 · Contacts CO-1 schema + ops + route landed.
- 2026-06-25 · Spine + Contacts specs are DoR-ready; canonical `entity_links` shape ratified.

## Dashboard (Home) → [decisions/dashboard.md](decisions/dashboard.md)

- 2026-07-09 · Dashboard DB-8 (gallery + config popovers) landed — Wave 6 (Dashboard rebuild, DB-1…DB-8) COMPLETE
- 2026-07-09 · Dashboard DB-6 (6 utility widgets + config-write mechanism) + DB-7 (habits) landed
- 2026-07-09 · Dashboard DB-5 (registry + 9 module widgets) landed — NO migration
- 2026-07-09 · Home chrome controls live in the app-chrome bottom bar (not floating over the grid) + a vertical-fill fix
- 2026-07-09 · Dashboard DB-4 (persistence + multi-page pager) landed — NO migration
- 2026-07-09 · Dashboard DB-3 (edit mode + hand-rolled pointer drag) landed
- 2026-07-08 · Dashboard DB-2 (shell swap + old-module deletion) landed
- 2026-07-08 · Dashboard DB-1 (pure grid engine) landed
- 2026-07-08 · Dashboard rebuild ("Home") specced — the bounded-grid model.

## Data layer, Supabase, contracts → [decisions/data.md](decisions/data.md)

- 2026-10-08 · The app never takes a Supabase session from the URL (`detectSessionInUrl: false`); sign-in is the typed 6-digit code only; the dashboard invite link still confirms the address but no longer signs anyone in.
- 2026-10-07 · Attachments are attachments-only, private, and pooled per workspace owner; HEIC converts only where the app can read it.
- 2026-10-08 · Deployed Edge Functions must match `supabase/functions/`, checked by `bun run functions:reconcile`; the Stripe Sync Engine's three functions are the only allowed exceptions.
- 2026-10-01 · Profile pictures and workspace marks live in the public `avatars` bucket.
- 2026-08-30 · ZE-11 — hosted Edge Functions now run the Zod parsers.
- 2026-08-17 · Zod boundary validation is `safeParse` at trust edges; closed values live in `@contracts`.
- 2026-08-14 · S-1 deployment — all 13 Supabase Edge Functions now run with `verify_jwt=false` and the new secret-key environment.
- 2026-08-14 · S-1 API-key migration — backend code uses only the new key model, with no legacy fallback.
- 2026-07-29 · Prod and the migration files ARE in sync — but the repo is not a bootstrap, and that is the real debt
- 2026-07-29 · `REVOKE … FROM PUBLIC` does not revoke `anon` on Supabase — the internal guards and a legacy invite function were anon-callable
- 2026-07-29 · A migration-filename collision is resolved by re-stamping the *idempotent* file, into the slot prod actually applied it in
- Agents act via intent ops only

## Spine: links, activity, notifications, inbox → [decisions/spine.md](decisions/spine.md)

- 2026-10-08 · One reference grammar: `@` mentions anything, `#` is tags, `/` is commands; `#tag` inside text is a link and never applies the tag.
- 2026-07-13 · DF-21 (Universal Inbox — spine lane) /s1 PLANNED — spec DoR-ready, 6 sub-blocks, no code yet.
- 2026-07-13 · DF-9 notification-generation trigger APPLIED TO PROD
- 2026-07-12 · DF-19f-notif (held Notifications toggles sub-slice) landed
- 2026-07-12 · DF-9 (Notification generation v1 — spine lane) landed
- 2026-07-11 · DF-8 (Tasks joins the spine) landed
- 2026-07-11 · DF-10 (⌘K palette searches entities) landed
- 2026-07-10 · DF-1 (deep-link selection: Tasks) landed
- 2026-06-27 · Spine CT-6 deterministic auto-suggest + strip landed.
- 2026-06-27 · Spine CT-4 @mention / /ref resolver + EntityRefChip landed.
- 2026-06-26 · Spine CT-5 comments + notification/activity generalization landed.
- 2026-06-25 · Spine CT-3 universal drag-payload contract landed.
- 2026-06-25 · Spine CT-2 EntityHub roll-up landed (reusable component + reducer).
- 2026-06-25 · Spine CT-1 link substrate landed (DB + runtime + TS).
- 2026-06-24 · Polymorphic integrity → a lean central `entities` registry.

## Tasks and Timeline → [decisions/tasks.md](decisions/tasks.md)

- 2026-10-08 · TV-D1 landed: task edits save field by field, a task has its own assignee (`assignee_id`), and `owner_id` is the creator again.
- 2026-10-08 · TV-F1: Focus keeps time by the wall clock, survives reloads, and asks about away time.
- 2026-10-08 · TV-Q1: the List leaves modified keys alone, a row's buttons keep Space/Enter, the bucket pill shows only where the bucket isn't implied, and deleting a bucket confirms, then commits when its Undo toast closes.
- 2026-10-08 · Tasks v2 calls answered: saved views are personal and synced; buckets get Archive, "Delete the tasks too" and a 30-day Recently deleted.
- 2026-10-07 · Tasks v2 planned: one optional assignee, a personal Queue not tied to a date, Focus as a run of your Queue, time entries and live updates.
- 2026-07-11 · DF-22: Tasks unifies to ONE app-level `DndContext`, but the Timeline deliberately keeps its own nested one.
- 2026-07-03 · Tasks TL-3 timeline dependency creation landed — Timeline view complete.
- 2026-07-03 · Tasks TL-2 timeline drag interactions landed.
- 2026-07-03 · Tasks TL-1 static timeline landed.
- 2026-07-02 · Tasks Timeline view specced (light plan) — the "Gantt deferred" is un-deferred.
- Subtasks are full tasks
- Recurrence = one task row that cycles

## Design system and UI → [decisions/design-system.md](decisions/design-system.md)

- 2026-10-08 · DS-3 landed: NavRow (count ⇄ ⋯ in one slot, one menu for ⋯ and right-click) and MetaCount; the Tasks rail runs on NavRow and hands focus back to itself when a row dialog closes.
- 2026-10-08 · DS-4 landed: FilterBar, DisplayMenu, the drag visuals and the view-prefs helper are generic primitives; Tasks adopts them in TV-U2/TV-U4.
- 2026-10-08 · DS-2 landed: primitives use the state layer, selection is tint-only, hover ≠ current everywhere it collided.
- 2026-10-08 · DS-1 landed: the state layer re-resolves in every appearance scope, thin token scrollbars are the global default, and Storybook switches every appearance axis.
- 2026-10-07 · A state layer of tokens; selection becomes tint-only (R5 rewrite lands in DS-2).
- 2026-08-14 · DF-18 (eyebrow / detail-title / toolbar standardization) landed
- 2026-07-27 · The app accent is MONOCHROME by default; hues are opt-in; pre-workspace surfaces are always monochrome
- 2026-07-27 · Onboarding is ONE screen, on the design system
- 2026-07-12 · DF-19f (Settings → Preferences: default landing view · startup · sounds & motion) landed
- 2026-07-11 · DF-16 (dead-chrome + copy sweep) landed
- 2026-07-03 · Post-Wave-2 sequencing calls (designer-ratified).
- 2026-06-13 · Text-size picker retired; density is the size axis.
- 2026-06-11 · Density is a customization axis, not a fixed value.
- Control-sizing rung contract.
- Theme shades.

## Brand: logo, colour, type, motion, voice → [decisions/brand.md](decisions/brand.md)

- 2026-10-08 · BRAND-4: the landing uses the lockup artwork, and the mark reveals itself in the nav on a first visit.
- 2026-10-08 · BRAND-1: every brand file is generated from `brand/masters/` by `bun run brand:export`.
- 2026-10-08 · Pink is not Moduo's accent and there is no "AI disc"; pink stays only as one ordinary accent/tag option.
- 2026-10-08 · Brand system planned: the product is the brand; drawn wordmark; no brand hue; pink isn't a brand colour; the mark reveals itself out of nothing.

## Product scope, alpha, settings, cross-cutting fixes → [decisions/product.md](decisions/product.md)

- 2026-10-08 · TX-1: the email kit is plain TypeScript at `supabase/functions/_shared/email/`, and its logo images come from the brand pipeline, not from the kit
- 2026-10-08 · Every email Moduo sends goes through one system: Resend, one template kit, one outbox; invite-only becomes an allow-list

- 2026-10-07 · Finance is not planned — not soon, possibly never.
- 2026-10-02 · Chat + calls becomes a planned module (Duo/Team plans only), reversing "no chat module, keep Slack"; whiteboard not planned; Mindmap stays hidden
- 2026-07-29 · Mindmap is OUT of alpha scope
- 2026-07-12 · DF-19e (Settings → Workspace: management inlined; standalone modal retired) landed
- 2026-07-12 · DF-19h (Settings → Account: delete account) landed
- 2026-07-12 · DF-7 (Rollup snippets + CompanyHub last-touch) landed
- 2026-07-12 · DF-19i (Settings: About cloud-first + Integrations cleanup) landed
- 2026-07-12 · DF-19g (Settings → Advanced: data export · reset-cache · diagnostics) landed
- 2026-07-11 · DF-19b/c/d (Settings: Appearance grouping · Account identity+password · API-keys section) landed
- 2026-07-11 · DF-19a (Settings grouped-nav backbone) landed
- 2026-07-11 · DF-19 (Settings overhaul) /s1 PLANNED — spec DoR-ready, 9 sub-blocks, no code yet.
- 2026-07-11 · DF-20 (global capture command bar) landed
- 2026-07-11 · DF-24 (workspace membership loop) landed
- 2026-07-11 · DF-12 (boot fetch storm consolidation) landed
- 2026-07-10 · DF-4 (hide Mindmap from the alpha nav) landed
- 2026-07-10 · Whole-app critique ratified → dogfood-fix plan DF-1…DF-24 (now in `BUILD_ORDER`, ahead of MCP-1) + `/s3` gains step 7 (next-session spawn chips).
- 2026-07-10 · DF-14 (selection + accent unification) landed
- 2026-07-10 · DF-5 (destructive-action safety pack) landed — ONE undo grammar app-wide
- 2026-06-24 · Alpha strategy locked.
- 2026-06-24 · Build sequence.
- 2026-06-24 · Lossless export is a launch-day trust feature.
- 2026-06-12 · Blocked-by = computed read-time state.
- 2026-06-11 · Cloud-first pivot.
- 2026-07-29 · SCALE-1 — bounded, paged module reads; the "explicit `.limit()`" premise was wrong.
