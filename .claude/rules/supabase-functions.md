---
paths: ["supabase/functions/**", "infra/mcp-proxy/**"]
incident: "Worktree function runs hit the main checkout's code, connector tests hung on real fetches, and hosted checks proved only the 400 path (HV-14a compiled these gotchas)"
expires: 2027-01-31
---

# Edge Functions and the MCP connector

- The shared local functions runtime serves the main checkout's `supabase/functions`, not a worktree's. To run a worktree's `moduo-mcp`: from its folder, `deno run --allow-all --no-lock --config supabase/functions/deno.json index.ts` with `SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_FUNCTION_SLUG=moduo-mcp`, `SB_EXECUTION_ID=<anything>`, `SUPABASE_JWKS` from the container, and `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` as `{"default":"…"}` from `supabase status -o env` (without them every request is 500 `MISSING_DEFAULT_PUBLISHABLE_KEY`). It listens on :8000.
- `supabase/functions/deno.json` gives each npm subpath its own entry (`"@supabase/server/core": "npm:@supabase/server@1.9.2/core"`) and pins `@supabase/supabase-js`. `bun run verify` doesn't type-check the connector: run `deno check --config supabase/functions/deno.json supabase/functions/moduo-mcp/index.ts`.
- Don't `rs.mock("@supabase/supabase-js")` in a connector test (the real client still builds and hangs on fetch): spy on `globalThis.fetch` as `supabase/functions/moduo-mcp/sdk-parity.test.ts` does.
- Verify a function with `curl` from Bash (the preview browser can't reach `/functions/v1/*`), and send one valid request, not only the 400 path; compare the payload's keys with the table's columns. Never call `delete-account` with the reusable test account.
- Deploy a function with large shared imports from the repo root: `supabase functions deploy <fn> --project-ref wtoonrvuqumihpkbvwvs --no-verify-jwt --import-map supabase/functions/deno.json --use-api` (rule 11 asks first).
