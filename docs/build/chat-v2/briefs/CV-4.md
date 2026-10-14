# CV-4: Chat in handed-out Team workspaces (server, small)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-4-plan-source`; record `docs/build/chat-v2/CV-4.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 4 | **CV-4** Chat in handed-out Team workspaces *(server, small)* | `chat_workspace_enabled` reads the effective plan with the grant fallback; `CHAT_PLAN_TIERS` / `planHasChat` follow; `chat_plan.spec` with and without TX-9b's function. *Until TX-9b lands:* the owner's plan decides, unchanged | AC2.1, AC2.8, AC10.8 | 1 |

**Depends on:** CV-1. TX-9b (the grant) is **not built** on this branch (`specs/BUILD_ORDER.md`: TX-9b unticked, owned by the hackathon plan): the owner's plan decides until it exists.

## 2. What to build

**§1 Words, shape and who sees Chat**
- **The Chat tab shows when a workspace has two or more members** (CH4); a one-person workspace never shows it, and a workspace back to one member keeps it while chat history exists. Chat is **on** when the owner's plan includes it (Duo, Team, Founder) or the workspace holds a dated grant (CH25, CH67); otherwise the tab opens on the paused state below (with the history, when there is any). ⌘7 stays Chat's number.
- **When the plan doesn't include chat** (a lapsed Duo, a grant that ended): Chat stays in the top bar, **every conversation stays readable and searchable**, and the composer is replaced by one line: "Chat is paused: this workspace's plan doesn't include it. Anna can turn it back on." The owner sees the same line with "Choose a plan". No marketing page (CH4a). Reading, marking read and unread, clearing Catch up, Later and Remind me, reacting, notification levels, Pin to sidebar, leaving, presence and statuses keep working, as do search, the Home widgets and read-only MCP; posting, editing, deleting, creating channels, files, moving, linking, decisions, pins and custom emoji wait for the plan.

**Edge cases this block handles** (§Edge cases)
- A workspace's plan lapses → every conversation stays readable and searchable; the composer shows the paused line; the owner sees "Choose a plan"; Catch up, widgets and read-only MCP keep working; a queued "Waiting to send" message becomes "Not sent · Retry".
- A dated grant ends during a hackathon → the same paused state; no new invites (the hackathon plan's rule); everything stays readable.
- The grant mechanism (TX-9b) isn't built yet → chat's plan check falls back to the owner's plan and works unchanged.

## 3. Acceptance criteria

**AC2 — A hackathon team's weekend (the hackathon cut)**
- **AC2.1** a handed-out Team workspace shows Chat with General and the welcome line
- **AC2.8** when the grant ends everything stays readable and the composer says the plan paused

**AC10 — Channels and permissions**
- **AC10.8** the paused plan keeps reading, search, widgets and read-only MCP

**Tests that prove them** (file · name · AC · plain English)

- `tests/chat-plan.spec.ts` · "paused and grants" · proves AC2.1, AC2.8, AC10.8 · A lapsed plan keeps reading, search and widgets, shows the paused line, refuses sends; a dated grant enables chat and its end pauses it; without TX-9b the owner's plan decides.

## 4. Decisions that bind it

- **The rule** (round-3 §2.25 e, #25; CH4a, CH25, CH67): `chat_workspace_enabled(ws)` is true when the workspace's owner has Duo, Team or Founder **or** the workspace holds an active dated grant. v1's live body checks the owner's plan only (`plan_tier_rank(profile_plan_tier_text(owner)) >= 2`, workspace not deleted): start from the live body.
- **The grant is read through one function the grant's owner defines** (the hackathon plan; TX-9b in the spec). It is **not built** and its name isn't fixed: the function is looked up with `to_regprocedure` and, when absent, the owner's plan decides, so the order of merging never matters. Look up `public.plan_grant_effective_tier(uuid)` (`to_regprocedure('public.plan_grant_effective_tier(uuid)')`): given a workspace id, it returns the plan tier an active dated grant gives that workspace now, or null when none is active (orchestrator's choice of name and shape; TX-9b builds it to this signature). Don't confuse it with `transactional-email.md` T24's per-email founder `plan_grants`: the workspace-level dated grant is the hackathon plan's (`.design/chat-v2/research/hackathon.md`).
- **Reading never needs the plan** (CV-1 did that); posting, editing, deleting, creating channels, files, moving, linking, decisions, pins and custom emoji do, through `chat_op__guard`, which reads this function. The ops that stay open on a paused plan are listed in #25 (read-state ops, Catch up ops, `react`, `set_prefs`, `leave`, status and client ops); each op's own block implements its exemption.
- **`CHAT_PLAN_TIERS` / `planHasChat`** (`supabase/functions/_shared/contracts/vocabularies.ts`, a Tier 2 path) "follow" (#29): a grant is not a tier, so decide how the client-side helper expresses it (the app already asks the server: `isEnabled` in `src/lib/runtime.chat.web.ts` calls `chat_workspace_enabled`), keep `vocabularies.test.ts` and the drift gate green, and record the choice.
- **Paused state, as the spec words it** (#33, §1): "Chat is paused: this workspace's plan doesn't include it. Anna can turn it back on." (the owner sees "Choose a plan"); an ended grant gives the same state, with no new invites (the hackathon plan's rule) and everything readable. The screen itself is CV-8a's.

## 5. Files

New: `supabase/migrations/<stamp>_chat_v2_plan_source.sql` (#35); `tests/chat-plan.spec.ts`. Touch: `supabase/functions/_shared/contracts/vocabularies.ts` (+ `vocabularies.test.ts`), `src/lib/runtime.chat.web.ts` (`isEnabled`). v1 origin: `supabase/migrations/20261006150000_chat_module.sql`. A throwaway stub of the grant function, created and dropped in the spec's setup, proves the with-grant path; without it the owner's plan decides. The spec's UI assertions (the paused line replacing the composer, refused sends) complete when CV-8a lands; assert at RPC level here (my reading; record it).

## 6. From earlier blocks

CV-1: the read rule without the plan (`chat_can_read_channel`), the foundation columns. Check that reading a conversation works for a workspace whose owner is on Free.

## 7. Watch out

- A workspace whose grant ended must stay readable and searchable, and a queued "Waiting to send" message turns into "Not sent · Retry" (edge case above).
- The plan check changes who can write on prod the moment it applies: keep the fallback behaviour identical to v1 when no grant function exists.
- **Tier 2** (migrations, RLS, contracts, moduo-mcp, src/lib/runtime*): one `/code-review high` and one security scan of the diff at the end; scan findings go only into the hand-back.
- **Migration:** stamp provisional (re-cut on apply day, chat's order kept); redefine from live bodies (`pg_get_functiondef`); re-state grants by name (`DROP` + `CREATE` resets them); re-assert the Realtime publication if you publish a table; apply only on your migration turn, then `bun run db:test chat`; never `local:reset` or `migration up` (runbook, `docs/gotchas/supabase.md`).
- **Hot files:** `src/lib/runtime.chat.web.ts`. Keep edits there small; another builder may change them too.
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

The paused screen and the composer line (CV-8a); the grant mechanism itself and its function (the hackathon plan, TX-9b); per-op plan exemptions (each op's block); plan limits for files (CV-9).
