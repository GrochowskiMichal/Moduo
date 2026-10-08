import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { DateField } from "./date-field";

const meta: Meta<typeof DateField> = {
  title: "Components/ui/date-field",
  component: DateField,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const DateOnly: Story = {
  render: () => {
    const [value, setValue] = useState<Date | null>(null);
    return <DateField value={value} onChange={setValue} placeholder="Due date" />;
  },
};

export const WithTime: Story = {
  render: () => {
    const [value, setValue] = useState<Date | null>(null);
    return <DateField value={value} onChange={setValue} withTime placeholder="Scheduled" />;
  },
};

export const Outline: Story = {
  render: () => {
    const [value, setValue] = useState<Date | null>(new Date());
    return <DateField value={value} onChange={setValue} variant="outline" />;
  },
};

/** As a detail-panel property value: icon slot, no box, muted placeholder. */
export const Property: Story = {
  render: () => {
    const [value, setValue] = useState<Date | null>(null);
    return (
      <DateField
        value={value}
        onChange={setValue}
        variant="property"
        placeholder="Set date"
        aria-label="Due"
      />
    );
  },
};
