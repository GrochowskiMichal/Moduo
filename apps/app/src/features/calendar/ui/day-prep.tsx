// The prep beside a meeting in Day view (CALR-12, AC13): its people as
// initials, up to two linked notes, one follow-up (the ringed task) and where
// it happens. Quiet chips in the free width of the event card; they read, the
// card opens (a click anywhere on it opens the event as before).

import { FileText, MapPin, Video } from "lucide-react";

import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { type DayPrep, isEmptyPrep } from "../day-prep";

/** People shown as initials; the rest are a count. */
const PREP_PEOPLE = 3;

const CHIP =
  "inline-flex h-(--ctrl-h-xs) min-w-0 max-w-(--cal-prep-chip-max) shrink items-center gap-1 rounded-sm bg-tag-chip-surface px-1.5 text-2xs whitespace-nowrap text-muted-foreground";

export function DayPrepAside({ prep }: { prep: DayPrep }) {
  if (isEmptyPrep(prep)) return null;
  const people = prep.people.slice(0, PREP_PEOPLE);
  const extra = prep.people.length - people.length;
  return (
    <div data-day-prep className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      {people.length > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-0.5">
          {people.map((p) => (
            <Avatar key={p.key} size="icon" role="img" aria-label={p.name} title={p.name}>
              <AvatarFallback aria-hidden>{p.initials}</AvatarFallback>
            </Avatar>
          ))}
          {extra > 0 ? (
            <span className="text-2xs text-muted-foreground tabular-nums">+{extra}</span>
          ) : null}
        </span>
      ) : null}
      {prep.notes.map((note) => (
        <span key={note.id} className={CHIP} title={note.title}>
          <FileText aria-hidden className="size-icon-xs shrink-0" />
          <span className="min-w-0 truncate">{note.title}</span>
        </span>
      ))}
      {prep.followUp ? (
        <span className={CHIP} title={`Follow-up: ${prep.followUp.title}`}>
          <span
            aria-hidden
            className="size-icon-xs shrink-0 rounded-full border border-timeline-outline"
          />
          <span className="sr-only">Follow-up: </span>
          <span className="min-w-0 truncate">{prep.followUp.title}</span>
        </span>
      ) : null}
      {prep.where ? (
        <span className={CHIP} title={prep.where.label}>
          {prep.where.kind === "link" ? (
            <Video aria-hidden className="size-icon-xs shrink-0" />
          ) : (
            <MapPin aria-hidden className="size-icon-xs shrink-0" />
          )}
          <span className="min-w-0 truncate">{prep.where.label}</span>
        </span>
      ) : null}
    </div>
  );
}
