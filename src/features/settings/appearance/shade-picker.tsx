import { Check } from "lucide-react";

import type { Shade } from "../../../lib/appearance";

import { AppearancePickerRow } from "./picker-row";

const SHADE_OPTIONS: ReadonlyArray<{ value: Shade; label: string }> = [
  { value: "black", label: "Black" },
  { value: "warm", label: "Warm" },
  { value: "cool", label: "Cool" },
  { value: "slate", label: "Slate" },
  { value: "plum", label: "Plum" },
  { value: "forest", label: "Forest" },
];

type Props = {
  value: Shade;
  onChange: (value: Shade) => void;
};

export function ShadePicker({ value, onChange }: Props) {
  return (
    <AppearancePickerRow
      title="Shade"
      description="Surface tint for the dark theme. Black is the classic pure-black look; tinted shades re-color every panel and border."
    >
      <div
        role="radiogroup"
        aria-label="Surface shade"
        className="grid grid-cols-3 gap-3 sm:grid-cols-6"
      >
        {SHADE_OPTIONS.map(({ value: shade, label }) => {
          const checked = shade === value;
          return (
            <button
              key={shade}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={label}
              data-shade={shade}
              onClick={() => onChange(shade)}
              className={
                checked
                  ? "group relative grid h-10 w-10 place-items-center rounded-full border border-foreground/30 bg-popover text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                  : "group relative grid h-10 w-10 place-items-center rounded-full border border-border bg-popover text-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
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
