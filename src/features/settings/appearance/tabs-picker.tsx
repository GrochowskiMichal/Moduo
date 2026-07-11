import { RadioGroup, RadioGroupItem } from "../../../components/ui/radio-group";
import { type Tabs } from "../../../lib/appearance";

import { AppearancePickerRow } from "./picker-row";

const OPTIONS: ReadonlyArray<{ value: Tabs; label: string; hint: string }> = [
  {
    value: "auto",
    label: "Labels visible",
    hint: "Every module shows its name. Scrolls horizontally when narrow.",
  },
  {
    value: "icons",
    label: "Icons only",
    hint: "Only the active module's label is shown. Icons reveal names on hover.",
  },
];

type Props = {
  value: Tabs;
  onChange: (value: Tabs) => void;
};

export function TabsPicker({ value, onChange }: Props) {
  return (
    <AppearancePickerRow
      title="Module navigation"
      tag="This device"
      description="Compact the top-bar module list down to icons for less horizontal scrolling."
    >
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as Tabs)}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        aria-label="Module navigation"
      >
        {OPTIONS.map(({ value: optionValue, label, hint }) => {
          const id = `tabs-${optionValue}`;
          const checked = optionValue === value;
          return (
            <label
              key={optionValue}
              htmlFor={id}
              className={
                checked
                  ? "flex cursor-pointer items-start gap-3 rounded-md border border-foreground/30 bg-accent px-3 py-3 transition-colors duration-(--motion-fade) ease-(--ease-out)"
                  : "flex cursor-pointer items-start gap-3 rounded-md border border-border bg-card px-3 py-3 transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-accent/60"
              }
            >
              <RadioGroupItem id={id} value={optionValue} className="mt-0.5" />
              <span className="flex flex-col">
                <span className="text-sm text-foreground">{label}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          );
        })}
      </RadioGroup>
    </AppearancePickerRow>
  );
}
