import { SmilePlus } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import { chipClasses } from "./chip";
import { IconButton } from "./icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/**
 * The reaction component (chat-v2 §6 and §17, CH16a, CH49; kit addition #32):
 * one look for reactions on chat messages and on task and note comments.
 *
 * - `Reactions` — the chips under a message or comment: the emoji, its count,
 *   yours on the neutral active fill (R5), who reacted on hover. A click adds
 *   or takes back yours.
 * - `QuickReactionRow` — your quick row (up to six), then "Customize…" and,
 *   when the full picker is wired (CV-7b), "Any emoji".
 * - `ReactionButton` — the ☺ button that opens your quick row in a popover.
 *
 * Domain-free: callers pass the labels ("Thumbs up", "You and Anna") and,
 * for keys that aren't a standard emoji (a workspace's `:name:`), how to draw
 * them (`glyph`); without it a key is drawn as its text.
 */

/** How a key is drawn; null or absent = as its text. */
type GlyphOf = (key: string) => React.ReactNode | null;

function Glyph({ k, glyph }: { k: string; glyph?: GlyphOf }) {
  return (
    <span aria-hidden className={cn(emojiGlyph, "inline-flex items-center")}>
      {glyph?.(k) ?? k}
    </span>
  );
}

const emojiGlyph = "text-base leading-none";

type ReactionItem = {
  /** The emoji (the stored key). */
  key: string;
  count: number;
  /** I reacted with it. */
  mine: boolean;
  /** Spoken name of the emoji ("Thumbs up"; any other emoji as itself). */
  label: string;
  /** Who reacted, for the hover ("You, Mike and Anna"). */
  who: string;
};

function Reactions({
  items,
  onToggle,
  disabled,
  trailing,
  glyph,
  className,
}: {
  items: readonly ReactionItem[];
  /** Draws a key that isn't a standard emoji (a custom one's image). */
  glyph?: GlyphOf;
  onToggle?: (key: string, on: boolean) => void;
  /** Read-only (nobody may react here): the chips still say who reacted. */
  disabled?: boolean;
  /** After the chips (e.g. a `ReactionButton` that shows on hover). */
  trailing?: React.ReactNode;
  className?: string;
}) {
  if (items.length === 0 && !trailing) return null;
  return (
    <div data-slot="reactions" className={cn("flex flex-wrap items-center gap-1", className)}>
      {items.map((r) => (
        <Tooltip key={r.key}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-pressed={r.mine}
              aria-label={`${r.label}: ${r.who}`}
              aria-disabled={disabled || undefined}
              onClick={() => {
                if (!disabled) onToggle?.(r.key, !r.mine);
              }}
              className={cn(
                chipClasses({ size: "xs", shape: "full", active: r.mine, interactive: !disabled }),
                "hit-min tabular-nums",
                r.mine ? "font-medium" : "text-muted-foreground",
              )}
            >
              <Glyph k={r.key} glyph={glyph} />
              {r.count}
            </button>
          </TooltipTrigger>
          <TooltipContent>{r.who}</TooltipContent>
        </Tooltip>
      ))}
      {trailing}
    </div>
  );
}

const quickButton = cn(
  "flex size-(--ctrl-h-sm) shrink-0 items-center justify-center rounded-md",
  "outline-none transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover",
  "focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-state-active",
);

function QuickReactionRow({
  keys,
  mine,
  labelOf,
  onPick,
  onCustomize,
  onAnyEmoji,
  glyph,
  className,
}: {
  /** Your quick row, resolved (up to six). */
  keys: readonly string[];
  /** The keys I already reacted with (pressed). */
  mine?: ReadonlySet<string>;
  labelOf: (key: string) => string;
  /** A key, and whether it becomes mine (`!mine.has(key)`). */
  onPick: (key: string, on: boolean) => void;
  /** "Customize…": opens Settings → Chat. */
  onCustomize?: () => void;
  /** "Any emoji": the full picker (CV-7b). Absent until it exists. */
  onAnyEmoji?: () => void;
  /** Draws a key that isn't a standard emoji (a custom one's image). */
  glyph?: GlyphOf;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div role="group" aria-label="Your quick reactions" className="flex items-center gap-0.5">
        {keys.map((key) => {
          const on = mine?.has(key) ?? false;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              aria-label={labelOf(key)}
              onClick={() => onPick(key, !on)}
              className={quickButton}
            >
              <Glyph k={key} glyph={glyph} />
            </button>
          );
        })}
        {onAnyEmoji ? (
          <button
            type="button"
            aria-label="Any emoji"
            onClick={onAnyEmoji}
            className={cn(quickButton, "text-muted-foreground")}
          >
            <SmilePlus aria-hidden className="size-icon" />
          </button>
        ) : null}
      </div>
      {onCustomize ? (
        <button
          type="button"
          onClick={onCustomize}
          className={cn(
            "self-start rounded-sm px-1.5 font-sans text-xs text-muted-foreground",
            "outline-none transition-colors duration-(--motion-fade) ease-(--ease-out)",
            "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
        >
          Customize…
        </button>
      ) : null}
    </div>
  );
}

function ReactionButton({
  label = "React",
  size = "sm",
  className,
  ...row
}: Omit<React.ComponentProps<typeof QuickReactionRow>, "className"> & {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const close = (run?: () => void) =>
    run
      ? () => {
          setOpen(false);
          run();
        }
      : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton icon={SmilePlus} label={label} size={size} className={className} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-1">
        <QuickReactionRow
          {...row}
          onPick={(key, on) => {
            row.onPick(key, on);
            setOpen(false);
          }}
          onCustomize={close(row.onCustomize)}
          onAnyEmoji={close(row.onAnyEmoji)}
        />
      </PopoverContent>
    </Popover>
  );
}

export type { GlyphOf, ReactionItem };
export { QuickReactionRow, ReactionButton, Reactions };
