// The project overview's words (MOD-139): what happened in the project reads
// "Recently", not "Lately".

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
  previewAssign: async () => null,
  initialsOf: () => "?",
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import { makeTask } from "../helpers";
import type { Bucket, Task } from "../model";
import { ProjectPanel } from "./project-panel";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

const PROJECT: Bucket = {
  id: "p1",
  workspaceId: "w",
  ownerId: "u1",
  name: "Website",
  isSystem: false,
  group: null,
  position: "a",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  deletedAt: null,
};

const TASK: Task = {
  ...makeTask({ workspaceId: "w", bucketId: "p1", title: "Draft the launch post", position: "a" }),
  id: "t1",
  creatorId: "u1",
  createdAt: "2026-10-14T09:00:00Z",
};

describe("the project overview (MOD-139)", () => {
  it('names what happened in the project "Recently"', () => {
    render(
      <TooltipProvider>
        <ProjectPanel project={PROJECT} tasks={[TASK]} sections={[]} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("heading", { name: "Recently" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Lately" })).toBeNull();
  });
});
