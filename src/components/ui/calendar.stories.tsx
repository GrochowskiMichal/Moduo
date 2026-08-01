import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Calendar } from "./calendar";

// Render-only story; the generic is loosened because DayPicker's discriminated
// props would otherwise force an `args` entry on a demo that takes none.
const meta: Meta = {
  title: "Components/ui/calendar",
};

export default meta;

export const Default: StoryObj = {
  render: () => {
    const [selected, setSelected] = useState<Date | undefined>(new Date());
    return (
      <div className="w-fit rounded-lg border border-border bg-popover">
        <Calendar mode="single" selected={selected} onSelect={setSelected} />
      </div>
    );
  },
};
