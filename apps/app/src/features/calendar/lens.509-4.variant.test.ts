// HV-15 variant of benchmarks/escapes/509-4-stale-derived-field: a task created with a due
// date (makeTask, used by capture and createTask) carries `dueDate` but not the derived
// `dueOn`, and the Calendar's due-chip lens reads only `dueOn`, so a captured task due
// Saturday never shows on Saturday while its create waits (offline: until it is sent).
// Fails until the fix lands. Zone-independent.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/calendar/lens.509-4.variant.test.ts

import { describe, expect, it, rs } from "@rstest/core";

rs.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));

import { captureTaskToStore } from "../../lib/sync/capture";
import { memoryCache } from "../../lib/sync/cache";
import { WorkspaceStore } from "../../lib/sync/store";
import { dueOnToLocalInstant } from "../../lib/task-rows";
import type { Bucket } from "../tasks/model";
import { fakeTasksRuntime } from "../tasks/testing/fake-tasks";
import { dueChipsByDay, visibleRange } from "./lens";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

const WS = "w1";
const ME = "u-me";

const inbox = {
  id: "inbox",
  workspaceId: WS,
  ownerId: ME,
  name: "Inbox",
  isSystem: true,
  group: null,
  position: "a",
  deletedAt: null,
} as unknown as Bucket;

hunt("HV-15 variant 509-4: a captured task's due day never reaches the Calendar", () => {
  it("a task captured offline with a due date shows as a due chip on that day", async () => {
    const { runtime } = fakeTasksRuntime({ buckets: [inbox] });
    const store = new WorkspaceStore(runtime, ME, WS, {
      cache: memoryCache(),
      listen: () => () => {},
      timing: { persistMs: 0, throttleMs: 0, retryMs: 60_000 },
    });
    const release = store.acquire();
    await store.whenLoaded();
    store.wentOffline();

    // What ⌘⇧K / Home capture pass for "Pay rent sat": the day's local midnight.
    const { queued } = await captureTaskToStore(store, {
      title: "Pay rent",
      dueDate: dueOnToLocalInstant("2026-10-24"),
      scheduledAt: null,
      recurrence: null,
    });
    expect(queued).toBe(true);

    const tasks = store.getSnapshot().bundle.tasks;
    expect(tasks.map((t) => t.title)).toContain("Pay rent");

    const range = visibleRange("week", new Date(2026, 9, 21, 9, 0), {
      weekStartsOn: 1,
      showWeekends: true,
    });
    const chips = dueChipsByDay(tasks, range, { list: [], me: ME });
    expect(chips.get("2026-10-24")?.map((c) => c.title)).toEqual(["Pay rent"]);
    release();
  });
});
