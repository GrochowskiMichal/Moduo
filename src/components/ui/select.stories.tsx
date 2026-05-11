import type { Meta, StoryObj } from "@storybook/react";

import { Label } from "./label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select";

const meta: Meta<typeof Select> = {
  title: "Components/ui/select",
  component: Select,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="grid w-64 gap-2">
      <Label htmlFor="display-font">Display font</Label>
      <Select defaultValue="pilat">
        <SelectTrigger id="display-font" className="w-full">
          <SelectValue placeholder="Pick a font" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Display</SelectLabel>
            <SelectItem value="pilat">Pilat Extended</SelectItem>
            <SelectItem value="geist">Geist</SelectItem>
            <SelectItem value="cal">Cal Sans</SelectItem>
            <SelectItem value="fraunces">Fraunces</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const WithSeparator: Story = {
  render: () => (
    <Select defaultValue="me">
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Assignee" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>People</SelectLabel>
          <SelectItem value="me">Me</SelectItem>
          <SelectItem value="alex">Alex</SelectItem>
          <SelectItem value="sam">Sam</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Other</SelectLabel>
          <SelectItem value="unassigned">Unassigned</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

export const Small: Story = {
  render: () => (
    <Select defaultValue="comfortable">
      <SelectTrigger size="sm" className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="comfortable">Comfortable</SelectItem>
        <SelectItem value="compact">Compact</SelectItem>
      </SelectContent>
    </Select>
  ),
};
