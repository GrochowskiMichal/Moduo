import type { Meta, StoryObj } from "@storybook/react";

import { FeaturePanelsShell } from "./feature-panels-shell";

const meta: Meta<typeof FeaturePanelsShell> = {
  title: "Components/app/feature-panels-shell",
  component: FeaturePanelsShell,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};
