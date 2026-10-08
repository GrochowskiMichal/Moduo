import { SlidersHorizontal } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { SegmentedControl, type SegmentedItem } from "./segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Separator } from "./separator";

/*
 * DisplayMenu (DS-4) — one popover for "how this view looks", generic over a
 * config the module provides. Three control kinds cover the Tasks comp
 * (layout, group, order, completed, subtasks, row properties):
 *
 * - `segmented`: a few exclusive choices, shown as a SegmentedControl
 *   (`iconOnly` for the layout switch);
 * - `select`: a longer exclusive list (group by, order by);
 * - `toggles`: any-of switches shown as a wrap of pressed buttons (which
 *   properties a row shows). Its value is the list of the ones that are on.
 *
 * The value is one plain object keyed by control id, so it persists as-is
 * through the view-prefs helper. With `defaultValue`, a "Reset to default"
 * action restores it (disabled while nothing differs).
 */

type DisplayValues = Record<string, string | readonly string[]>;

type DisplayChoice = SegmentedItem & { label: string };

/** The ids whose value is one string / a list of strings. */
type SingleKey<V> = { [K in keyof V]: V[K] extends string ? K : never }[keyof V] & string;
type ListKey<V> = { [K in keyof V]: V[K] extends readonly string[] ? K : never }[keyof V] & string;

type DisplayControl<V extends DisplayValues> =
  | {
      type: "segmented";
      id: SingleKey<V>;
      label: string;
      options: DisplayChoice[];
      /** Icons only (each choice still needs a label: it becomes the tooltip). */
      iconOnly?: boolean;
    }
  | { type: "select"; id: SingleKey<V>; label: string; options: DisplayChoice[] }
  | { type: "toggles"; id: ListKey<V>; label: string; options: DisplayChoice[] };

type DisplayMenuProps<V extends DisplayValues> = {
  controls: readonly DisplayControl<V>[];
  value: V;
  onValueChange: (next: V) => void;
  /** Enables "Reset to default". */
  defaultValue?: V;
  /** Extra actions under the controls, e.g. "Save as view…". */
  footer?: React.ReactNode;
  /** The trigger (asChild). Defaults to a "Display" ghost button. */
  children?: React.ReactNode;
  align?: "start" | "center" | "end";
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function sameValue(a: DisplayValues, b: DisplayValues): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const x = a[key];
    const y = b[key];
    if (Array.isArray(x) && Array.isArray(y)) {
      // Toggles compare as sets: the same properties in another order are
      // unchanged.
      const sx = new Set<string>(x);
      const sy = new Set<string>(y);
      if (sx.size !== sy.size || [...sx].some((v) => !sy.has(v))) return false;
    } else if (x !== y) return false;
  }
  return true;
}

/**
 * Reads a stored Display value back against the controls that will show it:
 * a choice the config no longer offers (a removed layout, a renamed grouping)
 * falls back to the default, and toggles keep only known options, deduped, in
 * the config's order. Pass it as the view-prefs sanitiser:
 * `readViewPrefs(key, DEFAULTS, (raw, d) => sanitizeDisplayValue(raw, CONTROLS, d))`.
 */
function sanitizeDisplayValue<V extends DisplayValues>(
  raw: unknown,
  controls: readonly DisplayControl<V>[],
  defaults: V,
): V {
  const stored =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const out: DisplayValues = { ...defaults };
  for (const control of controls) {
    const value = stored[control.id];
    const offered = control.options.map((o) => o.value);
    if (control.type === "toggles") {
      if (Array.isArray(value)) out[control.id] = offered.filter((v) => value.includes(v));
    } else if (typeof value === "string" && offered.includes(value)) {
      out[control.id] = value;
    }
  }
  return out as V;
}

const ROW_CLASS =
  "flex min-h-(--ctrl-h) items-center justify-between gap-3 px-2 font-display text-sm text-muted-foreground";

function DisplayMenu<V extends DisplayValues>({
  controls,
  value,
  onValueChange,
  defaultValue,
  footer,
  children,
  align = "end",
  open,
  defaultOpen,
  onOpenChange,
}: DisplayMenuProps<V>) {
  const idPrefix = React.useId();
  const set = (id: string, next: string | readonly string[]) =>
    onValueChange({ ...value, [id]: next });

  return (
    <Popover open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {children ?? (
          <Button variant="ghost" size="sm" className="px-2 data-[state=open]:bg-state-active">
            <SlidersHorizontal aria-hidden />
            Display
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        aria-label="Display options"
        className="flex w-80 flex-col rounded-lg border-hairline p-1.5"
        // Focus the panel, not its first control: that's an icon-only
        // segment, whose tooltip would pop up on every open. Tab still
        // reaches the controls in order.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        {controls.map((control, index) => {
          const labelId = `${idPrefix}-${control.id}`;
          if (control.type === "toggles") {
            const on = (value[control.id] as readonly string[] | undefined) ?? [];
            return (
              <React.Fragment key={control.id}>
                {index > 0 ? <Separator className="my-1.5 bg-hairline" /> : null}
                <div className={ROW_CLASS}>
                  <span id={labelId}>{control.label}</span>
                </div>
                <fieldset
                  aria-labelledby={labelId}
                  className="flex min-w-0 flex-wrap gap-1 px-2 pb-1.5"
                >
                  {control.options.map((option) => {
                    const pressed = on.includes(option.value);
                    const Icon = option.icon;
                    return (
                      <Button
                        key={option.value}
                        variant="outline"
                        size="sm"
                        aria-pressed={pressed}
                        className={cn(
                          "px-2",
                          pressed ? "border-transparent" : "text-muted-foreground",
                        )}
                        onClick={() =>
                          set(
                            control.id,
                            pressed
                              ? on.filter((v) => v !== option.value)
                              : control.options
                                  .map((o) => o.value)
                                  .filter((v) => v === option.value || on.includes(v)),
                          )
                        }
                      >
                        {Icon ? <Icon aria-hidden /> : null}
                        {option.label}
                      </Button>
                    );
                  })}
                </fieldset>
              </React.Fragment>
            );
          }

          const current = value[control.id] as string;
          return (
            <div key={control.id} className={ROW_CLASS}>
              <span id={labelId}>{control.label}</span>
              {control.type === "segmented" ? (
                <SegmentedControl
                  size="sm"
                  aria-label={control.label}
                  iconOnly={control.iconOnly}
                  value={current}
                  onValueChange={(next) => set(control.id, next)}
                  items={control.options.map((o) => ({ ...o, ariaLabel: o.ariaLabel ?? o.label }))}
                />
              ) : (
                <Select value={current} onValueChange={(next) => set(control.id, next)}>
                  <SelectTrigger
                    size="sm"
                    variant="bare"
                    aria-labelledby={labelId}
                    className="w-auto gap-1 bg-state-active px-2 hover:bg-state-active-hover"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {control.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          );
        })}

        {defaultValue || footer ? (
          <div className="flex items-center justify-end gap-1 px-1 pt-1">
            {footer}
            {defaultValue ? (
              <Button
                variant="ghost"
                size="sm"
                className="px-2 text-muted-foreground hover:text-foreground"
                disabled={sameValue(value, defaultValue)}
                onClick={() => onValueChange(defaultValue)}
              >
                Reset to default
              </Button>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export type { DisplayChoice, DisplayControl, DisplayMenuProps, DisplayValues };
export { DisplayMenu, sanitizeDisplayValue };
