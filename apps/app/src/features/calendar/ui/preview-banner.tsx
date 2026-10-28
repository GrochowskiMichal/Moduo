// The Preview as banner (CALR-16, AC29): above the grid while you see your
// week as a teammate does. Names their level on each of your calendars, says
// why a selected block looks as it does, opens Your calendar's share menu, and
// leaves with Done (or Esc).

import { Button } from "../../../components/ui/button";
import { previewBanner, previewExplain, type PreviewItem, type PreviewLevel } from "../share-lens";
import { setTeammates, useTeammatesStore } from "./teammates-store";

type Props = {
  name: string;
  levels: { calendarId: string; level: PreviewLevel }[];
  failed: boolean;
  loading: boolean;
  selected: PreviewItem | null;
};

export function PreviewBanner({ name, levels, failed, loading, selected }: Props) {
  const calendars = useTeammatesStore((s) => s.myCalendars);
  const first = name.split(" ")[0];
  const levelOf = new Map(levels.map((l) => [l.calendarId, l.level]));
  const named = calendars.map((c) => ({
    name: c.main ? "Your calendar" : c.name,
    level: levelOf.get(c.id) ?? ("none" as const),
    main: c.main,
  }));
  const main = calendars.find((c) => c.main);
  const calName = selected
    ? (named[calendars.findIndex((c) => c.id === selected.event.calendarRef)]?.name ??
      "This calendar")
    : "";
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted px-3 py-2 text-sm"
    >
      <span className="min-w-0 flex-1 text-foreground">
        {failed
          ? `Couldn't load your week as ${name} sees it. Leave the preview and try again.`
          : loading
            ? `Loading your week as ${name} sees it…`
            : previewBanner(name, named)}
      </span>
      {selected ? (
        <span className="basis-full text-muted-foreground">
          {previewExplain(selected, first, calName)}
        </span>
      ) : null}
      {main ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setTeammates({ shareOpen: main.id })}
        >
          Change what {first} sees
        </Button>
      ) : null}
      <Button type="button" size="sm" onClick={() => setTeammates({ previewAs: null })}>
        Done
      </Button>
    </div>
  );
}
