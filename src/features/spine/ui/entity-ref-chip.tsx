// Connective-tissue spine — the neutral entity ref chip (block CT-4).
//
// The inline chip an `@mention` / `/ref` inserts into prose (and that search
// results / the picker reuse). NEUTRAL MONOCHROME by contract (AC8, R5): the
// type GLYPH distinguishes a task from a contact — never a hue. Color stays
// reserved for tags + status, so a chip never competes with the one pink accent.
// Tokens only (R10); the type glyph comes from the shared icon-map. A tombstoned
// target renders dimmed as "Deleted <type>" with an optional remove affordance
// (the @/`/`-picker excludes tombstones, but a persisted chip may outlive its
// target — the same dimming the hub uses).

import { resolveEntityIcon } from "../icon-map";
import { cn } from "../../../lib/utils";

export type EntityRefChipProps = {
  entityType: string;
  label: string;
  /** Registry icon hint; falls back to the type glyph. */
  icon?: string | null;
  /** Target was deleted: dim + strike + "Deleted <type>". */
  tombstoned?: boolean;
  /** Makes the chip a button (open the target). */
  onClick?: () => void;
  /** Renders a trailing ✕ that detaches the ref. */
  onRemove?: () => void;
  className?: string;
  title?: string;
};

export function EntityRefChip({
  entityType,
  label,
  icon,
  tombstoned = false,
  onClick,
  onRemove,
  className,
  title,
}: EntityRefChipProps) {
  const Icon = resolveEntityIcon(entityType, icon);
  const text = tombstoned ? `Deleted ${entityType}` : label;

  const inner = (
    <>
      <Icon className="size-icon-xs shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate">{text}</span>
    </>
  );

  return (
    <span
      data-entity-type={entityType}
      title={title ?? text}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded bg-muted px-1 align-baseline text-sm leading-snug text-foreground",
        tombstoned && "text-muted-foreground line-through",
        className,
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className="flex min-w-0 items-center gap-1 rounded-sm transition-opacity duration-(--motion-fade) ease-(--ease-out) hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {inner}
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-1">{inner}</span>
      )}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
