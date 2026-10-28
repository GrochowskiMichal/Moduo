// "New events go to" (specs/calendar-rethink.md, Assumptions "New events go to"):
// Your calendar · Moduo or one writable Google calendar, in Calendar accounts
// and Settings › Integrations. Says so when the chosen one fell back.

import { useId } from "react";

import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { type NewEventsCalendar, type NewEventsTo, YOUR_CALENDAR_LABEL } from "../new-events-to";

const YOURS = "moduo";

/** The picked option as the setting stores it: Your calendar is no account. */
export function accountIdFromOption(value: string): string | null {
  return value === YOURS ? null : value;
}

export function NewEventsToField({
  calendars,
  to,
  onChange,
}: {
  calendars: NewEventsCalendar[];
  to: NewEventsTo;
  onChange: (accountId: string | null) => void;
}) {
  const labelId = useId();
  if (calendars.length === 0) {
    return <p className="text-xs text-muted-foreground">New events go to {YOUR_CALENDAR_LABEL}</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label id={labelId} className="text-xs text-muted-foreground">
          New events go to
        </Label>
        <Select
          value={to.accountId ?? YOURS}
          onValueChange={(value) => onChange(accountIdFromOption(value))}
        >
          <SelectTrigger size="sm" aria-labelledby={labelId}>
            <SelectValue>{to.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={YOURS}>{YOUR_CALENDAR_LABEL}</SelectItem>
            {calendars.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {to.fallback ? <p className="text-xs text-muted-foreground">{to.fallback}</p> : null}
    </div>
  );
}
