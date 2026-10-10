import { mapKnownRows } from "@contracts/rows";
import { describe, expect, it } from "@rstest/core";

import {
  applyMinBuild,
  isBelowMinimum,
  isReadOnlyBuild,
  isWriteRequest,
  parseVersion,
  READ_ONLY_MESSAGE,
  readOnlyFetch,
} from "./min-build";
import { taskRowToModel } from "./task-rows";

const BASE = "http://127.0.0.1:54321";

describe("old builds are told, never drop rows (AC12.6)", () => {
  it("a build below the minimum is read-only; at or above it isn't", () => {
    expect(isBelowMinimum("1.2.0", "1.3.0")).toBe(true);
    expect(isBelowMinimum("1.2.9", "1.10.0")).toBe(true);
    expect(isBelowMinimum("1.3.0", "1.3.0")).toBe(false);
    expect(isBelowMinimum("2.0.0", "1.9.9")).toBe(false);
    expect(isBelowMinimum("v1.2.0-beta.1", "1.2.1")).toBe(true);
  });

  it("an unreadable version or setting never locks anyone out", () => {
    expect(isBelowMinimum("dev", "9.9.9")).toBe(false);
    expect(isBelowMinimum("1.0.0", null)).toBe(false);
    expect(isBelowMinimum("1.0.0", "soon")).toBe(false);
    expect(parseVersion("1.2")).toBeNull();
  });

  it("the shipped minimum, 0.0.0, holds nobody back", () => {
    expect(isBelowMinimum("0.0.0", "0.0.0")).toBe(false);
    expect(isBelowMinimum("1.0.0", "0.0.0")).toBe(false);
  });

  it("an unknown status row still renders as its category", () => {
    const row = (status: string) => ({
      id: `t-${status}`,
      workspace_id: "w",
      bucket_id: "b",
      title: status,
      status,
      created_at: "2026-10-10T00:00:00Z",
      updated_at: "2026-10-10T00:00:00Z",
    });
    const tasks = mapKnownRows(
      [row("todo"), row("backlog"), row("wont_do"), row("in_review"), row("shipped")],
      taskRowToModel,
    );
    expect(tasks.map((t) => t.status)).toEqual(["todo", "todo", "archived", "in_progress", "todo"]);
  });
});

describe("which requests are writes", () => {
  it("reads, sign-in and Edge Functions pass", () => {
    expect(isWriteRequest("GET", `${BASE}/rest/v1/tasks?select=*`)).toBe(false);
    expect(isWriteRequest("POST", `${BASE}/auth/v1/token?grant_type=refresh_token`)).toBe(false);
    expect(isWriteRequest("POST", `${BASE}/functions/v1/moduo-mcp`)).toBe(false);
    expect(isWriteRequest("POST", `${BASE}/rest/v1/rpc/tasks_time_totals`)).toBe(false);
    expect(isWriteRequest("POST", `${BASE}/rest/v1/rpc/share_visible_ids`)).toBe(false);
    expect(isWriteRequest("POST", `${BASE}/storage/v1/object/sign/attachments/a.png`)).toBe(false);
  });

  it("table writes, ops and uploads don't", () => {
    expect(isWriteRequest("POST", `${BASE}/rest/v1/tasks`)).toBe(true);
    expect(isWriteRequest("PATCH", `${BASE}/rest/v1/tasks?id=eq.1`)).toBe(true);
    expect(isWriteRequest("DELETE", `${BASE}/rest/v1/tag_links?id=eq.1`)).toBe(true);
    expect(isWriteRequest("POST", `${BASE}/rest/v1/rpc/tasks_op_update`)).toBe(true);
    expect(isWriteRequest("POST", `${BASE}/rest/v1/rpc/links_op_create`)).toBe(true);
    expect(isWriteRequest("POST", `${BASE}/rest/v1/rpc/workspace_api_keys_create`)).toBe(true);
    expect(isWriteRequest("POST", `${BASE}/storage/v1/object/attachments/w/a.png`)).toBe(true);
  });
});

describe("readOnlyFetch", () => {
  it("passes everything until a check finds the build too old, then refuses writes only", async () => {
    const calls: string[] = [];
    const base = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("[]", { status: 200 });
    }) as typeof fetch;
    const guarded = readOnlyFetch(base);

    applyMinBuild("0.0.0", "1.0.0");
    expect(isReadOnlyBuild()).toBe(false);
    await guarded(`${BASE}/rest/v1/tasks`, { method: "POST" });
    expect(calls).toHaveLength(1);

    applyMinBuild("2.0.0", "1.0.0");
    expect(isReadOnlyBuild()).toBe(true);
    const refused = await guarded(`${BASE}/rest/v1/rpc/tasks_op_create`, { method: "POST" });
    expect(refused.status).toBe(403);
    expect((await refused.json()).message).toBe(READ_ONLY_MESSAGE);
    expect(calls).toHaveLength(1);

    const read = await guarded(`${BASE}/rest/v1/tasks?select=*`);
    expect(read.status).toBe(200);
    await guarded(`${BASE}/auth/v1/token`, { method: "POST" });
    expect(calls).toHaveLength(3);

    applyMinBuild("0.0.0", "1.0.0");
  });
});
