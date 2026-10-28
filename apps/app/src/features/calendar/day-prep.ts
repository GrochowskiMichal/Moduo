// Day view prep (CALR-12, AC13): what sits in the free width beside a meeting
// in Day view — its people (not you), up to two linked notes, one follow-up
// (the first open linked task) and where it happens (the meeting link's
// provider, else the place's name). Pure: the links come from
// `ui/use-day-prep.ts`.

import { linkLines, placeLines } from "./event-view";
import type { CalendarEventModel } from "./events";

/** What a meeting links to, as the prep reads it. */
export type PrepLinks = {
  notes: { id: string; title: string }[];
  tasks: { id: string; title: string; done: boolean }[];
};

export type PrepPerson = { key: string; name: string; initials: string };

export type DayPrep = {
  people: PrepPerson[];
  notes: { id: string; title: string }[];
  followUp: { id: string; title: string } | null;
  where: { kind: "link" | "place"; label: string } | null;
};

/** Notes shown beside a meeting; the rest stay in the Event view. */
export const PREP_NOTES = 2;

const SHORT_PROVIDER: Record<string, string> = {
  "Google Meet": "Meet",
  "Microsoft Teams": "Teams",
  "Meeting link": "Link",
};

function initialsOf(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return letters.map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

export function dayPrep(
  event: Pick<
    CalendarEventModel,
    "attendees" | "conferenceUrl" | "conferenceProvider" | "location"
  >,
  links: PrepLinks | null,
): DayPrep {
  const people = (event.attendees ?? [])
    .filter((a) => !a.self)
    .map((a) => {
      const name = a.name?.trim() || a.email.split("@")[0] || a.email;
      return { key: a.email || name, name, initials: initialsOf(name) };
    });
  const link = linkLines(event);
  const place = placeLines(event.location);
  const where = link
    ? { kind: "link" as const, label: SHORT_PROVIDER[link.provider] ?? link.provider }
    : place
      ? { kind: "place" as const, label: place.name }
      : null;
  const open = links?.tasks.find((t) => !t.done);
  return {
    people,
    notes: (links?.notes ?? []).slice(0, PREP_NOTES),
    followUp: open ? { id: open.id, title: open.title } : null,
    where,
  };
}

/** Nothing to prepare: the aside draws nothing. */
export function isEmptyPrep(prep: DayPrep): boolean {
  return (
    prep.people.length === 0 && prep.notes.length === 0 && !prep.followUp && prep.where === null
  );
}
