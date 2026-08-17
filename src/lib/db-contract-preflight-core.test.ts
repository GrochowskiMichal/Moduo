import { describe, expect, it } from "vitest";

import { type CatalogSnapshot, validateCatalogSnapshot } from "./db-contract-preflight-core";

const baseSnapshot = (overrides: Partial<CatalogSnapshot> = {}): CatalogSnapshot => ({
  enums: [{ name: "plan_tier", labels: ["free", "pro", "team", "founder"] }],
  constraints: [],
  columns: [
    { table: "profiles", column: "plan_tier", dataType: "USER-DEFINED", udtName: "plan_tier" },
    { table: "workspace_members", column: "role", dataType: "text", udtName: "text" },
    { table: "workspace_members", column: "permissions_notes", dataType: "text", udtName: "text" },
    { table: "workspace_members", column: "permissions_tasks", dataType: "text", udtName: "text" },
    { table: "email_accounts", column: "provider", dataType: "text", udtName: "text" },
    { table: "calendar_accounts", column: "provider", dataType: "text", udtName: "text" },
  ],
  distinctValues: {
    "profiles.plan_tier": [],
    "workspace_members.role": ["owner", "admin", "member", "viewer"],
    "workspace_members.permissions_notes": ["write"],
    "workspace_members.permissions_tasks": ["write"],
    "email_accounts.provider": [],
    "calendar_accounts.provider": [],
  },
  rowCounts: {},
  grants: [],
  ...overrides,
});

describe("validateCatalogSnapshot", () => {
  it("passes zero-row and already-normalized fixtures", () => {
    const result = validateCatalogSnapshot(baseSnapshot());
    expect(result.ok).toBe(true);
    expect(result.canonicalPlanTier).toBe("founder");
    expect(result.issues).toEqual([]);
  });

  it("reports legacy founders rows with named remediation", () => {
    const result = validateCatalogSnapshot(
      baseSnapshot({
        distinctValues: { ...baseSnapshot().distinctValues, "profiles.plan_tier": ["founders"] },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain("legacy_founders_rows");
  });

  it("reports unexpected provider and permission values", () => {
    const result = validateCatalogSnapshot(
      baseSnapshot({
        distinctValues: {
          ...baseSnapshot().distinctValues,
          "workspace_members.permissions_notes": ["read", "write", "legacy"],
          "email_accounts.provider": ["imap", "unknown-provider"],
          "calendar_accounts.provider": ["moduo", "unexpected"],
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "unexpected_workspace_permissions",
        "unexpected_email_provider",
        "unexpected_calendar_provider",
      ]),
    );
  });

  it("fails when required catalog facts are missing", () => {
    const result = validateCatalogSnapshot(baseSnapshot({ enums: [], columns: [] }));
    expect(result.ok).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain("missing_plan_tier_enum");
    expect(result.issues.map((entry) => entry.code)).toContain("missing_required_column");
  });
});
