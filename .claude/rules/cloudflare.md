---
paths: ["infra/**", "apps/*/wrangler.jsonc", "apps/landing/edge/**", "scripts/dns-diff.ts", "scripts/smoke-hosting.ts", "scripts/release/canary.ts"]
incident: "The moduo.app move (PLAT-8, 2026-10-17): runners got 403 from Bot Fight Mode, wrangler wouldn't take the apex, and the DKIM CNAMEs went proxied"
expires: 2027-01-31
---

# Cloudflare: Workers, zones and DNS

Release and update-server rules: `.claude/rules/ci-release.md`.

- **Bot Fight Mode and Browser Integrity Check are off for the zone** (GitHub's runners and the desktop updater can't solve a challenge). Keep them off, or exempt the API hosts, if they are ever turned back on.
- **Mail and third-party records must be DNS-only.** A zone import proxies CNAMEs (DKIM broke once the zone went active); `scripts/dns-diff.ts` flags every proxied record.
- **wrangler won't take the zone apex for a custom domain** (`code: 100117`): delete the apex record and attach the domain in one go, then deploy again.
- **A new Cloudflare product fails from CI until it's enabled in the dashboard and the token has its account permission** (R2: code 10042; Workers deploys need "Workers Scripts: Edit", not the "Workers: Editor" role).
- **A Worker's entry module exports only handlers** (`export default { fetch }`); wrangler refuses an exported constant though tsc passes. Run `wrangler dev` once on a new Worker. `scripts/ci/config-traps.test.ts` checks the entries.
- **A fresh deployment ignores the version-override header for a few seconds**, so a smoke test right after `versions deploy` may hit the old build; `canary.ts` waits until `/config.json` names the new one.
