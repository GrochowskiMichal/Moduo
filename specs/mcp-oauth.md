# Spec: Sign in with Moduo for MCP apps (connector on Supabase's MCP foundation)

> Status: **Ready** · Owner: mike · Planned 2026-10-22 · Related: [docs/moduo-mcp-connector.md](../docs/moduo-mcp-connector.md) · [docs/decisions/mcp.md](../docs/decisions/mcp.md) · [docs/moduo-module-contract.md](../docs/moduo-module-contract.md)

## Scope

Today an AI app reaches Moduo only with a pasted workspace API key (`Authorization: Bearer moduo_sk_…`). Claude.ai, Claude Desktop and ChatGPT add custom connectors by URL and sign-in, not by a pasted header, so most people can't connect Moduo from them. This delivers **"Add Moduo by URL, sign in, choose what it can reach"**: Supabase Auth's OAuth 2.1 server signs the person in, a Moduo consent screen turns their choices into an ordinary scoped key (a **connection**), and the connector accepts the app's OAuth token as that key. At the same time the connector moves onto Supabase's MCP foundation: the official MCP TypeScript SDK for the protocol and `@supabase/server` for token checks and OAuth discovery. Pasted keys keep working for scripts and tools that can't sign in. Last, the connector becomes friendlier to clients that run tools from code ("code mode", Anthropic's programmatic tool calling): output schemas and tool annotations.

Why now: Supabase shipped the pieces (OAuth 2.1 server, `@supabase/server`, the MCP Server block, 2026-10-22), all on the Free plan we're on, and connecting from claude.ai is the first thing an alpha user will try.

## Product behavior & UX

