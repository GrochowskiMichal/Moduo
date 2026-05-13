import { RadioGroup, RadioGroupItem } from "../../../components/ui/radio-group";
import { type Radius } from "../../../lib/appearance";

import { AppearancePickerRow } from "./picker-row";

const OPTIONS: ReadonlyArray<{ value: Radius; label: string }> = [
  { value: "sharp", label: "Sharp" },
  { value: "soft", label: "Soft" },
  { value: "round", label: "Round" },
];

type Props = {
  value: Radius;
  onChange: (value: Radius) => void;
};

export function RadiusPicker({ value, onChange }: Props) {
  return (
    <AppearancePickerRow
      title="Corner radius"
      description="How rounded cards, buttons, and dialogs feel."
    >
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as Radius)}
        className="grid grid-cols-3 gap-2"
        aria-label="Corner radius"
      >
        {OPTIONS.map(({ value: optionValue, label }) => {
          const id = `radius-${optionValue}`;
          const checked = optionValue === value;
          return (
            <label
              key={optionValue}
              htmlFor={id}
              data-radius={optionValue}
              className={
                checked
                  ? "flex cursor-pointer flex-col items-center gap-3 rounded-md border border-primary bg-accent px-3 py-3 transition-colors"
                  : "flex cursor-pointer flex-col items-center gap-3 rounded-md border border-border bg-card px-3 py-3 transition-colors hover:bg-accent"
              }
            >
              <span
                aria-hidden
                className="h-9 w-12 rounded-md border border-border bg-muted"
              />
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
