import type { Meta, StoryObj } from "@storybook/react";
import { Plus } from "lucide-react";

import { CollectionHeader } from "./collection-header";
import { IconButton } from "./icon-button";
import { AtThreeDensities } from "./kit-densities";
import { TooltipProvider } from "./tooltip";

const meta: Meta<typeof CollectionHeader> = {
  title: "Components/ui/collection-header",
  component: CollectionHeader,
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="w-80">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Label · count · one action, on the small control rung. */
export const Default: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <CollectionHeader
        label="Subtasks"
        count="1/3"
        action={<IconButton icon={Plus} label="Add a subtask" />}
      />
      <CollectionHeader label="Linked" count={4} />
      <CollectionHeader label="Attachments" />
    </div>
  ),
};

/** Height follows the control rung: 26 / 24 / 22 px. */
export const Densities: Story = {
  render: () => (
    <AtThreeDensities>
      <CollectionHeader
        label="Subtasks"
        count="1/3"
        action={<IconButton icon={Plus} label="Add a subtask" />}
      />
    </AtThreeDensities>
  ),
};
