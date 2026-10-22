// The projects a row or a card can move its task to (TV-D11b). A workspace
// can have hundreds; handing the list to every row as a prop redrew every row
// whenever a project was added, renamed or archived (about 5 s with 224
// projects, found in TV-U6). The view provides the list here, and only an
// open "Move to project" menu reads it, so a change to the list redraws that
// menu and no row.

import {
  TASK_STATUS_CATEGORIES,
  type TaskStatusCategory,
  taskCategoryOf,
} from "@contracts/vocabularies";
import { Inbox } from "lucide-react";
import { createContext, Fragment, type ReactNode, useContext, useMemo } from "react";
import { ContextMenuRadioItem } from "../../../components/ui/context-menu";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "../../../components/ui/dropdown-menu";
import type { ProjectStatus, Task } from "../model";
import { CATEGORY_LABELS, type StatusTarget, statusChoiceGroups } from "../statuses";
import { StatusIcon } from "./status-icon";

type ProjectChoice = { id: string; name: string; isSystem: boolean };

const ProjectChoicesContext = createContext<readonly ProjectChoice[]>([]);

/** The Inbox first, then the projects in the rail's order. */
export function ProjectChoicesProvider({
  projects,
  inboxId,
  children,
}: {
  projects: readonly ProjectChoice[];
  inboxId: string | null;
  children: ReactNode;
}) {
  const choices = useMemo(
    () =>
      inboxId
        ? [
            { id: inboxId, name: "Inbox", isSystem: true },
            ...projects.filter((p) => p.id !== inboxId),
          ]
        : projects,
    [projects, inboxId],
  );
  return (
    <ProjectChoicesContext.Provider value={choices}>{children}</ProjectChoicesContext.Provider>
  );
}

/** The choices as a dropdown's radio items (the row's project menu). */
export function ProjectMenuItems() {
  const choices = useContext(ProjectChoicesContext);
  return choices.map((p) => (
    <DropdownMenuRadioItem key={p.id} value={p.id}>
      {p.isSystem ? <Inbox aria-hidden /> : null}
      <span className="truncate">{p.name}</span>
    </DropdownMenuRadioItem>
  ));
}

/** The choices as a context menu's radio items (the card's "Move to project"). */
export function ProjectContextMenuItems() {
  const choices = useContext(ProjectChoicesContext);
  return choices.map((p) => (
    <ContextMenuRadioItem key={p.id} value={p.id}>
      {p.isSystem ? "Inbox" : p.name}
    </ContextMenuRadioItem>
  ));
}

// ── Statuses (TV-U10's ⇧S menu) ─────────────────────────────────────────────

type StatusChoices = {
  /** A project's statuses (the workspace default for the Inbox). */
  statusesFor: (bucketId: string) => readonly ProjectStatus[];
  /** Any statuses at all (a database before TV-D9 has none, and no Backlog). */
  any: boolean;
};

const StatusChoicesContext = createContext<StatusChoices>({ statusesFor: () => [], any: false });

/** The statuses a row's status menu offers, read only by an open menu (like projects). */
export function StatusChoicesProvider({
  statusesFor,
  any,
  children,
}: StatusChoices & { children: ReactNode }) {
  const value = useMemo(() => ({ statusesFor, any }), [statusesFor, any]);
  return <StatusChoicesContext.Provider value={value}>{children}</StatusChoicesContext.Provider>;
}

/**
 * The status menu's items for one task (REPLAN 53a), read only by an open
 * menu: its project's own statuses (`StatusRadioItems`).
 */
export function StatusMenuItems({
  task,
  onPick,
}: {
  task: Pick<Task, "bucketId" | "statusId" | "status" | "statusCategory">;
  onPick: (target: StatusTarget) => void;
}) {
  const { statusesFor, any } = useContext(StatusChoicesContext);
  return (
    <StatusRadioItems
      task={task}
      set={statusesFor(task.bucketId)}
      withBacklog={any}
      onPick={onPick}
    />
  );
}

/**
 * A task's status choices as menu radio items, the one list Details and the
 * row menu share: its project's statuses grouped by category, hidden ones
 * only while in use (`statusChoiceGroups`); the five categories when the
 * project's statuses can't be read here (Backlog only where statuses exist
 * at all, `withBacklog`).
 */
export function StatusRadioItems({
  task,
  set,
  withBacklog,
  onPick,
}: {
  task: Pick<Task, "statusId" | "status" | "statusCategory">;
  set: readonly ProjectStatus[];
  withBacklog: boolean;
  onPick: (target: StatusTarget) => void;
}) {
  const category = taskCategoryOf(task);
  const groups = statusChoiceGroups(set, (s) => s.id === task.statusId);
  const byName = groups.length > 0;
  return (
    <DropdownMenuRadioGroup
      value={byName ? (task.statusId ?? "") : category}
      onValueChange={(v) =>
        onPick(byName ? { statusId: v } : { category: v as TaskStatusCategory })
      }
    >
      {byName
        ? groups.map((g, i) => (
            <Fragment key={g.category}>
              {i > 0 ? <DropdownMenuSeparator /> : null}
              {g.statuses.map((s) => (
                <DropdownMenuRadioItem key={s.id} value={s.id}>
                  <StatusIcon category={s.category} className="text-muted-foreground" />
                  {s.name}
                </DropdownMenuRadioItem>
              ))}
            </Fragment>
          ))
        : TASK_STATUS_CATEGORIES.filter((c) => c !== "backlog" || withBacklog).map((c) => (
            <DropdownMenuRadioItem key={c} value={c}>
              <StatusIcon category={c} className="text-muted-foreground" />
              {CATEGORY_LABELS[c]}
            </DropdownMenuRadioItem>
          ))}
    </DropdownMenuRadioGroup>
  );
}
