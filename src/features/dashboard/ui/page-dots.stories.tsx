import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";

import { PageDots } from "./page-dots";

// DB-4 page indicator (AC5). Dots are keyboard-reachable buttons; edit mode adds
// the add / remove-page affordances. Visual capture is a deliberate human run.

const meta: Meta<typeof PageDots> = {
  title: "Features/dashboard/page-dots",
  component: PageDots,
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="flex justify-center p-6">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Three pages, second active — normal mode (dots only). */
export const ThreePages: Story = {
  render: () => {
    const [active, setActive] = useState(1);
    return <PageDots count={3} activeIndex={active} onSelect={setActive} />;
  },
};

/** Edit mode — dots plus add / remove-page controls. */
export const Editing: Story = {
  render: () => {
    const [active, setActive] = useState(0);
    return (
      <PageDots
        count={2}
        activeIndex={active}
        onSelect={setActive}
        editing
        onAddPage={() => {}}
        onRemovePage={() => {}}
      />
    );
  },
};

/** A single page in edit mode — dots still render so a page can be added; remove is disabled. */
export const SinglePageEditing: Story = {
  render: () => (
    <PageDots count={1} activeIndex={0} onSelect={() => {}} editing onAddPage={() => {}} onRemovePage={() => {}} />
  ),
};
