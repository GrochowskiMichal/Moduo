// The rebuilt /calendar page (CAL-1): three-pane shell, Week/Day task-lens
// grid, left rail. The right panel (switchable Tasks | Detail surface) lands
// with CAL-3 — hidden until then. Rides ONLY shipped Tasks reads/ops, so the
// page works with zero calendar tables deployed (the AC13 degrade posture).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import type { TasksModuleApi } from "../../tasks/hooks/use-tasks-module";
import {
  blocksByDay,
  localDayKey,
  parseDayKey,
  rangeLabel,
  startOfLocalDay,
  stepAnchor,
  taskBlocks,
  visibleRange,
  type CalendarView,
} from "../lens";
import {
  readCalendarPrefs,
  readViewState,
  writeViewState,
  type CalendarViewState,
} from "../prefs";
import { CalendarGrid } from "./calendar-grid";
import { CalendarRail } from "./calendar-rail";
import { CalendarToolbar } from "./calendar-toolbar";

type Props = {
  api: TasksModuleApi;
  userId: string;
  workspaceId: string;
};

export function CalendarPageView({ api, userId, workspaceId }: Props) {
  const [viewState, setViewState] = useState<CalendarViewState>(() =>
    readViewState(userId, workspaceId),
  );
  // Workspace/user switch → that context's own remembered view.
  useEffect(() => {
    setViewState(readViewState(userId, workspaceId));
  }, [userId, workspaceId]);

  const prefs = useMemo(() => readCalendarPrefs(userId), [userId]);

  const anchor = useMemo(
    () => parseDayKey(viewState.anchor) ?? startOfLocalDay(new Date()),
    [viewState.anchor],
  );
  const range = useMemo(
    () => visibleRange(viewState.view, anchor, prefs),
    [viewState.view, anchor, prefs],
  );
  const blocks = useMemo(() => taskBlocks(api.tasks, range), [api.tasks, range]);
  const grouped = useMemo(() => blocksByDay(blocks), [blocks]);
  // Mini-month density dots cover EVERY scheduled task the bundle knows, not
  // just the visible range — the dots exist to inform navigation to days you
  // can't currently see.
  const busyDayKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const t of api.tasks) {
      if (!t.scheduledAt || t.status === "archived") continue;
      const d = new Date(t.scheduledAt);
      if (!Number.isNaN(d.getTime())) keys.add(localDayKey(d));
    }
    return keys;
  }, [api.tasks]);

  const update = useCallback(
    (next: CalendarViewState) => {
      setViewState(next);
      writeViewState(userId, workspaceId, next);
    },
    [userId, workspaceId],
  );

  const setView = useCallback(
    (view: CalendarView) => update({ ...viewState, view }),
    [update, viewState],
  );
  const goToday = useCallback(
    () => update({ ...viewState, anchor: localDayKey(new Date()) }),
    [update, viewState],
  );
  const step = useCallback(
    (dir: 1 | -1) =>
      update({
        ...viewState,
        anchor: localDayKey(stepAnchor(viewState.view, anchor, dir)),
      }),
    [update, viewState, anchor],
  );
  const goToDate = useCallback(
    (day: Date) => update({ ...viewState, anchor: localDayKey(day) }),
    [update, viewState],
  );

  // Keyboard nav (AC1): T today · ←/→ period · D/W views. Handlers routed
  // through a ref so the one listener never captures stale state.
  const keysRef = useRef({ setView, goToday, step });
  keysRef.current = { setView, goToday, step };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          // Don't steal keys from open overlays (menus typeahead on plain
          // character keys without preventDefault; dialogs own their focus).
          target.closest("[role='dialog'], [role='menu'], [role='listbox'], [role='combobox']"))
      ) {
        return;
      }
      const k = keysRef.current;
      switch (e.key) {
        case "t":
        case "T":
          k.goToday();
          break;
        case "d":
        case "D":
          k.setView("day");
          break;
        case "w":
        case "W":
          k.setView("week");
          break;
        case "ArrowLeft":
          k.step(-1);
          break;
        case "ArrowRight":
          k.step(1);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onToggleDone = useCallback(
    (taskId: string) => {
      const task = api.tasks.find((t) => t.id === taskId);
      if (task) api.toggleDone(task);
    },
    [api],
  );

  return (
    <FeaturePanelsShell
      feature="calendar"
      hideRight
      left={
        <CalendarRail
          anchor={anchor}
          onSelectDate={goToDate}
          busyDayKeys={busyDayKeys}
          prefs={prefs}
        />
      }
      center={
        <div className="flex h-full min-h-0 flex-col">
          <CalendarToolbar
            view={viewState.view}
            label={rangeLabel(range)}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onToday={goToday}
            onViewChange={setView}
          />
          <CalendarGrid
            view={viewState.view}
            days={range.days}
            blocksByDay={grouped}
            prefs={prefs}
            loading={api.loading}
            error={api.error}
            onRetry={() => void api.reload()}
            canEdit={api.canEdit}
            onToggleDone={onToggleDone}
          />
        </div>
      }
    />
  );
}
