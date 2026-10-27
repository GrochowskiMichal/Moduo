---
paths: ["e2e/**", "scripts/agent/e2e.sh", "scripts/agent/e2e-env.ts", ".claude/skills/product-lab/**"]
incident: "Parallel e2e runs on the shared stack read each other's rows and reused another worktree's dev server (2026-10-14, CV-E2E)"
expires: 2027-01-31
---

# E2E and the product lab

- **Run e2e on the shared local stack through `scripts/agent/e2e.sh`**, never a bare `bunx playwright test`: it takes the machine-wide lock, adds `--project=e2e`, refuses a cloud `.env.local`, and the config starts this worktree's own server.
- **The `e2e` project runs `workers: 1`**: specs share one workspace and read each other's rows. A red parallel run of your own config: rerun with `--workers=1` before chasing it. A suite that finds zero tests passes, so check `playwright test --list`.
- **Visual baselines are never generated in CI.** A visual diff means stop and ask. A bare `bun run e2e` also runs the visual project and writes a baseline for every screenshot without one: delete those, never commit them unreviewed.
- **Playwright can want a newer browser build than this Mac has** ("Executable doesn't exist … chromium_headless_shell-<n>"). Don't download mid-block: use a local, uncommitted config with `use.channel: "chrome"`.
- **The perf spec needs the local stack and its 10,000-task fixture** (`bun run perf`); CI runs neither, and medians compare only on one machine.
- **Run one `/product-lab` at a time per Mac:** each run re-seeds the `lab*@moduo.local` people and soft-deletes their previous workspaces. Its preview server takes `LAB_PORT` when two lanes need the build.
