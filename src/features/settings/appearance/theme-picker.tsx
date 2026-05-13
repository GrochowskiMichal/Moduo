import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

import { RadioGroup, RadioGroupItem } from "../../../components/ui/radio-group";
import { type Theme } from "../../../lib/appearance";

import { AppearancePickerRow } from "./picker-row";

type ThemeChoice = Theme | "system";

type Option = {
  value: ThemeChoice;
  label: string;
  icon: LucideIcon;
};

const OPTIONS: Option[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
];

type Props = {
  value: Theme;
  onChange: (value: Theme) => void;
};

function resolveSystemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemePicker({ value, onChange }: Props) {
  const handleChange = (next: string) => {
    if (next === "system") {
      onChange(resolveSystemTheme());
      return;
    }
    if (next === "dark" || next === "light") {
      onChange(next);
    }
  };

  return (
    <AppearancePickerRow
      title="Theme"
      description="Surface colors and contrast. Light mode is structurally supported; visual polish is in progress."
    >
      <RadioGroup
        value={value}
        onValueChange={handleChange}
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        aria-label="Theme"
      >
        {OPTIONS.map(({ value: optionValue, label, icon: Icon }) => {
          const id = `theme-${optionValue}`;
          const checked = optionValue === value;
          return (
            <label
              key={optionValue}
              htmlFor={id}
              className={
                checked
                  ? "flex cursor-pointer items-center gap-3 rounded-md border border-primary bg-accent px-3 py-2 transition-colors"
                  : "flex cursor-pointer items-center gap-3 rounded-md border border-border bg-card px-3 py-2 transition-colors hover:bg-accent"
              }
            >
              <RadioGroupItem id={id} value={optionValue} />
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              <span className="text-sm text-foreground">{label}</span>
            </label>
          );
        })}
      </RadioGroup>
    </AppearancePickerRow>
  );
}
