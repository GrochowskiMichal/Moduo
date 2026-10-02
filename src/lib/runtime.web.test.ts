import { mapKnownRows, requireRow, taskRowSchema } from "@contracts/rows";
import { describe, expect, it } from "vitest";

describe("runtime.web mapper boundary", () => {
  const valid = {
    id: "t1",
    workspace_id: "w1",
    bucket_id: "b1",
    title: "Ok",
    status: "todo",
    created_at: "2026-08-17T00:00:00Z",
    updated_at: "2026-08-17T00:00:00Z",
  };

  it("maps a valid fixture identically", () => {
    const row = requireRow(taskRowSchema, valid, "task");
    expect(row.title).toBe("Ok");
  });

  it("skips a malformed RPC/row fixture in list reads", () => {
    const mapped = mapKnownRows([valid, { status: "nope" }], (row) =>
      requireRow(taskRowSchema, row, "task"),
    );
    expect(mapped).toHaveLength(1);
  });
});
