// Focus, the screen (TV-F7, specs/tasks-v3.md §7; REPLAN 61–66, 62a, 63, 65a;
// prototype round-2a frames 1–3). The sidebar's Focus opens it; it replaces
// the old "Plan · Focus" switch and its Execute view.
//
//   Focus                                   [Focus 18:40]  ⋯     ← header: the name, Pomodoro's pill, ⋯
//   ┌ ● Website › Launch · Due Thu                 [⏸ 18:02 of ~45m] ┐
//   │ Draft the launch announcement                                    │  ← the Now card
//   │ description (folded) · references as chips · subtasks            │
//   └ [Done ⏎] [Skip S]                                                ┘
//   Up next · 4 · ~1h                                                  ← project dividers, numbered rows
//   2 done · 1h 12m · Show                                             ← the done line
//
// Everything about time goes through the one engine (`features/focus/timer.ts`,
// TV-F6): Start is "Focus on this" for the Now task, the pill pauses, Stop sits
// in ⋯ with "Focus stopped · Undo", leaving the view never stops a session.
// The parts that tick every second (the pills, the done line's time, "while you
// were away") are their own small components, so the card and Up next don't
// redraw with the clock. With nothing lined up the screen teaches the three
// ways in (call 66): Q, ⇧F, and today's scheduled tasks as real rows.
//
// TV-F8 (REPLAN 57, 59a, 64, 10, 62a; call 5): "Arrange by project" (⋯ and Up
// next's header), the moment between two tasks (the along-the-way offer, and
// Pomodoro's break) in the Now card's place, the next meeting as a divider in
// Up next, your usual pace, and Hand off W: the task waits on someone and
// moves to In flight (the panel's alongside view; "2 in flight" here opens it).

