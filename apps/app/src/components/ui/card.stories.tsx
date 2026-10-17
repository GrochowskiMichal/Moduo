import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "./button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

const meta: Meta<typeof Card> = {
  title: "Components/ui/card",
  component: Card,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Weekly review</CardTitle>
        <CardDescription>3 notes pending review</CardDescription>
      </CardHeader>
      <CardContent>
        You have unreviewed notes from this week. Knock them out before Friday.
      </CardContent>
      <CardFooter>
        <Button size="sm">Start review</Button>
        <Button size="sm" variant="ghost">
          Dismiss
        </Button>
      </CardFooter>
    </Card>
  ),
};

export const WithAction: Story = {
  render: () => (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Project Atlas</CardTitle>
        <CardDescription>Shared with 4 people</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline">
            Open
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>Notes, threads, and meeting prep across the Atlas team.</CardContent>
    </Card>
  ),
};

export const Grid: Story = {
  render: () => (
    <div className="grid w-[640px] grid-cols-2 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <CardTitle>Card {i + 1}</CardTitle>
            <CardDescription>Compact card variant</CardDescription>
          </CardHeader>
          <CardContent>Body content goes here.</CardContent>
        </Card>
      ))}
    </div>
  ),
};
