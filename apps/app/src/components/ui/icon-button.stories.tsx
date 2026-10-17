import type { Meta, StoryObj } from "@storybook/react";
import { Plus, Settings2, Trash2 } from "lucide-react";

import { IconButton } from "./icon-button";
import { TooltipProvider } from "./tooltip";

const meta: Meta<typeof IconButton> = {
  title: "Components/ui/icon-button",
  component: IconButton,
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { icon: Plus, label: "Add item" },
};

export const Variants: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <IconButton icon={Plus} label="Add" variant="default" />
      <IconButton icon={Settings2} label="Settings" variant="outline" />
      <IconButton icon={Settings2} label="Settings" variant="ghost" />
      <IconButton icon={Trash2} label="Delete" variant="destructive" />
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <IconButton icon={Plus} label="Add (sm)" size="sm" variant="outline" />
      <IconButton icon={Plus} label="Add (md)" size="md" variant="outline" />
    </div>
  ),
};
