# Vendored: Cloudflare security-audit skill

- Source: https://github.com/cloudflare/security-audit-skill (MIT, see `LICENSE`)
- Pinned commit: `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` (2026-09-14, "Clarify guidance and full audit modes")
- Installed: 2026-10-23 by HV-9 (`specs/harness-v3.md`, AC27), project-scoped

Files are the upstream `skills/security-audit/` directory copied byte for byte. Upstream's own install (`npx skills add … --skill security-audit`) fetches the moving `HEAD`; we copy a pinned commit instead so a skill change is a reviewed diff. Do not edit these files: local rules for running it live in `docs/decisions/harness.md` (HV-9 entry).

To bump the pin, from the repo root:

```bash
git clone https://github.com/cloudflare/security-audit-skill /tmp/sas && git -C /tmp/sas checkout <sha>
cp /tmp/sas/skills/security-audit/* .claude/skills/security-audit/ && cp /tmp/sas/LICENSE .claude/skills/security-audit/LICENSE
```

Then update the commit line above and review the diff like any Tier 2 change (it steers agents that read RLS, billing and MCP code).

Moduo usage: full audit mode writes its run outside the repo (default `~/security-audit-skill/moduo/run-<N>`); never point the output into the repo, it is public. Findings that are unfixed holes stay out of git (AGENTS.md rule 2).
