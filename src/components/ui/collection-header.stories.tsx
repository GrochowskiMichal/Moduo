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

/** A few plain rows to sit under a header. */
function Rows({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={item} className="flex min-h-(--ctrl-h-sm) items-center px-1 font-sans text-base">
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * Label · count (the tertiary level) · one action, on the small control rung,
 * 4 px over its rows (MOD-152). An empty collection ends at its header: the
 * 4 px only come with rows under it.
 */
export const Default: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <section data-testid="with-rows">
        <CollectionHeader
          label="Subtasks"
          count="1/3"
          action={<IconButton icon={Plus} label="Add a subtask" />}
        />
        <Rows items={["Write the interview script", "Book three calls", "Send the notes"]} />
      </section>
      <section data-testid="empty">
        <CollectionHeader label="Linked" count={0} />
        <Rows items={[]} />
      </section>
      <section>
        <CollectionHeader label="Attachments" />
      </section>
    </div>
  ),
};

/** Height follows the control rung: 26 / 24 / 22 px. */
export const Densities: Story = {
  render: () => (
    <AtThreeDensities>
      <div>
        <CollectionHeader
          label="Subtasks"
          count="1/3"
          action={<IconButton icon={Plus} label="Add a subtask" />}
        />
        <Rows items={["Write the interview script", "Book three calls"]} />
      </div>
    </AtThreeDensities>
  ),
};
