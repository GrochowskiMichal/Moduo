import type { Meta, StoryObj } from "@storybook/react";
import { Inbox } from "lucide-react";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { AtThreeDensities } from "./kit-densities";

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

/** Page and inline sizes at the three density steps. */
export const Densities: Story = {
  render: () => (
    <AtThreeDensities>
      <div className="flex w-60 flex-col gap-4">
        <EmptyState
          icon={Inbox}
          title="No tasks match"
          description="Clear a filter to see more."
          action={
            <Button size="sm" variant="ghost">
              Clear filters
            </Button>
          }
          size="inline"
        />
      </div>
    </AtThreeDensities>
  ),
};
