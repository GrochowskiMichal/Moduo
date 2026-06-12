// Shared, quiet tag chip (cross-module). A faint hue-tinted pill with a colored
// dot and the tag name. Color is routed entirely through the label tokens via
// `data-label` (see tokens.css §13b + the .tag-chip/.tag-dot classes in
// global.css) — no raw color in this component. Used inline on task rows/cards
// (display), in the detail panel (removable), and as active filter chips
// (`onClick` to clear). Mail / Notes adopt the same chip later.

import { cn } from "../lib/utils";
import { normalizeLabelColor } from "./tag-colors";

type Props = {
  name: string;
  color?: string | null;
  /** Makes the whole chip a button (e.g. click a row chip to filter by it). */
  onClick?: () => void;
  /** Renders a trailing ✕ that removes the tag (detach / clear filter). */
  onRemove?: () => void;
  /** Stronger emphasis — a hue-colored hairline (e.g. an active filter chip). */
  active?: boolean;
  className?: string;
  title?: string;
};

export function TagChip({ name, color, onClick, onRemove, active, className, title }: Props) {
  const label = (
    <>
      <span className="tag-dot size-1.5 shrink-0 rounded-full" aria-hidden />
      <span className="min-w-0 truncate">
        <span className="text-muted-foreground/70">#</span>
        {name}
      </span>
    </>
  );

  return (
    <span
      data-label={normalizeLabelColor(color)}
      title={title ?? `#${name}`}
      className={cn(
        "tag-chip inline-flex max-w-full items-center gap-1 rounded border border-transparent px-1.5 py-0.5 text-2xs leading-none text-foreground/80",
        active && "tag-chip-outline",
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
          className="flex min-w-0 items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-1">{label}</span>
      )}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove #${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

/** A capped row of quiet chips for dense surfaces (rows / cards). */
export function TagChipList({
  tags,
  max = 3,
  onTagClick,
  className,
}: {
  tags: Array<{ id: string; name: string; color: string | null }>;
  max?: number;
  onTagClick?: (tagId: string) => void;
  className?: string;
}) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const extra = tags.length - shown.length;
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      {shown.map((t) => (
        <TagChip
          key={t.id}
          name={t.name}
          color={t.color}
          onClick={onTagClick ? () => onTagClick(t.id) : undefined}
        />
      ))}
      {extra > 0 ? (
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground/70">+{extra}</span>
      ) : null}
    </span>
  );
}
