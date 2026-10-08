import { cn } from "../../../lib/utils";

/**
 * The small live dot of a running run (TV-F2): the rail's Queue row, the
 * run header, the top-bar chip and "<name> is on this". Decorative: whatever
 * it sits next to says it in words.
 */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full bg-primary ring-2 ring-primary/25",
        className,
      )}
    />
  );
}
