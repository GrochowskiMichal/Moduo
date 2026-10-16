// Shared tag chip (cross-module): the dot chip (dogfood MOD-97, option C,
// Maciej 2026-10-15). A quiet neutral pill (`bg-tag-chip-surface`, the same in
// every hue and both themes), a 6 px dot in the tag's hue, then the name in
// neutral text. No "#": the "#" is how you type a tag, not how one looks.
// Colour is routed entirely through the label tokens via `data-label`
// (tokens.css §13b; .tag-dot / .tag-chip-active in global.css), so this file
// holds no raw colour. An active filter chip is the same chip with a 1 px inset
// ring in the hue and the name in full foreground.
//
// Two fixed sizes (drawn, not density-scaled): `sm` 18 px for Detailed rows and
// Board cards, inside a 15 px title's line; `md` 22 px in details panels
// (removable, a muted × at the end). Used by Tasks (rows, cards, the details
// panel, templates), Contacts, Notes and Mail.

import { Plus, X } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";
import { normalizeLabelColor } from "./tag-colors";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type Props = {
  name: string;
  color?: string | null;
  /** Makes the dot and name a button (e.g. click a chip to filter by it). */
  onClick?: () => void;
  /** Renders a trailing × that removes the tag (detach / clear filter). */
  onRemove?: () => void;
  /** An active filter chip: an inset ring in the tag's hue, full-foreground name. */
  active?: boolean;
  /** `sm` (default, 18 px, 12 px text) for rows and cards; `md` (22 px, 13 px) in panels. */
  size?: "sm" | "md";
  className?: string;
  /** Hover text on the dot and name. Defaults to "Tag: <name>"; pass "" for none. */
  title?: string;
};

const SIZE = {
  sm: { chip: "h-4.5 pl-1.5 text-xs", end: "pr-1.75", endRemovable: "pr-0.5", gap: "gap-1.25" },
  md: { chip: "h-5.5 pl-2 text-sm", end: "pr-2.25", endRemovable: "pr-1", gap: "gap-1.5" },
} as const;

/** Name → ×: the ×'s 24 px hit area reaches 5 px past its 14 px glyph, so the
 *  name starts clear of it (`.hit-min`, R13). */
const REMOVE_GAP = "gap-1.25";

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
  const s = SIZE[size];
  // The hover text sits on the dot and name, not the whole chip, so the × shows
  // only its own tooltip.
  const hover = title ?? `Tag: ${name}`;
  const label = (
    <>
      <span aria-hidden className="tag-dot size-1.5 shrink-0 rounded-full" />
      <span className="min-w-0 truncate">{name}</span>
    </>
  );

  return (
    <span
      data-slot="tag-chip"
      data-label={normalizeLabelColor(color)}
      data-active={active || undefined}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center rounded-full bg-tag-chip-surface font-sans leading-none whitespace-nowrap",
        s.chip,
        onRemove ? cn(s.endRemovable, REMOVE_GAP) : s.end,
        active ? "tag-chip-active text-foreground" : "text-foreground/90",
        className,
      )}
    >
      {onClick ? (
        <button
          type="button"
          title={hover}
          aria-label={`Tag: ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className={cn(
            "flex min-w-0 items-center rounded-full transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            s.gap,
          )}
        >
          {label}
        </button>
      ) : (
        <span
          data-slot="tag-chip-label"
          title={hover}
          className={cn("flex min-w-0 items-center", s.gap)}
        >
          {label}
        </span>
      )}
      {onRemove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Remove tag ${name}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="hit-min flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-active hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className={size === "md" ? "size-3" : "size-2.5"} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Remove tag</TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  );
}

const ADD_SIZE = { sm: "size-4.5", md: "size-5.5" } as const;

/**
 * The "+" that ends a row of chips (MOD-158): a round, quiet button at the
 * chips' own height (`md` 22 px, `sm` 18 px), a muted plus that lights on
 * hover, so it reads as the row's last item rather than a control of its own.
 * Its hit area still reaches 24 px (`.hit-min`, R13). Use it as a picker's
 * trigger (`asChild`); the label is its name and its tooltip.
 */
export function TagAddButton({
  size = "md",
  label = "Add tag",
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & {
  /** The chips it follows. */
  size?: "sm" | "md";
  label?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "hit-min inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none",
            "transition-colors duration-(--motion-fade) ease-(--ease-out)",
            "hover:bg-state-hover hover:text-foreground aria-expanded:bg-state-active aria-expanded:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            ADD_SIZE[size],
            className,
          )}
          {...props}
          // After the spread: a Radix trigger (asChild) passes its own data-slot.
          data-slot="tag-add"
        >
          <Plus aria-hidden className={size === "md" ? "size-icon-sm" : "size-icon-xs"} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The widest a chip gets in a list, so long names never squeeze the title out. */
const LIST_CHIP_MAX = "max-w-24";

/**
 * A capped row of chips for dense surfaces (Detailed rows, Board cards): the
 * first `max`, then a quiet "+n" whose tooltip names the rest. Each chip is at
 * most 96 px wide (`max-w-24`) and cuts a long name with an ellipsis; its hover
 * text keeps the full name. The list never wraps. In a Detailed row it holds
 * its width (two capped chips at most), so the title keeps the rest; in a Board
 * card's meta line it may shrink further, and the chips cut sooner.
 */
export function TagChipList({
  tags,
  max = 3,
  onTagClick,
  className,
}: {
  tags: ReadonlyArray<{ id: string; name: string; color: string | null }>;
  max?: number;
  onTagClick?: (tagId: string) => void;
  className?: string;
}) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const rest = tags.slice(max);
  const restNames = rest.map((t) => t.name).join(", ");
  return (
    <span data-slot="tag-chip-list" className={cn("flex min-w-0 items-center gap-1", className)}>
      {/* A screen reader hears "Tags: ui notes", not two bare words. */}
      <span className="sr-only">Tags:</span>
      {shown.map((t) => (
        <TagChip
          key={t.id}
          name={t.name}
          color={t.color}
          onClick={onTagClick ? () => onTagClick(t.id) : undefined}
          className={LIST_CHIP_MAX}
        />
      ))}
      {rest.length > 0 ? (
        <Tooltip>
          {/* A button, so keyboard focus opens the names too (the kit Tooltip,
              as the row's other counts use). */}
          <TooltipTrigger
            type="button"
            data-slot="tag-chip-more"
            aria-label={`${rest.length} more ${rest.length === 1 ? "tag" : "tags"}: ${restNames}`}
            className="shrink-0 rounded-sm font-sans text-xs tabular-nums text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            +{rest.length}
          </TooltipTrigger>
          <TooltipContent>{restNames}</TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  );
}
