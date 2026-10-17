import type { Meta, StoryObj } from "@storybook/react";

import { Skeleton } from "./skeleton";

const meta: Meta<typeof Skeleton> = {
  title: "Components/ui/skeleton",
  component: Skeleton,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const SidebarRows: Story = {
  render: () => (
    <div className="flex w-64 flex-col gap-1 p-2">
      {[70, 55, 80, 45].map((pct) => (
        <div key={pct} className="flex h-(--row-h) items-center gap-2 px-2">
          <Skeleton className="size-4" />
          <Skeleton className="h-3 flex-1" style={{ maxWidth: `${pct}%` }} />
        </div>
      ))}
    </div>
  ),
};