import { type FocusTimerMode, isFocusTimerMode, taskCategoryOf } from "@contracts/vocabularies";
import { Ellipsis, Pause, PlaneTakeoff, Play, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { CompleteToggle } from "../../../components/ui/complete-toggle";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { type FocusPrefs, useFocusPrefs } from "../../../lib/focus-prefs";
import { HotkeyScope, useAppHotkeys, useFocusWithin } from "../../../lib/hotkeys";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { undoToast } from "../../../lib/undo-toast";
import { bumpNotNow, clearNotNows, readNotNows } from "../../focus/along-the-way";
import { formatFocusClock } from "../../focus/clock";
import { getFocusSession, previewFocusInterval } from "../../focus/engine";
import { paceText, usualPace } from "../../focus/pace";
import {
  recordRunDone,
  setRunNotice,
  type TaskRefResolver,
  useFocusRunState,
} from "../../focus/run";
import { stopFocusWithUndo } from "../../focus/stop-with-undo";
import {
  changeFocusTimer,
  focusOn,
  moveFocusTo,
  skipFocusBreakHere,
  takeOverFocus,
  toggleFocusPause,
  useFocusTaskState,
  useFocusTimer,
} from "../../focus/timer";
import { dispatchOpenSettings } from "../../settings/settings-events";
import {
  ARRANGE_MIN_SAVED,
  alongTheWayOffer,
  arrangeByProject,
  arrangedQueue,
  doneLineText,
  focusLineup,
  MEETING_HORIZON_MS,
  type MeetingLine,
  meetingSlot,
  minutesLeft,
  NOT_NOWS_TO_ASK,
} from "../focus-screen";
import { estimateOf, type Task } from "../model";
import { byIdOf } from "../selectors";
import { bucketDotColor } from "../sidebar";
import {
  useTaskCommands,
  useTasksReader,
  useTasksSelector,
  useTasksStatus,
  useTasksUserId,
} from "../tasks-context";
import { AlongTheWayOffer, BreakOffer } from "./focus-between";
import { FocusEmptyState } from "./focus-empty-state";
import type { HandOff } from "./focus-hand-off";
import { FOCUS_PILL, NowCard, TIMER_LABELS } from "./focus-now-card";
import { UpNext } from "./focus-up-next";
import { useInFlight } from "./use-in-flight";
import { useNextMeeting } from "./use-next-meeting";

/** The moment between two tasks (TV-F8): one offer at a time, in Now's place. */
type BetweenOffer =
  | { kind: "break"; minutes: number; long: boolean }
  | { kind: "along"; task: Task; leavingProjectId: string; ask: boolean };

/** Pomodoro lengths offered in ⋯ (work / break minutes); others in Settings. */
const POMODORO_PRESETS: readonly { work: number; rest: number }[] = [
  { work: 25, rest: 5 },
  { work: 50, rest: 10 },
  { work: 90, rest: 15 },
];

type Props = {
  workspaceId: string;
  runtime: ModuoRuntime | null;
  canEdit: boolean;
  /** "Inbox", a project's name, or "Private project". */
  bucketNameById: (id: string) => string;
  /** The page's selection (the panel's Details). */
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /** Open a task's own details on top of the panel ("← item", call 65a). */
  onOpenTask: (id: string) => void;
  /** The task the panel's stack shows on top (a subtask opened from the card). */
  panelTaskId: string | null;
  /** New, at the top of Up next (call 90). */
  onRequestCapture: () => void;
  /** The page's one DndContext (DF-22) or, standalone, this view's own. */
  dndMode?: "internal" | "external";
  /** Open the panel on In flight ("2 in flight", TV-F8). */
  onShowInFlight?: () => void;
  /** Show a task's Details in the panel (the offer's Shrink, TV-F8). */
  onShowDetails?: (id: string) => void;
};

export function FocusView({
  workspaceId,
  runtime,
  canEdit,
  bucketNameById,
  selectedTaskId,
  onSelectTask,
  onOpenTask,
  panelTaskId,
  onRequestCapture,
  dndMode = "external",
  onShowInFlight,
  onShowDetails,
}: Props) {
  const focus = useFocusTaskState();
  const { run, ended, notice } = useFocusRunState();
  const { prefs, setPrefs } = useFocusPrefs();
  const [showDone, setShowDone] = useState(false);
  const [handOffOpen, setHandOffOpen] = useState(false);
  const [between, setBetween] = useState<BetweenOffer[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const me = useTasksUserId();
  const {
    markDone,
    addWaiting,
    addReminder,
    removeWaiting,
    removeReminder,
    arrangeQueue,
    moveQueuedToEnd,
    addToQueue,
    setTaskStatus,
    focusOnTask,
    focusRefOf,
  } = useTaskCommands();
  const read = useTasksReader();
  const tasks = useTasksSelector((d) => d.liveTasks);
  const queuedTasks = useTasksSelector((d) => d.queuedTasks);
  const queuedTaskIds = useTasksSelector((d) => d.queuedTaskIds);
  const blockedTaskIds = useTasksSelector((d) => d.blockedIds);
  const buckets = useTasksSelector((d) => d.buckets);
  const { loaded } = useTasksStatus();

  const taskById = byIdOf(tasks);
  // A session in this workspace (here or on another of my devices).
  const here = focus.active && focus.workspaceId === workspaceId;
  const sessionTask = here && focus.taskId ? (taskById.get(focus.taskId) ?? null) : null;
  // Lined-up tasks that wait on someone or something are In flight (TV-F8).
  const inFlight = useInFlight();
  const { now, upNext } = useMemo(
    () => focusLineup(queuedTasks, sessionTask, inFlight.waitingIds),
    [queuedTasks, sessionTask, inFlight.waitingIds],
  );
  // The session is on the card (else the card offers Start).
  const onNow = here && !!now && focus.taskId === now.id;
  const refOf = focusRefOf;

  // The panel follows Now (its Details), until you open something else: a row
  // in Up next or a scheduled task. A subtask stacks on top instead (65a).
  // Opening Focus shows Now, unless the task already open is lined up here (a
  // link to it); a task opened in another view doesn't follow you in.
  const shownNowRef = useRef<string | null>(null);
  const queuedRef = useRef(queuedTaskIds);
  useLayoutEffect(() => {
    queuedRef.current = queuedTaskIds;
  });
  useEffect(() => {
    const prev = shownNowRef.current;
    const next = now?.id ?? null;
    shownNowRef.current = next;
    if (!next || next.startsWith("tmp-")) return;
    const keep =
      selectedTaskId !== null &&
      selectedTaskId !== prev &&
      (prev !== null || queuedRef.current.has(selectedTaskId));
    if (!keep) onSelectTask(next);
  }, [now?.id, selectedTaskId, onSelectTask]);

  // ── the session's verbs (Start · Pause · Done · Stop) ──────────────────────
  const start = useCallback(() => {
    if (!now || !canEdit) return;
    const ref = refOf(now.id);
    if (!ref) return;
    setRunNotice(null);
    focusOn(ref, { timer: prefs.timer, resolveTask: refOf });
  }, [now, canEdit, refOf, prefs.timer]);

  // ── the moment between two tasks (TV-F8: 57, 59a, 62a) ────────────────────
  // Once per project change: leaving Acme for the same next task never offers
  // twice (a taken offer, finished, leads to the same switch).
  const offeredForRef = useRef<string | null>(null);
  const betweenOffers = useCallback(
    (leaving: Task, next: Task | null): BetweenOffer[] => {
      const out: BetweenOffer[] = [];
      if (!next) return out; // the session is ending: nothing is offered
      // Pomodoro's break first, once a work block has ended (it waits paused).
      const s = getFocusSession();
      if (
        onNow &&
        s.tracking &&
        s.timer === "pomodoro" &&
        s.phase === "break" &&
        !s.running &&
        s.workspaceId === workspaceId
      ) {
        out.push({ kind: "break", minutes: s.phaseSeconds / 60, long: s.longBreak });
      }
      const key = `${leaving.bucketId}>${next.id}`;
      if (prefs.alongTheWay && offeredForRef.current !== key) {
        const task = alongTheWayOffer({
          leaving,
          next,
          tasks,
          lineup: queuedTaskIds,
          me,
          blocked: blockedTaskIds,
          waiting: inFlight.waitingIds,
        });
        if (task) {
          offeredForRef.current = key;
          const ask = (readNotNows(me, workspaceId)[task.id] ?? 0) >= NOT_NOWS_TO_ASK;
          out.push({ kind: "along", task, leavingProjectId: leaving.bucketId, ask });
        }
      }
      return out;
    },
    [
      onNow,
      workspaceId,
      prefs.alongTheWay,
      tasks,
      queuedTaskIds,
      blockedTaskIds,
      me,
      inFlight.waitingIds,
    ],
  );
  const answered = useCallback(() => setBetween((list) => list.slice(1)), []);
  // Nothing left to move on to (the line-up ran out meanwhile): no offer waits.
  const hasNow = !!now;
  useEffect(() => {
    if (!hasNow) setBetween((list) => (list.length > 0 ? [] : list));
  }, [hasNow]);

  const done = useCallback(() => {
    if (!now || !canEdit) return;
    const next = firstReal(upNext);
    setRunNotice(null);
    const offers = betweenOffers(now, next);
    markDone(now.id);
    setBetween(offers);
    if (!onNow) return;
    // Counted in "n done" by the device that runs the clock: this one, now.
    takeOverFocus(refOf);
    recordRunDone(now.id);
    // The last one ends the session (62: "a session ends by itself when Up
    // next runs out"); the done line keeps its numbers.
    moveFocusTo(next ? refOf(next.id) : null, refOf);
  }, [now, canEdit, upNext, markDone, onNow, refOf, betweenOffers]);

  // ── Hand off W (TV-F8; call 5): it waits on someone, and moves to In flight ──
  const handOff = useCallback(
    (h: HandOff) => {
      if (!now || !canEdit) return;
      const task = now;
      const next = firstReal(upNext);
      const entryId = addWaiting(
        task.id,
        h.target.kind === "person"
          ? { kind: "person", ref: h.target.ref }
          : { kind: "text", label: h.target.label },
      );
      if (!entryId) return;
      if (h.checkBackAt) addReminder(task.id, "at", h.checkBackAt);
      if (h.note && runtime) {
        runtime.spine
          .addComment({
            workspaceId,
            entityType: "task",
            entityId: task.id,
            body: `Where I left off: ${h.note}`,
          })
          .catch(() => toast.error("Couldn’t save where you left off."));
      }
      setRunNotice(null);
      setBetween(betweenOffers(task, next));
      const moved = onNow;
      if (moved) {
        takeOverFocus(refOf);
        moveFocusTo(next ? refOf(next.id) : null, refOf);
      }
      const who = h.target.kind === "person" ? h.target.name : h.target.label;
      undoToast(`Waiting on ${who} · In flight`, {
        onUndo: () => {
          removeWaiting(entryId);
          if (h.checkBackAt) {
            const at = Date.parse(h.checkBackAt);
            const reminder = read().reminders.find(
              (r) => r.taskId === task.id && r.kind === "at" && r.at && Date.parse(r.at) === at,
            );
            if (reminder) removeReminder(reminder.id);
          }
          if (moved) moveFocusTo(refOf(task.id), refOf);
        },
      });
    },
    [
      now,
      canEdit,
      upNext,
      addWaiting,
      addReminder,
      removeWaiting,
      removeReminder,
      read,
      runtime,
      workspaceId,
      betweenOffers,
      onNow,
      refOf,
    ],
  );

  // ── Arrange by project (TV-F8: 57, 62) ───────────────────────────────────
  const arrangement = useMemo(() => arrangeByProject(now, upNext), [now, upNext]);
  const arrange = useCallback(() => {
    if (!canEdit || arrangement.saved < 1) return;
    const before = queuedTasks.map((t) => t.id);
    const after = arrangedQueue(
      before,
      upNext.map((t) => t.id),
      arrangement.order.map((t) => t.id),
    );
    // A move refused partway keeps what went through: say so, and Undo still
    // walks the line-up back.
    arrangeQueue(after, (partial) =>
      undoToast(partial ? "Arranged only in part" : "Arranged by project", {
        onUndo: () => arrangeQueue(before),
      }),
    );
  }, [canEdit, arrangement, queuedTasks, arrangeQueue, upNext]);

  // ── your usual pace (TV-F8, call 10) ─────────────────────────────────────
  const paceRatio = useMemo(
    () =>
      usualPace(
        tasks.map((t) => ({
          status: taskCategoryOf(t),
          completedBy: t.completedBy,
          completedAt: t.completedAt,
          updatedAt: t.updatedAt,
          timeSpentSeconds: t.timeSpentSeconds,
          estimate: estimateOf(t),
        })),
        me,
      ),
    [tasks, me],
  );

  // ── the next meeting (TV-F8, call 64) ─────────────────────────────────────
  const lineupMinutes = useMemo(
    () => [now, ...upNext].reduce((sum, t) => sum + (t ? (estimateOf(t) ?? 0) : 0), 0),
    [now, upNext],
  );
  const nextMeeting = useNextMeeting({
    runtime,
    workspaceId,
    me,
    horizonMs: Math.max(MEETING_HORIZON_MS, lineupMinutes * 60_000),
    enabled: !!now,
  });
  const meeting = useMemo<MeetingLine | null>(() => {
    if (!nextMeeting) return null;
    const index = meetingSlot(upNext, {
      nowMs: Date.now(),
      startsAt: nextMeeting.startsAt,
      hasNow: !!now,
      nowLeftMinutes: now ? minutesLeft(now) : null,
    });
    return { index, title: nextMeeting.title, startsAt: nextMeeting.startsAt };
  }, [nextMeeting, upNext, now]);

  const skip = useCallback(() => {
    if (!now || !canEdit) return;
    const next = firstReal(upNext);
    setRunNotice(null);
    if (queuedTaskIds.has(now.id)) moveQueuedToEnd(now.id);
    else addToQueue(now.id, "end");
    if (onNow && next) moveFocusTo(refOf(next.id), refOf);
  }, [now, canEdit, upNext, queuedTaskIds, moveQueuedToEnd, addToQueue, onNow, refOf]);

  const changeTimer = useCallback(
    (timer: FocusTimerMode) => {
      // The menu changes it everywhere (63): the default and the session.
      setPrefs({ timer });
      changeFocusTimer(timer, refOf);
    },
    [setPrefs, refOf],
  );

  // ── the offer's answers ──────────────────────────────────────────────────
  const offer = between[0] ?? null;
  const takeOffer = useCallback(() => {
    if (!offer) return;
    answered();
    if (offer.kind === "break") {
      // Take the break: its clock starts (it was waiting, paused).
      if (!getFocusSession().running) toggleFocusPause(refOf);
      return;
    }
    clearNotNows(me, workspaceId, offer.task.id);
    addToQueue(offer.task.id, "top");
    // With a session on, it gets the clock now; without one it's the Now card.
    if (onNow) {
      const ref = refOf(offer.task.id);
      if (ref) moveFocusTo(ref, refOf);
    }
  }, [offer, answered, refOf, me, workspaceId, addToQueue, onNow]);
  const declineOffer = useCallback(() => {
    if (!offer) return;
    answered();
    if (offer.kind === "break") skipFocusBreakHere(refOf);
    else bumpNotNow(me, workspaceId, offer.task.id);
  }, [offer, answered, refOf, me, workspaceId]);
  // Three Not-nows (57): Shrink · Move · Let go.
  const settleOffer = useCallback(
    (how: "shrink" | "backlog" | "wont_do") => {
      if (offer?.kind !== "along") return;
      answered();
      const task = offer.task;
      clearNotNows(me, workspaceId, task.id);
      if (how === "shrink") {
        onShowDetails?.(task.id);
        return;
      }
      const back = task.statusId ? { statusId: task.statusId } : { category: taskCategoryOf(task) };
      setTaskStatus(task.id, { category: how });
      undoToast(how === "backlog" ? "Moved to Backlog" : "Marked Won’t do", {
        onUndo: () => setTaskStatus(task.id, back),
      });
    },
    [offer, answered, me, workspaceId, onShowDetails, setTaskStatus],
  );

  // ── keys: ⏎ Done · S Skip · W Hand off · C new at the top · ⇧F on a row ────
  // Between tasks, ⏎ answers the offer's first action and Esc declines it.
  const keys = useRef({
    done,
    skip,
    onRequestCapture,
    focusOnTask,
    canEdit,
    offer,
    takeOffer,
    declineOffer,
    openHandOff: () => setHandOffOpen(true),
    dropOffers: () => setBetween([]),
    hasNow: !!now,
  });
  useLayoutEffect(() => {
    keys.current = {
      done,
      skip,
      onRequestCapture,
      focusOnTask,
      canEdit,
      offer,
      takeOffer,
      declineOffer,
      openHandOff: () => setHandOffOpen(true),
      dropOffers: () => setBetween([]),
      hasNow: !!now,
    };
  });
  // Registry bindings in the "focus" scope (lib/hotkeys), live only while the
  // screen holds focus: never from the sidebar, the panel, a field, or nowhere
  // at all (⏎ has no Undo).
  const focusInside = useFocusWithin(rootRef);
  const ours = (e: KeyboardEvent): Element | null => {
    const target = e.target instanceof Element ? e.target : null;
    if (e.repeat || !target || !rootRef.current?.contains(target)) return null;
    if (target.closest('[role="menu"],[role="dialog"],[role="listbox"]')) return null;
    return target;
  };
  // A focused button keeps its own Enter.
  const onControl = (target: Element) =>
    !!target.closest("button,a,[role='button'],[role='checkbox']");
  useAppHotkeys(
    {
      // ⇧F on a subtask or an Up next row: it becomes the Now card (65a).
      "focus.promote": (e) => {
        const target = ours(e);
        const k = keys.current;
        const id = target?.closest<HTMLElement>("[data-focus-task]")?.dataset.focusTask;
        if (!id || !k.canEdit) return false;
        // A new Now card: whatever was offered between tasks is moot.
        k.dropOffers();
        k.focusOnTask(id);
      },
      // Between tasks the offer holds Now's place: ⏎ takes it (the Shrink ·
      // Move · Let go ask has no ⏎ of its own), Esc declines.
      "focus.enter": (e) => {
        const target = ours(e);
        const k = keys.current;
        if (!target || onControl(target)) return false;
        if (k.offer) {
          if (k.offer.kind !== "break" && k.offer.ask) return false;
          k.takeOffer();
        } else {
          k.done();
        }
      },
      "focus.decline": (e) => {
        const k = keys.current;
        if (!ours(e) || !k.offer) return false;
        e.stopPropagation();
        k.declineOffer();
      },
      "focus.capture": (e) => {
        const k = keys.current;
        if (!ours(e) || !k.canEdit) return false;
        k.onRequestCapture();
      },
      "focus.skip": (e) => {
        const k = keys.current;
        if (!ours(e) || k.offer) return false;
        k.skip();
      },
      "focus.hand-off": (e) => {
        const k = keys.current;
        if (!ours(e) || k.offer || !k.canEdit || !k.hasNow) return false;
        k.openHandOff();
      },
    },
    { enabled: focusInside },
  );

  // The screen takes focus when nothing else holds it: on opening (from the
  // top bar, a reload), and when the button you used goes away (Done on the
  // last task). Start becoming the pill hands focus to the pill, so a second
  // ⏎ pauses (undoable) rather than finishing the task. A click on the
  // screen's empty parts focuses it too (tabIndex -1).
  // An answered offer (Not now, the break) takes its focused button with it,
  // so the screen takes focus back and the keys keep working (TV-F8).
  const offerShown = between.length > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Now, the session and the offer are the cues
  useEffect(() => {
    if (typeof document === "undefined" || document.activeElement !== document.body) return;
    const root = rootRef.current;
    const pill = root?.querySelector<HTMLElement>(
      '[data-slot="focus-task-pill"],[data-slot="focus-pomodoro-pill"]',
    );
    (pill ?? root)?.focus({ preventScroll: true });
  }, [now?.id, onNow, offerShown]);

  // ── what this session finished ("2 done · Show") ───────────────────────────
  const sessionRun = run && run.workspaceId === workspaceId ? run : null;
  const endedRun = !sessionRun && ended && ended.workspaceId === workspaceId ? ended : null;
  const doneIds = useMemo(() => {
    const ids = sessionRun?.doneTaskIds ?? endedRun?.doneTaskIds;
    if (ids) return ids;
    // No session yet: what you checked off here since the list loaded.
    return queuedTasks.filter((t) => t.status === "done").map((t) => t.id);
  }, [sessionRun, endedRun, queuedTasks]);
  const timed = (sessionRun?.mode ?? endedRun?.mode ?? prefs.timer) !== "off";
  // The run's notice is about this workspace's session only.
  const noticeOwner = run ?? ended;
  const noticeHere = !noticeOwner || noticeOwner.workspaceId === workspaceId;

  if (!loaded) return <FocusSkeleton />;

  const timerMode: FocusTimerMode = here && focus.timer ? focus.timer : prefs.timer;
  const header = (
    <div className="mb-3 flex shrink-0 items-center gap-2">
      <h1 className="min-w-0 flex-1 truncate font-display text-lg text-foreground">Focus</h1>
      {here && focus.timer === "pomodoro" ? <PomodoroPill resolveTask={refOf} /> : null}
      <FocusMenu
        timer={timerMode}
        prefs={prefs}
        onTimer={changeTimer}
        onPrefs={setPrefs}
        showDone={showDone}
        onShowDone={setShowDone}
        canStop={focus.active}
        canArrange={canEdit && arrangement.saved > 0}
        onArrange={arrange}
      />
    </div>
  );

  // Under Timer: Off nothing is timed, so there's no pace to read (63).
  const pace = paceText({
    minutes: upNext.reduce((sum, t) => sum + (estimateOf(t) ?? 0), 0),
    ratio: paceRatio,
    enabled: prefs.usualPace,
    timed: timerMode !== "off",
  });
  const inFlightLine =
    inFlight.items.length > 0 && onShowInFlight ? (
      <InFlightLine
        count={inFlight.items.length}
        attention={inFlight.attention}
        onShow={onShowInFlight}
      />
    ) : null;

  const doneLine =
    doneIds.length > 0 ? (
      <DoneLine
        count={doneIds.length}
        timed={timed}
        endedSeconds={endedRun?.focusedSeconds ?? null}
        live={!!sessionRun}
        shown={showDone}
        onToggle={() => setShowDone((v) => !v)}
      />
    ) : null;
  const doneList =
    showDone && doneIds.length > 0 ? (
      <DoneList ids={doneIds} taskById={taskById} bucketNameById={bucketNameById} />
    ) : null;

  return (
    <HotkeyScope scope="focus">
      <div
        ref={rootRef}
        tabIndex={-1}
        className="flex h-full min-h-0 flex-col outline-none"
        data-slot="focus-view"
      >
        {header}
        {/* Never sideways (MOD-119): a long word or line stays inside the column. */}
        <div className="pane-scroll min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-6">
            {notice && noticeHere ? (
              <NoticeLine text={notice} onDismiss={() => setRunNotice(null)} />
            ) : null}
            {now ? (
              <>
                {offer?.kind === "along" ? (
                  <AlongTheWayOffer
                    key={`along-${offer.task.id}`}
                    task={offer.task}
                    projectName={bucketNameById(offer.leavingProjectId)}
                    projectColor={bucketDotColor(
                      buckets.find((b) => b.id === offer.leavingProjectId) ?? {},
                    )}
                    ask={offer.ask}
                    onTake={takeOffer}
                    onNotNow={declineOffer}
                    onShrink={() => settleOffer("shrink")}
                    onMove={() => settleOffer("backlog")}
                    onLetGo={() => settleOffer("wont_do")}
                  />
                ) : offer?.kind === "break" ? (
                  <BreakOffer
                    key="break"
                    minutes={offer.minutes}
                    long={offer.long}
                    onTake={takeOffer}
                    onSkip={declineOffer}
                  />
                ) : (
                  <NowCard
                    task={now}
                    runtime={runtime}
                    workspaceId={workspaceId}
                    canEdit={canEdit}
                    bucketNameById={bucketNameById}
                    onNow={onNow}
                    timer={timerMode}
                    countdown={prefs.countdownEstimate}
                    panelTaskId={panelTaskId}
                    onOpenTask={onOpenTask}
                    onStart={start}
                    onDone={done}
                    onSkip={skip}
                    handOffOpen={handOffOpen}
                    onHandOffOpenChange={setHandOffOpen}
                    onHandOff={handOff}
                  />
                )}
                <UpNext
                  upNext={upNext}
                  canEdit={canEdit}
                  bucketNameById={bucketNameById}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={onSelectTask}
                  dndMode={dndMode}
                  meeting={meeting}
                  pace={pace}
                  arrange={
                    arrangement.saved >= ARRANGE_MIN_SAVED
                      ? { saved: arrangement.saved, onArrange: arrange }
                      : null
                  }
                />
                {inFlightLine}
                {doneLine}
                {doneList}
              </>
            ) : (
              <>
                {inFlightLine}
                {doneLine}
                {doneList}
                <FocusEmptyState
                  canEdit={canEdit}
                  bucketNameById={bucketNameById}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={onSelectTask}
                  onRequestCapture={onRequestCapture}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </HotkeyScope>
  );
}

// ── the header's ⋯ (63) ─────────────────────────────────────────────────────

function FocusMenu({
  timer,
  prefs,
  onTimer,
  onPrefs,
  showDone,
  onShowDone,
  canStop,
  canArrange,
  onArrange,
}: {
  timer: FocusTimerMode;
  prefs: FocusPrefs;
  onTimer: (timer: FocusTimerMode) => void;
  onPrefs: (patch: Partial<FocusPrefs>) => void;
  showDone: boolean;
  onShowDone: (show: boolean) => void;
  canStop: boolean;
  /** Arranging would save at least one switch (TV-F8). */
  canArrange: boolean;
  onArrange: () => void;
}) {
  const lengths = `${prefs.workMinutes} / ${prefs.breakMinutes}`;
  const [openSettings, setOpenSettings] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton icon={Ellipsis} label="Focus options" tooltip={null} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64"
        onCloseAutoFocus={(event) => {
          // Settings takes focus: open it once the menu has closed, not while
          // the menu is still handing focus back (ui.md gotcha).
          if (!openSettings) return;
          event.preventDefault();
          setOpenSettings(false);
          dispatchOpenSettings({ section: "focus" });
        }}
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Timer
            <span className="ml-auto pl-3 font-sans text-xs text-muted-foreground">
              {TIMER_LABELS[timer]}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            <DropdownMenuRadioGroup
              value={timer}
              onValueChange={(value) => {
                if (isFocusTimerMode(value)) onTimer(value);
              }}
            >
              <DropdownMenuRadioItem value="per_task">Per task</DropdownMenuRadioItem>
              <DropdownMenuCheckboxItem
                checked={prefs.countdownEstimate}
                disabled={timer !== "per_task"}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => onPrefs({ countdownEstimate: checked === true })}
                className="pl-12"
              >
                Count down the estimate
              </DropdownMenuCheckboxItem>
              <DropdownMenuRadioItem value="pomodoro">Pomodoro</DropdownMenuRadioItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="pl-12">
                  Lengths
                  <span className="ml-auto pl-3 font-sans text-xs tabular-nums text-muted-foreground">
                    {lengths}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={lengths}
                    onValueChange={(value) => {
                      const preset = POMODORO_PRESETS.find(
                        (p) => `${p.work} / ${p.rest}` === value,
                      );
                      if (!preset) return;
                      const patch = { workMinutes: preset.work, breakMinutes: preset.rest };
                      onPrefs(patch);
                      previewFocusInterval({ ...prefs, ...patch });
                    }}
                  >
                    {POMODORO_PRESETS.map((p) => (
                      <DropdownMenuRadioItem
                        key={p.work}
                        value={`${p.work} / ${p.rest}`}
                        className="tabular-nums"
                      >
                        {p.work} / {p.rest} min
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setOpenSettings(true)}>
                    Other lengths…
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {/* 63's order: Timer · Arrange · Offer quick tasks · Show done · Stop. */}
        <DropdownMenuItem disabled={!canArrange} onSelect={onArrange}>
          Arrange by project
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={prefs.alongTheWay}
          onSelect={(e) => e.preventDefault()}
          onCheckedChange={(checked) => onPrefs({ alongTheWay: checked === true })}
        >
          Offer quick tasks along the way
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem onSelect={() => onShowDone(!showDone)}>
          {showDone ? "Hide what’s done this session" : "Show what’s done this session"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Alone at the bottom, far from Pause (62); "Focus stopped · Undo" for 10 s. */}
        <DropdownMenuItem disabled={!canStop} onSelect={() => stopFocusWithUndo()}>
          Stop
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Pomodoro's rhythm in the header, beside ⋯ ("Focus 18:40", "Break 4:12"). */
function PomodoroPill({ resolveTask }: { resolveTask: TaskRefResolver }) {
  const t = useFocusTimer();
  if (!t.active || t.timer !== "pomodoro") return null;
  const phase = t.phase === "break" ? (t.longBreak ? "Long break" : "Break") : "Focus";
  const clock = formatFocusClock(t.bigClock);
  const where = t.elsewhere ? " · on your other device" : "";
  const action = t.running ? "Pause" : "Resume";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={FOCUS_PILL}
          aria-label={`${action} · ${phase} ${clock}${where}`}
          onClick={() => toggleFocusPause(resolveTask)}
          data-slot="focus-pomodoro-pill"
        >
          {t.running ? (
            <Pause className="size-icon-xs" aria-hidden />
          ) : (
            <Play className="size-icon-xs" aria-hidden />
          )}
          {t.running ? (
            <span>
              {phase} {clock}
            </span>
          ) : (
            <span>
              Paused <span className="text-muted-foreground">·</span> {clock}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {action}
        {where}
      </TooltipContent>
    </Tooltip>
  );
}

// ── the session moving on by itself ("Mike completed …", F6-6) ────────────

/** Why the card changed under you; the follower also toasts it once. */
function NoticeLine({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <p
      role="status"
      data-slot="focus-notice"
      className="-mb-2 flex items-center gap-1 px-1 font-sans text-xs text-muted-foreground"
    >
      <span className="min-w-0 flex-1">{text}</span>
      <IconButton icon={X} label="Dismiss" onClick={onDismiss} />
    </p>
  );
}

// ── what's in flight (TV-F8) ─────────────────────────────────────────────────

/** "2 in flight · 1 to check": opens the panel's In flight view. */
function InFlightLine({
  count,
  attention,
  onShow,
}: {
  count: number;
  attention: number;
  onShow: () => void;
}) {
  return (
    <p className="flex items-center gap-1.5 px-1 font-sans text-xs tabular-nums text-muted-foreground">
      <PlaneTakeoff className="size-icon-xs shrink-0 text-subtle-foreground" aria-hidden />
      <button
        type="button"
        onClick={onShow}
        data-slot="focus-in-flight"
        className="hit-min rounded-sm transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {count} in flight
        {attention > 0 ? <span className="text-foreground"> · {attention} to check</span> : null}
      </button>
    </p>
  );
}

// ── the done line (62a: "2 done · 1h 12m · Show") ───────────────────────────

function DoneLine({
  count,
  timed,
  endedSeconds,
  live,
  shown,
  onToggle,
}: {
  count: number;
  timed: boolean;
  /** The ended session's focused time; null while one runs. */
  endedSeconds: number | null;
  live: boolean;
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <p className="flex items-center gap-1.5 px-1 font-sans text-xs tabular-nums text-muted-foreground">
      {live ? (
        <LiveDoneText count={count} timed={timed} />
      ) : (
        <span>{doneLineText({ done: count, seconds: endedSeconds ?? 0, timed })}</span>
      )}
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={shown}
        className="hit-min rounded-sm text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {shown ? "Hide" : "Show"}
      </button>
    </p>
  );
}

function LiveDoneText({ count, timed }: { count: number; timed: boolean }) {
  const t = useFocusTimer();
  return <span>{doneLineText({ done: count, seconds: t.sessionSeconds, timed })}</span>;
}

function DoneList({
  ids,
  taskById,
  bucketNameById,
}: {
  ids: readonly string[];
  taskById: Map<string, Task>;
  bucketNameById: (id: string) => string;
}) {
  return (
    <ul className="flex flex-col px-1" aria-label="Done this session" data-slot="focus-done">
      {ids.map((id) => {
        const task = taskById.get(id);
        return (
          <li key={id} className="flex min-h-(--row-h) items-center gap-2">
            <CompleteToggle done disabled onToggle={() => {}} aria-label="Done" />
            <span className="min-w-0 flex-1 truncate font-sans text-sm text-muted-foreground line-through">
              {task ? task.title || "Untitled" : "A finished task"}
            </span>
            {task ? (
              <span className="shrink-0 font-sans text-xs text-subtle-foreground">
                {bucketNameById(task.bucketId)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function FocusSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" data-slot="focus-view">
      <div className="mb-3 flex h-7 items-center">
        <h1 className="font-display text-lg text-foreground">Focus</h1>
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
        <div className="h-40 rounded-lg border border-border bg-card" />
        <div className="h-4 w-32 rounded-sm bg-muted" />
        <div className="h-4 w-48 rounded-sm bg-muted" />
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** The first task with a real id (one still saving can't take the clock). */
function firstReal(list: readonly Task[]): Task | null {
  return list.find((t) => !t.id.startsWith("tmp-")) ?? null;
}
