// "Link existing…" / "Set company" picker (block CO-4, AC5/AC8). A thin wrapper
// over the spine's registry-backed MentionPicker (CT-4) + useMentionSearch: the
// caller supplies the entity types to search and a trigger control, and gets the
// chosen candidate back to write through contacts.link. Search runs only while
// the popover is open.

import { type ReactNode, useState } from "react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import { useMentionSearch } from "../../spine/hooks/use-mention-search";
import type { MentionCandidate } from "../../spine/mention";
import { MentionPicker } from "../../spine/ui/mention-picker";

export type EntityLinkPickerProps = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** Entity types to search (e.g. ["task","note"] or ["company"]). */
  types: string[];
  canCreate?: boolean;
  createType?: string | null;
  placeholder?: string;
  emptyLabel?: string;
  trigger: ReactNode;
  onPick: (candidate: MentionCandidate) => void;
};

export function EntityLinkPicker({
  runtime,
  workspaceId,
  types,
  canCreate = false,
  createType = null,
  placeholder,
  emptyLabel,
  trigger,
  onPick,
}: EntityLinkPickerProps) {
  const [open, setOpen] = useState(false);
  const search = useMentionSearch({
    runtime,
    workspaceId,
    trigger: "ref",
    types,
    canCreate,
    createType,
    includePeople: false,
    enabled: open,
  });

  return (
    <MentionPicker
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      candidates={search.candidates}
      query={search.query}
      onQueryChange={search.setQuery}
      loading={search.loading}
      placeholder={placeholder}
      emptyLabel={emptyLabel}
      onSelect={(candidate) => {
        setOpen(false);
        onPick(candidate);
      }}
    />
  );
}
