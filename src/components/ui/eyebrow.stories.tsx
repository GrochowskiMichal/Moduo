import type { Meta, StoryObj } from "@storybook/react";

import { Eyebrow } from "./eyebrow";

const meta: Meta<typeof Eyebrow> = {
  title: "Components/ui/eyebrow",
  component: Eyebrow,
  tags: ["autodocs"],
  args: {
    children: "Linked",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Eyebrow>Activity</Eyebrow>
      <Eyebrow tone="muted">Buckets</Eyebrow>
      <div className="text-primary">
        <Eyebrow tone="inherit">Selected row</Eyebrow>
      </div>
    </div>
  ),
};

export const InASection: Story = {
  render: () => (
    <div className="w-64 space-y-1 rounded-lg border border-border bg-card p-3">
      <Eyebrow as="h3">Emails</Eyebrow>
      <p className="text-sm text-muted-foreground">Three linked threads.</p>
    </div>
  ),
};

export const AsAGroupHeader: Story = {
  render: () => (
    <div className="w-56 space-y-2">
      <Eyebrow as="div" className="px-1">
        Calendars
      </Eyebrow>
      <Eyebrow as="div" tone="muted" className="px-1">
        work@example.com
      </Eyebrow>
    </div>
  ),
};
