import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { DateField, TimeInput } from "./date-field";
import { AtThreeDensities } from "./kit-densities";

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

/**
 * The token time field that replaced the native `<input type="time">`: it
 * shows "3:00 PM", takes "15:00", "3pm" or "1530", commits on Enter or blur,
 * reverts anything that isn't a time, and ↑ / ↓ move it by 15 minutes.
 */
export const Time: Story = {
  render: () => {
    const [value, setValue] = useState("15:00");
    return (
      <div className="flex items-center gap-3">
        <TimeInput value={value} onValueChange={setValue} aria-label="Time" />
        <span className="font-sans text-xs text-muted-foreground tabular-nums">{value}</span>
      </div>
    );
  },
};

function DateFieldSample() {
  const [due, setDue] = useState<Date | null>(new Date(2027, 9, 16));
  const [time, setTime] = useState("15:00");
  return (
    <div className="flex flex-col items-start gap-2">
      <DateField value={due} onChange={setDue} />
      <DateField value={null} onChange={() => {}} placeholder="Set date" variant="outline" />
      <TimeInput value={time} onValueChange={setTime} aria-label="Time" />
    </div>
  );
}

/** Triggers and the time field at the three density steps. */
export const Densities: Story = {
  render: () => <AtThreeDensities>{() => <DateFieldSample />}</AtThreeDensities>,
};
