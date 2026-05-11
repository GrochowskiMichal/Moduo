import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "./button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";

const meta: Meta<typeof Sheet> = {
  title: "Components/ui/sheet",
  component: Sheet,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

function ExampleBody() {
  return (
    <div className="flex-1 space-y-3 px-4 text-sm text-foreground">
      <p>
        Right-anchored side drawer used by the notification center and the
        collapsed-rail expansion in the responsive shell.
      </p>
      <p className="text-muted-foreground">
        Scrollable region. Esc closes; focus returns to the trigger.
      </p>
    </div>
  );
}

export const RightSide: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open right sheet</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>
            Recent activity across your workspaces.
          </SheetDescription>
        </SheetHeader>
        <ExampleBody />
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="ghost">Mark all read</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

export const LeftSide: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open left sheet</Button>
      </SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Workspace</SheetTitle>
          <SheetDescription>Quick switcher and recents.</SheetDescription>
        </SheetHeader>
        <ExampleBody />
      </SheetContent>
    </Sheet>
  ),
};

export const BottomSide: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open bottom sheet</Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Shortcuts</SheetTitle>
          <SheetDescription>Press ⌘K to open the palette.</SheetDescription>
        </SheetHeader>
        <ExampleBody />
      </SheetContent>
    </Sheet>
  ),
};
