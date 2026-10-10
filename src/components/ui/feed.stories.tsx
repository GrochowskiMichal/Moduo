import type { Meta, StoryObj } from "@storybook/react";
import { ArrowUp, AtSign } from "lucide-react";

import { PersonAvatar } from "./avatar";
import { FeedCard, FeedComposer, FeedComposerInput, FeedItem } from "./feed";
import { IconButton } from "./icon-button";
import { AtThreeDensities } from "./kit-densities";
import { TooltipProvider } from "./tooltip";

const meta: Meta<typeof FeedItem> = {
  title: "Components/ui/feed",
  component: FeedItem,
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

function SampleFeed() {
  return (
    <section aria-label="Comments and activity" className="flex w-80 flex-col gap-2.5">
      <FeedItem
        avatar={<PersonAvatar name="Maciej Grzywacz" id="u1" />}
        time="2h"
        timeTitle="Oct 16, 2027, 3:00 PM"
      >
        <b>Maciej</b> set the due date to Thu
      </FeedItem>
      <FeedItem avatar={<PersonAvatar name="Sam Okafor" id="u2" />} time="1h">
        <b>Sam</b> added 2 files
      </FeedItem>
      <FeedCard avatar={<PersonAvatar name="Mia Chen" id="u3" />} author="Mia Chen" time="Oct 13">
        <p className="font-sans text-sm leading-relaxed text-foreground">
          The hero needs the new palette before Friday’s review.
        </p>
      </FeedCard>
      <FeedComposer
        actions={
          <>
            <IconButton icon={AtSign} label="Mention someone" />
            <IconButton icon={ArrowUp} label="Comment" disabled />
          </>
        }
      >
        <FeedComposerInput placeholder="Leave a comment…  @ to mention" aria-label="Comment" />
      </FeedComposer>
    </section>
  );
}

/**
 * The history under an item: quiet activity lines, comment cards and the
 * composer. Times sit in the tertiary level and never truncate.
 */
export const Default: Story = {
  render: () => <SampleFeed />,
};

export const Densities: Story = {
  render: () => <AtThreeDensities>{() => <SampleFeed />}</AtThreeDensities>,
};
