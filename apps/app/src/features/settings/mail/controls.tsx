// Small shared controls for Settings → Mail (MR-15).

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type Choice = { value: string; label: string };

export function ChoiceSelect({
  value,
  choices,
  onChange,
  label,
  className = "w-44",
}: {
  value: string;
  choices: readonly Choice[];
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((c) => (
          <SelectItem key={c.value} value={c.value}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
