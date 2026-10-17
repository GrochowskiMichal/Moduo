import { RadioGroup, RadioGroupItem } from "../../../components/ui/radio-group";
import type { Density } from "../../../lib/appearance";

import { AppearancePickerRow } from "./picker-row";

const OPTIONS: ReadonlyArray<{ value: Density; label: string; hint: string }> = [
  { value: "comfortable", label: "Comfortable", hint: "Roomier rows and controls." },
  { value: "compact", label: "Compact", hint: "Tighter rows and controls." },
  { value: "dense", label: "Dense", hint: "Maximum content per screen." },
];

type Props = {
  value: Density;
  onChange: (value: Density) => void;
};

export function DensityPicker({ value, onChange }: Props) {
  return (
    <AppearancePickerRow
      title="Density"
      tag="This device"
      description="Row heights and control sizes. Changes apply across the whole app."
    >
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as Density)}
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        aria-label="Density"
      >
        {OPTIONS.map(({ value: optionValue, label, hint }) => {
          const id = `density-${optionValue}`;
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
