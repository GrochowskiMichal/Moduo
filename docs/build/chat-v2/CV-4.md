# CV-4 — Chat in handed-out Team workspaces

> Branch `t/maciej/cv-4-plan-source` · head: the commit carrying this line · status: built, not landed
> Migration: `supabase/migrations/20261014100400_chat_v2_plan_source.sql` (released as `20261017102000`) · applied to the local stack: **no** (waiting for its turn, after CV-2a's). Proven in rolled-back transactions only (below). Apply it with `psql "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261014100400_chat_v2_plan_source.sql`, then `bun run db:test chat` and `scripts/agent/e2e.sh tests/chat-plan.spec.ts`. The stamp is provisional (re-cut on apply day, after CV-2a's and CV-2b's files).

## Delivered against the row

- **`chat_workspace_enabled(ws)` reads the effective plan**: true when the workspace isn't deleted and its owner's plan ranks Duo or above (v1's rule, checked first, unchanged) **or** `public.plan_grant_effective_tier(ws)` (TX-9b's function, looked up with `to_regprocedure` on every call and called only when it exists) returns a tier ranked Duo or above. Absent function → the owner's plan decides, exactly as v1. A grant function that fails reads as no grant (a `WARNING` with its SQLSTATE in the log). Same name, parameter, return type, `STABLE SECURITY DEFINER`, `search_path = public`; the language moves sql → plpgsql (a SQL body must resolve every function it names at create time). Grants re-stated (`authenticated`, `service_role`; no PUBLIC, no anon) and asserted at the end of the file; a `COMMENT` names the grant function's contract for TX-9b.
- Every caller picks it up by name, unchanged: `chat_op__guard` (posting and the other plan-gated writes), `chat_op_agent_post`, `chat_can_access_workspace` (the workspace presence topic, v1's `chat_unread_counts`). Reading still never asks the plan (CV-1's `chat_can_read_channel`).
- **`CHAT_PLAN_TIERS` / `planHasChat` follow** (contracts): unchanged behaviour, doc comment rewritten (a tier list for the owner's plan and a grant's tier alike; whether a workspace has chat is the server's answer), and a **new drift gate**: `CHAT_PLAN_TIERS` must equal the tiers the newest `CREATE FUNCTION public.plan_tier_rank` body (today `20261006120000_entitlements_from_stripe_sync.sql`) puts at Duo or above; the plan-source migration must look up `public.plan_grant_effective_tier(uuid)` and compare against `plan_tier_rank('duo')`; and any migration that defines `plan_grant_effective_tier` must define it as `public.plan_grant_effective_tier(<one uuid>)` (signature drift in TX-9b would otherwise switch grants off silently).
- **`runtime.chat.web.ts`**: comments only (the header's plan gate and `isEnabled`: the owner's plan or a dated grant, decided server-side; off means paused, and v1's screens show ChatLocked until CV-8a). `isEnabled` already asks `chat_workspace_enabled`.
- **Tests**: `supabase/tests/chat_plan.test.sql` (27 checks, runs under `db:test chat`) and `tests/chat-plan.spec.ts` (API level, two tests, two workspaces: one whose owner pays and then lapses, one handed out by a grant and opened only under it).

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC2.1 | `supabase/tests/chat_plan.test.sql` · "grant: a Team grant turns chat on for W, whose owner is on Free", "grant: A opens chat in W and General is made", "grant: A posts in General"; `tests/chat-plan.spec.ts` · "paused and grants › a dated grant turns chat on in a Free owner's workspace, and its end pauses it" (its workspace has no General until the grant; **orchestrator runs it after applying**). The welcome line is UI (CV-8a). |
| AC2.8 | `chat_plan.test.sql` · "grant ended: chat is paused in W", "grant ended: A can't post", "grant ended: A still reads General", "… reads the conversation and its message", "… search still finds it"; the same spec test (second half). The paused line in place of the composer is CV-8a's. |
| AC10.8 | Reading and search on a paused plan: `chat_plan.test.sql` (grant ended; grant function gone) and `tests/chat-plan.spec.ts` · "paused and grants › a lapsed plan keeps reading and search, refuses sends; the owner's plan decides" (**passed** on the local stack without the migration: it is v1's rule plus CV-1's read rule). Widgets and read-only MCP are **not** complete here: v1's Conversations widget shows "Chat comes with the Duo and Team plans" and v1's connector refuses reads (`assertEnabled` in `moduo-mcp/modules/chat.ts`) when `chat_workspace_enabled` is false; CV-22 (widgets) and CV-21 (MCP tools, reads as the creator through the app's reads) finish AC10.8. |
| "without TX-9b" | `chat_plan.test.sql` · "no grant function: Duo, Team and Founder owners have chat, Free and Pro don't (CHAT_PLAN_TIERS)", "… W2 on; W3 and W off", "… an unknown workspace is off", "TX-9b's function gone again: …"; `drift-gates.test.ts` · "CHAT_PLAN_TIERS are plan_tier_rank's tiers at Duo or above; …" |

**Rolled-back proof** (one `psql` session as `supabase_admin` per file: `BEGIN` → the migration → `_setup.sql` → the test → `_finish.sql`'s `ROLLBACK`), after the review fixes: `chat_plan` 27/27, `chat_foundation` 47/47, `chat_privacy` 60/60, `chat_realtime` 19/19, `chat_erasure` 9/9, `chat_convert` 35/35. The `chat_plan` run drops and recreates the grant function in one session (text, failing, `plan_tier`), so the cached call is re-planned each time. Negative control (first version): `chat_plan.test.sql` against the live (v1) body fails 12 checks (every grant check). Afterwards the live `chat_workspace_enabled` has no `plan_grant` text and no `plan_grant_effective_tier` exists on the stack. The spec's stub SQL (install, end, the real-function guard including a real function with no comment, drop) was run verbatim in rolled-back transactions too. The spec's lapsed-plan test passed live through `scripts/agent/e2e.sh` (it needs no migration; its `beforeAll` makes both workspaces).

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **The owner's plan is asked first; the grant function only when it doesn't include chat** · agent · keeps v1's answer (and cost) for every paying workspace, and a broken or slow grant function can't take chat from one (`chat_plan.test.sql` proves a raising stub is never called for a Duo owner) · rejected: `greatest(owner rank, grant rank)` in one expression (always calls the grant function).
- **A grant function that fails reads as no grant, with a `WARNING` (its SQLSTATE only) in the log** · agent (code review) · `chat_can_access_workspace` (the realtime topic policies, v1's unread counts) asks this function too, so letting the error through would turn a TX-9b bug into errors on every Free-owner workspace's presence, counts and `isEnabled`; read as no grant, only a granted workspace pauses, and the log names it. The exception block wraps only the call, which runs only when the owner's plan doesn't include chat · rejected: letting the error through (the first version).
- **The grant function is called statically, guarded by `to_regprocedure`** · agent (code review) · plpgsql prepares a statement on its first run, so the body never needs the function to exist, and the call gets a cached plan (re-planned when the function is replaced: proven in `chat_plan.test.sql`) · rejected: `EXECUTE` (planned on every call), and a placeholder function this migration creates for TX-9b to replace (the brief binds the order-independent lookup; a placeholder would break TX-9b's plain `CREATE FUNCTION` and fix its return type).
- **The grant's tier is read as text (`::text`) and ranked with `plan_tier_rank`** · agent · TX-9b may return `text` or the `plan_tier` enum (both proven); an unknown tier ranks 0 (off) · rejected: fixing the return type here.
- **`CHAT_PLAN_TIERS` / `planHasChat` keep their behaviour; the grant stays server-only** · agent · a grant is not a tier of its own and the client never learns it; the one client caller (`chat-locked.tsx`) asks about the reader's *own* plan; the workspace answer is `ChatRuntime.isEnabled` → `chat_workspace_enabled`. The drift gate ties the list to `plan_tier_rank` and to the plan-source file · rejected: a client `workspaceHasChat(ownerTier, grantTier)` helper with no caller (the client has no grant tier to give it).
- **`search_path` stays `public`** (the live body's), with every call schema-qualified.
- **Spec at API level** (the brief's reading): the paused line and "Not sent · Retry" are CV-8a's; this spec asserts `chat_workspace_enabled`, reads, search (v2 `search_tsv` and v1's `ilike`) and a refused `chat_op_send` (by HTTP status, not wording: CV-2a may reword the refusal) with no row written.
- **The spec's grant stub** is created with `psql` (PostgREST can't run DDL) using the stack's `DB_URL` from `supabase status` (`MODUO_DB_URL` overrides), carries the comment `chat-plan.spec stub`, and is replaced or dropped only on a positive match of that comment (validator: a real function with no comment must never count as the stub); it is dropped in `beforeAll` too, so a crashed run leaves no grant behind. When a real `plan_grant_effective_tier` exists (TX-9b landed) the grant test skips with a reason; the lapsed-plan test still runs (a new workspace has no grant).
- **`chat_workspace_enabled` keeps v1's signature and contract** (one bit: chat on or off for a workspace) · agent · callers and the connector depend on it, and every write path checks membership first · rejected: changing the RPC's contract in this block (CV-23 reviews the v1 surface).

## Gotchas (area: supabase)

- **(supabase)** A `LANGUAGE sql` function body is parsed and its functions resolved at `CREATE` time: a function that may not exist yet can only be reached from plpgsql: guard it with `to_regprocedure` and call it statically (plpgsql prepares the call on first execution, so it is never resolved while the function is absent).
- **(supabase)** A `DO $$ … $$` block whose body contains `$$` anywhere (e.g. nested `$b$…$b$$f$`) ends early with a confusing syntax error: name the outer quote (`DO $do$ … $do$`).
- **(supabase)** `coalesce(obj_description(…), 'mark') = 'mark'` counts an uncommented object as marked: match a marker positively (`obj_description(…) IS NOT DISTINCT FROM 'mark'`, and the object exists).

## For later blocks

- **TX-9b (hackathon plan):** build `public.plan_grant_effective_tier(p_workspace_id uuid)` returning the active dated grant's tier (`text` or `plan_tier`) or null; `chat_workspace_enabled` picks it up with no further migration (the drift gate fails if the signature differs). Give it `search_path` pinned; it runs as `postgres` (called from a definer). If it raises, chat reads it as no grant and logs a `WARNING` with the SQLSTATE. When it lands, `tests/chat-plan.spec.ts`'s grant test skips (its stub never replaces a real function): TX-9b's own spec should cover a grant turning chat on and off through its ops; `chat_plan.test.sql` keeps working (it renames a real function out of the way inside its rolled-back run).
- **CV-2a:** `chat_op__guard` keeps calling `chat_workspace_enabled`; if the refusal's wording or code changes, `chat_plan.test.sql`'s "grant ended: A can't post" expects the message to contain "plan" (`v ILIKE '%plan%'`).
- **CV-2b:** v1's `chat_unread_counts` asks `chat_can_access_workspace` (the plan): on a paused plan it returns nothing; the redefinition should read without the plan (§1: marking read keeps working).
- **CV-17:** the workspace presence topic (`chat:<ws>`) is allowed through `chat_can_access_workspace` (the plan): presence on a paused plan needs it to drop the plan (§1).
- **CV-8a:** the paused screen reads `isEnabled` (false = paused); a paused workspace's conversations still load. `chat-locked.tsx` is v1's marketing page (CH4a removes it).
- **CV-21:** v1's connector refuses chat reads when `chat_workspace_enabled` is false (`assertEnabled`); read-only MCP must keep working on a paused plan (AC10.8).
- **CV-22:** v1's Conversations widget shows the plan copy when `enabled` is false; the Catch up widget must keep working on a paused plan (AC10.8).

## Manual checklist (step → expect → surface)

- [ ] Apply the migration, `bun run db:test chat` → 6 files pass (`chat_plan` 27 checks) → terminal
- [ ] `scripts/agent/e2e.sh tests/chat-plan.spec.ts` → 2 passed → terminal
- [ ] A Duo workspace with two people; switch the owner to Free and reload Chat → every conversation still opens and search finds old messages; sending is refused → Chat
- [ ] With a stub grant for that workspace (`tests/chat-plan.spec.ts`'s SQL), reload → chat is on; end it → paused again → Chat

## Reviews

- **Validator**, round 1 on `dd6f8625..3a1c2831`: no BLOCKER. One MAJOR, fixed: the spec's stub guard counted a real, uncommented function as the stub. MINORs: spec test 2 didn't prove General is made under the grant (fixed: it has its own workspace, opened only under the grant); AC10.8's widgets and MCP (left to CV-22 and CV-21, as recorded here). NITs fixed: the redundant `coalesce` and an unwrapped comment. Delta round: on the fix commit.
- **`/code-review high`**:
  - Fixed: the same stub-guard finding; a failing grant function's error reaching the realtime policies and counts (it now reads as no grant); `EXECUTE` on every call (now a static call); the drift gate reading only one migration (it reads the newest body); the `isEnabled` comment (reworded).
  - Added: a drift-gate check for signature drift.
  - Rejected: a placeholder function and a membership check (reasons above).
- **Security review**: no finding at confidence ≥ 8.

## Verify before release

- Prod has no `public.plan_grant_effective_tier(uuid)` unless TX-9b shipped it; if TX-9b ships first, check it returns null for every workspace without an active grant before this applies (the plan check changes who can write the moment it applies).
- On prod, `chat_workspace_enabled` is owned by `postgres` and keeps `authenticated` + `service_role` EXECUTE only (the migration asserts the grants).
