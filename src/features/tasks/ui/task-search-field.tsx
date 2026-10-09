// The Tasks toolbar's search (tasks-v2 §7, U2-4): an icon button that opens
// into a field (`/` from anywhere on the page). It filters the current scope
// live by title and description; a finished `#tag` or `@name` word becomes a
// filter chip (the page does that through `onValueChange` / `onCommit`).

import { Search, X } from "lucide-react";
import { type RefObject, useEffect } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Kbd } from "../../../components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";

export function TaskSearchField({
  value,
  onValueChange,
  onCommit,
  open,
  onOpenChange,
  inputRef,
}: {
  value: string;
  onValueChange: (next: string) => void;
  /** Enter: finish a trailing `#tag` / `@name` word too. */
  onCommit: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const expanded = open || value.length > 0;

  // Opening (the button or `/`) puts the caret in the field.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, inputRef]);

  if (!expanded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="aspect-square px-0 text-muted-foreground hover:text-foreground"
            aria-label="Search"
            aria-keyshortcuts="/"
            onClick={() => onOpenChange(true)}
          >
            <Search aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Search <Kbd>/</Kbd>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="relative flex items-center">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2 size-icon-sm text-muted-foreground"
      />
      <Input
        ref={inputRef}
        type="search"
        size="sm"
        value={value}
        aria-label="Search tasks"
        placeholder="Search… # tag, @ person"
        className="w-56 pr-7 pl-7 [&::-webkit-search-cancel-button]:hidden"
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // Esc clears; a second Esc (already empty) closes the field.
            e.preventDefault();
            e.stopPropagation();
            if (value) onValueChange("");
            else {
              onOpenChange(false);
              e.currentTarget.blur();
            }
          } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onCommit();
          }
        }}
        onBlur={() => {
          if (!value) onOpenChange(false);
        }}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute right-1.5 flex size-icon items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
        >
          <X aria-hidden className="size-icon-xs" />
        </button>
      ) : null}
    </div>
  );
}
