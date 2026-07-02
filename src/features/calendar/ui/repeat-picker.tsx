// The repeat control for native events (DESIGN_BRIEF §7c): presets + a
// "Custom" natural-language input with a live plain-English echo — the echo
// is the consent gesture; nothing saves until it reads right. Un-parseable →
// the polite inline fallback, never a silent wrong guess.

import { useMemo, useState } from "react";
import { Repeat } from "lucide-react";
import { RRule } from "rrule";

import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { cn } from "@/lib/utils";
import { parseRecurrenceNL } from "../recurrence-nl";

const PRESETS: Array<{ label: string; rrule: string }> = [
  { label: "Daily", rrule: "FREQ=DAILY" },
  { label: "Weekdays", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  { label: "Weekly", rrule: "FREQ=WEEKLY" },
  { label: "Monthly", rrule: "FREQ=MONTHLY" },
];

/** Short human summary of an rrule body ("weekly on Tue, Thu"). */
export function rruleSummary(rrule: string | null): string {
  if (!rrule) return "Doesn't repeat";
  try {
    return RRule.fromString(rrule).toText();
  } catch {
    return "Repeats";
  }
}

type Props = {
  value: string | null;
  disabled?: boolean;
  /** timeOfDay arrives when the NL phrase carried one ("…at 9"). */
  onChange: (rrule: string | null, timeOfDay?: { hour: number; minute: number }) => void;
  className?: string;
};

export function RepeatPicker({ value, disabled = false, onChange, className }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  const parsed = useMemo(
    () => (customText.trim() ? parseRecurrenceNL(customText) : null),
    [customText],
  );

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button variant="outline" size="sm" className="justify-start gap-1.5">
            <Repeat aria-hidden />
            <span className="min-w-0 truncate">{rruleSummary(value)}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <DropdownMenuItem
            onSelect={() => {
              setCustomOpen(false);
              onChange(null);
            }}
          >
            Doesn't repeat
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {PRESETS.map((p) => (
            <DropdownMenuItem
              key={p.rrule}
              onSelect={() => {
                setCustomOpen(false);
                onChange(p.rrule);
              }}
            >
              {p.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCustomOpen(true)}>Custom…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {customOpen ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="every tuesday and thursday at 9"
              className="h-auto flex-1 text-sm"
              style={{ height: "var(--ctrl-h-sm)" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && parsed) {
                  e.preventDefault();
                  onChange(parsed.rrule, parsed.timeOfDay ?? undefined);
                  setCustomOpen(false);
                  setCustomText("");
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setCustomOpen(false);
                }
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!parsed}
              onClick={() => {
                if (!parsed) return;
                onChange(parsed.rrule, parsed.timeOfDay ?? undefined);
                setCustomOpen(false);
                setCustomText("");
              }}
            >
              Set
            </Button>
          </div>
          <span className="px-1 text-2xs text-muted-foreground" aria-live="polite">
            {customText.trim() === ""
              ? "Plain English — the echo below is what saves."
              : parsed
                ? `→ ${parsed.echo}`
                : "Couldn't read that — try “every tuesday at 9” or pick a preset."}
          </span>
        </div>
      ) : null}
    </div>
  );
}
