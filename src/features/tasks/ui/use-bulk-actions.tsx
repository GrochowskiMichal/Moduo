// A selection's actions (tasks-v3 §4, calls 82b and e; TV-U12): the bottom
// bar's multi-select row — Complete Space · Focus Q · Assign @ · Tag # ·
// Date D · Delete ⌫ · More ▾ (Move · Status · Section · Priority · Waiting ·
// Team) · "4 selected · Esc" — the same keys on the List and the Board, and
// the pickers they open. The bar is the shell's one mode mechanism
// (`bottom-bar-mode.ts`, the Inbox's triage row is the other). Every change
// goes through `planBulk` and the module's one-write bulk ops.

import { TASK_STATUS_CATEGORIES } from "@contracts/vocabularies";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { type BottomBarMode, useBottomBarModeOwner } from "../../../components/app/bottom-bar-mode";
import { TeamMark } from "../../../components/ui/avatar";
import { NavRowDot } from "../../../components/ui/nav-row";
import { useAssignees } from "../assignees";
import {
  type BulkChange,
  type BulkDate,
  type BulkNames,
  dayWordOf,
  planBulk,
  type RepeatChoice,
  repeatsAmong,
  shiftDayKey,
  singleProject,
  tasksWord,
} from "../bulk";
import { daysLeftInWeek } from "../day-buckets";
import { PRIORITY_LABELS, todayStr } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { PriorityLevel, Task } from "../model";
import { engineZone } from "../recurrence-engine";
import { bucketDotColor } from "../sidebar";
import { CATEGORY_LABELS, statusesByCategory } from "../statuses";
import { AssigneeAvatar } from "./assignee-avatar";
import { BulkPickerDialog, type BulkPickerItem } from "./bulk-picker";
import { DayPickerDialog } from "./day-picker-dialog";
import { RepeatMoveDialog } from "./repeat-move-dialog";
import { publishSelectionMenu, type SelectionMenu } from "./selection-menu";
import { StatusIcon } from "./status-icon";

export type BulkPickerKind =
  | "assign"
  | "tag"
  | "date"
  | "move"
  | "status"
  | "section"
  | "priority"
  | "waiting"
  | "team";

type BulkApi = Pick<
  TasksModuleApi,
  | "tasks"
  | "buckets"
  | "sections"
  | "teams"
  | "tags"
  | "tagsByTask"
  | "waiting"
  | "queuedTaskIds"
  | "currentUserId"
  | "statusesForBucket"
  | "bulkWrite"
  | "bulkDelete"
  | "bulkQueue"
  | "bulkWaiting"
  | "bulkTag"
>;

export type BulkActions = {
  /** The bar's keys on a selection: true when one was handled. */
  onKey: (event: React.KeyboardEvent<HTMLElement>) => boolean;
  /** Open one of the pickers (the panel's "Mixed" values open them too). */
  openPicker: (kind: BulkPickerKind) => void;
  complete: () => void;
  /** The pickers and the repeat question, for the page to mount. */
  dialogs: ReactNode;
};

const NEXT_WEEK_LABEL = "Next week";

/** Next Monday, as the date panel's "Next week" (a day key). */
function nextWeekDay(now: Date): string {
  return shiftDayKey(todayStr(now), daysLeftInWeek(now) + 1);
}

