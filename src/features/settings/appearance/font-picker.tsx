import { RadioGroup, RadioGroupItem } from "../../../components/ui/radio-group";
import { type Font } from "../../../lib/appearance";

import { AppearancePickerRow } from "./picker-row";

const OPTIONS: ReadonlyArray<{ value: Font; label: string }> = [
  { value: "geist", label: "Geist" },
  { value: "inter", label: "Inter" },
  { value: "pilat", label: "Pilat" },
  { value: "cal", label: "Cal Sans" },
  { value: "fraunces", label: "Fraunces" },
  { value: "serif", label: "Source Serif" },
  { value: "mono", label: "Geist Mono" },
];

type Props = {
  value: Font;
  onChange: (value: Font) => void;
};

export function FontPicker({ value, onChange }: Props) {
  return (
    <AppearancePickerRow
      title="Font"
      description="One typeface for the whole app. Hierarchy comes from weight and size, not a second face."
    >
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as Font)}
        className="grid grid-cols-3 gap-2"
        aria-label="Font"
      >
        {OPTIONS.map(({ value: optionValue, label }) => {
          const id = `font-${optionValue}`;
          const checked = optionValue === value;
          return (
            <label
              key={optionValue}
              htmlFor={id}
              data-font={optionValue}
              className={
                checked
                  ? "flex cursor-pointer flex-col items-center gap-2 rounded-md border border-primary bg-accent px-3 py-3 transition-colors"
                  : "flex cursor-pointer flex-col items-center gap-2 rounded-md border border-border bg-card px-3 py-3 transition-colors hover:bg-accent"
              }
            >
              <span aria-hidden className="font-sans text-2xl leading-none text-foreground">
                Ag
              </span>
              <span className="flex items-center gap-2 text-sm text-foreground">
                <RadioGroupItem id={id} value={optionValue} />
                {label}
              </span>
            </label>
          );
        })}
      </RadioGroup>
    </AppearancePickerRow>
  );
}
