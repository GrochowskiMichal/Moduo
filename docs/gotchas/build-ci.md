# Gotchas: Build, CI and desktop release pipeline

Read before working in `.github/`, `scripts/`, `infra/`, `package.json`, `apps/app/rsbuild.config.ts`, e2e. Index of all areas: [docs/gotchas.md](../gotchas.md).

Compiled on 2026-10-27 (HV-14c, specs/harness-v3.md AC30): every entry became an ast-grep rule, a test, a comment at the trap, a path rule or a doc, or was deleted as stale. A path rule loads by itself when you open a file it covers.

## Where the traps live now

- **Tests:** [scripts/ci/config-traps.test.ts](../../scripts/ci/config-traps.test.ts) (workflow shell pitfalls, `secrets: inherit`, the Rust cache, Apple credentials kept from `tauri build`, Worker entry modules, empty CI shards, the Bun linker, Turborepo inputs, the desktop build target, the app icon source); `tools/claude-plugins/moduo-agent/hooks/moduo-report.test.sh` now clears `MODUO_AGENT_NAME` itself.
- **ast-grep:** `env-define-nullish-fallback` (an unset `PUBLIC_*` variable is `""`, not `undefined`).
- **Path rules:** [ci-release](../../.claude/rules/ci-release.md), [cloudflare](../../.claude/rules/cloudflare.md), [build-tooling](../../.claude/rules/build-tooling.md), [app-react](../../.claude/rules/app-react.md), [e2e](../../.claude/rules/e2e.md), [unit-tests](../../.claude/rules/unit-tests.md), [migrations-practice](../../.claude/rules/migrations-practice.md).
- **Comments at the trap:** `scripts/release/canary.ts`, `apps/app/wrangler.jsonc`, `infra/mac-runner/setup.sh`, `scripts/ci-macos-notarize.sh`, `apps/app/rsbuild.config.ts`, `apps/app/src/app/router/route-tree.tsx`, `apps/app/src/features/settings/sections/advanced-section.tsx`, `e2e/playwright.config.ts`, `scripts/agent/e2e-env.ts`, `e2e/tests/support/local-stack.ts`, `apps/app/rstest.setup.ts`.
- **Docs:** [docs/agent-setup.md](../agent-setup.md) §Known quirks (tool and guard quirks), [docs/entire.md](../entire.md) (analytics follow `develop`), [docs/release.md](../release.md) §3 (Edge Function deploy flags).

## Open entries

None. A new trap goes here (the trap, why, what to do instead) only until it has a better home; one that bites twice becomes a hook, a lint rule or a test.
