import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Slider } from "./slider";

const meta: Meta<typeof Slider> = {
  title: "Components/ui/slider",
  component: Slider,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({ size }: { size?: "sm" | "default" }) {
  const [value, setValue] = useState(60);
  return (
    <div className="flex w-64 items-center gap-3">
      <Slider
        size={size}
        thumbLabel="Volume"
        value={[value]}
        max={100}
        step={1}
        onValueChange={([v]) => setValue(v)}
      />
      <span className="w-8 text-right text-sm tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}

export const Default: Story = { render: () => <Controlled /> };

export const Small: Story = { render: () => <Controlled size="sm" /> };

export const Disabled: Story = {
  render: () => (
    <div className="w-64">
      <Slider thumbLabel="Volume" defaultValue={[40]} max={100} disabled />
    </div>
  ),
};
