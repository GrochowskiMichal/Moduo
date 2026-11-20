---
paths: ["package.json", "bunfig.toml", "bun.lock", "turbo.json", "apps/*/turbo.json", "apps/*/package.json", ".oxlintrc.json", ".bun-lint-version", ".bun-version", "scripts/bun-lint.ts", "apps/app/rsbuild.config.ts", "apps/app/.stylelintrc.json"]
incident: "A Biome upgrade turned verify red on untouched files (2026-10-07, LINT-1), and the PLAT-2 workspace move silently changed the linker, lint scopes and cache inputs (2026-10-17)"
expires: 2027-01-31
---

# Build tooling: Bun, Turborepo, Rsbuild, lint and format

Turbo cache inputs and CI wiring: `.claude/rules/ci-release.md`. Invariants (linker, `agentGuidance`, release-notes inputs, `typescript`, desktop build target) are tested in `scripts/ci/config-traps.test.ts`.

- **`bun lint` (oxlint rules, `.oxlintrc.json`) and `bun fmt` own JS/TS.** `bun lint` ships only in Bun canary: `scripts/bun-lint.ts` fetches the build pinned in `.bun-lint-version`. Errors fail, warnings are a burn-down budget. Suppress with `// eslint-disable-next-line <rule> -- <why>` on the line the rule reports (for `exhaustive-deps`, the dependency array). Never hand-fix formatting: `bun run format:fix`. After a repo-wide reformat, rebuild the notes bundle (`bun run build:notes-doc`) and add the commit to `.git-blame-ignore-revs`. `bun lint -c <file>` resolves `ignorePatterns` from that file's folder.
- **After any toolchain bump** (Bun, the lint pin, a linter), run `bun run lint:js` and `bun run build:web`, not just typecheck and tests. `build:web` is what catches a config path or a font `url()` with spaces that broke.
- **Config paths resolve from the config file's folder** since the workspace move: lint configs live in their workspace, Tailwind's class scan starts at the PostCSS `base` (`apps/app`), and a Turborepo task hashes only its own package unless an outside file is a `$TURBO_ROOT$/…` input.
- **After a big `bun.lock` change, reinstall from scratch** (`rm -rf node_modules && bun install --frozen-lockfile`): an install over the old tree can skip nested packages, and the crash then looks like a code bug inside `node_modules`.
- **`dev:web` hardcodes `--port 8081`**, and the flag beats `server.port` and `PORT`. For another port call `./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port N`, as the e2e config does.
- **The bundle's dynamic imports are all prefetched** unless `performance.prefetch.exclude` names them; code that must not download before consent needs a named chunk in that list (the PostHog one is there).
