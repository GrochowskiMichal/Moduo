// Teammates' lanes beside your week (CALR-16, AC30): a thin lane per shown
// teammate at each day column's edge, in their hue, with their blocks placed
// by the grid's own geometry. A block opens a small card with "Find a time
// with …". Lives in the hours grid's CSS grid, like the cursor; inline styles
// are geometry only.

import { dispatchCreateNew } from "../../../components/app/create-events";
import type { LabelColor } from "../../../components/tag-colors";
import { Button } from "../../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { chipSpanInDay, dayGeometry } from "../grid-layout";
import { localDayKey } from "../lens";
import { lanesForDay, type TeammateBlock } from "../teammates";
import { gridY } from "./grid-units";
import { setTeammates } from "./teammates-store";
import { formatTimeOfDay } from "./time-format";

type Props = {
  days: Date[];
  blocks: TeammateBlock[];
  owners: string[];
  hues: Record<string, LabelColor>;
  names: Record<string, string>;
};

/** Open the composer with "with <name> ", that teammate's lane showing. */
export function findTimeWith(id: string, name: string): void {
  setTeammates({ composerSeed: { text: `with ${name} `, ids: [id] } });
  dispatchCreateNew();
}

function LaneBlock({
  block,
  name,
  hue,
  geom,
}: {
  block: TeammateBlock;
  name: string;
  hue: LabelColor;
  /** The column's day: an overnight block sits on each day it crosses. */
  geom: ReturnType<typeof dayGeometry>;
}) {
  const span = chipSpanInDay(block.startMs, block.endMs, geom);
  if (!span) return null;
  const what = block.title ?? (block.kind === "focus" ? "Focus time" : "Busy");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-label={hue}
          aria-label={`${name}: ${what}`}
          className="pointer-events-auto absolute inset-x-0 rounded-sm bg-label-fill"
          style={{ top: gridY(span.topMinutes), height: gridY(span.heightMinutes) }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      </PopoverTrigger>
      <PopoverContent className="flex w-60 flex-col gap-1 p-3 text-sm">
        <span className="font-medium text-foreground">{name}</span>
        <span className="text-muted-foreground tabular-nums">
          {formatTimeOfDay(block.startMs)} – {formatTimeOfDay(block.endMs)}
        </span>
        <span className="text-foreground">{what}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 justify-start"
          onClick={() => findTimeWith(block.ownerId, name)}
        >
          Find a time with {name.split(" ")[0]}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function TeammateLanes({ days, blocks, owners, hues, names }: Props) {
  return (
    <>
      {days.map((day, col) => {
        const geom = dayGeometry(day);
        return (
          <div
            key={localDayKey(day)}
            className="pointer-events-none absolute inset-0"
            // Column 1 is the hour gutter.
            style={{ gridColumn: `${col + 2} / span 1`, gridRow: "1 / span 1" }}
          >
            {lanesForDay(blocks, owners, geom.dayStartMs, geom.dayEndMs).map((lane, i) => (
              <div
                key={lane.ownerId}
                data-teammate-lane={lane.ownerId}
                className="absolute inset-y-0 w-1"
                style={{ right: `${i * 0.375}rem` }}
              >
                {lane.blocks.map((b) => (
                  <LaneBlock
                    key={`${b.eventId ?? b.calendarId}:${b.startMs}`}
                    block={b}
                    name={names[lane.ownerId] ?? "Member"}
                    hue={hues[lane.ownerId] ?? "gray"}
                    geom={geom}
                  />
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
