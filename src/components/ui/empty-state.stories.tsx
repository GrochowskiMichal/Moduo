import type { Meta, StoryObj } from "@storybook/react";
import { Inbox } from "lucide-react";

import { EmptyState } from "./empty-state";
import { Button } from "./button";

const meta: Meta<typeof EmptyState> = {
  title: "Components/ui/empty-state",
  component: EmptyState,
  decorators: [
    (Story) => (
      <div className="h-72 w-96 rounded-lg border border-border">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { title: "Nothing here yet." },
};

export const WithIconAndAction: Story = {
  args: {
    icon: Inbox,
    title: "Your inbox is empty",
    description: "Captured tasks land here before you sort them.",
    action: <Button size="sm">New task</Button>,
    hint: "or press c to capture",
  },
};
