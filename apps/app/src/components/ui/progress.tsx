/**
 * Determinate progress bar — the app's first progress primitive (IM-1, AC5).
 *
 * A primitive rather than a one-off bar because two surfaces need it: the notes
 * import ("142 of 350 pages") and the email history backfill (IM-2c). Per
 * DESIGN_RULES R2/R10 it is token-driven only — no raw colors, no arbitrary
 * Tailwind values. It animates on a **movement** token (`--motion-fast`) because
 * it transitions width: R6 zeroes those under reduced motion, while
 * `--motion-fade` deliberately stays non-zero for opacity and would keep this bar
 * travelling for a user who asked it not to.
 *
 * Hand-rolled: a determinate bar is a div with a width, and `@radix-ui/react-progress`
 * would be a new dependency for that. It still carries the same ARIA contract
 * (`role="progressbar"` + the value/min/max trio) so assistive tech reads it.
 *
 * Neutral (DS-6, visual audit §C): the fill is the secondary text colour on a
 * hairline track, never the accent. The accent stays for selection, focus,
 * the done check and status marks (R5, the accent budget of call 46). Two
 * sizes: `md` 6 px for a standalone bar, `sm` 2 px inline beside a number
 * (the detail panel's "1h 20m of ~4h").
 */

import { cn } from "@/lib/utils";

type Props = {
  /** Completed units. Clamped into `[0, max]`. */
  value: number;
  /** Total units. A non-positive max renders the indeterminate-looking empty bar. */
  max: number;
  /** Accessible name — required, since a bare bar tells a screen reader nothing. */
  label: string;
  size?: "sm" | "md";
  className?: string;
};

export function Progress({ value, max, label, size = "md", className }: Props) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const safeValue = safeMax === 0 ? 0 : Math.min(Math.max(value, 0), safeMax);
  const percent = safeMax === 0 ? 0 : (safeValue / safeMax) * 100;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={safeMax === 0 ? undefined : safeValue}
      aria-valuemin={0}
      aria-valuemax={safeMax || undefined}
      data-slot="progress"
      data-size={size}
      className={cn(
        "w-full overflow-hidden rounded-full bg-hairline",
        size === "sm" ? "h-0.5" : "h-1.5",
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-muted-foreground transition-[width] duration-(--motion-fast) ease-(--ease-out)"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
