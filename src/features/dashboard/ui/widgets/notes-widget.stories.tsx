import type { Meta, StoryObj } from "@storybook/react";

import { NotesWidget } from "./notes-widget";

const meta: Meta<typeof NotesWidget> = {
  title: "features/dashboard/ui/widgets/notes-widget",
  component: NotesWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};
