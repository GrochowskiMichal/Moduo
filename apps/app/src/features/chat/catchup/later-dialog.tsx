// Later / Remind me (specs/chat-v2.md §9, #33): in 1 hour · this evening ·
// tomorrow · pick a time, in the person's zone (Time & region). One dialog for
// Catch up's H, a message's ⋯ "Remind me…" and `/remind` in the composer;
// like the Inbox's Snooze (tasks-v3), its choices are buttons, the first
// focused.

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTimeRegion } from "@/lib/time-region";
import {
  LATER_HORIZON_MS,
  laterChoices,
  laterHint,
  laterRefusal,
  localValue,
  pickedInstant,
} from "./later-times";

export function LaterDialog({
  open,
  title,
  description,
  onPick,
  onClose,
}: {
  open: boolean;
  /** "Later", "Remind me about this message", "Remind me about Acme". */
  title: string;
  description: string;
  /** The instant chosen (ISO). */
  onPick: (at: string) => void;
  onClose: () => void;
}) {
  const region = useTimeRegion();
  const zone = region.timeZone;
  const [picking, setPicking] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The times are taken when it opens (a dialog left open doesn't drift).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    setPicking(false);
    setError(null);
  }, [open]);
  const choices = useMemo(() => laterChoices(now, zone), [now, zone]);

  const pickAt = () => {
    const at = pickedInstant(value, zone);
    const why = laterRefusal(at, new Date());
    if (why || !at) {
      setError(why);
      return;
    }
    onPick(at.toISOString());
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-sm" data-slot="later-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {picking ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              pickAt();
            }}
          >
            <Input
              autoFocus
              type="datetime-local"
              aria-label="Date and time"
              value={value}
              min={localValue(now, zone)}
              max={localValue(new Date(now.getTime() + LATER_HORIZON_MS), zone)}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
            />
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicking(false)}>
                Back
              </Button>
              <Button type="submit" size="sm">
                Remind me
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid gap-1">
            {choices.map((c, i) => (
              <Button
                key={c.id}
                autoFocus={i === 0}
                variant="ghost"
                className="justify-between"
                onClick={() => onPick(c.at.toISOString())}
              >
                {c.label}
                <span className="text-xs text-muted-foreground">
                  {laterHint(c.at, now, zone, region.hour12)}
                </span>
              </Button>
            ))}
            <Button
              variant="ghost"
              className="justify-start"
              onClick={() => {
                setValue(localValue(choices[0]?.at ?? now, zone));
                setPicking(true);
              }}
            >
              Pick a time…
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
