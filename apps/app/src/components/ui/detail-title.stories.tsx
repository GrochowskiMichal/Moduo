import type { Meta, StoryObj } from "@storybook/react";

import { DetailTitle } from "./detail-title";
import { Eyebrow } from "./eyebrow";
import { Input } from "./input";

const meta: Meta<typeof DetailTitle> = {
  title: "Components/ui/detail-title",
  component: DetailTitle,
  tags: ["autodocs"],
  args: {
    children: "Ship the alpha build",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Rail: Story = {
  render: () => (
    <div className="w-80 space-y-2 rounded-lg border border-border bg-card p-3">
      <Eyebrow>Event</Eyebrow>
      <DetailTitle>Design review with Mike</DetailTitle>
      <p className="text-xs text-muted-foreground">Tomorrow · 14:00–15:00</p>
    </div>
  ),
};

/** A redesigned inspector's title (Tasks detail panel): 18px semibold, wraps. */
export const Lead: Story = {
  render: () => (
    <div className="w-80 rounded-lg border border-border bg-card p-3">
      <DetailTitle size="lead">
        Landing pricing: state clearly that the Free plan is desktop-only
      </DetailTitle>
    </div>
  ),
};

export const Page: Story = {
  render: () => (
    <div className="max-w-2xl space-y-1">
      <DetailTitle size="page">Acme Industries</DetailTitle>
      <p className="text-sm text-muted-foreground">acme.example.com</p>
    </div>
  ),
};

export const Editable: Story = {
  render: () => (
    <div className="w-80">
      <DetailTitle asChild>
        <Input
          aria-label="Task title"
          defaultValue="Ship the alpha build"
          className="border-transparent bg-transparent px-0"
        />
      </DetailTitle>
    </div>
  ),
};
