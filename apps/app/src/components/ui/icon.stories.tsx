import type { Meta, StoryObj } from "@storybook/react";

import { Icon, type IconName } from "./icon";

const meta: Meta<typeof Icon> = {
  title: "Components/ui/icon",
  component: Icon,
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
    name: {
      control: "select",
      options: [
        "bell",
        "settings",
        "trash-2",
        "search",
        "folder",
        "mail",
        "file-text",
        "tag",
      ] satisfies IconName[],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    name: "bell",
    size: "sm",
  },
};

const ALL_NAMES: IconName[] = [
  "bell",
  "edit-2",
  "settings",
  "log-out",
  "trash-2",
  "grid",
  "calendar",
  "file-text",
  "mail",
  "check-square",
  "tag",
  "edit-3",
  "clock",
  "pen-tool",
  "git-branch",
  "folder",
  "bar-chart-2",
  "dollar-sign",
  "search",
  "ground-roots",
];

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-6 text-foreground">
      <div className="flex flex-col items-center gap-2">
        <Icon name="bell" size="sm" />
        <span className="text-xs text-muted-foreground">sm (16)</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Icon name="bell" size="md" />
        <span className="text-xs text-muted-foreground">md (20)</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Icon name="bell" size="lg" />
        <span className="text-xs text-muted-foreground">lg (24)</span>
      </div>
    </div>
  ),
};

export const Gallery: Story = {
  render: () => (
    <div className="grid grid-cols-6 gap-4 text-foreground">
      {ALL_NAMES.map((name) => (
        <div
          key={name}
          className="flex flex-col items-center gap-2 rounded-md border border-border bg-card p-3"
        >
          <Icon name={name} size="md" />
          <span className="text-xs text-muted-foreground">{name}</span>
        </div>
      ))}
    </div>
  ),
};
