// DB-5 — shared, tokens-only building blocks for widget bodies so each of the 9
// module widgets stays tiny and consistent. Row height rides the density token
// (`--row-h`), so a denser setting shows tighter rows in the same cell (AC13);
// the row budget (widget-density.ts) decides how many before "+N more".

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Fills the frame body as a column (header lives in WidgetFrame). */
export function WidgetBodyRoot({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex h-full min-h-0 flex-col", className)}>{children}</div>;
}

/** A scroll region for widgets that prefer scrolling to a "+N more" cut. */
export function WidgetScroll({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</div>;
}

export function WidgetLoading() {
  return (
    <div className="grid h-full place-items-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

export function WidgetEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center px-3 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function WidgetList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("flex flex-col gap-0.5 p-1.5", className)}>{children}</ul>;
}

export function WidgetSectionLabel({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-2 pb-0.5 pt-2 first:pt-1">
      <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {children}
      </span>
      {typeof count === "number" ? (
        <span className="text-2xs tabular-nums text-muted-foreground/70">{count}</span>
      ) : null}
    </div>
  );
}

export interface WidgetRowProps {
  /** Leading icon (muted). Omit for a custom `leading` node. */
  icon?: LucideIcon;
  leading?: ReactNode;
  title: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  /** Bolder title for the "next up" / primary row. */
  emphasis?: boolean;
  disabled?: boolean;
}

/** One list row: leading icon, title (+ optional secondary), trailing meta. */
export function WidgetRow({
  icon: Icon,
  leading,
  title,
  secondary,
  trailing,
  onClick,
  emphasis = false,
  disabled = false,
}: WidgetRowProps) {
  const interactive = Boolean(onClick) && !disabled;
  const inner = (
    <>
      {leading ??
        (Icon ? (
          <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
        ) : null)}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "min-w-0 truncate text-sm",
            emphasis ? "font-medium text-foreground" : "text-foreground",
          )}
        >
          {title}
        </span>
        {secondary ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{secondary}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className="shrink-0 pl-2 text-2xs tabular-nums text-muted-foreground/80">
          {trailing}
        </span>
      ) : null}
    </>
  );

  const rowClass = cn(
    "flex min-h-[var(--row-h)] w-full items-center gap-2 rounded-md px-2 py-1 text-left",
    interactive &&
      "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    disabled && "opacity-60",
  );

  return (
    <li>
      {interactive ? (
        <button type="button" onClick={onClick} className={rowClass}>
          {inner}
        </button>
      ) : (
        <div className={rowClass}>{inner}</div>
      )}
    </li>
  );
}

/** The "+N more" footer. A button (opens the module) when `onClick` is given,
 * else quiet static text (spine widgets have no dedicated page). */
export function WidgetMore({ count, onClick }: { count: number; onClick?: () => void }) {
  if (count <= 0) return null;
  const label = `+${count} more`;
  if (!onClick) {
    return (
      <p className="mx-1.5 mb-1.5 mt-0.5 shrink-0 px-2 py-1 text-xs text-muted-foreground/70">
        {label}
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-1.5 mb-1.5 mt-0.5 shrink-0 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </button>
  );
}
