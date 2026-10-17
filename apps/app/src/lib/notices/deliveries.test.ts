import { describe, expect, it } from "@rstest/core";

import { taskCyclesFromJson } from "../task-rows";
import { deliveriesToShow, isChatNotice, noticeCopy, noticeDeliveryFromRow } from "./deliveries";

const row = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  user_id: "u",
  workspace_id: "w",
  kind: "reminder",
  task_id: "t1",
  title: "Call Anna",
  body: null,
  url: "/tasks?id=t1",
  created_at: "2026-10-13T09:00:00Z",
  ...over,
});

describe("notice deliveries (TV-D12)", () => {
  it("reads a delivery row, keeping only in-app links", () => {
    expect(noticeDeliveryFromRow(row())).toMatchObject({
      id: "d1",
      kind: "reminder",
      taskId: "t1",
      url: "/tasks?id=t1",
    });
    expect(noticeDeliveryFromRow(row({ url: "https://evil.example" }))?.url).toBeNull();
    expect(noticeDeliveryFromRow(row({ kind: "later" }))?.kind).toBe("reminder");
    expect(noticeDeliveryFromRow({ id: 1 })).toBeNull();
  });

  it("says a reminder in the app's words", () => {
    const d = noticeDeliveryFromRow(row())!;
    expect(noticeCopy(d)).toEqual({ title: "Reminder", body: "Call Anna" });
  });

  it("reads a chat notice: the server's words, the conversation, message and tag (CV-6a)", () => {
    const d = noticeDeliveryFromRow(
      row({
        kind: "chat_mention",
        task_id: null,
        title: "Sofia Ortiz · #plans · Acme",
        body: "ping @Tom",
        url: "/chat?c=c1&m=m1",
        channel_id: "c1",
        message_id: "m1",
        tag: "chat:c1",
        held_for_focus: false,
      }),
    )!;
    expect(d).toMatchObject({
      kind: "chat_mention",
      channelId: "c1",
      messageId: "m1",
      tag: "chat:c1",
    });
    expect(isChatNotice(d)).toBe(true);
    expect(isChatNotice(noticeDeliveryFromRow(row())!)).toBe(false);
    expect(noticeCopy(d)).toEqual({ title: "Sofia Ortiz · #plans · Acme", body: "ping @Tom" });
    expect(noticeCopy({ ...d, body: null })).toEqual({
      title: "Sofia Ortiz · #plans · Acme",
      body: "",
    });
  });

  it("shows only the newest few, each once", () => {
    const ds = ["01", "02", "03", "04"].map(
      (n) => noticeDeliveryFromRow(row({ id: n, created_at: `2026-10-13T09:${n}:00Z` }))!,
    );
    expect(deliveriesToShow(ds, new Set(["04"])).map((d) => d.id)).toEqual(["03", "02", "01"]);
    expect(deliveriesToShow(ds, new Set(), 2).map((d) => d.id)).toEqual(["04", "03"]);
  });
});

describe("a repeat's history (TV-D12, tasks_op_history)", () => {
  it("reads cycles newest first and drops what doesn't read", () => {
    expect(
      taskCyclesFromJson([
        { kind: "done", at: "2026-10-02T10:00:00Z", cycle: "c1", by: "u", my_seconds: 1800 },
        { kind: "skipped", at: "2026-10-09T10:00:00Z", cycle: null, by: null, my_seconds: 0 },
        { kind: "missed", at: "2026-10-16T10:00:00Z" },
        "junk",
      ]),
    ).toEqual([
      { kind: "skipped", at: "2026-10-09T10:00:00Z", cycle: null, by: null, mySeconds: 0 },
      { kind: "done", at: "2026-10-02T10:00:00Z", cycle: "c1", by: "u", mySeconds: 1800 },
    ]);
    expect(taskCyclesFromJson(null)).toEqual([]);
  });
});
