import type { Meta, StoryObj } from "@storybook/react";
import { Search } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { DisplayMenu } from "../../../components/ui/display-menu";
import { FilterButton } from "../../../components/ui/filter-bar";
import { PlanViewHeader } from "./plan-view-header";

// The List / Board / Timeline toolbar at three widths (MOD-95 follow-up): the
// title keeps about ten characters with its count (no ⋯ since MOD-150); under 36rem Filter
// and Display become icons; narrower still, the controls wrap under the title.

function Header({ title }: { title: string }) {
  return (
    <PlanViewHeader
      title={title}
      view="list"
      onViewChange={() => {}}
      canEdit
      onRequestCapture={() => {}}
      controls={{
        count: 12,
        project: { onOpenDetails: () => {} },
        search: (
          <Button variant="ghost" size="sm" aria-label="Search" className="aspect-square px-0">
            <Search aria-hidden />
          </Button>
        ),
        filter: <FilterButton dimensions={[]} value={[]} onValueChange={() => {}} shortcut="F" />,
        display: <DisplayMenu controls={[]} value={{}} onValueChange={() => {}} />,
      }}
    />
  );
}

const meta = {
  title: "Tasks/PlanViewHeader",
  component: Header,
  args: { title: "Website relaunch for the spring campaign" },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Room for every word: Filter and Display keep their labels. */
export const Wide: Story = {
  render: (args) => (
    <div className="w-180">
      <Header {...args} />
    </div>
  ),
};

/** Under 36rem: Filter and Display are icons (named, with tooltips). */
export const Narrow: Story = {
  render: (args) => (
    <div className="w-128">
      <Header {...args} />
    </div>
  ),
};

/** The center pane at a 1024 px window with both side panels open (about 400 px). */
export const Squeezed: Story = {
  render: (args) => (
    <div className="w-96">
      <Header {...args} />
    </div>
  ),
};
