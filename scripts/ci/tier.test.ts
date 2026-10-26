import { describe, expect, it } from "@rstest/core";

import { classify, globToRegExp, TIER2, tierOf } from "./tier";

// One real path per Tier 2 rule: each must classify as tier-2 on its own.
const TIER2_FIXTURES = [
  "supabase/migrations/20261023000000_add_x.sql",
  "supabase/tests/rls_tasks.test.sql",
  "supabase/functions/_shared/contracts/vocabularies.ts",
  "supabase/functions/delete-account/index.ts",
  ".claude/skills/security-audit/SKILL.md",
  "supabase/functions/_shared/account-erasure.ts",
  "supabase/functions/_shared/billing.ts",
  "supabase/functions/create-checkout-session/index.ts",
  "supabase/functions/create-portal-session/index.ts",
  "supabase/functions/start-trial/index.ts",
  "supabase/functions/extend-trial/index.ts",
  "supabase/functions/issue-founder-coupon/index.ts",
  "supabase/functions/moduo-mcp/tools/tasks.ts",
  "infra/mcp-proxy/src/index.ts",
  "supabase/functions/meet-token/index.ts",
  "apps/app/src/lib/runtime.web.tasks.ts",
  "apps/app/src/lib/sync/kernel/outbox.ts",
  "apps/app/src/lib/prefs-sync.ts",
  "apps/app/src/providers/auth-provider.tsx",
  "apps/desktop/src-tauri/src/store_redb/mod.rs",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/app/src/lib/tauri-plugin-updater-stub.ts",
  "infra/update-server/src/server.ts",
  "scripts/tauri-signed-build.sh",
  "scripts/ci-normalize-updater-key.sh",
  "scripts/ci-macos-notarize.sh",
  ".github/workflows/checks.yml",
  "scripts/ci/ratchets.baseline.json",
  "supabase/functions/_shared/posthog-erasure.ts",
  "supabase/functions/_shared/app-token.ts",
  "supabase/functions/_shared/secret-keys.ts",
  "supabase/functions/_shared/token-cipher.ts",
  "supabase/config.toml",
  "apps/desktop/src-tauri/src/auth.rs",
  "apps/desktop/src-tauri/src/keychain.rs",
  "apps/desktop/src-tauri/capabilities/default.json",
  ".claude/hooks/guard-git.sh",
  ".claude/settings.json",
];

describe("paths → tier", () => {
  it.each(TIER2_FIXTURES)("%s is tier-2", (path) => {
    expect(tierOf(path)).toBe(2);
    expect(classify(["docs/x.md", path]).tier).toBe(2);
  });

  it("has a fixture for every rule", () => {
    for (const rule of TIER2) {
      const re = globToRegExp(rule.glob);
      expect(TIER2_FIXTURES.some((p) => re.test(p))).toBe(true);
    }
  });

  it("gives a docs-only change tier-0", () => {
    expect(classify(["README.md", "docs/gotchas/workflow.md", "specs/harness-v3.md"]).tier).toBe(0);
    expect(classify(["docs/diagrams/flow.svg", ".claude/rules/supabase.md"]).tier).toBe(0);
    expect(classify([]).tier).toBe(0);
  });

  it("treats published notes and code under docs/ as code (tier-1)", () => {
    expect(tierOf("CHANGELOG.md")).toBe(1);
    expect(tierOf(".changes/fix-x.md")).toBe(1);
    expect(tierOf("release-notes/releases.json")).toBe(1);
    expect(tierOf("docs/examples/snippet.ts")).toBe(1);
  });

  it("gives ordinary app code tier-1", () => {
    expect(classify(["apps/app/src/features/tasks/ui/row.tsx", "README.md"]).tier).toBe(1);
    expect(tierOf("apps/app/src/lib/view-prefs.ts")).toBe(1);
    expect(tierOf("apps/app/src/lib/prefs-sync.test.ts")).toBe(1);
    expect(tierOf("supabase/functions/push-send/index.ts")).toBe(1);
    expect(tierOf("scripts/check-boundaries.ts")).toBe(1);
  });

  it("does not let a runtime* glob reach into subfolders or lookalikes", () => {
    expect(tierOf("apps/app/src/lib/runtime-helpers/x.ts")).toBe(1);
    expect(tierOf("apps/app/src/lib/syncing.ts")).toBe(1);
    expect(tierOf("apps/desktop/src-tauri/src/sync/mod.rs")).toBe(1);
  });

  it("names every Tier 2 path with the rule it matched", () => {
    const r = classify([
      "apps/app/src/lib/sync/store.ts",
      "docs/a.md",
      "apps/app/src/lib/sync/store.ts",
    ]);
    expect(r.matches).toEqual([
      {
        path: "apps/app/src/lib/sync/store.ts",
        glob: "apps/app/src/lib/sync/**",
        why: "sync kernel",
      },
    ]);
  });
});

describe("globToRegExp", () => {
  it("matches ** across directories and * within one segment", () => {
    expect(globToRegExp("a/**").test("a/b/c.ts")).toBe(true);
    expect(globToRegExp("a/**/c.ts").test("a/c.ts")).toBe(true);
    expect(globToRegExp("a/**/c.ts").test("a/x/y/c.ts")).toBe(true);
    expect(globToRegExp("a/*.ts").test("a/b/c.ts")).toBe(false);
    expect(globToRegExp("a.b").test("axb")).toBe(false);
  });
});
