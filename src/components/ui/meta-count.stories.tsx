import type { Meta, StoryObj } from "@storybook/react";
import { Hash, ListTree, MessageSquare, Paperclip } from "lucide-react";
import { AtThreeDensities } from "./kit-densities";
import { MetaCount, MetaCounts } from "./meta-count";

const meta: Meta<typeof MetaCount> = {
  title: "Components/ui/meta-count",
  component: MetaCount,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <MetaCount icon={Paperclip} count={2} label="attachments" />,
};

/** The quiet-counts group, in its fixed order: tags · attachments · comments · subtasks. Zeros render nothing. Subtasks can show progress ("1/3") through `value`. */
export const Group: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <MetaCounts>
        <MetaCount icon={Hash} count={3} label="tags" />
        <MetaCount icon={Paperclip} count={2} label="attachments" />
        <MetaCount icon={MessageSquare} count={14} label="comments" />
        <MetaCount
          icon={ListTree}
          count={5}
          label={(n) => (n === 1 ? "1 subtask" : `${n} subtasks`)}
        />
      </MetaCounts>
      <MetaCounts>
        <MetaCount icon={Hash} count={2} label="tags" />
        <MetaCount icon={ListTree} count={3} value="1/3" label={() => "1 of 3 subtasks done"} />
      </MetaCounts>
      <MetaCounts>
        <MetaCount icon={Hash} count={0} label="tags" />
        <MetaCount icon={Paperclip} count={1} label={() => "1 attachment"} />
        <MetaCount icon={MessageSquare} count={0} label="comments" />
      </MetaCounts>
    </div>
  ),
};

/** On a list row and a board card, after the title. */
export const OnARow: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-2">
      <div className="flex h-(--row-h) items-center gap-2 rounded-md bg-card px-3">
        <span className="min-w-0 truncate text-base">Notes: fix black background</span>
        <MetaCounts>
          <MetaCount icon={Hash} count={3} label="tags" />
          <MetaCount icon={Paperclip} count={2} label="attachments" />
        </MetaCounts>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-card p-3">
        <span className="text-base">Notes: fix black background</span>
        <MetaCounts>
          <span className="font-sans text-xs tabular-nums text-muted-foreground">Fri</span>
          <MetaCount icon={Hash} count={3} label="tags" />
          <MetaCount icon={Paperclip} count={2} label="attachments" />
        </MetaCounts>
      </div>
    </div>
  ),
};

/** The quiet counts on a row at the three density steps (icons on the icon rung). */
export const Densities: Story = {
  render: () => (
    <AtThreeDensities>
      <div className="flex h-(--row-h) w-72 items-center gap-2 rounded-md bg-card px-3">
        <span className="min-w-0 truncate text-md">Notes: fix black background</span>
        <MetaCounts>
          <MetaCount icon={Hash} count={3} label="tags" />
          <MetaCount icon={Paperclip} count={2} label="attachments" />
          <MetaCount icon={MessageSquare} count={14} label="comments" />
        </MetaCounts>
      </div>
    </AtThreeDensities>
  ),
};
