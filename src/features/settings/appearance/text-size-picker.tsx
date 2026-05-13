import { RadioGroup, RadioGroupItem } from "../../../components/ui/radio-group";
import { type TextSize } from "../../../lib/appearance";

import { AppearancePickerRow } from "./picker-row";

const OPTIONS: ReadonlyArray<{ value: TextSize; label: string; sample: string }> = [
  { value: "small", label: "Small", sample: "Aa" },
  { value: "normal", label: "Normal", sample: "Aa" },
  { value: "large", label: "Large", sample: "Aa" },
];

const SAMPLE_CLASS: Record<TextSize, string> = {
  small: "text-xs",
  normal: "text-sm",
  large: "text-base",
};

type Props = {
  value: TextSize;
  onChange: (value: TextSize) => void;
};

export function TextSizePicker({ value, onChange }: Props) {
  return (
    <AppearancePickerRow
      title="Body text size"
      description="Affects body text and most UI labels. Page titles stay fixed."
    >
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as TextSize)}
        className="grid grid-cols-3 gap-2"
        aria-label="Body text size"
      >
        {OPTIONS.map(({ value: optionValue, label, sample }) => {
          const id = `text-size-${optionValue}`;
          const checked = optionValue === value;
          return (
            <label
              key={optionValue}
              htmlFor={id}
              className={
                checked
                  ? "flex cursor-pointer items-center justify-between gap-3 rounded-md border border-primary bg-accent px-3 py-2 transition-colors"
                  : "flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 transition-colors hover:bg-accent"
              }
            >
              <span className="flex items-center gap-2">
                <RadioGroupItem id={id} value={optionValue} />
                <span className="text-sm text-foreground">{label}</span>
              </span>
              <span
                aria-hidden
                className={`text-muted-foreground ${SAMPLE_CLASS[optionValue]}`}
              >
                {sample}
              </span>
            </label>
          );
        })}
      </RadioGroup>
    </AppearancePickerRow>
  );
}
