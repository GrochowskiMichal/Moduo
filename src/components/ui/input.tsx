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

/**
 * The draft behind a token text field that stands in for a native one (DS-6):
 * the text being typed, shown from `value` through `format`, committed through
 * `parse` on Enter or blur (text that doesn't parse reverts), and committed on
 * unmount too: a popover closed by an outside click removes the field without
 * a blur, and the native fields it replaces saved on every keystroke.
 * `parse` returns `undefined` for "not readable" and may return `null` for
 * "cleared".
 */
function useDraftField<T>({
  value,
  format,
  parse,
  onValueChange,
}: {
  value: T;
  format: (value: T) => string;
  parse: (text: string) => T | undefined;
  onValueChange: (value: T) => void;
}) {
  const shown = format(value);
  const [draft, setDraft] = React.useState(shown);
  // Re-show the field's value after every commit, not only when it changes: a
  // consumer that maps the commit back to the value it had ("" → 1) must not
  // leave the field blank over a real value. A controlled field shows what its
  // owner holds.
  const [commits, setCommits] = React.useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `commits` is the trigger
  React.useEffect(() => setDraft(shown), [shown, commits]);

  const latest = React.useRef({ draft, value, parse, format, onValueChange });
  latest.current = { draft, value, parse, format, onValueChange };
  React.useEffect(
    () => () => {
      const {
        draft: text,
        value: current,
        parse: read,
        format: write,
        onValueChange: save,
      } = latest.current;
      if (text === write(current)) return;
      const next = read(text);
      if (next !== undefined && next !== current) save(next);
    },
    [],
  );

  /** Put a value in: save it when it changed, then show what the owner holds. */
  const set = (next: T) => {
    if (next !== value) onValueChange(next);
    setCommits((n) => n + 1);
  };

  /** Commit the draft: a readable change saves; anything else reverts. */
  const commit = () => {
    const next = parse(draft);
    if (next === undefined) setDraft(shown);
    else set(next);
  };

  /** Throw the draft away (Esc). Also cleared from the unmount commit at once,
   *  so an Esc that closes the field's popover in the same tick saves nothing. */
  const revert = () => {
    latest.current.draft = shown;
    setDraft(shown);
  };

  return { draft, setDraft, commit, set, revert };
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
 * only, ↑ / ↓ step, clamped to [min, max] on Enter, blur or unmount; text that
 * isn't a number reverts.
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
  const field = useDraftField<number | null>({
    value,
    format: (n) => (n === null ? "" : String(n)),
    parse: (text) => {
      const t = text.trim();
      if (t === "") return null;
      return /^\d+$/.test(t) ? clamp(Number.parseInt(t, 10), min, max) : undefined;
    },
    onValueChange,
  });

  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={field.draft}
      onChange={(e) => field.setDraft(e.target.value)}
      onBlur={(e) => {
        field.commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") field.commit();
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const typed = Number.parseInt(field.draft, 10);
          const from = Number.isNaN(typed) ? (value ?? min) : typed;
          field.set(clamp(from + (e.key === "ArrowUp" ? step : -step), min, max));
        } else if (e.key === "Escape") field.revert();
        onKeyDown?.(e);
      }}
      className={cn("tabular-nums", className)}
      {...props}
    />
  );
}

export type { InputProps, NumberInputProps };
export { Input, NumberInput, useDraftField };
