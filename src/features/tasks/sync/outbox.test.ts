import { describe, expect, it } from "vitest";
import { sortOutboxByCreatedAt } from "./outbox";

describe("sortOutboxByCreatedAt", () => {
  it("sorts FIFO by createdAt", () => {
    const sorted = sortOutboxByCreatedAt([
      {
        id: "2",
        scopeKey: "u:w",
        workspaceId: "w",
        ownerId: "o",
        op: "upsert_task",
        payload: {},
        createdAt: "2026-02-17T10:02:00.000Z",
      },
      {
        id: "1",
        scopeKey: "u:w",
        workspaceId: "w",
        ownerId: "o",
        op: "upsert_task",
        payload: {},
        createdAt: "2026-02-17T10:01:00.000Z",
      },
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["1", "2"]);
  });
});
