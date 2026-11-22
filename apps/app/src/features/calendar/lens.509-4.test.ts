// HV-15 variant of benchmarks/escapes/509-4-stale-derived-field (fixed): a task created
// with a due date (makeTask, used by capture and createTask) carries `dueDate` but not
// the derived `dueOn` until its create comes back, and the Calendar's due-chip lens read
// only `dueOn`, so a captured task due Saturday never showed on Saturday while its
// create waited (offline: until it is sent). The lens now reads `taskDueDay`
// (lib/task-rows.ts): `dueOn`, else the due instant's local day. Zone-independent
// except where noted.
// Run: bun run --cwd apps/app test src/features/calendar/lens.509-4.test.ts
import { describe, expect, it, rs } from "@rstest/core";

rs.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));

import { memoryCache } from "../../lib/sync/cache";
import { captureTaskToStore } from "../../lib/sync/capture";
import { WorkspaceStore } from "../../lib/sync/store";
import { dueOnToLocalInstant } from "../../lib/task-rows";
import type { Bucket, Task } from "../tasks/model";
import { fakeTasksRuntime } from "../tasks/testing/fake-tasks";
import { dueChipsByDay, visibleRange } from "./lens";

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

describe("HV-15 variant 509-4: a captured task's due day reaches the Calendar", () => {
  it("a task captured offline with a due date shows as a due chip on that day", async () => {
    const { runtime } = fakeTasksRuntime({ buckets: [inbox] });
    const store = new WorkspaceStore(runtime, ME, WS, {
      cache: memoryCache(),
      listen: () => () => {},
      timing: { persistMs: 0, throttleMs: 0, retryMs: 60_000 },
    });
    const release = store.acquire();
    try {
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
    } finally {
      release();
    }
  });

  // Hardening: wrong fixes that pass the case above in some zone.

  const range = visibleRange("week", new Date(2026, 9, 21, 9, 0), {
    weekStartsOn: 1,
    showWeekends: true,
  });
  const task = (id: string, due: { dueOn?: string | null; dueDate?: string | null }) => ({
    id,
    title: id,
    scheduledAt: null,
    durationMinutes: null,
    status: "todo" as Task["status"],
    deletedAt: null,
    assigneeId: ME,
    creatorId: ME,
    dueDate: null,
    ...due,
  });
  const chipsOn = (tasks: ReturnType<typeof task>[]) => {
    const chips = dueChipsByDay(tasks, range, { list: [], me: ME });
    return Object.fromEntries([...chips].map(([day, list]) => [day, list.map((c) => c.taskId)]));
  };
  /** Oct 24's local wall clock at h:m, as an instant. */
  const oct24At = (h: number, m: number) => new Date(2026, 9, 24, h, m).toISOString();

  it("without dueOn, the due instant's local day counts, not its UTC day", () => {
    // 00:30 and 23:30 local: a `.slice(0, 10)` of the instant moves one of them
    // a day in any zone but UTC.
    expect(
      chipsOn([
        task("early", { dueDate: oct24At(0, 30) }),
        task("late", { dueDate: oct24At(23, 30) }),
      ]),
    ).toEqual({ "2026-10-24": ["early", "late"] });
  });

  it("the derived day wins over a stale due instant", () => {
    expect(chipsOn([task("moved", { dueOn: "2026-10-22", dueDate: oct24At(12, 0) })])).toEqual({
      "2026-10-22": ["moved"],
    });
  });

  it("a bare due day is that day (west of UTC it read as the day before)", () => {
    expect(chipsOn([task("bare", { dueDate: "2026-10-24" })])).toEqual({
      "2026-10-24": ["bare"],
    });
  });

  it("no due day, no chip; an archived task with only a due instant stays out", () => {
    expect(
      chipsOn([
        task("none", {}),
        { ...task("gone", { dueDate: oct24At(12, 0) }), status: "archived" as Task["status"] },
      ]),
    ).toEqual({});
  });
});
