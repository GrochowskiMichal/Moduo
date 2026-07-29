import { describe, expect, it, vi } from "vitest";

import {
  collectTruncations,
  describeTruncation,
  PGRST_MAX_ROWS,
  readPaged,
  type PageResult,
} from "./paged-select";

/** A fake table of `total` rows that honours offset/limit like PostgREST does. */
function fakeTable(total: number, hardCap = PGRST_MAX_ROWS) {
  const calls: Array<{ offset: number; limit: number }> = [];
  const page = async (offset: number, limit: number): Promise<PageResult<number, string>> => {
    calls.push({ offset, limit });
    // PostgREST never returns more than db-max-rows, whatever you ask for.
    const size = Math.min(limit, hardCap);
    const rows: number[] = [];
    for (let i = offset; i < Math.min(offset + size, total); i += 1) rows.push(i);
    return { data: rows, error: null };
  };
  return { page, calls };
}

describe("readPaged", () => {
  it("returns everything in ONE request when the collection fits a page", async () => {
    const t = fakeTable(42);
    const res = await readPaged({ scope: "tasks", cap: 5000, page: t.page });
    expect(res.rows).toHaveLength(42);
    expect(res.truncation).toBeNull();
    expect(t.calls).toHaveLength(1);
  });

  it("pages past the PostgREST 1000-row ceiling instead of losing the tail", async () => {
    const t = fakeTable(1510);
    const res = await readPaged({ scope: "tasks", cap: 5000, page: t.page });
    expect(res.rows).toHaveLength(1510);
    expect(res.rows[1509]).toBe(1509);
    expect(res.truncation).toBeNull();
    expect(t.calls.length).toBeGreaterThan(1);
  });

  it("stops at the cap and reports the exact total", async () => {
    const t = fakeTable(4321);
    const countTotal = vi.fn(async () => 4321);
    const res = await readPaged({ scope: "tasks", cap: 100, page: t.page, countTotal });
    expect(res.rows).toHaveLength(100);
    expect(res.truncation).toEqual({ scope: "tasks", shown: 100, total: 4321 });
    expect(countTotal).toHaveBeenCalledTimes(1);
  });

  it("never pays for the count when nothing was truncated", async () => {
    const t = fakeTable(10);
    const countTotal = vi.fn(async () => 10);
    const res = await readPaged({ scope: "tasks", cap: 100, page: t.page, countTotal });
    expect(res.truncation).toBeNull();
    expect(countTotal).not.toHaveBeenCalled();
  });

  it("reports truncation with a null total when the count itself fails", async () => {
    const t = fakeTable(500);
    const res = await readPaged({
      scope: "notes",
      cap: 10,
      page: t.page,
      countTotal: async () => {
        throw new Error("count blew up");
      },
    });
    expect(res.truncation).toEqual({ scope: "notes", shown: 10, total: null });
  });

  it("treats exactly-cap rows as complete, not truncated", async () => {
    const t = fakeTable(100);
    const res = await readPaged({ scope: "tasks", cap: 100, page: t.page });
    expect(res.rows).toHaveLength(100);
    expect(res.truncation).toBeNull();
  });

  it("treats cap+1 rows as truncated", async () => {
    const t = fakeTable(101);
    const res = await readPaged({ scope: "tasks", cap: 100, page: t.page, countTotal: async () => 101 });
    expect(res.rows).toHaveLength(100);
    expect(res.truncation?.total).toBe(101);
  });

  it("surfaces a page error with the rows read so far and no truncation claim", async () => {
    const res = await readPaged<number, string>({
      scope: "tasks",
      cap: 5000,
      page: async () => ({ data: null, error: "PGRST301" }),
    });
    expect(res.error).toBe("PGRST301");
    expect(res.rows).toEqual([]);
    expect(res.truncation).toBeNull();
  });

  it("handles an exact multiple of the page size (the extra empty request)", async () => {
    const t = fakeTable(2000);
    const res = await readPaged({ scope: "tasks", cap: 5000, page: t.page });
    expect(res.rows).toHaveLength(2000);
    expect(res.truncation).toBeNull();
    // 1000 + 1000 (both full) + one short page that proves the end.
    expect(t.calls).toHaveLength(3);
  });

  it("dedupes rows re-emitted by a shifting offset (concurrent insert)", async () => {
    // Page 2 repeats page 1's last row — what an insert before the cursor does.
    const pages = [
      [1, 2, 3],
      [3, 4, 5],
      [] as number[],
    ];
    let i = 0;
    const res = await readPaged<number, string>({
      scope: "tasks",
      cap: 100,
      pageSize: 3,
      keyOf: (n) => String(n),
      page: async () => ({ data: pages[i++] ?? [], error: null }),
    });
    expect(res.rows).toEqual([1, 2, 3, 4, 5]);
  });

  it("clamps a stale total so it can never read 'N of fewer-than-N'", async () => {
    const t = fakeTable(500);
    const res = await readPaged({
      scope: "tasks",
      cap: 100,
      page: t.page,
      countTotal: async () => 98, // rows deleted between the read and the count
    });
    expect(res.truncation).toEqual({ scope: "tasks", shown: 100, total: 100 });
  });

  it("never asks for more than the PostgREST ceiling in one request", async () => {
    const t = fakeTable(3000);
    await readPaged({ scope: "tasks", cap: 5000, page: t.page });
    for (const c of t.calls) expect(c.limit).toBeLessThanOrEqual(PGRST_MAX_ROWS);
  });
});

describe("collectTruncations", () => {
  it("keeps only the collections that actually hit their cap", () => {
    const hit = { scope: "tasks", shown: 5000, total: 6000 };
    expect(collectTruncations(null, hit, undefined)).toEqual([hit]);
    expect(collectTruncations(null, undefined)).toEqual([]);
  });
});

describe("describeTruncation", () => {
  it("reads as 'N of M' with thousands separators", () => {
    expect(describeTruncation({ scope: "tasks", shown: 5000, total: 6120 })).toBe(
      "5,000 of 6,120 tasks",
    );
  });

  it("degrades honestly when the total is unknown", () => {
    expect(describeTruncation({ scope: "events", shown: 5000, total: null })).toBe(
      "5,000 events (of more)",
    );
  });
});
