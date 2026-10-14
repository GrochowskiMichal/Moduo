// One item's tag-chip row: contact/company cards (fix pack FX-2, AC3 —
// designer decision: tags live in the header, under the subtitle), the note
// and email detail panels. Chips are hue + name (color never the only signal);
// removing detaches, never deletes; the picker is the shared workspace
// TagPicker Tasks uses, fed by the shared tag store (TV-T1).

import { TagChip } from "@/components/tag-chip";
import { TagPicker } from "@/components/tag-picker";
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
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  focus: EntityRef;
  canEdit: boolean;
  className?: string;
}) {
  const { tags, attached, toggle, create, recolor, remove } = useEntityTags(
    runtime,
    workspaceId,
    focus,
  );

  // Read-only with nothing attached → render nothing (no empty affordance).
  if (!canEdit && attached.length === 0) return null;

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
        />
      ) : null}
    </div>
  );
}
