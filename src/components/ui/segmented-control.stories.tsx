import type { Meta, StoryObj } from "@storybook/react";
import { Columns3, List } from "lucide-react";
import { useState } from "react";

import { SegmentedControl } from "./segmented-control";

const meta: Meta<typeof SegmentedControl> = {
  title: "Components/ui/segmented-control",
  component: SegmentedControl,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState("plan");
    return (
      <SegmentedControl
        aria-label="Mode"
        value={value}
        onValueChange={setValue}
        items={[
          { value: "plan", label: "Plan" },
          { value: "queue", label: "Queue" },
        ]}
      />
    );
  },
};

export const IconOnly: Story = {
  render: () => {
    const [value, setValue] = useState("list");
    return (
      <SegmentedControl
        aria-label="View"
        iconOnly
        value={value}
        onValueChange={setValue}
        items={[
          { value: "list", icon: List, ariaLabel: "List view" },
          { value: "board", icon: Columns3, ariaLabel: "Board view" },
        ]}
      />
    );
  },
};

export const Small: Story = {
  render: () => {
    const [value, setValue] = useState("list");
    return (
      <SegmentedControl
        aria-label="View"
        size="sm"
        value={value}
        onValueChange={setValue}
        items={[
          { value: "list", label: "List", icon: List },
          { value: "board", label: "Board", icon: Columns3 },
        ]}
      />
    );
  },
};
