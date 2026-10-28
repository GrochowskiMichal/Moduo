// What the week shows (CALR-16): your own events, with the teammates you turned
// on (or named in the composer) as lanes beside them; or, while previewing,
// your week exactly as a teammate sees it (the server's masked read for them),
// read-only, with no tasks and no lanes. Kept out of the page, which only
// swaps in what this returns.

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Button } from "../../../components/ui/button";
import type { SharedCalendar } from "../../../lib/calendar-busy";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { useWorkspace } from "../../workspaces/workspace-context";
import type { CalendarEventModel } from "../events";
import type { VisibleRange } from "../lens";
import { previewLens, type PreviewLevel } from "../share-lens";
import {
  laneOwners,
  legendLine,
  splitTeammateEvents,
  teammateBlocks,
  teammateHues,
  teammatesSharing,
} from "../teammates";
import { PreviewBanner } from "./preview-banner";
import { PreviewAsMenu, readShownTeammates, saveShownTeammates } from "./shared-with-you";
import { TeammateLanes } from "./teammate-lanes";
import { setTeammates, useTeammatesStore } from "./teammates-store";

type Preview = {
  rows: CalendarEventModel[];
  busy: CalendarEventModel[];
  levels: { calendarId: string; level: PreviewLevel }[];
  failed: boolean;
};

const FAILED: Preview = { rows: [], busy: [], levels: [], failed: true };

/** The preview read for the visible window, while previewing. */
function usePreviewRead(
  runtime: ModuoRuntime | null,
  workspaceId: string,
  range: VisibleRange,
  as: string | null,
): Preview | null {
  const [read, setRead] = useState<{ key: string; value: Preview } | null>(null);
  const key = `${as}:${range.startMs}:${range.endMs}`;
  useEffect(() => {
    if (!as) return;
    let live = true;
    const run = runtime?.calendar.preview;
    const window = {
      fromIso: new Date(range.startMs).toISOString(),
      toIso: new Date(range.endMs).toISOString(),
    };
    (run ? run({ workspaceId, as, window }) : Promise.resolve(FAILED))
      .catch(() => FAILED)
      .then((value) => {
        if (live) setRead({ key, value });
      });
    return () => {
      live = false;
    };
  }, [runtime, workspaceId, as, key, range.startMs, range.endMs]);
  // Esc leaves the preview.
  useEffect(() => {
    if (!as) return;
    // Bubble phase, and only when nothing else wants Esc: an open menu,
    // dialog or popover (the share menu, ⌘K) or a field closes first.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (
        document.querySelector(
          "[role='dialog'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]",
        )
      )
        return;
      setTeammates({ previewAs: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [as]);
  return as && read?.key === key ? read.value : null;
}

const NO_SHARED: SharedCalendar[] = [];
const DAY_MS = 86_400_000;
/** How far past the visible range teammates' blocks reach (lanes cut them per day). */
export const LOOKAHEAD_DAYS = 21;
const EMPTY = new Map();

export function useCalendarLens(q: {
  runtime: ModuoRuntime | null;
  userId: string;
  workspaceId: string;
  events: CalendarEventModel[];
  range: VisibleRange;
  accountHues: Record<string, string>;
}) {
  const { runtime, userId, workspaceId, events, range, accountHues } = q;
  const { members } = useWorkspace();
  const people = useMemo(
    () =>
      members
        .filter((m) => m.isActive && !m.removedAt)
        .map((m) => ({ userId: m.userId, name: m.displayName || "Teammate" })),
    [members],
  );
  const [shared, setShared] = useState<{ ws: string; list: SharedCalendar[] } | null>(null);
  useEffect(() => {
    let live = true;
    setTeammates({ shown: readShownTeammates(userId, workspaceId), previewAs: null });
    void runtime?.calendar
      .sharedWithMe?.(workspaceId)
      .then((list) => live && setShared({ ws: workspaceId, list }));
    return () => {
      live = false;
    };
  }, [runtime, userId, workspaceId]);
  const list = shared?.ws === workspaceId ? shared.list : NO_SHARED;

  const shown = useTeammatesStore((s) => s.shown);
  const named = useTeammatesStore((s) => s.named);
  const as = useTeammatesStore((s) => s.previewAs);
  const teammates = useMemo(() => teammatesSharing(list, people, userId), [list, people, userId]);
  const split = useMemo(() => splitTeammateEvents(events, list, userId), [events, list, userId]);
  // The composer's ⇥ walks up to two weeks past the draft: give it three past the view.
  const blocks = useMemo(
    () =>
      teammateBlocks(split.theirs, list, {
        startMs: range.startMs - DAY_MS,
        endMs: range.endMs + LOOKAHEAD_DAYS * DAY_MS,
      }),
    [split, list, range.startMs, range.endMs],
  );
  useEffect(() => setTeammates({ teammates, blocks }), [teammates, blocks]);
  const ids = teammates.map((t) => t.userId);
  const owners = laneOwners(
    shown.filter((id) => ids.includes(id)),
    named.filter((id) => ids.includes(id)),
  );
  const hues = teammateHues(owners, Object.values(accountHues));
  const names = Object.fromEntries(people.map((p) => [p.userId, p.name]));

  const preview = usePreviewRead(runtime, workspaceId, range, as);
  const items = useMemo(() => (preview ? previewLens(preview) : []), [preview]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const previewing = as !== null;
  const selected = previewing
    ? (items.find((i) => selectedKey?.startsWith(`${i.event.id}:`)) ?? null)
    : null;

  const legend = legendLine(teammates.filter((t) => owners.includes(t.userId)));
  const top: ReactNode = previewing ? (
    <PreviewBanner
      name={names[as] ?? "Teammate"}
      levels={preview?.levels ?? []}
      failed={preview?.failed ?? false}
      loading={!preview}
      selected={selected}
    />
  ) : legend ? (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{legend}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => saveShownTeammates(userId, workspaceId, [])}
      >
        Hide
      </Button>
    </div>
  ) : null;

  return {
    previewing,
    /** Your week, or the preview's rows and blocks as the teammate gets them. */
    events: previewing ? items.map((i) => i.event) : split.mine,
    /** Nothing is editable while previewing. */
    edit: (can: boolean) => can && !previewing,
    /** Tasks stay with you: none while previewing. */
    tasks: <T,>(byDay: T): T => (previewing ? (EMPTY as T) : byDay),
    /** A failed preview isn't an empty week. */
    faulted: (base: boolean) => base || Boolean(preview?.failed),
    /** While previewing a selection only explains the block; true = handled. */
    select: (key: string | null) => {
      if (!previewing) return false;
      setSelectedKey(key);
      return true;
    },
    top,
    layer:
      previewing || owners.length === 0 ? null : (
        <TeammateLanes
          days={range.days}
          blocks={blocks}
          owners={owners}
          hues={hues}
          names={names}
        />
      ),
    menu: previewing ? null : <PreviewAsMenu userId={userId} />,
  };
}
