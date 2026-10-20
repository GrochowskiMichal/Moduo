// Tests' way into the Tasks context (A4): render a component under a real
// `<TasksProvider>` whose store has already read the seed, so the first render
// shows the data (as a warm page does). Commands can be swapped for spies.
//
//   const patchTask = rs.fn();
//   const view = await renderWithTasks(<TaskDetailPanel task={t} … />, {
//     seed: { buckets: [INBOX], tasks: [t] },
//     commands: { patchTask },
//   });
//   view.store.answer({ tasks: [{ ...other, title: "Renamed" }] }); // a teammate's edit
//
// `rerender` keeps the provider (it's the render's wrapper).

import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { type WorkspaceStore, workspaceStore } from "../../../lib/sync/store";
import type { TaskCommands } from "../commands";
import {
  type FakeRuntimeExtras,
  FakeTasksProvider,
  type FakeTasksRuntime,
  type FakeTasksSeed,
  fakeTasksRuntime,
} from "./fake-tasks";

export type RenderWithTasksOptions = {
  /** Each synced table's rows (tasks, buckets, queue, sessions, …). */
  seed?: FakeTasksSeed;
  /** Runtime parts besides the Tasks reads (spine, attachments), and Tasks calls to replace. */
  runtime?: FakeRuntimeExtras;
  /** Default "u1". */
  userId?: string;
  /** Default "w1". */
  workspaceId?: string;
  /** Tasks access (default edit). */
  permission?: "none" | "view" | "edit" | "admin";
  /** Commands to use instead of the store's: spies, canned answers. */
  commands?: Partial<TaskCommands>;
  /** Around the provider (a workspace context, a tooltip provider). */
  wrapper?: (props: { children: ReactNode }) => ReactNode;
};

export type RenderWithTasksResult = RenderResult & {
  /** The page's store: `answer` a row to change data as a teammate would. */
  store: WorkspaceStore;
  runtime: ModuoRuntime;
  /** The fake `runtime.tasks` (what reached the "server"). */
  tasks: FakeTasksRuntime["tasks"];
};

export async function renderWithTasks(
  ui: ReactElement,
  opts: RenderWithTasksOptions = {},
): Promise<RenderWithTasksResult> {
  const { seed, userId = "u1", workspaceId = "w1", permission = "edit", commands } = opts;
  const fake = fakeTasksRuntime(seed, opts.runtime);
  // Read the seed before the first render: the provider finds the store warm.
  const store = workspaceStore(fake.runtime, userId, workspaceId);
  const release = store.acquire();
  if (permission !== "none") await store.whenRest();
  const Outer = opts.wrapper;
  function Wrapper({ children }: { children: ReactNode }) {
    const tree = (
      <FakeTasksProvider
        runtime={fake.runtime}
        userId={userId}
        workspaceId={workspaceId}
        permission={permission}
        commands={commands}
      >
        {children}
      </FakeTasksProvider>
    );
    return Outer ? <Outer>{tree}</Outer> : tree;
  }
  const result = render(ui, { wrapper: Wrapper });
  // The provider holds the store now (its effect ran inside render's act).
  release();
  return { ...result, store, runtime: fake.runtime, tasks: fake.tasks };
}
