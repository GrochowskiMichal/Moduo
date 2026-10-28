// Working hours… (CALR-13, AC45), from the calendars ⋯ menu: the working day's
// start and end, weekends on or off, and the week start. Hours and weekends
// ride the synced `user_preferences.calendar` domain; the week start is Time &
// region's, the one every module reads, so it changes there too. Each change
// applies at once: the wash, the opening scroll and free-time hops follow it.

import { MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Switch } from "../../../components/ui/switch";
import { useReturnFocus } from "../../../hooks/use-return-focus";
import { getRuntime } from "../../../lib/runtime";
import { saveTimeRegion, useSavedTimeRegion } from "../../../lib/time-region";
import type { CalendarPrefs } from "../prefs";

type HoursPatch = Partial<
  Pick<CalendarPrefs, "workStartMinute" | "workEndMinute" | "showWeekends">
>;

const AUTO = "auto";
const WEEK_STARTS = [
  { value: AUTO, label: "Auto" },
  { value: "1", label: "Monday" },
  { value: "0", label: "Sunday" },
  { value: "6", label: "Saturday" },
];

const toClock = (minute: number) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

function fromClock(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const minute = Number(m[1]) * 60 + Number(m[2]);
  return minute >= 0 && minute < 24 * 60 ? minute : null;
}

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: Pick<CalendarPrefs, "workStartMinute" | "workEndMinute" | "showWeekends">;
  onChange: (patch: HoursPatch) => void;
};

export function WorkingHoursSheet({ open, onOpenChange, prefs, onChange }: SheetProps) {
  // Auto follows the device, as in Settings → Time & region.
  const { weekStart } = useSavedTimeRegion();
  const [saving, setSaving] = useState(false);
  const returnFocus = useReturnFocus(open);
  // An end at midnight reads as 24:00 on the input's 00:00.
  const end = prefs.workEndMinute >= 24 * 60 ? 0 : prefs.workEndMinute;

  const setStart = (value: string) => {
    const minute = fromClock(value);
    if (minute !== null && minute < prefs.workEndMinute) onChange({ workStartMinute: minute });
  };
  const setEnd = (value: string) => {
    const raw = fromClock(value);
    const minute = raw === 0 ? 24 * 60 : raw;
    if (minute !== null && minute > prefs.workStartMinute) onChange({ workEndMinute: minute });
  };
  const setWeekStart = (value: string) => {
    const runtime = getRuntime();
    if (!runtime) return;
    setSaving(true);
    saveTimeRegion(runtime.preferences, { weekStart: value === AUTO ? null : Number(value) })
      .catch(() => toast.error("Couldn't change the week start. Try again."))
      .finally(() => setSaving(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" onCloseAutoFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>Working hours</DialogTitle>
          <DialogDescription>
            The week washes the hours outside them, opens at their start, and finds free time inside
            them.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cal-work-start">Starts</Label>
              <Input
                id="cal-work-start"
                type="time"
                step={900}
                aria-label="Working day starts"
                value={toClock(prefs.workStartMinute)}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cal-work-end">Ends</Label>
              <Input
                id="cal-work-end"
                type="time"
                step={900}
                aria-label="Working day ends"
                value={toClock(end)}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="cal-weekends">Show weekends</Label>
            <Switch
              id="cal-weekends"
              aria-label="Show weekends"
              checked={prefs.showWeekends}
              onCheckedChange={(on) => onChange({ showWeekends: on })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-foreground">Week starts on</span>
            <SegmentedControl
              size="sm"
              fullWidth
              aria-label="Week starts on"
              value={weekStart === null ? AUTO : String(weekStart)}
              onValueChange={setWeekStart}
              items={WEEK_STARTS}
              disabled={saving}
            />
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The ⋯ beside the rail's "Calendars": Working hours…. */
export function CalendarsMenu({
  prefs,
  onChange,
}: {
  prefs: SheetProps["prefs"];
  onChange: (patch: HoursPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  // A menu item that opens a dialog opens it once the menu has closed.
  const pending = useRef(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon={MoreHorizontal} label="Calendar settings" size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(e) => {
            if (!pending.current) return;
            pending.current = false;
            e.preventDefault();
            setOpen(true);
          }}
        >
          <DropdownMenuItem onSelect={() => (pending.current = true)}>
            Working hours…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <WorkingHoursSheet open={open} onOpenChange={setOpen} prefs={prefs} onChange={onChange} />
    </>
  );
}
