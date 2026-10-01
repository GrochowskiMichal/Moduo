/**
 * Pieces of the public booking sentence: the blanks the guest fills in, and
 * the tray that opens under the sentence with the choices for one blank.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "../../../components/ui/button";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { cn } from "../../../lib/utils";

// ---- formatting (guest's locale) ----

function keyDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function dayLong(key: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(keyDate(key));
}

export function dayShort(key: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(keyDate(key));
}

export function dayParts(key: string): { weekday: string; day: string; month: string } {
  const at = keyDate(key);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(at);
  return {
    weekday: part({ weekday: "short" }),
    day: part({ day: "numeric" }),
    month: part({ month: "short" }),
  };
}

export function timeLabel(slot: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(slot));
}

export function clockIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    return "";
  }
}

// ---- blanks ----

const blankBase =
  "rounded-t-md border-b-2 px-0.5 font-normal box-decoration-clone transition-colors duration-[var(--motion-fade)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type BlankProps = {
  label: string;
  value: string | null;
  placeholder: string;
  open?: boolean;
  disabled?: boolean;
  controls?: string;
  onToggle?: () => void;
  ref?: Ref<HTMLButtonElement>;
};

/** A choice blank in the sentence. Shows the picked value or a dashed placeholder. */
export function Blank({
  label,
  value,
  placeholder,
  open = false,
  disabled,
  controls,
  onToggle,
  ref,
}: BlankProps) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onToggle}
      className={cn(
        blankBase,
        value
          ? "border-foreground text-foreground"
          : "border-dashed border-muted-foreground text-muted-foreground",
        open ? "bg-accent" : "enabled:hover:bg-accent",
        "disabled:cursor-default disabled:opacity-50",
      )}
    >
      <span className="sr-only">{label}: </span>
      {value ?? placeholder}
    </button>
  );
}

/** A fixed word in the sentence that looks like a filled blank but can't change. */
export function Fixed({ children }: { children: ReactNode }) {
  return <span className={cn(blankBase, "border-foreground/40 text-foreground")}>{children}</span>;
}

type BlankInputProps = Omit<ComponentProps<"input">, "size"> & { label: string };

/** A text blank: an input that sits inside the sentence and grows with its text. */
export function BlankInput({
  label,
  placeholder = "",
  value,
  className,
  ...props
}: BlankInputProps) {
  const text = typeof value === "string" ? value : "";
  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      value={value}
      size={Math.max(placeholder.length, text.length) + 1}
      className={cn(
        blankBase,
        "field-sizing-content min-w-16 max-w-full bg-transparent text-foreground",
        "border-dashed border-muted-foreground placeholder:text-muted-foreground",
        "not-placeholder-shown:border-solid not-placeholder-shown:border-foreground",
        "focus:border-solid focus:border-foreground focus:bg-accent focus:outline-none focus-visible:ring-0",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

// ---- tray ----

type TrayProps = {
  id: string;
  label: string;
  heading: ReactNode;
  aside?: ReactNode;
  onClose: () => void;
  children: ReactNode;
};

/** The panel under the sentence with the choices for the open blank. Escape closes it. */
export function Tray({ id, label, heading, aside, onClose, children }: TrayProps) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };
  return (
    <fieldset
      id={id}
      aria-label={label}
      onKeyDown={onKeyDown}
      className="m-0 flex min-w-0 animate-in flex-col gap-4 rounded-lg border border-border bg-card p-4 fade-in-0 slide-in-from-top-1 duration-[var(--motion-base)] sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-display text-base text-foreground">{heading}</p>
        {aside ? <div className="font-sans text-sm text-muted-foreground">{aside}</div> : null}
      </div>
      {children}
    </fieldset>
  );
}

type ChipProps = ComponentProps<"button"> & { selected?: boolean };

export function Chip({ selected = false, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex h-[var(--ctrl-h-lg)] items-center gap-2 rounded-full border px-4 font-sans text-md tabular-nums",
        "transition-colors duration-[var(--motion-fade)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-[var(--selected-border)] bg-[var(--selected-bg)] text-foreground"
          : "border-border text-foreground hover:border-foreground",
        className,
      )}
      {...props}
    />
  );
}

// ---- day strip ----

type DayStripProps = {
  days: Array<{ key: string; count: number }>;
  selected: string | null;
  onPick: (key: string) => void;
};

/** Open days as a horizontal strip. A short bar under each day shows how open it is. */
export function DayStrip({ days, selected, onPick }: DayStripProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const most = Math.max(1, ...days.map((day) => day.count));

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () =>
      setEdges({
        start: el.scrollLeft <= 1,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const picked = el.querySelector<HTMLElement>("[aria-pressed='true']");
    picked?.scrollIntoView({ block: "nearest", inline: "nearest" });
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const page = (direction: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Earlier days"
        disabled={edges.start}
        className="max-sm:hidden"
        onClick={() => page(-1)}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <div
        ref={scroller}
        className="-my-1 flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto scroll-smooth py-1 [scrollbar-width:none]"
      >
        {days.map((day) => {
          const parts = dayParts(day.key);
          const on = day.key === selected;
          return (
            <button
              key={day.key}
              type="button"
              aria-pressed={on}
              aria-label={`${dayLong(day.key)}, ${day.count} open ${day.count === 1 ? "time" : "times"}`}
              onClick={() => onPick(day.key)}
              className={cn(
                "flex w-16 shrink-0 snap-start flex-col items-center gap-0.5 rounded-lg border py-2.5",
                "transition-colors duration-[var(--motion-fade)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on
                  ? "border-[var(--selected-border)] bg-[var(--selected-bg)]"
                  : "border-border hover:border-foreground",
              )}
            >
              <Eyebrow>{parts.weekday}</Eyebrow>
              <span className="font-sans text-2xl text-foreground tabular-nums">{parts.day}</span>
              <span className="font-sans text-2xs text-muted-foreground">{parts.month}</span>
              <span
                aria-hidden
                className="mt-1 h-0.5 rounded-full bg-foreground/60"
                style={{ width: `${Math.max(16, Math.round((day.count / most) * 100)) * 0.32}px` }}
              />
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Later days"
        disabled={edges.end}
        className="max-sm:hidden"
        onClick={() => page(1)}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );
}
