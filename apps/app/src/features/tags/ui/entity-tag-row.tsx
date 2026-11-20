// One item's tag-chip row: contact/company cards (fix pack FX-2, AC3 —
// designer decision: tags live in the header, under the subtitle), the note
// and email detail panels. Chips are hue + name (color never the only signal);
// removing detaches, never deletes; the picker is the shared workspace
// TagPicker Tasks uses, fed by the shared tag store (TV-T1).

import { Plus } from "lucide-react";

import { TagAddButton, TagChip } from "@/components/tag-chip";
import { TagPicker } from "@/components/tag-picker";
import { PropertyValue } from "@/components/ui/property-row";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";

import { useEntityTags } from "../hooks/use-entity-tags";

export function EntityTagRow({
  runtime,
  workspaceId,
  focus,
  canEdit,
  className,
  variant = "chips",
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  focus: EntityRef;
  canEdit: boolean;
  className?: string;
  /** "property": the value of a Tags property row, drawn as Tasks' detail
   * panel draws it ("+ Add tag", then chips with a small +). */
  variant?: "chips" | "property";
}) {
  const { tags, attached, toggle, create, recolor, remove } = useEntityTags(
    runtime,
    workspaceId,
    focus,
  );

  // Read-only with nothing attached → render nothing (no empty affordance).
  if (!canEdit && attached.length === 0) {
    return variant === "property" ? (
      <span className="font-sans text-sm text-muted-foreground">No tags</span>
    ) : null;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {attached.map((t) => (
        <TagChip
          key={t.id}
          name={t.name}
          color={t.color}
          size="md"
          onRemove={canEdit ? () => toggle(t.id) : undefined}
        />
      ))}
      {canEdit ? (
        <TagPicker
          tags={tags.filter((t) => !t.deletedAt)}
          selectedIds={attached.map((t) => t.id)}
          canEdit={canEdit}
          onToggle={toggle}
          onCreate={create}
          onRecolor={recolor}
          onDelete={remove}
          trigger={
            variant === "property" ? (
              attached.length === 0 ? (
                <PropertyValue icon={<Plus />} empty aria-label="Add tag">
                  Add tag
                </PropertyValue>
              ) : (
                <TagAddButton />
              )
            ) : undefined
          }
        />
      ) : null}
    </div>
  );
}
