import type { Meta, StoryObj } from "@storybook/react";
import { CalendarDays, CircleDot, FileText, Flag, Hash, User } from "lucide-react";
import { useState } from "react";

import { Chip, ChipButton, PickerPill } from "./chip";
import { DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "./dropdown-menu";
import { AtThreeDensities } from "./kit-densities";

const meta: Meta<typeof Chip> = {
  title: "Components/ui/chip",
  component: Chip,
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * One chip for every use (call 45). At rest a hairline ring; set or active,
 * the neutral fill. `sm` sits on the control rung, `xs` inline with text.
 */
export const Default: Story = {
  render: () => {
    const [on, setOn] = useState(true);
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip icon={FileText}>Launch brief</Chip>
          <Chip icon={Hash} shape="full">
            design
          </Chip>
          <Chip icon={User} active onRemove={() => {}} removeLabel="Remove Anna">
            Anna
          </Chip>
          <ChipButton icon={CircleDot} active={on} onClick={() => setOn((v) => !v)}>
            In progress
          </ChipButton>
        </div>
        <p className="max-w-md font-sans text-sm text-foreground">
          Waiting on{" "}
          <Chip size="xs" icon={User}>
            Anna Kowalska
          </Chip>{" "}
          since{" "}
          <Chip size="xs" icon={CalendarDays}>
            Oct 16
          </Chip>
        </p>
      </div>
    );
  },
};

export const Densities: Story = {
  render: () => (
    <AtThreeDensities>
      <div className="flex flex-wrap items-center gap-2">
        <Chip icon={FileText}>Launch brief</Chip>
        <Chip icon={User} active onRemove={() => {}}>
          Anna
        </Chip>
        <Chip size="xs" icon={CalendarDays}>
          Oct 16
        </Chip>
      </div>
    </AtThreeDensities>
  ),
};

function PriorityPill() {
  const [priority, setPriority] = useState<string | null>(null);
  return (
    <PickerPill
      icon={Flag}
      label="Priority"
      value={priority}
      content={
        <>
          <DropdownMenuRadioGroup value={priority ?? ""} onValueChange={setPriority}>
            {["Urgent", "High", "Medium", "Low"].map((p) => (
              <DropdownMenuRadioItem key={p} value={p}>
                {p}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuItem onSelect={() => setPriority(null)}>No priority</DropdownMenuItem>
        </>
      }
    />
  );
}

/**
 * Picker pill: a chip that opens a picker. Unset shows the field's name,
 * muted, on the hairline; set shows the value on the fill (one rule: fill,
 * not border).
 */
export const PickerPills: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <PickerPill icon={CalendarDays} label="Due" value="Oct 16" content={<div />} />
      <PickerPill icon={User} label="Assignee" value={null} content={<div />} />
      <PriorityPill />
    </div>
  ),
};

export const PickerPillDensities: Story = {
  render: () => (
    <AtThreeDensities>
      <div className="flex flex-wrap items-center gap-2">
        <PickerPill icon={CalendarDays} label="Due" value="Oct 16" content={<div />} />
        <PickerPill icon={User} label="Assignee" value={null} content={<div />} />
      </div>
    </AtThreeDensities>
  ),
};
