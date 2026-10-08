import type { Meta, StoryObj } from "@storybook/react";
import { CircleDashed, Flag, Hash, Lock, Plus, UserRound } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { FilterBar, FilterButton, FilterMenu } from "./filter-bar";
import { type FilterCondition, type FilterDimension, matchesFilters } from "./filter-model";
import { Toolbar } from "./toolbar";

const meta: Meta<typeof FilterBar> = {
  title: "Components/ui/filter-bar",
  component: FilterBar,
  decorators: [
    (Story) => (
      <div className="w-[720px] rounded-lg bg-card p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

function TagDot({ color }: { color: string }) {
  return <span data-label={color} className="tag-dot size-2.5 rounded-full" aria-hidden />;
}

/** A Tasks-shaped registry: the module maps its fields to dimensions. */
const DIMENSIONS: FilterDimension[] = [
  {
    id: "assignee",
    label: "Assignee",
    icon: UserRound,
    options: [
      { value: "me", label: "Me" },
      { value: "ola", label: "Ola", keywords: ["ola@moduo.app"] },
      { value: "mike", label: "Mike" },
      { value: "none", label: "Unassigned" },
    ],
  },
  {
    id: "tag",
    label: "Tag",
    icon: Hash,
    options: [
      { value: "ui", label: "UI", leading: <TagDot color="blue" />, count: 12 },
      { value: "fix", label: "fix", leading: <TagDot color="red" />, count: 4 },
      { value: "docs", label: "docs", leading: <TagDot color="green" />, count: 7 },
      { value: "infra", label: "infra", leading: <TagDot color="amber" />, count: 2 },
    ],
  },
  {
    id: "status",
    label: "Status",
    icon: CircleDashed,
    options: [
      { value: "todo", label: "To do" },
      { value: "doing", label: "In progress" },
      { value: "done", label: "Done" },
      { value: "archived", label: "Archived" },
    ],
  },
  {
    id: "priority",
    label: "Priority",
    icon: Flag,
    options: [
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low" },
    ],
  },
  {
    id: "blocked",
    label: "Blocked",
    icon: Lock,
    operators: ["is"],
    multiple: false,
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
];

const ROWS = [
  { title: "Brand-customize the auth emails", assignee: ["me"], tag: ["ui"], status: ["todo"] },
  { title: "Make the Windows build faster", assignee: ["mike"], tag: ["infra"], status: ["doing"] },
  {
    title: "Landing subpages per feature tab",
    assignee: ["me"],
    tag: ["ui", "docs"],
    status: ["todo"],
  },
  { title: "Fix the trial 401 on boot", assignee: ["ola"], tag: ["fix"], status: ["done"] },
  { title: "Write the README", assignee: [], tag: ["docs"], status: ["todo"] },
];

/** The toolbar's Filter button + the chip row, filtering a list live. */
export const Default: Story = {
  render: () => {
    const [value, setValue] = useState<FilterCondition[]>([
      { dimension: "assignee", operator: "is", values: ["me"] },
      { dimension: "tag", operator: "any_of", values: ["ui", "fix"] },
    ]);
    const valuesOf = (row: (typeof ROWS)[number], dim: string) =>
      dim === "assignee"
        ? row.assignee.length
          ? row.assignee
          : ["none"]
        : (((row as Record<string, unknown>)[dim] as string[]) ?? []);
    const visible = ROWS.filter((row) => matchesFilters(row, value, valuesOf));
    return (
      <div className="flex flex-col gap-2">
        <Toolbar aria-label="Tasks">
          <h2 className="font-display text-lg text-foreground">All</h2>
          <Toolbar.Spacer />
          <FilterButton dimensions={DIMENSIONS} value={value} onValueChange={setValue} />
        </Toolbar>
        <FilterBar
          dimensions={DIMENSIONS}
          value={value}
          onValueChange={setValue}
          matchCount={visible.length}
          totalCount={ROWS.length}
        />
        <ul className="flex flex-col font-sans text-base text-foreground">
          {visible.map((row) => (
            <li key={row.title} className="flex h-(--row-h) items-center px-2">
              {row.title}
            </li>
          ))}
        </ul>
      </div>
    );
  },
};

/** "is not" and a single-pick yes/no dimension, whose operator is fixed. */
export const Operators: Story = {
  render: () => {
    const [value, setValue] = useState<FilterCondition[]>([
      { dimension: "status", operator: "is_not", values: ["done", "archived"] },
      { dimension: "blocked", operator: "is", values: ["yes"] },
      { dimension: "tag", operator: "any_of", values: ["ui", "fix", "docs"] },
    ]);
    return <FilterBar dimensions={DIMENSIONS} value={value} onValueChange={setValue} />;
  },
};

/** The add-filter menu, open on its dimension step. Type "ola@" to jump
 *  straight to a value through its keywords. */
export const MenuOpen: Story = {
  render: () => {
    const [value, setValue] = useState<FilterCondition[]>([]);
    return (
      <div className="h-[360px]">
        <FilterMenu dimensions={DIMENSIONS} value={value} onValueChange={setValue} defaultOpen>
          <Button variant="ghost" size="sm" className="px-2">
            <Plus aria-hidden />
            Filter
          </Button>
        </FilterMenu>
      </div>
    );
  },
};
