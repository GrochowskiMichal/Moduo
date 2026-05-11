import type { Meta, StoryObj } from "@storybook/react";

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "./avatar";

const meta: Meta<typeof Avatar> = {
  title: "Components/ui/avatar",
  component: Avatar,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const FallbackOnly: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar size="sm"><AvatarFallback>EN</AvatarFallback></Avatar>
      <Avatar><AvatarFallback>MJ</AvatarFallback></Avatar>
      <Avatar size="lg"><AvatarFallback>AS</AvatarFallback></Avatar>
    </div>
  ),
};

export const WithImage: Story = {
  render: () => (
    <Avatar>
      <AvatarImage src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=128&h=128&fit=crop" alt="User" />
      <AvatarFallback>U</AvatarFallback>
    </Avatar>
  ),
};

export const WithStatusBadge: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar>
        <AvatarFallback>EN</AvatarFallback>
        <AvatarBadge className="bg-success" />
      </Avatar>
      <Avatar>
        <AvatarFallback>MJ</AvatarFallback>
        <AvatarBadge className="bg-warning" />
      </Avatar>
      <Avatar>
        <AvatarFallback>AS</AvatarFallback>
        <AvatarBadge className="bg-muted-foreground" />
      </Avatar>
    </div>
  ),
};

export const Group: Story = {
  render: () => (
    <AvatarGroup>
      <Avatar><AvatarFallback>EN</AvatarFallback></Avatar>
      <Avatar><AvatarFallback>MJ</AvatarFallback></Avatar>
      <Avatar><AvatarFallback>AS</AvatarFallback></Avatar>
      <AvatarGroupCount>+3</AvatarGroupCount>
    </AvatarGroup>
  ),
};
