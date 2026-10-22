// The picker a selection's action opens (TV-U12): Assign, Tag, Date, Move,
// Status, Section, Priority, Waiting on, Team. One search dialog for all of
// them, as the Inbox's "File in…" is: a key or the bottom bar opens it with
// nothing on screen to anchor a popover to. The items come from
// `use-bulk-actions.tsx`; this only lists, filters and picks.

import { Check } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../../../components/ui/command";

export type BulkPickerItem = {
  key: string;
  label: string;
  /** What the item searches by besides its label (a person's full name). */
  keywords?: string;
  /** A 14 px mark before the label (a status icon, an avatar, a dot). */
  icon?: ReactNode;
  /** Every selected task has it already (a tag they all carry). */
  checked?: boolean;
  /** Its key in the picker ("1"), or a quiet word ("each own date"). */
  hint?: string;
  onPick: () => void;
};

export function BulkPickerDialog({
  open,
  title,
  description,
  placeholder,
  items,
  empty = "Nothing matches.",
  create,
  onClose,
}: {
  open: boolean;
  /** "Assign 4 tasks to…" (read by screen readers; the input says it too). */
  title: string;
  description: string;
  placeholder: string;
  items: readonly BulkPickerItem[];
  empty?: string;
  /** What a typed word that matches nothing makes ("Create tag “urgent”"). */
  create?: (query: string) => { label: string; onPick: () => void } | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? items.filter((i) => `${i.label} ${i.keywords ?? ""}`.toLowerCase().includes(q))
    : items;
  const made = q && !items.some((i) => i.label.toLowerCase() === q) ? create?.(query.trim()) : null;
  const close = () => {
    setQuery("");
    onClose();
  };
  const pick = (run: () => void) => {
    setQuery("");
    run();
  };
  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title={title}
      description={description}
      commandProps={{ shouldFilter: false, label: title }}
    >
      <CommandInput placeholder={placeholder} value={query} onValueChange={setQuery} />
      <CommandList>
        {made ? null : <CommandEmpty>{empty}</CommandEmpty>}
        {shown.length > 0 ? (
          <CommandGroup>
            {shown.map((item) => (
              <CommandItem key={item.key} value={item.key} onSelect={() => pick(item.onPick)}>
                {item.icon !== undefined ? (
                  <span
                    aria-hidden
                    className="flex size-icon-sm shrink-0 items-center justify-center text-muted-foreground"
                  >
                    {item.icon}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 break-words">{item.label}</span>
                {item.checked ? (
                  <Check aria-label="All have it" className="size-icon-sm text-muted-foreground" />
                ) : null}
                {item.hint ? <CommandShortcut>{item.hint}</CommandShortcut> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {made ? (
          <CommandGroup>
            <CommandItem value="__create__" onSelect={() => pick(made.onPick)}>
              <span className="min-w-0 flex-1 break-words">{made.label}</span>
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
