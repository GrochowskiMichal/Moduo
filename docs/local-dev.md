# Local development stack

The whole loop runs on your Mac: Postgres, Auth, Storage, Realtime, Edge Functions, email (Mailpit) and Stripe webhooks. Prod (`wtoonrvuqumihpkbvwvs`) is only touched when a release train ships (see [decisions/workflow.md](decisions/workflow.md), 2026-10-09).

## One-time setup (per machine)

| Need | Install |
| --- | --- |
| Docker runtime | `brew install --cask orbstack`, then open OrbStack once |
| Supabase CLI | `brew install supabase/tap/supabase` (logged in: `supabase login`) |
| `psql` | `brew install libpq && brew link --force libpq` |
| Stripe CLI | runs in Docker, nothing to install; log in once: `docker run --rm -it -v "$HOME/.config/stripe:/root/.config/stripe" stripe/stripe-cli login` |

Homebrew's `stripe` formula refuses to install while the Xcode Command Line Tools are outdated, so the Docker image is the default.

## Daily loop

```bash
bun run local:up          # start the stack (bootstraps the DB the first time) + point .env.local at it
bun run dev:web           # app on http://127.0.0.1:8081, talking to the local stack
bun run local:functions   # optional: serve every Edge Function with hot reload
bun run local:stripe      # optional: forward Stripe test webhooks to the local stripe-webhook
bun run env:cloud         # switch .env.local back to the cloud project
bun run local:down        # stop (data kept)
```

- **Sign in:** `dev@moduo.local`. The app emails a 6-digit code; read it in Mailpit at http://127.0.0.1:54324. Nothing leaves the machine.
- **Studio** (tables, SQL, auth users): http://127.0.0.1:54323.
- **One stack for all worktrees:** `project_id = "moduo"`, so every worktree shares the same containers and data. Only one can run at a time, which is the point.

## How the database is built

`supabase db reset` cannot work yet: 22 of prod's tables have no migration file ([gotchas/supabase.md](gotchas/supabase.md)). So `scripts/local/stack.sh`:

1. dumps prod's **schema only** (no rows) into `~/.cache/moduo/supabase-snapshot/`, outside the repo and shared by every worktree (`bun run local:snapshot` refreshes it; it is a read);
2. loads `public`, `private` and `stripe`, plus prod's storage policies and its triggers on `auth.users`;
3. applies every repo migration **newer than the snapshot**: your unreleased migration runs locally first;
4. runs `supabase/seed.sql` (buckets, test user).

`bun run local:reset` wipes the local DB and repeats all of it in about 20 seconds. Write a migration, `local:reset`, test, repeat. Prod only sees it on release day.

**Proper fix (open, needs Maciej + Mike):** commit a `00000000000000_baseline.sql` captured from prod and archive the pre-baseline files, so `supabase db reset` works for everyone and the snapshot step goes away.

## Edge Functions

`bun run local:functions` copies `supabase/functions/.env.example` to `supabase/functions/.env` (gitignored) on first run. Fill in **test-mode** Stripe keys there. `SUPABASE_URL` and the service key are injected by the CLI. `config.toml` pins `verify_jwt = false` for every function, matching prod.

## Stripe

`bun run local:stripe` prints a `whsec_…`; put it in `supabase/functions/.env` as `STRIPE_WEBHOOK_SECRET` and restart `local:functions`. Trigger events with `docker run --rm -it -v "$HOME/.config/stripe:/root/.config/stripe" stripe/stripe-cli trigger checkout.session.completed`.

**Gap:** `stripe-webhook`, `stripe-setup` and `stripe-worker` are deployed on prod but their source is not in this repo, so webhook handling can't run locally until someone commits that code (`supabase functions download stripe-webhook`). Checkout and portal session creation do run locally.

## Not local (on purpose)

- **pg_cron jobs** (e.g. `purge-deleted` at 04:23 UTC) aren't in the snapshot; call the function by hand.
- **OAuth providers** (Google, Zoom) need real client IDs and redirect URLs; test those against cloud.
- **Desktop app:** `bun run dev:desktop` reads the same `.env.local`, so it uses the local stack too.
