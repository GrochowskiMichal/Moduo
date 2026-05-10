import type { Meta, StoryObj } from "@storybook/react";

import { PlanCalendarView } from "./calendar-view";

const meta: Meta<typeof PlanCalendarView> = {
  title: "features/plan/ui/calendar-view",
  component: PlanCalendarView,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};
