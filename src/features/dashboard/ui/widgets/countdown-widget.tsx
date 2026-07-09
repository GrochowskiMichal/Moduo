// DB-6 — "Countdown" widget (S). Counts down to a target date/time. Configured
// inline (no popover until DB-8) and persisted via updateConfig; ticks at 250ms.

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { WidgetComponentProps } from "../../registry/types";
import { computeCountdown, parseLocalDateTime, toDateTimeLocalValue } from "../../countdown";

function str(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  return typeof v === "string" ? v : "";
}

function SetupForm({
  initialTitle,
  initialIso,
  onSave,
}: {
  initialTitle: string;
  initialIso: string;
  onSave: (title: string, iso: string) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [when, setWhen] = useState(() => toDateTimeLocalValue(initialIso));

  const save = () => {
    const ms = parseLocalDateTime(when);
    if (ms == null) return;
    onSave(title.trim(), new Date(ms).toISOString());
  };

  return (
    <div className="flex h-full flex-col justify-center gap-2 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="h-[var(--ctrl-h-sm)] w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <input
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        className="h-[var(--ctrl-h-sm)] w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button size="sm" onClick={save} disabled={parseLocalDateTime(when) == null}>
        Set countdown
      </Button>
    </div>
  );
}

export function CountdownWidget({ widget, updateConfig }: WidgetComponentProps) {
  const targetIso = str(widget.config, "countdownTargetIso");
  const title = str(widget.config, "countdownTitle");
  const [editing, setEditing] = useState(!targetIso);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (editing || !targetIso) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [editing, targetIso]);

  if (editing || !targetIso) {
    return (
      <SetupForm
        initialTitle={title}
        initialIso={targetIso}
        onSave={(nextTitle, iso) => {
          updateConfig({ countdownTitle: nextTitle, countdownTargetIso: iso });
          setEditing(false);
        }}
      />
    );
  }

  const targetMs = new Date(targetIso).getTime();
  const parts = computeCountdown(now, targetMs);

  return (
    <div className="group relative grid h-full place-items-center px-3 text-center">
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Edit countdown"
        className="absolute right-1.5 top-1.5 rounded-sm text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70 hover:!text-foreground focus-visible:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pencil className="size-icon-xs" aria-hidden />
      </button>

      <div className="flex flex-col items-center gap-1">
        {title ? <p className="max-w-full truncate text-xs text-muted-foreground">{title}</p> : null}
        {parts.isComplete ? (
          <p className="font-display text-2xl font-semibold text-foreground">🎉 Done</p>
        ) : parts.days > 0 ? (
          <>
            <p className="font-display text-4xl font-semibold tabular-nums text-foreground">
              {parts.days}
            </p>
            <p className="text-xs text-muted-foreground">
              {parts.days === 1 ? "day" : "days"} · {parts.hours}h {parts.minutes}m
            </p>
          </>
        ) : (
          <p className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {String(parts.hours).padStart(2, "0")}:{String(parts.minutes).padStart(2, "0")}:
            {String(parts.seconds).padStart(2, "0")}
          </p>
        )}
      </div>
    </div>
  );
}
