import type { Meta, StoryObj } from "@storybook/react";
import { MessageSquare, Paperclip } from "lucide-react";

import { PersonAvatar } from "./avatar";
import { CompleteToggle } from "./complete-toggle";
import { ItemCard, ItemCardMeta, ItemCardTitle } from "./item-card";
import { AtThreeDensities } from "./kit-densities";
import { MetaCount, MetaCounts } from "./meta-count";

const meta: Meta<typeof ItemCard> = {
  title: "Components/ui/item-card",
  component: ItemCard,
};

export default meta;
type Story = StoryObj<typeof meta>;

function SampleCard({
  title,
  date,
  who,
  selected,
  done,
}: {
  title: string;
  date: string;
  who: string | null;
  selected?: boolean;
  done?: boolean;
}) {
  return (
    <ItemCard selected={selected} done={done} tabIndex={0} className="w-64">
      <ItemCardTitle lead={<CompleteToggle done={!!done} onToggle={() => {}} />}>
        {title}
      </ItemCardTitle>
      <ItemCardMeta>
        <span>{date}</span>
        <MetaCounts>
          <MetaCount icon={Paperclip} count={2} label="attachments" />
          <MetaCount icon={MessageSquare} count={5} label="comments" />
        </MetaCounts>
        <PersonAvatar name={who} className="ms-auto" />
      </ItemCardMeta>
    </ItemCard>
  );
}

/**
 * A board card: hairline ring on the card fill, hover is a fill (point at
 * one), selected is the tint with its ring, done fades to half. The title
 * wraps; the meta line holds date · counts · assignee.
 */
export const Default: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-3">
      <SampleCard title="Draft the launch announcement" date="Thu" who="Alex Rivera" />
      <SampleCard
        title="Hero illustration for the homepage, with the new brand colours"
        date="Today"
        who="Sam Okafor"
        selected
      />
      <SampleCard title="Finalize pricing page copy" date="Oct 16" who={null} done />
    </div>
  ),
};

/** Padding follows density, so cards shrink with rows (call 44). */
export const Densities: Story = {
  render: () => (
    <AtThreeDensities>
      <SampleCard title="Draft the launch announcement" date="Thu" who="Alex Rivera" />
    </AtThreeDensities>
  ),
};
