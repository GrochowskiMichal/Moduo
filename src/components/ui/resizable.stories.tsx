import type { Meta, StoryObj } from "@storybook/react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable";

const meta: Meta<typeof ResizablePanelGroup> = {
  title: "Components/ui/resizable",
  component: ResizablePanelGroup,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

function Pane({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export const Default: Story = {
  render: () => (
    <div className="h-[480px] w-full p-4">
      <ResizablePanelGroup direction="horizontal" className="gap-1">
        <ResizablePanel defaultSize="25%" minSize="15%">
          <Pane label="Left rail" />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50%">
          <Pane label="Main" />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="25%" minSize="15%">
          <Pane label="Right rail" />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div className="h-[480px] w-full p-4">
      <ResizablePanelGroup direction="vertical" className="gap-1">
        <ResizablePanel defaultSize="60%">
          <Pane label="Top" />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="40%" minSize="20%">
          <Pane label="Bottom" />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
};
