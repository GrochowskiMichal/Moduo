import * as React from "react";

import { cn } from "@/lib/utils";
import { type FieldShellVariant, fieldShellVariants } from "./field-shell";

type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  /** Surface treatment — see field-shell.ts. Default `filled`. */
  variant?: FieldShellVariant;
  /** Control height rung: `md` = --ctrl-h (default), `sm` = --ctrl-h-sm. */
  size?: "sm" | "md";
};

function Input({ className, type, style, variant = "filled", size = "md", ...props }: InputProps) {
  const heightVar = size === "sm" ? "var(--ctrl-h-sm)" : "var(--ctrl-h)";
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        fieldShellVariants({ variant }),
        "flex",
        size === "sm" ? "px-2.5" : "px-3",
        variant === "bare" && "px-0",
        "file:inline-flex file:border-0 file:bg-transparent file:text-base file:font-medium file:text-foreground",
        className,
      )}
      style={{ height: heightVar, ...style }}
      {...props}
    />
  );
}

type NumberInputProps = Omit<InputProps, "value" | "defaultValue" | "onChange" | "type"> & {
  /** The number, or null when empty. */
  value: number | null;
  /** Called with a whole number in [min, max], or null when cleared. */
  onValueChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** ↑ / ↓ move the value by this much (default 1). */
  step?: number;
};

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/**
 * NumberInput — the token number field that replaces the native
 * `<input type="number">` (DS-6, the §5.1 fix list): no spinner chrome, digits
 * only, ↑ / ↓ step, clamped to [min, max] on Enter or blur, text that isn't a
 * number reverts.
 */
function NumberInput({
  value,
  onValueChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  className,
  onBlur,
  onKeyDown,
  ...props
}: NumberInputProps) {
  const shown = value === null ? "" : String(value);
  const [draft, setDraft] = React.useState(shown);
  React.useEffect(() => setDraft(shown), [shown]);

  // A popover that closes on an outside click unmounts the field without a
  // blur; commit a pending, readable draft on the way out (the native field
  // saved per keystroke).
  const pending = React.useRef({ draft, value, onValueChange, min, max });
  pending.current = { draft, value, onValueChange, min, max };
  React.useEffect(
    () => () => {
      const {
        draft: last,
        value: current,
        onValueChange: save,
        min: lo,
        max: hi,
      } = pending.current;
      const text = last.trim();
      if (!/^\d+$/.test(text)) return;
      const next = clamp(Number.parseInt(text, 10), lo, hi);
      if (next !== current) save(next);
    },
    [],
  );

  const commit = () => {
    const text = draft.trim();
    if (text === "") {
      if (value !== null) onValueChange(null);
      return;
    }
    const parsed = Number.parseInt(text, 10);
    if (!/^\d+$/.test(text) || Number.isNaN(parsed)) {
      setDraft(shown);
      return;
    }
    const next = clamp(parsed, min, max);
    setDraft(String(next));
    if (next !== value) onValueChange(next);
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const base = Number.parseInt(draft, 10);
          const from = Number.isNaN(base) ? (value ?? min) : base;
          const next = clamp(from + (e.key === "ArrowUp" ? step : -step), min, max);
          setDraft(String(next));
          onValueChange(next);
        } else if (e.key === "Escape") setDraft(shown);
        onKeyDown?.(e);
      }}
      className={cn("tabular-nums", className)}
      {...props}
    />
  );
}

export type { InputProps, NumberInputProps };
export { Input, NumberInput };
