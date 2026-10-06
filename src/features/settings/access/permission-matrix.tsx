import { Check, Lock, Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import {
  ACTION_LABELS,
  MATRIX_ACTIONS,
  MATRIX_MODULES,
  MATRIX_POWERS,
  MODULE_LABELS,
  moduleKey,
  type PermissionKey,
  POWER_LABELS,
  powerKey,
} from "../../workspaces/access";

/**
 * The role/person permission grid: modules × View/Create/Edit/Delete, then the
 * workspace powers as a list. Cells are rendered by the caller (role editor and
 * person editor draw different states); this owns layout + hover reporting so
 * the explainer under the grid can follow the pointer and keyboard focus.
 */
export function PermissionMatrix({
  renderCell,
  onFocusKey,
}: {
  renderCell: (key: PermissionKey) => ReactNode;
  onFocusKey?: (key: PermissionKey | null) => void;
}) {
  const track = (key: PermissionKey) => ({
    onMouseEnter: () => onFocusKey?.(key),
    onFocus: () => onFocusKey?.(key),
  });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col">
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,3.5rem)] items-end pb-1.5">
          <span />
          {MATRIX_ACTIONS.map((action) => (
            <span key={action} className="text-center text-2xs text-muted-foreground">
              {ACTION_LABELS[action]}
            </span>
          ))}
        </div>
        {MATRIX_MODULES.map((module) => (
          <div
            key={module}
            className="grid grid-cols-[minmax(0,1fr)_repeat(4,3.5rem)] items-center border-t border-border py-1.5"
          >
            <span className="truncate text-sm text-foreground">{MODULE_LABELS[module]}</span>
            {MATRIX_ACTIONS.map((action) => {
              const key = moduleKey(module, action);
              return (
                <span key={key} className="flex justify-center" {...track(key)}>
                  {renderCell(key)}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-col">
        <span className="pb-1.5 text-2xs text-muted-foreground">Workspace</span>
        {MATRIX_POWERS.map((power) => {
          const key = powerKey(power);
          return (
            <div
              key={key}
              className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center border-t border-border py-1.5"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-foreground">
                  {POWER_LABELS[power].label}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {POWER_LABELS[power].hint}
                </span>
              </span>
              <span className="flex justify-center" {...track(key)}>
                {renderCell(key)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const cellBase =
  "grid size-7 place-items-center rounded-md border transition-colors duration-[var(--motion-fade)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card";

/** A role cell: on/off, optionally disabled with a reason. */
export function RoleCell({
  label,
  checked,
  disabledReason,
  locked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  /** Why it can't be changed (shown as a tooltip). */
  disabledReason?: string | null;
  /** Read-only ceiling: always off, shown as a lock. */
  locked?: boolean;
  onToggle: () => void;
}) {
  const disabled = !!disabledReason || locked;
  const button = (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={label}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onToggle();
      }}
      className={cn(
        cellBase,
        checked
          ? "border-foreground/20 bg-foreground/10 text-foreground"
          : "border-border bg-transparent text-muted-foreground",
        !disabled && !checked && "hover:bg-accent",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      {locked ? (
        <Lock className="size-3" aria-hidden />
      ) : checked ? (
        <Check className="size-3.5" aria-hidden />
      ) : null}
    </button>
  );
  const reason = locked ? "Read-only roles never edit." : disabledReason;
  if (!reason) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export type PersonCellVisual = "on" | "off" | "allow" | "block" | "locked" | "needs-view";

/** A person cell: what they can do, and whether that comes from an exception. */
export function PersonCell({
  label,
  visual,
  interactive,
  onToggle,
}: {
  label: string;
  visual: PersonCellVisual;
  interactive: boolean;
  onToggle: () => void;
}) {
  const effective = visual === "on" || visual === "allow";
  return (
    <button
      type="button"
      aria-pressed={effective}
      aria-label={label}
      aria-disabled={!interactive || undefined}
      onClick={() => {
        if (interactive) onToggle();
      }}
      className={cn(
        cellBase,
        visual === "on" && "border-border bg-muted text-foreground",
        visual === "off" && "border-border bg-transparent text-muted-foreground",
        visual === "allow" && "border-success/40 bg-success/10 text-success",
        visual === "block" && "border-destructive/40 bg-destructive/10 text-destructive",
        (visual === "locked" || visual === "needs-view") &&
          "border-dashed border-border bg-transparent text-muted-foreground",
        interactive ? "hover:border-foreground/30" : "cursor-default",
      )}
    >
      {visual === "on" ? <Check className="size-3.5" aria-hidden /> : null}
      {visual === "allow" ? <Plus className="size-3.5" aria-hidden /> : null}
      {visual === "block" ? <Minus className="size-3.5" aria-hidden /> : null}
      {visual === "locked" ? <Lock className="size-3" aria-hidden /> : null}
    </button>
  );
}

export function PersonLegend() {
  const item = (icon: ReactNode, text: string, tone: string) => (
    <span className={cn("inline-flex items-center gap-1.5", tone)}>
      {icon}
      {text}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
      {item(<Check className="size-3" aria-hidden />, "From their role", "")}
      {item(<Plus className="size-3" aria-hidden />, "Allowed for them", "text-success")}
      {item(<Minus className="size-3" aria-hidden />, "Blocked for them", "text-destructive")}
      {item(<Lock className="size-3" aria-hidden />, "Read-only role", "")}
      {item(
        <span className="size-3 rounded-sm border border-dashed border-current" aria-hidden />,
        "Needs View first",
        "",
      )}
    </div>
  );
}
