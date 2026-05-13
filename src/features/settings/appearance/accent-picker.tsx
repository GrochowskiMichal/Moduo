import { Check } from "lucide-react";

import { type Accent } from "../../../lib/appearance";

import { AppearancePickerRow } from "./picker-row";

const ACCENT_OPTIONS: ReadonlyArray<{ value: Accent; label: string }> = [
  { value: "pink", label: "Pink" },
  { value: "violet", label: "Violet" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "amber", label: "Amber" },
  { value: "red", label: "Red" },
  { value: "teal", label: "Teal" },
  { value: "mono", label: "Mono" },
];

type Props = {
  value: Accent;
  onChange: (value: Accent) => void;
};

export function AccentPicker({ value, onChange }: Props) {
  return (
    <AppearancePickerRow
      title="Accent"
      description="Primary color for buttons, focus rings, and key interactions."
    >
      <div
        role="radiogroup"
        aria-label="Accent color"
        className="grid grid-cols-4 gap-3 sm:grid-cols-8"
      >
        {ACCENT_OPTIONS.map(({ value: accent, label }) => {
          const checked = accent === value;
          return (
            <button
              key={accent}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={label}
              data-accent={accent}
              onClick={() => onChange(accent)}
              className={
                checked
                  ? "group relative grid h-10 w-10 place-items-center rounded-full border border-foreground/30 bg-primary text-primary-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                  : "group relative grid h-10 w-10 place-items-center rounded-full border border-border bg-primary text-primary-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              }
            >
              {checked ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <span className="sr-only">{label}</span>
              )}
            </button>
          );
        })}
      </div>
    </AppearancePickerRow>
  );
}
