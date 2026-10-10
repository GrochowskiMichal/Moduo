import type { Meta, StoryObj } from "@storybook/react";
import { ListTree, MessageSquare, Paperclip } from "lucide-react";
import { useState } from "react";

import { PersonAvatar } from "./avatar";
import { CompleteToggle } from "./complete-toggle";
import { AtThreeDensities } from "./kit-densities";
import { MetaCount, MetaCounts } from "./meta-count";
import { Row, RowColumn, RowColumns, RowLead, RowMeta, RowTitle } from "./row";

const meta: Meta<typeof Row> = {
  title: "Components/ui/row",
  component: Row,
};

export default meta;
type Story = StoryObj<typeof meta>;

type Sample = {
  id: string;
  title: string;
  date: string;
  who: string | null;
  comments?: number;
  files?: number;
  subtasks?: string;
};

const SAMPLES: Sample[] = [
  { id: "1", title: "Draft the launch announcement", date: "Thu", who: "Alex Rivera", comments: 3 },
  {
    id: "2",
    title: "Hero illustration for the homepage, with the new brand colours",
    date: "Today",
    who: "Sam Okafor",
    files: 2,
  },
  {
    id: "3",
    title: "Set up Stripe webhooks for upgrades",
    date: "Oct 16, 2027",
    who: null,
    subtasks: "1/3",
  },
  { id: "4", title: "Finalize pricing page copy", date: "3:00 PM", who: "Mia Chen" },
];

function SampleRow({
  sample,
  selected,
  done,
  onToggle,
}: {
  sample: Sample;
  selected?: boolean;
  done?: boolean;
  onToggle?: () => void;
}) {
  return (
    <Row selected={selected} done={done} tabIndex={0}>
      <RowLead>
        <CompleteToggle done={!!done} onToggle={onToggle ?? (() => {})} />
      </RowLead>
      <RowTitle>{sample.title}</RowTitle>
      <RowMeta>
        <MetaCounts>
          <MetaCount icon={Paperclip} count={sample.files ?? 0} label="attachments" />
          <MetaCount icon={MessageSquare} count={sample.comments ?? 0} label="comments" />
          {sample.subtasks ? (
            <MetaCount
              icon={ListTree}
              count={3}
              value={sample.subtasks}
              label={() => `${sample.subtasks} subtasks done`}
            />
          ) : null}
        </MetaCounts>
      </RowMeta>
      <RowColumns>
        <RowColumn>{sample.date}</RowColumn>
        <RowColumn width="icon">
          <PersonAvatar name={sample.who} />
        </RowColumn>
      </RowColumns>
    </Row>
  );
}

/**
 * The anatomy and every state: rest, hover (point at one), selected, done
 * (the check stays at full strength), keyboard focus (Tab in). The long title
 * gives way first; the date column never truncates.
 */
export const Default: Story = {
  render: () => {
    const [done, setDone] = useState<Record<string, boolean>>({ "4": true });
    return (
      <div className="flex w-[560px] flex-col gap-px">
        {SAMPLES.map((s) => (
          <SampleRow
            key={s.id}
            sample={s}
            selected={s.id === "2"}
            done={done[s.id]}
            onToggle={() => setDone((d) => ({ ...d, [s.id]: !d[s.id] }))}
          />
        ))}
      </div>
    );
  },
};

/** The drag states: a drop target under the pointer, and the row being dragged. */
export const DragStates: Story = {
  render: () => (
    <div className="flex w-[560px] flex-col gap-px">
      <Row dropTarget>
        <RowLead>
          <CompleteToggle done={false} onToggle={() => {}} />
        </RowLead>
        <RowTitle>Drop here</RowTitle>
      </Row>
      <Row dragging>
        <RowLead>
          <CompleteToggle done={false} onToggle={() => {}} />
        </RowLead>
        <RowTitle>Being dragged</RowTitle>
      </Row>
    </div>
  ),
};

/** Row height follows density: 36 / 32 / 28 px. */
export const Densities: Story = {
  render: () => (
    <AtThreeDensities direction="column">
      <div className="flex w-[560px] flex-col gap-px">
        {SAMPLES.slice(0, 3).map((s) => (
          <SampleRow key={s.id} sample={s} selected={s.id === "2"} />
        ))}
      </div>
    </AtThreeDensities>
  ),
};
