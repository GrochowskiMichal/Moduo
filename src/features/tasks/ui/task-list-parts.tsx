// The List's group furniture (tasks-v3 §4, TV-U10): the group header with its
// mark, count and the "+" that stays visible (default n), a section's ⋯
// (Rename · Delete), the folded "Backlog · n" line, and a project's
// "+ Add section" line. Kept out of task-list-view.tsx, which the Board,
// multi-select and Upcoming blocks also touch.

import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { TeamMark } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { GroupHeader } from "../../../components/ui/group-header";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { NavRowDot } from "../../../components/ui/nav-row";
import { cn } from "../../../lib/utils";
import type { Assignee } from "../assignees";
import type { GroupBy } from "../helpers";
import type { GroupAdd, GroupAddState } from "../list-group-add";
import type { PriorityLevel } from "../model";
import { bucketDotColor } from "../sidebar";
import { type StatusKey, statusKeyCategory } from "../statuses";
import { AssigneeAvatar } from "./assignee-avatar";
import { PriorityMark } from "./level-icons";
import { StatusIcon } from "./status-icon";

/** What a group's leading mark needs to know about its key. */
export type GroupMarkContext = {
  bucketColor: (bucketId: string) => string | null;
  assignee: (userId: string) => Assignee | null;
  /** A team's name, letters and colour (its mark, TV-D13). */
  team: (teamId: string) => { name: string; mark: string; color: string | null } | null;
};

/** Each kind of group leads with its mark (research §2): glyph, dot, avatar. */
export function groupMark(groupBy: GroupBy, key: string, ctx: GroupMarkContext): ReactNode {
  switch (groupBy) {
    case "status":
      return (
        <StatusIcon
          category={statusKeyCategory(key as StatusKey)}
          className="text-muted-foreground"
        />
      );
    case "priority":
      return key === "unset" ? null : <PriorityMark level={key as PriorityLevel} />;
    case "bucket":
      return <NavRowDot color={bucketDotColor({ color: ctx.bucketColor(key) })} />;
    case "assignee": {
      if (key === "none") return null;
      return <AssigneeAvatar assignee={ctx.assignee(key)} assigneeId={key} size="icon" />;
    }
    case "team": {
      const team = key === "none" ? null : ctx.team(key);
      return team ? (
        <TeamMark name={team.name} id={key} letters={team.mark} color={team.color} />
      ) : null;
    }
    default:
      return null;
  }
}

/**
 * One group's header: sentence case as typed (call 40), its mark, its count
 * (a section's "2 of 5" and "· ends Oct 24"), the "+" that stays visible and
 * adds at the top with the group's value, and a section's ⋯.
 */
