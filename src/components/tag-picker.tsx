// Shared, workspace-level tag picker (cross-module: Tasks now; Mail / Notes
// adopt it later). A Popover wrapping a shadcn Command list: search existing
// tags, toggle them on/off the target entity, create a new one inline (color
// auto-assigned, recolorable), recolor, and delete. Operates on a light
// {id,name,color} shape so it stays decoupled from any one module's model.
//
// Design: quiet and minimal (principle 1). Create lives behind the search box —
// "friction behind the dump" (principle 3): type a name, hit Create, refine the
// color later. Color is token-routed via <TagChip> / data-label.

import { Fragment, useState, type ReactNode } from "react";
import { Check, Plus, Tag as TagIcon, Trash2 } from "lucide-react";

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "../lib/utils";
import { LABEL_COLORS, normalizeLabelColor, type LabelColor } from "./tag-colors";

export type PickableTag = { id: string; name: string; color: string | null };

type Props = {
  /** The workspace's tags — the universe to pick from. */
  tags: PickableTag[];
  /** Tag ids currently attached to the target entity. */
  selectedIds: string[];
  canEdit: boolean;
  /** Attach / detach a tag on the target entity. */
  onToggle: (tagId: string) => void;
  /** Create a new tag (auto-colored) and attach it. */
  onCreate: (name: string) => void;
  /** Recolor a workspace tag. */
  onRecolor?: (tagId: string, color: LabelColor) => void;
  /** Delete a tag from the workspace (detaches everywhere). */
  onDelete?: (tagId: string) => void;
  /** Custom trigger (asChild). Defaults to a quiet "Add tag" button. */
  trigger?: ReactNode;
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function TagPicker({
  tags,
  selectedIds,
  canEdit,
  onToggle,
  onCreate,
  onRecolor,
  onDelete,
  trigger,
  align = "start",
  open,
  onOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [query, setQuery] = useState("");
  const [recoloringId, setRecoloringId] = useState<string | null>(null);

  const selected = new Set(selectedIds);
  const q = query.trim().toLowerCase();
  const sorted = [...tags].sort((a, b) => a.name.localeCompare(b.name));
  const filtered = q ? sorted.filter((t) => t.name.toLowerCase().includes(q)) : sorted;
  const exact = tags.some((t) => t.name.trim().toLowerCase() === q);
  const canCreate = canEdit && q.length > 0 && !exact;

  const handleCreate = () => {
    const name = query.trim();
    if (!name) return;
    onCreate(name);
    setQuery("");
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQuery("");
          setRecoloringId(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            disabled={!canEdit}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <TagIcon className="size-3.5" aria-hidden />
            Add tag
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={canEdit ? "Filter or create…" : "Filter tags…"}
          />
          <CommandList>
            <CommandGroup>
              {filtered.map((tag) => {
                const color = normalizeLabelColor(tag.color);
                const isSelected = selected.has(tag.id);
                return (
                  <Fragment key={tag.id}>
                    <CommandItem
                      value={tag.id}
                      onSelect={() => onToggle(tag.id)}
                      className="group/item"
                    >
                      <button
                        type="button"
                        aria-label={canEdit && onRecolor ? `Recolor #${tag.name}` : undefined}
                        data-label={color}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (canEdit && onRecolor) {
                            setRecoloringId((id) => (id === tag.id ? null : tag.id));
                          }
                        }}
                        className={cn(
                          "tag-dot size-2.5 shrink-0 rounded-full",
                          canEdit && onRecolor
                            ? "ring-offset-1 ring-offset-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            : "pointer-events-none",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-muted-foreground/70">#</span>
                        {tag.name}
                      </span>
                      {isSelected ? <Check className="size-4 text-foreground" aria-hidden /> : null}
                      {canEdit && onDelete ? (
                        <button
                          type="button"
                          aria-label={`Delete #${tag.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(tag.id);
                          }}
                          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/item:opacity-100 group-data-[selected=true]/item:opacity-100"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      ) : null}
                    </CommandItem>
                    {recoloringId === tag.id && onRecolor ? (
                      <SwatchStrip
                        current={color}
                        onPick={(c) => {
                          onRecolor(tag.id, c);
                          setRecoloringId(null);
                        }}
                      />
                    ) : null}
                  </Fragment>
                );
              })}

              {canCreate ? (
                <CommandItem value="__create__" onSelect={handleCreate}>
                  <Plus className="size-4" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    Create <span className="text-muted-foreground/70">#</span>
                    {query.trim()}
                  </span>
                </CommandItem>
              ) : null}

              {filtered.length === 0 && !canCreate ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {tags.length === 0 ? "No tags yet." : "No matches."}
                </p>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SwatchStrip({
  current,
  onPick,
}: {
  current: LabelColor;
  onPick: (color: LabelColor) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
      {LABEL_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          data-label={color}
          onClick={() => onPick(color)}
          className={cn(
            "tag-dot size-4 rounded-full transition-transform hover:scale-110",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-popover",
            color === current && "ring-2 ring-ring ring-offset-1 ring-offset-popover",
          )}
        />
      ))}
    </div>
  );
}
