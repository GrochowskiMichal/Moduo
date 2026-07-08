# Claude Code setup — notifications & autonomy

How to run the [Claude Code workflow](../CLAUDE.md) unsupervised. Split into **what the repo sets up for you** and **what only you can toggle** (Claude Code blocks repos from changing those, for security).

## What the repo sets up (committed)

**Lifecycle hooks** — `.claude/settings.json` + `.claude/hooks/notify.sh`:

- **Stop hook** → a desktop notification when a block finishes ("ready for your review"). The deterministic, auditable "done" signal.
- **Notification hook** → a desktop notification when Claude is blocked waiting on your input.

The script is cross-platform and **always exits 0**, so it can never accidentally block Claude from stopping. It fires `osascript` on macOS, `notify-send` on Linux, and no-ops elsewhere. Hooks **merge** with your user-level hooks rather than replacing them.

> **Shared with the team.** These hooks are committed, so anyone working in the repo gets them (harmless no-op where it can't notify). The first time the hooks change, Claude Code asks you to review/approve them before they run — that's expected. Don't want them? Remove the `hooks` block from `.claude/settings.json`, or override locally.
>
> **Why not "verify before stopping"?** Running `bun run verify` on every Stop would run the whole suite on every turn. Instead, `/s2` runs `bun run verify` once before it reports a block done — same guarantee, far cheaper.

## What only you can toggle (user-level / in-app)

A repo **cannot** set these — flip them yourself in the desktop app's `/config` (or `~/.claude/settings.json`):

| Setting | What it does | Recommended |
| --- | --- | --- |
| **Auto mode** | Removes routine permission prompts but keeps the safety classifier (blocks destructive git/infra). Toggle with the mode selector / `Shift+Tab`. **A repo cannot enable auto mode for itself — by design.** | On, for `/s2` runs |
| **`agentPushNotifEnabled`** | Phone push when a long task finishes (needs Remote Control connected). | On |
| **`inputNeededNotifEnabled`** | Phone push when Claude is waiting on your input. | On |

These give you the *away-from-desk* signal; the repo hooks give you the *at-desk* desktop notification.

## The unsupervised flow

1. **Plan Mode** → `/s1` → grill + spec + execution blocks → "Ready to execute."
2. Approve → switch to **auto mode** (not bypass — bypass turns off the safety classifier).
3. `/s2` one block. It builds, runs `bun run verify`, self-reviews, and reports. The Stop hook + push tell you it's done.
4. You test, approve the next block. (Each session runs on its own branch/worktree — nothing hits `main` until you merge.)
5. `/s3` at the end.

The only two things you ever manage: **the work plan** and **your subscription limits.**
