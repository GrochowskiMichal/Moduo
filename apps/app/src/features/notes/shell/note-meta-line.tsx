/**
 * The muted meta line under a note's title (specs/notes-refresh.md NR-3, AC6):
 * linked-entity chips, then the note's own state (Public, open comments),
 * then "Edited … ago" (or an agent's edit with Undo, NR-6). A named chip opens
 * its entity; a count chip opens the Detail panel, where the full list lives.
 */

import { Fragment, type ReactNode } from "react";

import type { EntityRef } from "../../../lib/entity-links";
import type { NoteMetaLine } from "../note-meta";

export const META_CHIP =
  "rounded-sm px-0.5 text-muted-foreground transition-colors duration-(--motion-fade) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function NoteMetaLineView({
  line,
  state = [],
  onOpenEntity,
  onOpenDetail,
  onUndo,
}: {
  line: NoteMetaLine;
  /** The note's own state chips (Public, open comments), keyed, in order. */
  state?: Array<{ key: string; node: ReactNode }>;
  onOpenEntity: (ref: EntityRef) => void;
  onOpenDetail: () => void;
  /** Revert the agent edit the line names (shown when `line.undoable`). */
  onUndo?: () => void;
}) {
  if (line.chips.length === 0 && state.length === 0 && !line.edited) return null;
  return (
    <p
      data-note-meta-line
      className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden whitespace-nowrap font-sans text-sm text-muted-foreground"
    >
      {line.chips.map((chip) => (
        <span key={chip.key} className="flex min-w-0 shrink items-center gap-1.5">
          <button
            type="button"
            className={`${META_CHIP} max-w-48 truncate`}
            onClick={() => (chip.kind === "entity" ? onOpenEntity(chip.ref) : onOpenDetail())}
          >
            {chip.label}
          </button>
          <span aria-hidden>·</span>
        </span>
      ))}
      {state.map((chip, i) => (
        <Fragment key={chip.key}>
          {chip.node}
          {i < state.length - 1 || line.edited ? <span aria-hidden>·</span> : null}
        </Fragment>
      ))}
      {line.edited ? <span className="tabular-nums">{line.edited}</span> : null}
      {line.undoable && onUndo ? (
        <>
          <span aria-hidden>·</span>
          <button type="button" className={META_CHIP} onClick={onUndo}>
            Undo
          </button>
        </>
      ) : null}
    </p>
  );
}
