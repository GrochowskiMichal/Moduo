// Tag filter for the Plan views (Session 4). A quiet "Filter" control that sits
// next to the group/columns control in the header, plus the active-filter chip
// row rendered below it. Union (OR) semantics: a task matches if it carries any
// selected tag (see taskMatchesTagFilter). Filtering narrows the center list /
// board only — rail bucket counts are unaffected.

import { Check, ListFilter } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { Eyebrow } from "../../../components/ui/eyebrow";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import { TagChip } from "../../../components/tag-chip";
import { cn } from "../../../lib/utils";
import { normalizeLabelColor } from "../../../components/tag-colors";
import type { Tag } from "../model";

export function TagFilterButton({
  tags,
  filterTagIds,
  countByTag,
  onToggle,
}: {
  tags: Tag[];
  filterTagIds: string[];
  countByTag: Map<string, number>;
  onToggle: (tagId: string) => void;
}) {
  const selected = new Set(filterTagIds);
  const active = filterTagIds.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={active ? "secondary" : "outline"}
          className="font-display"
          aria-label="Filter by tag"
        >
          <ListFilter className="size-4" aria-hidden />
          Filter
          {active ? <span className="tabular-nums text-muted-foreground">· {active}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-0">
        <Command>
          <CommandInput placeholder="Filter tags…" />
          <CommandList>
            <CommandEmpty>No tags yet.</CommandEmpty>
            <CommandGroup>
              {tags.map((tag) => {
                const isOn = selected.has(tag.id);
                return (
                  <CommandItem key={tag.id} value={tag.name} onSelect={() => onToggle(tag.id)}>
                    <span
                      data-label={normalizeLabelColor(tag.color)}
                      className="tag-dot size-2.5 shrink-0 rounded-full"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-muted-foreground/70">#</span>
                      {tag.name}
                    </span>
                    <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground/60">
                      {countByTag.get(tag.id) ?? 0}
                    </span>
                    <Check
                      className={cn("size-4 shrink-0 text-foreground", isOn ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ActiveTagFilters({
  tags,
  filterTagIds,
  matchCount,
  scopeCount,
  onToggle,
  onClear,
}: {
  tags: Tag[];
  filterTagIds: string[];
  matchCount: number;
  scopeCount: number;
  onToggle: (tagId: string) => void;
  onClear: () => void;
}) {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const active = filterTagIds.map((id) => byId.get(id)).filter((t): t is Tag => !!t);
  if (active.length === 0) return null;
  return (
    <>
      <Eyebrow tone="muted">Filter</Eyebrow>
      {active.map((tag) => (
        <TagChip key={tag.id} name={tag.name} color={tag.color} active onRemove={() => onToggle(tag.id)} />
      ))}
      <span className="font-sans text-xs tabular-nums text-muted-foreground/70">
        {matchCount} of {scopeCount}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="rounded text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Clear
      </button>
    </>
  );
}
