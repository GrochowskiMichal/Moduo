import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { CompleteToggle } from "./complete-toggle";

const meta: Meta<typeof CompleteToggle> = {
  title: "Components/ui/complete-toggle",
  component: CompleteToggle,
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Toggle me — the check springs in (the one sanctioned delight moment). */
export const Default: Story = {
  render: () => {
    const [done, setDone] = useState(false);
    return <CompleteToggle done={done} onToggle={() => setDone((d) => !d)} />;
  },
};

export const Done: Story = {
  args: { done: true, onToggle: () => {} },
};

export const Disabled: Story = {
  args: { done: false, disabled: true, onToggle: () => {} },
};
