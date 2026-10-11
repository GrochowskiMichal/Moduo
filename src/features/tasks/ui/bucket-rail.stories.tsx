import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import type { TasksSidebarHideable } from "../../../lib/preferences";
import type { Area, Bucket } from "../model";
import { BucketRail } from "./bucket-rail";
import { TeamWorkspace } from "./tasks-stories-fixtures";

// TV-U6 — the Tasks sidebar (specs/tasks-v3.md §3; prototype round-1c frame
// 1): Inbox · Focus · Upcoming · My tasks, the hairline (its ⋯ is Customize
// sidebar, Archived projects and Recently deleted), All · Pinned · projects by
// area. Baselines are a human capture (tests/visual/sidebar.spec.ts).

const NOW = "2026-10-01T00:00:00.000Z";
const project = (id: string, name: string, extra: Partial<Bucket> = {}): Bucket => ({
  id,
  workspaceId: "w",
  ownerId: "u",
  name,
  isSystem: false,
  group: null,
  position: id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  ...extra,
});
const area = (id: string, name: string, position: number): Area => ({
  id,
  workspaceId: "w",
  name,
  color: null,
  position,
  shared: true,
  createdBy: "u",
  createdAt: NOW,
  updatedAt: NOW,
});

const INBOX = project("inbox", "Inbox", { isSystem: true, position: "a" });
const FRESH = [
  project("p1", "Launch v1", { color: "blue" }),
  project("p2", "Website", { color: "teal" }),
  project("p3", "Acme rebrand", { color: "violet" }),
];
const AREAS = [
  area("product", "Product", 1),
  area("clients", "Clients", 2),
  area("school", "School", 3),
  area("personal", "Personal", 4),
];
const BUSY = [
  project("b1", "Launch v1", { color: "blue", areaId: "product" }),
  project("b2", "Website", { color: "teal", areaId: "product" }),
  project("b3", "Bugs", { areaId: "product" }),
  project("b4", "Acme rebrand", { color: "violet", areaId: "clients" }),
  project("b5", "Northwind app", { color: "green", areaId: "clients" }),
  project("b6", "CS 201 Algorithms", { color: "amber", areaId: "school" }),
  project("b7", "Thesis", { color: "blue", areaId: "school" }),
  project("b8", "Home", { color: "teal", areaId: "personal" }),
];
const COUNTS = new Map([
  ["inbox", 3],
  ["p1", 6],
  ["p2", 4],
  ["p3", 2],
  ["b1", 8],
  ["b2", 5],
  ["b3", 4],
  ["b4", 7],
  ["b5", 3],
  ["b6", 3],
  ["b7", 2],
  ["b8", 2],
]);

type HarnessProps = {
  projects: Bucket[];
  areas: Area[];
  pinned?: string[];
  hidden?: TasksSidebarHideable[];
  collapsed?: string[];
  myTasks?: number | null;
  canEdit?: boolean;
};

function Harness({
  projects,
  areas,
  pinned: initialPinned = [],
  hidden: initialHidden = [],
  collapsed: initialCollapsed = [],
  myTasks = 22,
  canEdit = true,
}: HarnessProps) {
  const [selection, setSelection] = useState("upcoming");
  const [pinned, setPinned] = useState(initialPinned);
  const [hidden, setHidden] = useState(new Set(initialHidden));
  const [collapsed, setCollapsed] = useState(new Set(initialCollapsed));
  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  return (
    <BucketRail
      mode="plan"
      onModeChange={() => {}}
      selection={selection}
      onSelect={setSelection}
      buckets={projects}
      areas={areas}
      inbox={INBOX}
      openCountByBucket={COUNTS}
      driftCountByBucket={new Map()}
      totalOpenCount={34}
      queueCount={4}
      myTasksCount={myTasks}
      canEdit={canEdit}
      hidden={hidden}
      onToggleHidden={(row) => setHidden((prev) => toggle(prev, row))}
      pinned={pinned}
      onTogglePin={(id) =>
        setPinned((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
      }
      collapsed={collapsed}
      onToggleCollapsed={(key) => setCollapsed((prev) => toggle(prev, key))}
      onCreateBucket={() => {}}
      onRenameBucket={() => {}}
      onRequestDelete={() => {}}
      onRequestArchive={() => {}}
      onSetBucketColor={() => {}}
      onMoveBucket={() => {}}
      onMoveBucketToArea={() => {}}
      onTriageBucket={() => {}}
      onCreateArea={async () => null}
      onRenameArea={() => {}}
      onSetAreaColor={() => {}}
      onMoveArea={() => {}}
      onDeleteArea={() => {}}
      archivedCount={2}
      trashCount={5}
    />
  );
}

const meta = {
  title: "Tasks/Sidebar",
  component: Harness,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <TeamWorkspace>
        <div className="flex h-screen w-60 flex-col bg-card p-2">
          <Story />
        </div>
      </TeamWorkspace>
    ),
  ],
  args: { projects: BUSY, areas: AREAS },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A fresh workspace: no headers at all, the hairline, All, its projects. */
export const FreshWorkspace: Story = { args: { projects: FRESH, areas: [], myTasks: null } };

/** A busy workspace: Pinned (only once something is pinned), areas, a collapsed one. */
export const BusyWorkspace: Story = {
  args: { pinned: ["b1"], collapsed: ["area:school"] },
};

/** Customize sidebar: Upcoming and All hidden. */
export const Customized: Story = { args: { hidden: ["upcoming", "all"] } };

/** Someone who can't edit: no New project, a menu with Pin only. */
export const ReadOnly: Story = { args: { canEdit: false } };
