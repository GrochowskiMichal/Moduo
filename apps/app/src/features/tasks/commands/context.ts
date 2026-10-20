// What the Tasks commands are built from (`createTaskCommands`). The commands
// are made once per store, runtime, workspace and person, and read everything
// else when they run: the store's data through `data()` (its snapshot now,
// never a render's), and what changes without a new store (edit access,
// members' names, time blocks, the trash read) through `env()`, which the
// hook keeps current after each render. So a store change never gives a
// command a new identity, and nothing is written during render.

import type { TaskStatusCategory } from "@contracts/vocabularies";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { WorkspaceStore } from "../../../lib/sync/store";
import type { NewTaskFields } from "../helpers";
import type { Task, TasksTrash, TimeBlockMap } from "../model";
import type { TasksData } from "../selectors";
import type { StatusTarget } from "../statuses";
import type { WritePlan } from "../write-plan";

/** An adjustment `logTimeAdjustment` recorded, as its Undo needs it. */
export type TimeAdjustment = {
  /** The entry to remove; null on a database without time entries yet. */
  entryId: string | null;
  seconds: number;
};

/** Which deleted item a Restore or Delete forever acts on (TV-U6). */
export type TrashTarget = { kind: "bucket" | "task"; id: string };

/** What an archive does with the project's open tasks (REPLAN 78: "4 open
 *  tasks — Won't do · Move · Keep"). */
export type ArchiveOpenTasks =
  | { kind: "keep" }
  | { kind: "wont_do" }
  | { kind: "move"; projectId: string };

/** A new task's fields, as the surfaces give them (the place is worked out here). */
export type NewTaskInput = Omit<NewTaskFields, "workspaceId" | "position">;

/** Call 87: how many open subtasks a check-off finished, and their Undo. */
export type Finished = { count: number; undo: () => void };

/** What changes without a new store: read when a command runs. */
export type TaskCommandsEnv = {
  canRead: boolean;
  canEdit: boolean;
  /** A teammate's name, for "Also in Mike's queue". */
  memberName: (userId: string) => string;
  timeBlocks: TimeBlockMap;
  /** Read Recently deleted again (a no-op where it isn't read). */
  reloadTrash: () => Promise<void>;
};

export type TaskCommandsContext = {
  store: WorkspaceStore | null;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  userId: string | null;
  /** The store's data as it is now (`tasksDataOf` its snapshot). */
  data: () => TasksData;
  env: () => TaskCommandsEnv;
  /** Bumped after every successful op — the detail panel's trail refetch cue. */
  bumpActivity: () => void;
  setTrash: Dispatch<SetStateAction<TasksTrash | null>>;
  setTimeBlocks: Dispatch<SetStateAction<TimeBlockMap>>;
  /** Set by the page: opens Recently deleted (the delete toast links there). */
  openTrashRef: RefObject<(() => void) | null>;
};

/**
 * The commands one aggregate calls on another. Late-bound: filled in once
 * every aggregate is made, and only called when a command runs, so a cycle
 * (a status change patches the task; a patch offers a status change) needs
 * no refs.
 */
export type TaskPeers = {
  patchTask: (id: string, patch: Partial<Task>) => void;
  /** `patchTask`, answering the write's plan (null for a task the copy doesn't have). */
  writeTask: (id: string, patch: Partial<Task>) => WritePlan | null;
  setTaskStatus: (id: string, target: StatusTarget) => void;
  offerReminderRestore: (task: Task, to: TaskStatusCategory | undefined) => void;
  finishOpenSubtasks: (before: Task) => Finished | null;
  restoreQueuePlace: (taskId: string, lineupBefore: string[]) => void;
};
