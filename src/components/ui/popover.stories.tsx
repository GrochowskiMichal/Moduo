import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "./button";
import { Input } from "./input";
import { Label } from "./label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover";

const meta: Meta<typeof Popover> = {
  title: "Components/ui/popover",
  component: Popover,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Dimensions</PopoverTitle>
          <PopoverDescription>
            Set the size used for the print preview.
          </PopoverDescription>
        </PopoverHeader>
        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-3 items-center gap-2">
            <Label htmlFor="width">Width</Label>
            <Input id="width" defaultValue="100%" className="col-span-2" />
          </div>
          <div className="grid grid-cols-3 items-center gap-2">
            <Label htmlFor="height">Height</Label>
            <Input id="height" defaultValue="auto" className="col-span-2" />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  ),
};

export const Compact: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost">Workspace info</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">Moduo HQ</div>
          <div className="text-xs text-muted-foreground">12 members · 4 spaces</div>
        </div>
      </PopoverContent>
    </Popover>
  ),
};
