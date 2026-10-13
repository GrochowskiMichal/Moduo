/**
 * The muted meta line under a note's title (specs/notes-refresh.md NR-3, AC6):
 * linked-entity chips, then "Edited … ago". A named chip opens its entity; a
 * count chip opens the Detail panel, where the full list lives.
 */

import type { EntityRef } from "../../../lib/entity-links";
import type { NoteMetaLine } from "../note-meta";

const CHIP =
  "rounded-sm px-0.5 text-muted-foreground transition-colors duration-(--motion-fade) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function NoteMetaLineView({
  line,
  onOpenEntity,
  onOpenDetail,
}: {
  line: NoteMetaLine;
  onOpenEntity: (ref: EntityRef) => void;
  onOpenDetail: () => void;
}) {
  if (line.chips.length === 0 && !line.edited) return null;
  return (
    <p
      data-note-meta-line
      className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden whitespace-nowrap font-sans text-sm text-muted-foreground"
    >
      {line.chips.map((chip) => (
        <span key={chip.key} className="flex min-w-0 shrink items-center gap-1.5">
          <button
            type="button"
            className={`${CHIP} max-w-48 truncate`}
            onClick={() => (chip.kind === "entity" ? onOpenEntity(chip.ref) : onOpenDetail())}
          >
            {chip.label}
          </button>
          <span aria-hidden>·</span>
        </span>
      ))}
      {line.edited ? <span className="tabular-nums">{line.edited}</span> : null}
    </p>
  );
}
