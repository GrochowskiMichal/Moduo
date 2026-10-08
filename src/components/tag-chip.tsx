// Shared, quiet tag chip (cross-module). Borderless inline text: the "#" glyph
// carries the tag's hue, the name stays neutral — no dot, no pill. Color is
// routed entirely through the label tokens via `data-label` (see tokens.css
// §13b + the .tag-hash / .tag-chip-active classes in global.css) — no raw color
// in this component. Active filter chips go fully hued (# + name). Used inline
// on task rows/cards (display), in the detail panel (removable), and as filter
// chips (`onClick` to clear). Mail / Notes adopt the same chip later.

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
  /** `sm` (default, 12px) for dense rows; `md` (13px) where there's room (detail panel). */
  size?: "sm" | "md";
  className?: string;
  title?: string;
};

export function TagChip({
  name,
  color,
  onClick,
  onRemove,
  active,
  size = "sm",
  className,
  title,
}: Props) {
  const label = (
    <span className={cn("min-w-0 truncate", active ? "tag-chip-active" : "text-foreground/90")}>
      <span className={cn(!active && "tag-hash")} aria-hidden>
        #
      </span>
      {name}
    </span>
  );

  return (
    <span
      data-label={normalizeLabelColor(color)}
      title={title ?? `#${name}`}
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 leading-none",
        size === "md" ? "text-sm" : "text-xs",
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
          className="flex min-w-0 items-center rounded-sm hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </button>
      ) : (
        <span className="flex min-w-0 items-center">{label}</span>
      )}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove #${name}`}
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
