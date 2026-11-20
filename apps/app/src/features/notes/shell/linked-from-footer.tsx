/**
 * "Linked from (n)" at the foot of a note (specs/notes-refresh.md NR-3, AC6):
 * everything that links to this note, grouped by relationship, each with its
 * hub snippet. Quiet: hidden entirely when nothing links here.
 */

import type { EntityRef } from "../../../lib/entity-links";
import { backlinkCount, type BacklinkGroup } from "../note-meta";

export function LinkedFromFooter({
  groups,
  onOpen,
}: {
  groups: BacklinkGroup[];
  onOpen: (ref: EntityRef) => void;
}) {
  const total = backlinkCount(groups);
  if (total === 0) return null;
  return (
    <section aria-label="Linked from" className="mt-10 border-t border-hairline pt-4 pb-16">
      <h2 className="mb-2 font-sans text-2xs text-muted-foreground">
        Linked from <span className="tabular-nums">({total})</span>
      </h2>
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.kind}>
            <h3 className="px-2 pb-0.5 font-sans text-2xs text-muted-foreground">{group.label}</h3>
            <ul>
              {group.rows.map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => onOpen(row.ref)}
                    className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left font-sans text-sm transition-colors duration-(--motion-fade) hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate text-foreground">{row.title}</span>
                    {row.snippet ? (
                      <span className="min-w-0 truncate text-muted-foreground">{row.snippet}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
