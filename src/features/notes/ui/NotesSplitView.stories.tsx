import type { Meta, StoryObj } from "@storybook/react";

import { NotesSplitView } from "./NotesSplitView";

const meta: Meta<typeof NotesSplitView> = {
  title: "features/notes/ui/NotesSplitView",
  component: NotesSplitView,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};
