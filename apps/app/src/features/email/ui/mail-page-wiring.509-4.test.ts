// HV-15 variant of benchmarks/escapes/509-4-stale-derived-field (regression test):
// dragging a thread onto the Mail Today panel makes a task whose `dueDate` is the bare
// day "YYYY-MM-DD"; its derived `dueOn` must be that local day, not the day `localDayOf`
// gets by reading it as UTC midnight (west of UTC that is the day before). Passes
// today; it guards the drop path. Bites only west of UTC.
// Run: TZ=America/New_York bun run --cwd apps/app test src/features/email/ui/mail-page-wiring.509-4.test.ts

import { describe, expect, it } from "@rstest/core";

import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { taskCreateOpInput } from "../../../lib/task-rows";
import { makeTask } from "../../tasks/helpers";
import type { Task } from "../../tasks/model";
import { createMailSpineCommands } from "../commands/spine";
import { createRuntimeSpinePort, localDate, type SpineRuntime } from "./mail-page-wiring";

const thread: MailThreadRow = {
  threadId: "t1",
  accountId: "gmail:me@x.com",
  subject: "Contract draft",
  snippet: "Please review",
  senders: [{ name: "Anna", email: "anna@acme.com" }],
  lastDateMs: 1,
  messageCount: 1,
  unread: true,
  pinned: false,
  hasAttachments: false,
  hasInvite: false,
  tab: "personal",
  priority: false,
  muted: false,
  snoozedUntilMs: null,
};

describe("HV-15 variant 509-4: a thread dropped on Today makes a task due that day", () => {
  it("the created task is due on the day it was dropped on", async () => {
    const saved: Task[] = [];
    const rt: SpineRuntime = {
      email: { upsertRef: async () => ({ id: "ref1" }), removeRef: async () => {} },
      tasks: {
        upsertTask: async (task: Task) => (saved.push(task), { id: "task1" }),
        deleteTask: async () => {},
      },
      notes: { create: async () => ({ id: "n1" }), trash: async () => {} },
      calendar: { createEvent: async () => ({ id: "e1" }), removeEvent: async () => {} },
      spine: {
        listLinks: async () => [],
        createLink: async () => ({ id: "l1" }),
        deleteLink: async () => {},
      },
    } as unknown as SpineRuntime;
    // The same task builder the Mail route hands the port (use-mail-page-wiring.tsx).
    const port = createRuntimeSpinePort({
      runtime: rt,
      workspaceId: "w",
      hasRef: () => false,
      contacts: [],
      makeTask: ({ title, description, dueDate }) =>
        makeTask({
          workspaceId: "w",
          bucketId: "inbox",
          title,
          description,
          dueDate,
          position: "a",
        }),
    });
    // The Today panel's drop zone: `date={localDate(now())}`.
    const today = localDate(new Date(2026, 10, 10, 9, 0).getTime());
    await createMailSpineCommands(port).drop(thread, { kind: "day", date: today });

    expect(saved).toHaveLength(1);
    // What the web runtime sends to `tasks_op_create` (createTaskRow).
    expect(taskCreateOpInput(saved[0] as Task).due_on).toBe("2026-11-10");
  });
});