**Connecting (the main flow).**
1. In Claude (or ChatGPT, Claude Code…) the person adds a connector with the URL shown in Moduo's Settings → API keys / Integrations → AI & MCP.
2. The app finds out how to sign in (OAuth discovery), registers itself and opens the browser at Moduo's consent screen, `/oauth/consent` (a page outside the app shell, like `/join`).
3. Not signed in: the email-code sign-in appears; after it the person lands back on the same consent screen (a pending-consent hand-off, like the invite's pending join). Someone not in Moduo sees the existing invite-only message.
4. The consent screen: "**<App name> wants to work in Moduo as you**", the app's website domain (always shown), a quiet "Moduo hasn't checked this app" line unless the domain is claude.ai, anthropic.com, openai.com or chatgpt.com, a **workspace picker** (defaults to the current workspace), the **same None / View / Edit card per module** as the API key screen with its caps ("You can only view X yourself"), the cross-module notes and the private-chat switch, an **expiry picker** (Never / 30 days / 90 days / 1 year, default 90 days), and **Approve** / **Deny**.
5. Defaults: Tasks: View, everything else None, 90 days, exactly the key card's.
6. Approve: the connection is created, the browser goes back to the app, and the app's tools appear. A quiet bell notice to the person only: "Claude connected to Moduo · View: Tasks".
7. Deny: nothing is created; the app is told no.

**Using it.** Everything an agent does through a connection behaves as with a key today: only the chosen modules, never more than the person, every change in the trail as "Alex · via Claude", tools listed per access.

**One connection per app per person.** A connection belongs to one workspace. Reconnecting the same app (a new device, an expired connection, a reconnect) shows the consent screen pre-filled with the current access; approving updates that same connection (no duplicate). Picking a different workspace there moves the connection to it (the old one ends).

**Settings → API keys.** Connections sit in the same list, marked **Connected app**, with no secret or prefix. Same details as keys: access summary, "Acts as you", Last used / Never used, Expires… / Expired, Unused for N days; same **Edit access**. "Revoke" reads **Disconnect** ("Disconnect Claude? It loses access immediately; it can sign in again later."). Disconnect cuts the app off at once; its next call is asked to sign in again. Connections count toward the 20-key cap. The trail name is the app's own name ("Claude"), renameable in the row like a key's.

**Telling people how to connect.** The Connector card (Settings → API keys) and Integrations → AI & MCP lead with "Add Moduo as a connector in Claude, ChatGPT or Claude Code with this URL. You'll sign in and choose what it can reach." plus the URL with a copy button. Keys move to a secondary "For scripts and tools that can't sign in" with the existing create flow.

**States.**
- Consent screen loading: skeleton of the card. Unknown or used-up `authorization_id` (reloaded, expired, opened twice): "This sign-in link has expired. Go back to <app or 'your app'> and connect again."
- Role without `ws.api_keys` in the chosen workspace: that workspace is listed but disabled with "Your role doesn't include API keys here. Ask the workspace owner."; if no workspace qualifies, Approve is off with that message.
- At the 20-key cap: "This workspace has 20 keys and connections. Disconnect or revoke one in Settings → API keys first." Approve off.
- Already consented and the app re-asks (Supabase reports prior consent): the screen still shows, pre-filled (rule above), so access is always seen before it changes.
- Expired connection: the app's calls are refused and it asks the person to sign in again; the row says "Expired …".

## Edge cases

- **Token used outside the connector.** An app's OAuth token is a Supabase user token. It must get nothing from Supabase's API (database, Storage, Realtime) or Moduo's other functions (`delete-account`, billing, …). Only `moduo-mcp` honours it.
- **Disconnected or expired connection, token still valid** (tokens live up to an hour): the connector refuses at once; the person's grant is also withdrawn so the app can't refresh silently.
- **The person leaves the workspace or loses the role**: as with keys today, the connection is capped to what the person has (a former member's connection has no access).
- **Two apps of the same kind** (Claude Desktop and claude.ai register as separate clients): two connections, each named by the app.
- **Same app, second workspace**: moving the connection ends the first (one workspace per connection); the consent screen says "This moves Claude from <A> to <B>."
- **Approve succeeds in Moduo but the redirect fails** (browser closed): the connection exists; reconnecting reuses it.
- **Approve clicked twice / two tabs**: one connection (idempotent on app + person).
- **An app registers with a misleading name** ("Moduo Official"): the domain line and the unchecked-app note are the defence; no allowlist for alpha.
- **Pasted keys**: unchanged, including the error text clients see.
- **Old clients** that only speak older MCP protocol versions: still served (the SDK negotiates down).
- **Signed out mid-consent** (session expires on the page): Approve signs in again and returns.

## Acceptance criteria

- **AC1** — An OAuth token Supabase issued to an app gets nothing from the database API, Storage, Realtime or any Moduo function other than `moduo-mcp`; the person's own sign-in keeps working everywhere.
- **AC2** — The connector speaks MCP through the official SDK, and every existing tool answers exactly as before for a pasted key (tool lists per scope, arguments, results, errors, attribution).
- **AC3** — An MCP client with no credentials gets a 401 that points it at Moduo's sign-in (OAuth protected-resource discovery), and can register itself.
- **AC4** — A valid token for a live connection reaches the tools that connection's access allows, attributed "Person · via <app name>"; a token for a disconnected, expired or missing connection is refused with "sign in again".
- **AC5** — The consent screen shows the app's name and domain, the unchecked-app note for unknown domains, the workspace picker, the per-module access card with the person's caps, private chat, and expiry, with the key card's defaults; Approve creates (or updates) one connection and returns to the app; Deny creates nothing.
- **AC6** — A signed-out person who opens the consent link signs in with an email code and lands back on the same consent screen.
- **AC7** — Reconnecting the same app pre-fills the current access and updates the same connection; picking another workspace moves it.
- **AC8** — Settings → API keys lists connections as "Connected app" with no secret, with Edit access, rename, expiry and usage details; Disconnect cuts the app off immediately and withdraws its grant.
- **AC9** — Connections count toward the 20-key cap, and the consent screen refuses with the cap message at 20.
- **AC10** — A new connection sends the person (only) a quiet bell notice naming the app and its access.
- **AC11** — Settings and Integrations lead with connecting by URL; keys sit under "For scripts and tools that can't sign in".
- **AC12** — The main read tools publish an output schema and every tool carries read-only / destructive / idempotent hints.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `supabase/tests/oauth_token_lockout.sql` · "an OAuth token reads and calls nothing" | AC1 | With an OAuth-shaped token (a `client_id` claim), table reads, RPC calls, Storage objects and Realtime topics are all refused; the same person without `client_id` still works. |
| `supabase/functions/_shared/user-auth.test.ts` · "refuses app tokens" | AC1 | Every Edge Function that accepts a person's token turns away a token that carries `client_id`. |
| `scripts/oauth-lockout-probe.ts` (local stack, real OAuth server) · "token from a real authorization" | AC1 | Runs a real OAuth code flow on the local stack, then hits PostgREST, Storage, Realtime and `delete-account` with the token and expects refusals. |
| `supabase/functions/moduo-mcp/sdk-parity.test.ts` · "same answers through the SDK" | AC2 | For every tool, the list entry, a sample call's result and an error answer match the pre-SDK snapshot. |
| existing `key-scopes.test.ts`, `tasks-v3.test.ts`, `chat-tools.test.ts`, `tool-schemas.test.ts` | AC2 | The current suite still passes, now calling through the SDK server. |
| `supabase/functions/moduo-mcp/oauth.test.ts` · "401 points at discovery" | AC3 | A call without credentials gets 401 with `WWW-Authenticate: Bearer resource_metadata=…`, and the protected-resource document names the Supabase authorization server. |
| `oauth.test.ts` · "token maps to its connection" | AC4 | A signed token with `sub` + `client_id` resolves the live connection's scopes; revoked, expired, missing and wrong-workspace cases answer 401 `invalid_token`. |
| `supabase/tests/oauth_connections.sql` · "connect is one per app and person" | AC5, AC7, AC9 | The connect function creates, then updates the same row, moves it between workspaces, caps scopes to the person, refuses at 20, refuses a role without `ws.api_keys` and an unknown client. |
| `supabase/tests/oauth_connections.sql` · "attribution reads via the app" | AC4 | An op through a connection logs `api_key` with "Person · via Claude". |
| `apps/app/src/features/settings/oauth-consent.test.ts` · "consent model" | AC5 | Defaults, caps, the unchecked-app rule by domain, the move-workspace line, the cap and role messages. |
| `apps/app/src/features/workspaces/pending-consent.test.ts` · "resume after sign-in" | AC6 | The pending consent survives sign-in, expires after 10 minutes, and is taken once. |
| `e2e/oauth-consent.spec.ts` · "approve and deny" | AC5, AC6 | Against the local stack: a client starts authorization, the signed-out person signs in, sees the screen, approves, and the client gets a code; a second run denies and nothing is created. |
| `apps/app/src/features/settings/api-keys.test.ts` · "connected apps in the list" | AC8, AC11 | Rows for connections show "Connected app", no prefix, Disconnect wording; the connector card leads with the URL copy. |
| `supabase/tests/oauth_connections.sql` · "disconnect cuts off" | AC8 | After disconnect, the key id no longer resolves, so the next call is refused. |
| `supabase/tests/oauth_connections.sql` · "connect notifies the person" | AC10 | One bell notice to the person, none to others. |
| `supabase/functions/moduo-mcp/tool-annotations.test.ts` · "every tool is annotated" | AC12 | Each tool has hints; view tools are read-only; the five main reads have an output schema that their real answers validate against. |

## Assumptions & technical decisions

1. **A connection is a `workspace_api_keys` row**, not a new table. New columns `oauth_client_id text` (null for pasted keys) and `oauth_client_domain text`; `key_hash` becomes nullable with a CHECK that exactly one of `key_hash` / `oauth_client_id` is set; a partial unique index on `(created_by, oauth_client_id)` where live. Everything already keyed on the key id (scopes, caps, expiry, revoke, sessions, trail, private chat) works unchanged. Rejected: a separate `oauth_connections` table (would duplicate every scope and attribution path).
2. **The OAuth token is exchanged for the key inside the connector; calls keep running as `service_role` + `x-moduo-key-id`.** Rejected: running OAuth calls as the person under RLS (the earlier idea). Recon showed it breaks Tasks (`share_visible_ids` is service-role-only since `20261022130000`) and all chat agent RPCs, flips attribution to the person (`module_activity_log` and `perm_actor_id()` put the person first), and RLS never applies module scopes. With the exchange, none of the 35 migrations that read `module_api_key_id()` change.
3. **Connector auth order**: `Bearer moduo_sk_…` → today's path, untouched. Any other bearer → verified as a Supabase JWT against the project's JWKS (ES256 already live on prod) via `@supabase/server`; it must carry `client_id`; the live row for `(sub, client_id)` is loaded with the same revoked / expired / creator checks as keys. Otherwise 401 `invalid_token` with the discovery header, which makes clients re-run sign-in (and so the consent screen, pre-filled).
4. **Locking app tokens out of everything else (AC1)** in layers, proven by MCPO-1 before any OAuth reaches prod: (a) a PostgREST pre-request function (`pgrst.db_pre_request`) that raises when the JWT carries `client_id`, covering every table read and RPC; (b) restrictive policies on `storage.objects` and `realtime.messages` for the same; (c) a Custom Access Token hook (on the Free plan) that sets `role` to `anon` for tokens issued through the OAuth server, so Realtime postgres-changes and any `TO authenticated` policy see nothing; (d) one `_shared` helper every user-token Edge Function uses, refusing tokens with `client_id`. If the spike shows (c) breaks the OAuth flow, drop it and keep (a)(b)(d) plus restrictive policies on the tables published to Realtime. Supabase Auth's own endpoints (e.g. changing email) may still accept the token; the spike records what they allow and it is an accepted, documented risk if so (only the app holds the token, for an hour).
5. **Connect is a SECURITY DEFINER RPC** `workspace_api_keys_connect_oauth(p_workspace_id, p_client_id, p_scopes, p_expires_in_days, p_include_private_chat)`, called by the consent page as the signed-in person before `approveAuthorization`. It checks the client exists in `auth.oauth_clients` (name and redirect domain come from there, never from the browser), checks `ws.api_keys` and the scope caps with the existing `__check_scopes`, the 20 cap, upserts the one live row for (person, client), revokes it in a previous workspace when moving, and writes the bell notice. Rename and Disconnect reuse `workspace_api_keys_set_scopes` / `_revoke` (a rename RPC is added if none exists); Disconnect also calls `supabase.auth.oauth.revokeGrant({ clientId })` from the app.
6. **Consent route `/oauth/consent`**: a new top-level page outside the app gate (`preWorkspace()` wrapper, like `/join`). Maciej OK'd the new route on 2026-10-22 (AGENTS.md rule 7). It matches `authorization_url_path` already in `supabase/config.toml`. Uses `supabase.auth.oauth.getAuthorizationDetails / approveAuthorization / denyAuthorization` (supabase-js 2.117.2 has them). Return after sign-in: `moduo:pending_consent` in localStorage with the `authorization_id`, 10-minute TTL, taken once, wired where `takePendingJoin()` is.
7. **The consent card reuses `KeyScopeFields`, the expiry options and `scopeCeiling`** from the API key screen, so the two can't drift. The unchecked-app rule is a small list in `apps/app/src/features/settings/` (claude.ai, anthropic.com, openai.com, chatgpt.com), matched on the registered redirect domain.
8. **MCP SDK**: `@modelcontextprotocol/server` 2.x (Zod 4, matches our `zod@4.6.5`), one stateless `McpServer` + `WebStandardStreamableHTTPServerTransport` per request (the SDK's documented serverless pattern). Only the tools the key may use are registered on each request, which keeps the per-key list. Our `parseToolArgs` stays the argument gate; handlers don't change. Error answers keep their current text. The SDK supports protocol versions up to 2025-11-25; 2026-07-28 arrives with SDK upgrades.
9. **`@supabase/server` 1.x + `@supabase/middleware`** for JWT verification and `withOAuthProtectedResource` (the `/.well-known/oauth-protected-resource` document and the 401 header). `verify_jwt = false` stays.
10. **Dynamic client registration on.** Supabase doesn't document Client ID Metadata Documents yet; MCPO-5 checks which method Claude and ChatGPT use today and records it.
11. **Bell notice**: through the existing notification path for the person; if its kind is a closed vocabulary, the value is added in `@contracts` with the matching CHECK in the same migration (AGENTS.md rule 4).
12. **Code-mode readiness (MCPO-6)**: `outputSchema` + `structuredContent` for `tasks_list`, `tasks_get`, `tasks_search`, `tasks_today`, `tasks_queue`; annotations (`readOnlyHint` on every View tool, `destructiveHint` on trash / delete / disconnect-like ops, `idempotentHint` where repeating is harmless) for all 110. The five deprecated aliases stay until TV-D7. Server-side code mode (a `code` tool) is not built: decided in this planning session (see the decision entry).
13. **Prod enablement is manual (Mike)**: dashboard → Authentication → OAuth Server on, Authorization path `/oauth/consent`, Site URL `https://app.moduo.app` (staging: its own project settings), dynamic registration on, the access-token hook pointed at the function. MCPO-5 lists the exact steps; nothing OAuth is switched on in prod before MCPO-1's lockout is applied there.
14. **Local testing**: `config.toml` `[auth.oauth_server] enabled = true`, `allow_dynamic_registration = true` (CLI ≥ 2.54.11; we have 2.197.0). Real external clients against the local stack need a tunnel and `jwt_issuer`; the e2e test drives the flow itself instead.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **MCPO-1 — App tokens can't reach anything but the connector** (Tier 2) | OAuth server on in local config; migration: pre-request guard, restrictive Storage/Realtime policies, the access-token hook; the `_shared` user-token helper adopted by every user-token function; lockout SQL tests + the local probe script; records what Auth endpoints still allow | AC1 | — |
| 2 | **MCPO-2 — Connector on the official MCP SDK** (Tier 2) | `index.ts` rebuilt on `@modelcontextprotocol/server` stateless + `@supabase/server` plumbing, pasted keys only; parity snapshot test; no behavior change | AC2 | — |
| 3 | **MCPO-3 — Connections in the data and the connector** (Tier 2) | Migration: key columns, CHECK, unique index, `workspace_api_keys_connect_oauth`, rename RPC if missing, bell notice; connector accepts OAuth tokens, 401 + protected-resource discovery; SQL + connector tests | AC3, AC4, AC9, AC10 | 1, 2 |
| 4 | **MCPO-4 — Consent screen and connected apps in Settings** | `/oauth/consent` page, pending-consent resume, Settings rows + Disconnect (+ `revokeGrant`) + rename, Connector card and Integrations copy; unit + e2e tests | AC5, AC6, AC7, AC8, AC11 | 3 |
| 5 | **MCPO-5 — Real clients and prod switch-on** | Claude Code (`/mcp` sign-in), claude.ai and ChatGPT connect against staging; the prod enablement checklist in `docs/release.md`; `docs/moduo-mcp-connector.md` refreshed; registration method recorded | AC3–AC8 end to end | 4 |
| 6 | **MCPO-6 — Code-mode readiness** | Output schemas for the five main reads, annotations on all tools, test | AC12 | 2 |

MCPO-1 and MCPO-2 can run in parallel (different files). MCPO-6 can run any time after MCPO-2.

## Out of scope

- Server-side code mode (a `code` / `search` + `execute` tool) and a Cloudflare Worker in front of the connector.
- Running connector calls as the person under RLS.
- An app allowlist or verified-app badges.
- Retiring pasted keys; removing the deprecated tool aliases (TV-D7).
- MCP Apps (UI inside Claude or ChatGPT).
- Moving to MCP protocol 2026-07-28 ahead of the SDK.
- Workspace-admin views of other members' connections beyond what the key list already shows.
- A custom domain for the sign-in server (Pro plan add-on).

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [x] **Open questions is empty**.
- [x] **Data model is named and Supabase-first**: `workspace_api_keys` columns + connect RPC (MCPO-3), lockout migration (MCPO-1).
- [x] For a **module feature**: n/a (connector infrastructure; no new module, MCP tools unchanged except annotations).
- [x] **Execution blocks** are decomposed, sequenced, and each is context-sized and self-contained.
- [x] **Design constraints acknowledged**: the consent page and Settings rows use tokens only, shadcn-wrapped primitives, the existing `KeyScopeFields` and `preWorkspace()` look; DESIGN_RULES R1–R10.
- [x] **Manual-test surfaces identified**: connect Claude Code and claude.ai to staging, approve / deny / reconnect / move workspace / disconnect, and a token tried against the REST API.

**Ready to execute.**

## Open questions

- [ ] (none)
