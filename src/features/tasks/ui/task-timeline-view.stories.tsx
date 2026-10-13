import type { Meta, StoryObj } from "@storybook/react";
import { addDays, format } from "date-fns";
import { useState } from "react";

import { tasksDisplayDefaults } from "../display";
import { makeTask } from "../helpers";
import type { Area, Bucket, Section, Task, TaskSession } from "../model";
import { TaskTimelineView } from "./task-timeline-view";
import { bucket, INBOX, stubApi, TeamWorkspace } from "./tasks-stories-fixtures";

// The Timeline (TV-TL1, REPLAN 67–71): the prototype's two frames (round-2a
// frames 4 and 5) as stories — All at Quarter, one project row per project
// under its area with its phases and progress, and one project at Month with
// its sections as bands and diamonds and its tasks as points. Dates are
// relative to today so the marks keep their place against the today line.
// Visual captures are a deliberate human run (tests/visual/tasks-timeline.spec.ts).

const key = (offset: number) => format(addDays(new Date(), offset), "yyyy-MM-dd");

const AREAS: Area[] = [
  {
    id: "clients",
    workspaceId: "w1",
    name: "Clients",
    color: null,
    position: 0,
    shared: true,
    createdBy: null,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "product",
    workspaceId: "w1",
    name: "Product",
    color: null,
    position: 1,
    shared: true,
    createdBy: null,
    createdAt: "",
    updatedAt: "",
  },
];

const project = (id: string, name: string, over: Partial<Bucket>): Bucket => ({
  ...bucket(id, name, id),
  ...over,
});

const ACME = project("acme", "Acme rebrand", {
  areaId: "clients",
  color: "violet",
  startsOn: key(-11),
  targetOn: key(25),
});
const NORTH = project("north", "Northwind app", { areaId: "clients", color: "green" });
const WEBSITE = project("website", "Website", {
  areaId: "product",
  color: "teal",
  startsOn: key(-13),
  targetOn: key(38),
});
const VIDEOS = project("videos", "Studio videos", {
  areaId: "product",
  color: "blue",
  startsOn: key(9),
  targetOn: key(23),
});
const PROJECTS = [ACME, NORTH, WEBSITE, VIDEOS];

const section = (
  id: string,
  projectId: string,
  name: string,
  position: number,
  over: Partial<Section>,
): Section => ({
  id,
  workspaceId: "w1",
  projectId,
  name,
  position,
  startsOn: null,
  endsOn: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const SECTIONS: Section[] = [
  section("discovery", "acme", "Discovery", 0, { startsOn: key(-11), endsOn: key(-2) }),
  section("design", "acme", "Design", 1, { startsOn: key(1), endsOn: key(12) }),
  section("build", "acme", "Build", 2, { endsOn: key(25) }),
];

let n = 0;
function task(title: string, bucketId: string, over: Partial<Task> = {}): Task {
  n += 1;
  return {
    ...makeTask({ workspaceId: "w1", bucketId, title, position: String(n).padStart(6, "0") }),
    id: over.id ?? `t${n}`,
    assigneeId: n % 3 === 0 ? "u2" : "u1",
    statusCategory: "todo",
    ...over,
  };
}

const TASKS: Task[] = [
  task("Interview notes", "acme", {
    sectionId: "discovery",
    dueOn: key(-8),
    status: "done",
    statusCategory: "done",
  }),
  task("Logo concepts round 2", "acme", { id: "logo", sectionId: "design", dueOn: key(2) }),
  task("Collect brand assets from client", "acme", { sectionId: "design", dueOn: key(-3) }),
  task("Moodboard v2 for the packaging", "acme", { id: "moodboard", sectionId: "design" }),
  task("Brand guidelines PDF", "acme", { sectionId: "build", dueOn: key(25) }),
  task("Export logo files", "acme", { sectionId: "build", dueOn: key(24) }),
  task("Business card print files", "acme", { sectionId: "build", dueOn: key(23) }),
  task("Handover call with Anna", "acme", {
    sectionId: "build",
    dueOn: key(25),
    recurrence: { rrule: "FREQ=WEEKLY;INTERVAL=1", dtstart: null, nextOccurrence: null },
  }),
  task("Icon set: first pass", "acme", { sectionId: "design" }),
  task("API contract", "north", { dueOn: key(-7) }),
  task("Onboarding screens", "north", { dueOn: key(18) }),
  task("Pricing page copy", "website", { dueOn: key(6) }),
  task("Episode 4 edit", "videos", { dueOn: key(16) }),
];

const SESSIONS: TaskSession[] = [
  {
    id: "s1",
    workspaceId: "w1",
    taskId: "moodboard",
    userId: "u1",
    startsAt: addDays(new Date(), 3).toISOString(),
    endsAt: addDays(new Date(), 3).toISOString(),
    updatedAt: "",
  },
];

function api(tasks: Task[] = TASKS) {
  return stubApi(tasks, {
    areas: AREAS,
    sections: SECTIONS,
    sessions: SESSIONS,
    archivedBuckets: [],
    currentUserId: "u1",
  });
}

/** The view with its Display in state, so the zoom and the menu work in the story. */
function Harness({
  scope,
  tasks = TASKS,
  canEdit = true,
  duePerWeek = false,
}: {
  scope: string;
  tasks?: Task[];
  canEdit?: boolean;
  duePerWeek?: boolean;
}) {
  const [display, setDisplay] = useState(() =>
    tasksDisplayDefaults(scope, "standard", { duePerWeek }),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const scoped = scope === "all" ? tasks : tasks.filter((t) => t.bucketId === scope);
  return (
    <TeamWorkspace>
      <TaskTimelineView
        tasks={scoped}
        scopeTitle={scope === "all" ? "All" : (PROJECTS.find((p) => p.id === scope)?.name ?? "")}
        selection={scope}
        view="timeline"
        onViewChange={() => {}}
        buckets={PROJECTS}
        inbox={INBOX}
        canEdit={canEdit}
        onRequestCapture={() => {}}
        selectedTaskId={selected}
        onSelectTask={setSelected}
        api={api(tasks)}
        workspaceId="w1"
        display={display}
        onDisplayChange={setDisplay}
        completed={display.completed}
        stayingIds={new Set()}
      />
    </TeamWorkspace>
  );
}

const meta = {
  title: "Tasks/TaskTimelineView",
  component: Harness,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="bg-card p-4" style={{ height: 640 }}>
        <Story />
      </div>
    ),
  ],
  args: { scope: "all" },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All at Quarter (frame 4): projects under their areas; ▸ expands one. */
export const AllProjects: Story = {};

/** All with Due per week (the student's default, AC2.7). */
export const DuePerWeek: Story = { args: { duePerWeek: true } };

/** Inside a project at Month (frame 5): sections as bands and diamonds, tasks as points. */
export const InsideAProject: Story = { args: { scope: "acme" } };

/** Nothing dated: the rows stay, with the today line and one sentence (71). */
export const Empty: Story = {
  args: {
    scope: "north",
    tasks: TASKS.map((t) => ({ ...t, dueOn: null, dueDate: null })),
  },
};

/** Everything visible, nothing editable. */
export const ReadOnly: Story = { args: { scope: "acme", canEdit: false } };
