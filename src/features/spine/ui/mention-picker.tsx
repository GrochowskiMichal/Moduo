// Connective-tissue spine — the MentionPicker (block CT-4).
//
// The reusable registry-backed picker for the `@` / `/ref` gestures (and the
// keyboard "Link to…" equivalent on any drag-source row). Composes shadcn
// `Command` + `Popover` (DESIGN_BRIEF Component Inventory) — keyboard-first,
// type-aware, neutral. It is presentational + controlled: candidates, query,
// and loading come from `useMentionSearch`; selection is funnelled through the
// pure `resolveMention` by the caller. `MentionCommand` is the inner list,
// exported so caret-anchored surfaces can reuse it without a second Popover.

import { type ReactNode } from "react";
import { Plus, User } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { resolveEntityIcon } from "../icon-map";
import { type MentionCandidate } from "../mention";

/** A stable key for a candidate (entity ref / member id / create token). */
export function mentionCandidateKey(candidate: MentionCandidate): string {
  switch (candidate.kind) {
    case "entity":
      return `entity:${candidate.ref.type}:${candidate.ref.id}`;
    case "person":
      return `person:${candidate.memberId}`;
    case "create":
      return `create:${candidate.entityType}`;
  }
}

function CandidateRow({ candidate }: { candidate: MentionCandidate }) {
  if (candidate.kind === "create") {
    return (
      <>
        <Plus className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          Create {candidate.entityType}{" "}
          <span className="text-foreground">&ldquo;{candidate.label}&rdquo;</span>
        </span>
      </>
    );
  }
  const Icon =
    candidate.kind === "person" ? User : resolveEntityIcon(candidate.ref.type, candidate.icon);
  return (
    <>
      <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
      {candidate.kind === "person" ? (
        <span className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground/70">
          person
        </span>
      ) : null}
    </>
  );
}

export type MentionCommandProps = {
  candidates: MentionCandidate[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (candidate: MentionCandidate) => void;
  loading?: boolean;
  placeholder?: string;
  emptyLabel?: string;
};

/** The inner Command list — reusable by both the Popover picker and the caret menu. */
export function MentionCommand({
  candidates,
  query,
  onQueryChange,
  onSelect,
  loading,
  placeholder = "Search…",
  emptyLabel = "No matches.",
}: MentionCommandProps) {
  return (
    <Command shouldFilter={false}>
      <CommandInput value={query} onValueChange={onQueryChange} placeholder={placeholder} />
      <CommandList>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Searching…</p>
        ) : candidates.length === 0 ? (
          <CommandEmpty>{emptyLabel}</CommandEmpty>
        ) : (
          <CommandGroup>
            {candidates.map((candidate) => (
              <CommandItem
                key={mentionCandidateKey(candidate)}
                value={mentionCandidateKey(candidate)}
                onSelect={() => onSelect(candidate)}
              >
                <CandidateRow candidate={candidate} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

export type MentionPickerProps = MentionCommandProps & {
  /** The control that opens the picker (asChild). */
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
};

/** The Popover-anchored picker for button surfaces (e.g. keyboard "Link to…"). */
export function MentionPicker({
  trigger,
  open,
  onOpenChange,
  align = "start",
  ...command
}: MentionPickerProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-0">
        <MentionCommand {...command} />
      </PopoverContent>
    </Popover>
  );
}
