// The Tasks commands (docs/moduo-module-contract.md's intent ops and the
// writes around them), made once per store, runtime, workspace and person
// (`TaskCommandsContext`) and grouped by aggregate. A command reads the
// store's data when it runs, so its identity never changes with the data.
// Cross-aggregate calls go through `peers`, filled in once every group is
// made (they only run later, when a command does).

import { createActivityOps } from "./activity";
import { createBulkOps } from "./bulk";
import { createBulkWrite } from "./bulk-write";
import type { TaskCommandsContext, TaskPeers } from "./context";
import { createProjectOps } from "./projects";
import { createQueueOps } from "./queue";
import { createScheduleOps } from "./schedule";
import { createShared } from "./shared";
import { createStatusOps } from "./status";
import { createStructureOps } from "./structure";
import { createTagOps } from "./tags";
import { createTaskOps } from "./task";
import { createTimeOps } from "./time";

export type { BulkQueueOptions } from "./bulk";
export type { BulkWriteOptions } from "./bulk-write";
export type {
  ArchiveOpenTasks,
  TaskCommandsContext,
  TaskCommandsEnv,
  TimeAdjustment,
  TrashTarget,
} from "./context";
export { makeFailed } from "./shared";

export function createTaskCommands(ctx: TaskCommandsContext) {
  const shared = createShared(ctx);
  const peers = {} as TaskPeers;
  const commands = {
    ...createTaskOps(ctx, shared, peers),
    ...createStatusOps(ctx, shared, peers),
    ...createQueueOps(ctx, shared),
    ...createTimeOps(ctx, shared),
    ...createScheduleOps(ctx, shared),
    ...createActivityOps(ctx, shared),
    ...createProjectOps(ctx, shared, peers),
    ...createStructureOps(ctx, shared),
    ...createTagOps(shared),
    ...createBulkWrite(ctx, shared, peers),
    ...createBulkOps(ctx, shared),
  };
  Object.assign(peers, commands satisfies TaskPeers);
  return commands;
}

export type TaskCommands = ReturnType<typeof createTaskCommands>;
