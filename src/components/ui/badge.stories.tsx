import type { Meta, StoryObj } from "@storybook/react";
import { Check } from "lucide-react";

import { Badge } from "./badge";

const meta: Meta<typeof Badge> = {
  title: "Components/ui/badge",
  component: Badge,
  tags: ["autodocs"],
  args: {
    children: "Badge",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="info">Info</Badge>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="success">
        <Check />
        Synced
      </Badge>
      <Badge variant="warning">Offline</Badge>
      <Badge variant="outline">v0.4.0</Badge>
    </div>
  ),
};

export const TagList: Story = {
  render: () => (
    <div className="flex flex-wrap gap-1.5">
      {["design", "tokens", "primitives", "shadcn", "react"].map((t) => (
        <Badge key={t} variant="secondary">
          #{t}
        </Badge>
      ))}
    </div>
  ),
};