export function ListGroupHeader({
  groupKey,
  label,
  count,
  sub,
  leading,
  collapsed,
  onToggle,
  addState,
  onAdd,
  section,
  extraAction,
  className,
  self,
}: {
  groupKey: string;
  label: string;
  count?: ReactNode;
  sub?: ReactNode;
  leading?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  addState: GroupAddState;
  onAdd: (add: GroupAdd) => void;
  /** A section's own edits (Section groups inside an editable project). */
  section?: { onRename: (name: string) => void; onDelete: () => void } | null;
  /** Something the header always offers before its "+" (Upcoming's Earlier: "Move all…"). */
  extraAction?: ReactNode;
  className?: string;
  /** The reader's own group ("You"): its "+" says "Add a task to you" (MOD-137). */
  self?: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  if (renaming && section) {
    return (
      <NameInput
        initial={label}
        label="Section name"
        onCommit={(name) => {
          setRenaming(false);
          if (name && name !== label) section.onRename(name);
        }}
        onCancel={() => setRenaming(false)}
      />
    );
  }
  const add =
    addState.kind === "none" ? null : (
      <IconButton
        icon={Plus}
        label={`Add a task to ${self ? "you" : label || "this group"}`}
        tooltip={addState.kind === "disabled" ? addState.reason : undefined}
        aria-description={addState.kind === "disabled" ? addState.reason : undefined}
        aria-disabled={addState.kind === "disabled" || undefined}
        className={cn(addState.kind === "disabled" && "opacity-50")}
        onClick={(e) => {
          e.stopPropagation();
          if (addState.kind === "add") onAdd(addState.add);
        }}
      />
    );
  return (
    <GroupHeader
      data-list-group={groupKey}
      className={className}
      label={label}
      count={count}
      sub={sub}
      leading={leading}
      onToggle={onToggle}
      collapsed={collapsed}
      actions={
        section ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <IconButton icon={MoreHorizontal} label={`${label} options`} tooltip={null} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename…</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={section.onDelete}>
                Delete section
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined
      }
      persistentActions={
        extraAction ? (
          <>
            {extraAction}
            {add}
          </>
        ) : (
          add
        )
      }
    />
  );
}

/**
 * The line under an extra group's first rows (My tasks' team block, research
 * §8): "Show 3 more", then "Show fewer".
 */
export function ShowMoreLine({
  count,
  shown,
  onToggle,
}: {
  count: number;
  shown: boolean;
  onToggle: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div className="flex min-h-(--row-h-sm) items-center px-1">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={shown}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="text-muted-foreground tabular-nums hover:text-foreground"
      >
        {shown ? "Show fewer" : `Show ${count} more`}
      </Button>
    </div>
  );
}

/**
 * The folded "Backlog · n" line (REPLAN 53b): Backlog tasks sit out of the
 * groups until asked for, at the end of each group (or of the list).
 */
export function BacklogLine({
  count,
  shown,
  onToggle,
}: {
  count: number;
  shown: boolean;
  onToggle: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div className="flex min-h-(--row-h-sm) items-center gap-2 px-2.5 font-sans text-xs text-muted-foreground">
      <button
        type="button"
        data-slot="backlog-line"
        aria-expanded={shown}
        aria-label={`Backlog, ${count} ${count === 1 ? "task" : "tasks"}, ${shown ? "hide" : "show"}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="flex items-center gap-1.5 rounded-sm tabular-nums transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <StatusIcon category="backlog" className="size-icon-xs" />
        Backlog · {count}
        <ChevronRight
          aria-hidden
          className={cn(
            "size-icon-xs shrink-0 transition-transform duration-(--motion-fast) ease-(--ease-out)",
            shown && "rotate-90",
          )}
        />
      </button>
    </div>
  );
}

/** A project's "+ Add section" line, ending the List grouped by section. */
export function AddSectionLine({ onAdd }: { onAdd: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  if (adding) {
    return (
      <NameInput
        initial=""
        label="New section name"
        placeholder="Section name"
        onCommit={(name) => {
          setAdding(false);
          if (name) onAdd(name);
        }}
        onCancel={() => setAdding(false)}
      />
    );
  }
  return (
    <div className="flex min-h-(--row-h-sm) items-center px-1.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setAdding(true);
        }}
        className="flex items-center gap-1.5 rounded-sm px-1 font-sans text-xs text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Plus aria-hidden className="size-icon-xs" />
        Add section
      </button>
    </div>
  );
}

/** A one-line name field: Enter saves, Esc or leaving it cancels an empty one. */
export function NameInput({
  initial,
  label,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  placeholder?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ended = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const end = (commit: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (commit) onCommit(value.trim());
    else onCancel();
  };
  return (
    <div className="flex min-h-(--row-h-sm) items-center px-1.5">
      <Input
        ref={ref}
        size="sm"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // The List's keys stay out of a field being typed in.
          e.stopPropagation();
          if (e.key === "Enter") end(true);
          else if (e.key === "Escape") end(false);
        }}
        onBlur={() => end(value.trim().length > 0)}
        className="max-w-72"
      />
    </div>
  );
}
