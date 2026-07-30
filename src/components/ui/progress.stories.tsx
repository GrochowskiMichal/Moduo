import type { Meta, StoryObj } from "@storybook/react";

import { Progress } from "./progress";

const meta: Meta<typeof Progress> = {
  title: "Components/ui/progress",
  component: Progress,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Determinate: Story = {
  render: () => (
    <div className="w-80 space-y-4">
      {[0, 25, 60, 100].map((value) => (
        <div key={value} className="space-y-1">
          <Progress value={value} max={100} label={`${value} percent complete`} />
          <p className="text-xs text-muted-foreground">{value}%</p>
        </div>
      ))}
    </div>
  ),
};

export const InContext: Story = {
  name: "In context (notes import)",
  render: () => (
    <div className="w-80 space-y-1">
      <Progress value={142} max={350} label="Importing 350 notes" />
      <p className="text-xs text-muted-foreground">Imported 142 of 350…</p>
    </div>
  ),
};

export const EdgeCases: Story = {
  render: () => (
    <div className="w-80 space-y-4">
      <div className="space-y-1">
        <Progress value={0} max={0} label="Nothing to do" />
        <p className="text-xs text-muted-foreground">max = 0 — empty, never NaN</p>
      </div>
      <div className="space-y-1">
        <Progress value={500} max={100} label="Over-reported progress" />
        <p className="text-xs text-muted-foreground">value &gt; max — clamped to full</p>
      </div>
      <div className="space-y-1">
        <Progress value={-10} max={100} label="Negative progress" />
        <p className="text-xs text-muted-foreground">value &lt; 0 — clamped to empty</p>
      </div>
    </div>
  ),
};
