// DB-8 (AC10) — per-widget config forms, shown in the `⋯` popover anchored to the
// widget. Only the types that lack an inline editor get one here: Clock
// (timezones), Pomodoro (durations), Tasks (project filter). Weather / Countdown /
// Pinned edit their settings via their own widget-anchored affordances (DB-6).

import type { ComponentType } from "react";

import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/utils";

import { useDashboardData } from "../context/dashboard-data-context";
import type { WidgetInstance, WidgetType } from "../engine/types";

export interface ConfigFormProps {
  widget: WidgetInstance;
  updateConfig: (patch: Record<string, unknown>) => void;
  onClose: () => void;
}

export type ConfigFormComponent = ComponentType<ConfigFormProps>;

// ── Clock ────────────────────────────────────────────────────────────────────
const CLOCK_PRESETS: Array<{ zone: string; label: string }> = [
  { zone: "America/Los_Angeles", label: "Los Angeles" },
  { zone: "America/New_York", label: "New York" },
  { zone: "Europe/London", label: "London" },
  { zone: "Europe/Berlin", label: "Berlin" },
  { zone: "Asia/Kolkata", label: "Kolkata" },
  { zone: "Asia/Tokyo", label: "Tokyo" },
  { zone: "Australia/Sydney", label: "Sydney" },
];

function ClockConfig({ widget, updateConfig }: ConfigFormProps) {
  const selected = Array.isArray(widget.config.timezones)
    ? (widget.config.timezones as unknown[]).filter((z): z is string => typeof z === "string")
    : [];
  const toggle = (zone: string) => {
    const next = selected.includes(zone) ? selected.filter((z) => z !== zone) : [...selected, zone];
    updateConfig({ timezones: next });
  };
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow as="p">Extra timezones</Eyebrow>
      <div className="flex flex-wrap gap-1">
        {CLOCK_PRESETS.map((p) => {
          const on = selected.includes(p.zone);
          return (
            <button
              key={p.zone}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(p.zone)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Pomodoro ─────────────────────────────────────────────────────────────────
function numConfig(config: Record<string, unknown>, key: string, fallback: number): number {
  const v = config[key];
  return typeof v === "number" && v > 0 ? v : fallback;
}

function DurationField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm text-foreground">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="h-[var(--ctrl-h-sm)] w-16 rounded-md border border-border bg-muted px-2 text-right text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}

function PomodoroConfig({ widget, updateConfig }: ConfigFormProps) {
  const work = numConfig(widget.config, "pomodoroWorkMinutes", 25);
  const brk = numConfig(widget.config, "pomodoroBreakMinutes", 5);
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow as="p">Durations (minutes)</Eyebrow>
      <DurationField
        label="Focus"
        value={work}
        min={5}
        max={90}
        onChange={(n) => updateConfig({ pomodoroWorkMinutes: n })}
      />
      <DurationField
        label="Break"
        value={brk}
        min={1}
        max={30}
        onChange={(n) => updateConfig({ pomodoroBreakMinutes: n })}
      />
    </div>
  );
}

// ── Tasks (project filter) ───────────────────────────────────────────────────
function TasksConfig({ widget, updateConfig }: ConfigFormProps) {
  const { tasks } = useDashboardData();
  const buckets = tasks.data.buckets;
  const selected = Array.isArray(widget.config.projectIds)
    ? (widget.config.projectIds as unknown[]).filter((id): id is string => typeof id === "string")
    : [];

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((b) => b !== id) : [...selected, id];
    updateConfig({ projectIds: next });
  };

  return (
    <div className="flex flex-col gap-2">
      <Eyebrow as="p">Projects {selected.length === 0 ? "(all)" : `(${selected.length})`}</Eyebrow>
      {buckets.length === 0 ? (
        <p className="text-xs text-muted-foreground">No projects yet.</p>
      ) : (
        <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto scrollbar-thin">
          {buckets.map((bucket) => {
            const on = selected.includes(bucket.id);
            return (
              <li key={bucket.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(bucket.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-3.5 shrink-0 place-items-center rounded-sm border",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}
                    aria-hidden
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span className="min-w-0 truncate">{bucket.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const WIDGET_CONFIG_FORMS: Partial<Record<WidgetType, ConfigFormComponent>> = {
  clock: ClockConfig,
  pomodoro: PomodoroConfig,
  tasks: TasksConfig,
};

export function getConfigForm(type: WidgetType): ConfigFormComponent | null {
  return WIDGET_CONFIG_FORMS[type] ?? null;
}
