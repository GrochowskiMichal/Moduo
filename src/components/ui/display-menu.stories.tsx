import type { Meta, StoryObj } from "@storybook/react";
import { Columns3, GanttChart, List } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { type DisplayControl, DisplayMenu } from "./display-menu";

const meta: Meta<typeof DisplayMenu> = {
  title: "Components/ui/display-menu",
  component: DisplayMenu,
  decorators: [
    (Story) => (
      <div className="flex h-[480px] w-[560px] justify-end rounded-lg bg-card p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

type TasksDisplay = {
  layout: string;
  groupBy: string;
  orderBy: string;
  completed: string;
  subtasks: string;
  properties: string[];
};

const DEFAULTS: TasksDisplay = {
  layout: "list",
  groupBy: "bucket",
  orderBy: "manual",
  completed: "hidden",
  subtasks: "nested",
  properties: ["priority", "due", "scheduled", "assignee", "tags", "attachments", "comments"],
};

/** The Tasks comp's Display popover, as a module config. */
const CONTROLS: DisplayControl<TasksDisplay>[] = [
  {
    type: "segmented",
    id: "layout",
    label: "Layout",
    iconOnly: true,
    options: [
      { value: "list", label: "List", icon: List },
      { value: "board", label: "Board", icon: Columns3 },
      { value: "timeline", label: "Timeline", icon: GanttChart },
    ],
  },
  {
    type: "select",
    id: "groupBy",
    label: "Group by",
    options: [
      { value: "none", label: "None" },
      { value: "status", label: "Status" },
      { value: "bucket", label: "Bucket" },
      { value: "assignee", label: "Assignee" },
      { value: "priority", label: "Priority" },
      { value: "time", label: "Time" },
    ],
  },
  {
    type: "select",
    id: "orderBy",
    label: "Order by",
    options: [
      { value: "manual", label: "Manual" },
      { value: "due", label: "Due" },
      { value: "scheduled", label: "Scheduled" },
      { value: "priority", label: "Priority" },
      { value: "created", label: "Created" },
      { value: "updated", label: "Updated" },
    ],
  },
  {
    type: "segmented",
    id: "completed",
    label: "Completed",
    options: [
      { value: "hidden", label: "Hidden" },
      { value: "7d", label: "7 days" },
      { value: "all", label: "All" },
    ],
  },
  {
    type: "segmented",
    id: "subtasks",
    label: "Subtasks",
    options: [
      { value: "nested", label: "Nested" },
      { value: "flat", label: "Flat" },
    ],
  },
  {
    type: "toggles",
    id: "properties",
    label: "Show on rows",
    options: [
      { value: "priority", label: "Priority" },
      { value: "energy", label: "Energy" },
      { value: "due", label: "Due" },
      { value: "scheduled", label: "Scheduled" },
      { value: "assignee", label: "Assignee" },
      { value: "tags", label: "Tags" },
      { value: "attachments", label: "Attachments" },
      { value: "comments", label: "Comments" },
      { value: "estimate", label: "Estimate" },
    ],
  },
];

/** Open on first paint, with Reset (enabled once anything differs). */
export const Default: Story = {
  render: () => {
    const [value, setValue] = useState(DEFAULTS);
    return (
      <DisplayMenu
        controls={CONTROLS}
        value={value}
        onValueChange={setValue}
        defaultValue={DEFAULTS}
        defaultOpen
      />
    );
  },
};

/** With a footer action, as "Save as view…" will use it (TV-U8). */
export const WithFooter: Story = {
  render: () => {
    const [value, setValue] = useState({ ...DEFAULTS, completed: "all" });
    return (
      <DisplayMenu
        controls={CONTROLS}
        value={value}
        onValueChange={setValue}
        defaultValue={DEFAULTS}
        defaultOpen
        footer={
          <Button variant="ghost" size="sm" className="me-auto px-2">
            Save as view…
          </Button>
        }
      />
    );
  },
};
