import { describe, expect, it } from "@rstest/core";

import { isMissingTableError, selectFirstDeployedTier } from "./deploy-tiers";

type Res = { error: { code?: string; message: string } | null; cols: string };

function fakeDb(deployed: string[], failWith?: { code: string; message: string }) {
  const asked: string[] = [];
  const query = async (cols: string): Promise<Res> => {
    asked.push(cols);
    if (failWith) return { error: failWith, cols };
    const missing = cols.split(", ").find((c) => !deployed.includes(c));
    return {
      error: missing ? { code: "42703", message: `column ${missing} does not exist` } : null,
      cols,
    };
  };
  return { asked, query };
}

const TIERS = ["a, b, in_inbox", "a, b", "a"] as const;

describe("selectFirstDeployedTier (NR-1 deploy gap)", () => {
  it("reads the newest tier in one round trip once the migration is applied", async () => {
    const db = fakeDb(["a", "b", "in_inbox"]);
    const { res, tier } = await selectFirstDeployedTier(TIERS, db.query);
    expect(tier).toBe(0);
    expect(res.error).toBeNull();
    expect(db.asked).toEqual(["a, b, in_inbox"]);
  });

  it("steps down to v2 (not degraded) while NR-1 columns are missing", async () => {
    const db = fakeDb(["a", "b"]);
    const { res, tier } = await selectFirstDeployedTier(TIERS, db.query);
    expect(tier).toBe(1);
    expect(res.error).toBeNull();
  });

  it("reaches the legacy tier only when v2 columns are missing too", async () => {
    const db = fakeDb(["a"]);
    const { tier } = await selectFirstDeployedTier(TIERS, db.query);
    expect(tier).toBe(2);
  });

  it("stops at the first non-schema error (an outage is not an old schema)", async () => {
    const db = fakeDb([], { code: "PGRST301", message: "JWT expired" });
    const { res, tier } = await selectFirstDeployedTier(TIERS, db.query);
    expect(tier).toBe(0);
    expect(res.error?.code).toBe("PGRST301");
    expect(db.asked).toHaveLength(1);
  });
});

describe("isMissingTableError", () => {
  it("recognises Postgres and PostgREST missing-table codes only", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true);
    expect(isMissingTableError({ code: "42501" })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});