export function useBulkActions({
  api,
  ids,
  canEdit,
  bucketNameById,
}: {
  api: BulkApi;
  /** The selected tasks, in the view's order, while two or more are; else empty. */
  ids: readonly string[];
  canEdit: boolean;
  bucketNameById: (id: string) => string;
}): BulkActions {
  const multi = ids.length >= 2;
  const { assignees, byId } = useAssignees();
  const tasks = useMemo(() => {
    if (!multi) return [];
    const map = new Map(api.tasks.map((t) => [t.id, t]));
    return ids.map((id) => map.get(id)).filter((t): t is Task => !!t);
  }, [multi, ids, api.tasks]);

  // The newest of everything, for the actions (they run from keys, the bar,
  // a picker and a toast, after this render).
  const latest = useRef({ api, tasks, bucketNameById, byId });
  useLayoutEffect(() => {
    latest.current = { api, tasks, bucketNameById, byId };
  });

  const names = useCallback((): BulkNames => {
    const { api: a, bucketNameById: projectName, byId: person } = latest.current;
    return {
      project: projectName,
      person: (id) => {
        const p = person(id);
        return p ? (p.isMe ? "you" : p.fullName || p.name) : "a former member";
      },
      section: (id) =>
        id ? (a.sections.find((s) => s.id === id)?.name ?? "a section") : "No section",
      team: (id) => (id ? (a.teams.find((t) => t.id === id)?.name ?? "a team") : "No team"),
    };
  }, []);

  const apply = useCallback(
    (change: BulkChange) => {
      const { api: a, tasks: chosen } = latest.current;
      if (chosen.length === 0) return;
      const plan = planBulk(chosen, change, {
        all: a.tasks,
        statusesFor: a.statusesForBucket,
        names: names(),
        now: new Date(),
        zone: engineZone(),
      });
      if (plan.writes.length === 0) {
        toast("They already have that.");
        return;
      }
      void a.bulkWrite(plan.writes, { label: plan.label, followers: plan.followers });
    },
    [names],
  );

  const [picker, setPickerState] = useState<BulkPickerKind | null>(null);
  const [pickingDay, setPickingDay] = useState(false);
  const [repeatAsk, setRepeatAsk] = useState<BulkDate | null>(null);
  // Where the keys were when a picker opened (the List or the Board): focus
  // goes back there when it closes, so the next key acts on the selection.
  const returnTo = useRef<HTMLElement | null>(null);
  const setPicker = useCallback((kind: BulkPickerKind | null) => {
    if (kind) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) returnTo.current = active;
    } else {
      const back = returnTo.current;
      requestAnimationFrame(() => {
        if (back?.isConnected && document.activeElement === document.body) {
          back.focus({ preventScroll: true });
        }
      });
    }
    setPickerState(kind);
  }, []);
  // A selection that went (Esc, a click) closes what it opened.
  useEffect(() => {
    if (multi) return;
    setPickerState(null);
    setPickingDay(false);
    setRepeatAsk(null);
  }, [multi]);

  const applyDate = useCallback(
    (to: BulkDate, repeats?: RepeatChoice) => {
      if (!repeats && !("clear" in to) && repeatsAmong(latest.current.tasks) > 0) {
        setRepeatAsk(to);
        return;
      }
      apply({ kind: "date", to, repeats });
    },
    [apply],
  );

  const complete = useCallback(() => apply({ kind: "complete" }), [apply]);
  const focus = useCallback(() => {
    latest.current.api.bulkQueue(latest.current.tasks.map((t) => t.id));
  }, []);
  const remove = useCallback(() => {
    void latest.current.api.bulkDelete(latest.current.tasks.map((t) => t.id));
  }, []);
  const assignToMe = useCallback(() => {
    const me = latest.current.api.currentUserId;
    if (me) apply({ kind: "assign", assigneeId: me });
  }, [apply]);

  const openPicker = useCallback((kind: BulkPickerKind) => setPicker(kind), [setPicker]);

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLElement>): boolean => {
      if (!multi || !canEdit) return false;
      const key = e.key;
      // Delete: bare ⌫ / Del with several selected, and ⌘⌫ (keymap).
      if ((key === "Backspace" || key === "Delete") && !e.altKey && !e.shiftKey) {
        remove();
        return true;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      const open = (kind: BulkPickerKind) => {
        setPicker(kind);
        return true;
      };
      if (key === "@") return open("assign");
      if (key === "#") return open("tag");
      if (e.shiftKey) return key.toLowerCase() === "s" ? open("status") : false;
      switch (key.toLowerCase()) {
        case " ":
        case "x":
          complete();
          return true;
        case "q":
          focus();
          return true;
        case "a":
          setPicker("assign");
          return true;
        case "l":
          setPicker("tag");
          return true;
        case "d":
          setPicker("date");
          return true;
        case "b":
          setPicker("move");
          return true;
        case "p":
          setPicker("priority");
          return true;
        case "i":
          assignToMe();
          return true;
        default:
          return false;
      }
    },
    [multi, canEdit, remove, complete, focus, assignToMe, setPicker],
  );

  // ── the bar's row (82b): six with their keys, then More ▾ ────────────────
  const count = tasks.length;
  const project = singleProject(tasks);
  const hasSections = !!project && api.sections.some((s) => s.projectId === project);
  const allClosed = count > 0 && tasks.every((t) => t.status === "done" || t.status === "archived");
  const hasTeams = api.teams.length > 0;
  const mode = useMemo<BottomBarMode | null>(() => {
    if (!multi) return null;
    const note = `${count} selected · Esc`;
    if (!canEdit) return { id: "tasks:selection", label: "Selection", actions: [], note };
    return {
      id: "tasks:selection",
      label: `${count} tasks selected`,
      actions: [
        {
          id: "complete",
          label: allClosed ? "Reopen" : "Complete",
          keyHint: "Space",
          run: complete,
        },
        { id: "focus", label: "Focus", keyHint: "Q", run: focus },
        { id: "assign", label: "Assign", keyHint: "@", run: () => setPicker("assign") },
        { id: "tag", label: "Tag", keyHint: "#", run: () => setPicker("tag") },
        { id: "date", label: "Date", keyHint: "D", run: () => setPicker("date") },
        { id: "delete", label: "Delete", keyHint: "⌫", run: remove },
        { id: "move", label: "Move", keyHint: "B", run: () => setPicker("move") },
        { id: "status", label: "Status", keyHint: "⇧S", run: () => setPicker("status") },
        {
          id: "section",
          label: "Section",
          run: () => setPicker("section"),
          disabled: !hasSections,
        },
        { id: "priority", label: "Priority", keyHint: "P", run: () => setPicker("priority") },
        { id: "waiting", label: "Waiting", run: () => setPicker("waiting") },
        { id: "team", label: "Team", run: () => setPicker("team"), disabled: !hasTeams },
      ],
      note,
    };
  }, [multi, canEdit, count, allClosed, hasSections, hasTeams, complete, focus, remove, setPicker]);
  useBottomBarModeOwner(mode);

  // Right-clicking one of the selected tasks offers the same (82a).
  const menu = useMemo<SelectionMenu | null>(
    () =>
      multi && canEdit
        ? {
            ids: new Set(ids),
            allClosed,
            sections: hasSections,
            teams: hasTeams,
            complete,
            focus,
            remove,
            open: setPicker,
          }
        : null,
    [multi, canEdit, ids, allClosed, hasSections, hasTeams, complete, focus, remove, setPicker],
  );
  useEffect(() => {
    publishSelectionMenu(menu);
    return () => publishSelectionMenu(null);
  }, [menu]);

  // ── the pickers ───────────────────────────────────────────────────────────
  const close = useCallback(() => setPicker(null), [setPicker]);
  const n = tasksWord(count);
  const now = new Date();
  const items = ((): {
    title: string;
    placeholder: string;
    items: BulkPickerItem[];
    empty?: string;
    create?: (q: string) => { label: string; onPick: () => void } | null;
  } | null => {
    switch (picker) {
      case "assign":
        return {
          title: `Assign ${n} to…`,
          placeholder: "Assign to…",
          items: [
            ...assignees
              .filter((a) => a.canTakeTasks)
              .map((a) => ({
                key: a.userId,
                label: a.isMe ? "Me" : a.fullName || a.name,
                keywords: `${a.name} ${a.fullName}`,
                icon: <AssigneeAvatar assignee={a} size="icon" />,
                onPick: () => {
                  close();
                  apply({ kind: "assign", assigneeId: a.userId });
                },
              })),
            {
              key: "__nobody__",
              label: "No one",
              onPick: () => {
                close();
                apply({ kind: "assign", assigneeId: null });
              },
            },
          ],
          empty: "Nobody by that name.",
        };
      case "tag": {
        const has = (tagId: string) => (id: string) =>
          (api.tagsByTask.get(id) ?? []).some((t) => t.id === tagId);
        return {
          title: `Tag ${n}`,
          placeholder: "Tag…",
          items: [...api.tags]
            .filter((t) => !t.deletedAt)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((t) => ({
              key: t.id,
              label: t.name,
              icon: <NavRowDot color={bucketDotColor(t)} />,
              checked: tasks.every((task) => has(t.id)(task.id)),
              onPick: () => {
                close();
                void api.bulkTag(
                  tasks.map((x) => x.id),
                  { id: t.id, name: t.name },
                  has(t.id),
                );
              },
            })),
          empty: "No tag by that name.",
          create: (q) => ({
            label: `Create tag “${q}”`,
            onPick: () => {
              close();
              void api.bulkTag(
                tasks.map((x) => x.id),
                { name: q },
                () => false,
              );
            },
          }),
        };
      }
      case "date": {
        const today = todayStr(now);
        const day = (key: string, label: string, to: BulkDate): BulkPickerItem => ({
          key,
          label,
          onPick: () => {
            close();
            applyDate(to);
          },
        });
        return {
          title: `Date for ${n}`,
          placeholder: "Due…",
          items: [
            day("today", "Today", { day: today }),
            day("tomorrow", "Tomorrow", { day: shiftDayKey(today, 1) }),
            day("next-week", NEXT_WEEK_LABEL, { day: nextWeekDay(now) }),
            { ...day("plus-day", "A day later", { shift: 1 }), hint: "each its own" },
            { ...day("plus-week", "A week later", { shift: 7 }), hint: "each its own" },
            {
              key: "pick",
              label: "Pick a date…",
              onPick: () => {
                close();
                setPickingDay(true);
              },
            },
            day("clear", "No date", { clear: true }),
          ],
        };
      }
      case "move":
        return {
          title: `Move ${n} to…`,
          placeholder: "Move to…",
          items: api.buckets
            .filter((b) => !b.isSystem)
            .map((b) => ({
              key: b.id,
              label: b.name,
              icon: <NavRowDot color={bucketDotColor(b)} />,
              onPick: () => {
                close();
                apply({ kind: "project", bucketId: b.id });
              },
            })),
          empty: "No project by that name.",
        };
      case "status": {
        // One project's own statuses by name; across projects, the categories.
        const set = project ? api.statusesForBucket(project) : [];
        const own = set.length > 0;
        return {
          title: `Status for ${n}`,
          placeholder: "Status…",
          items: own
            ? statusesByCategory(set).flatMap(({ category, statuses }) =>
                statuses
                  .filter((s) => !s.hidden)
                  .map((s) => ({
                    key: s.id,
                    label: s.name,
                    group: CATEGORY_LABELS[category],
                    icon: <StatusIcon category={category} />,
                    onPick: () => {
                      close();
                      apply({ kind: "status", target: { statusId: s.id } });
                    },
                  })),
              )
            : TASK_STATUS_CATEGORIES.map((category) => ({
                key: category,
                label: CATEGORY_LABELS[category],
                icon: <StatusIcon category={category} />,
                onPick: () => {
                  close();
                  apply({ kind: "status", target: { category } });
                },
              })),
        };
      }
      case "section":
        return {
          title: `Section for ${n}`,
          placeholder: "Section…",
          items: [
            ...api.sections
              .filter((s) => s.projectId === project)
              .map((s) => ({
                key: s.id,
                label: s.name,
                onPick: () => {
                  close();
                  apply({ kind: "section", sectionId: s.id, projectId: project });
                },
              })),
            {
              key: "__none__",
              label: "No section",
              onPick: () => {
                close();
                apply({ kind: "section", sectionId: null, projectId: project });
              },
            },
          ],
        };
      case "priority": {
        const levels: Array<PriorityLevel | null> = ["high", "medium", "low", null];
        return {
          title: `Priority for ${n}`,
          placeholder: "Priority…",
          items: levels.map((level) => ({
            key: level ?? "none",
            label: level ? PRIORITY_LABELS[level] : "No priority",
            onPick: () => {
              close();
              apply({ kind: "priority", priority: level });
            },
          })),
        };
      }
      case "waiting":
        return {
          title: `${n} waiting on…`,
          placeholder: "Waiting on…",
          items: assignees
            .filter((a) => !a.isMe)
            .map((a) => ({
              key: a.userId,
              label: a.fullName || a.name,
              keywords: a.name,
              icon: <AssigneeAvatar assignee={a} size="icon" />,
              onPick: () => {
                close();
                void api.bulkWaiting(
                  tasks.map((t) => t.id),
                  { kind: "person", ref: a.userId },
                  a.fullName || a.name,
                  api.waiting,
                );
              },
            })),
          empty: "Type what they're waiting on.",
          create: (q) => ({
            label: `Waiting on “${q}”`,
            onPick: () => {
              close();
              void api.bulkWaiting(
                tasks.map((t) => t.id),
                { kind: "text", label: q },
                `“${q}”`,
                api.waiting,
              );
            },
          }),
        };
      case "team":
        return {
          title: `Team for ${n}`,
          placeholder: "Team…",
          items: [
            ...api.teams.map((t) => ({
              key: t.id,
              label: t.name,
              icon: <TeamMark name={t.name} id={t.id} letters={t.mark} color={t.color} />,
              onPick: () => {
                close();
                apply({ kind: "team", teamId: t.id });
              },
            })),
            {
              key: "__none__",
              label: "No team",
              onPick: () => {
                close();
                apply({ kind: "team", teamId: null });
              },
            },
          ],
        };
      default:
        return null;
    }
  })();

  const repeatLabel = (to: BulkDate | null): string => {
    if (!to || "clear" in to) return "";
    if ("day" in to) return dayWordOf(to.day, now);
    return to.shift === 7 ? "a week later" : "a day later";
  };

  const dialogs = (
    <>
      {items ? (
        <BulkPickerDialog
          open
          title={items.title}
          description="A change here applies to every selected task, with one Undo."
          placeholder={items.placeholder}
          items={items.items}
          empty={items.empty}
          create={items.create}
          onClose={close}
        />
      ) : null}
      {pickingDay ? (
        <DayPickerDialog
          open
          title={`Date for ${n}`}
          onPick={(d) => {
            setPickingDay(false);
            close();
            applyDate({ day: todayStr(d) });
          }}
          onClose={() => {
            setPickingDay(false);
            close();
          }}
        />
      ) : null}
      <RepeatMoveDialog
        open={repeatAsk !== null}
        tasks={tasks}
        dayLabel={repeatLabel(repeatAsk)}
        onChoose={(choice) => {
          const to = repeatAsk;
          setRepeatAsk(null);
          close();
          if (to) applyDate(to, choice);
        }}
        onClose={() => {
          setRepeatAsk(null);
          close();
        }}
      />
    </>
  );

  return { onKey, openPicker, complete, dialogs };
}
