// The Board's furniture (TV-U11; tasks-v3 §5, calls 22a, 53a, 53b, defaults
// n and o): a column's header (its mark, name as typed, count, the "+" that
// stays visible, and its ⋯), the folded button that stands in for a column,
// a lane's header, the "n hidden" line, and "+ Add status" / "+ Add
// section". The UI says "section", never "column" (22a). Kept out of
// task-board-view.tsx so the view stays the layout and the drag wiring.

import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { GroupHeader } from "../../../components/ui/group-header";
import { IconButton } from "../../../components/ui/icon-button";
import { NavRowDot } from "../../../components/ui/nav-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import type { BoardMark } from "../board-columns";
import type { GroupAdd, GroupAddState } from "../list-group-add";
import { bucketDotColor } from "../sidebar";
import { StatusIcon } from "./status-icon";
import { type GroupMarkContext, groupMark, NameInput } from "./task-list-parts";

/** What a column or lane leads with: the category's icon, the List's group
 *  mark (priority, project dot, avatar, team), an area's dot. */
export function BoardMarkView({ mark, ctx }: { mark: BoardMark; ctx: GroupMarkContext }) {
  if (!mark) return null;
  if (mark.kind === "status") {
    return <StatusIcon category={mark.category} className="text-muted-foreground" />;
  }
  if (mark.kind === "dot") return <NavRowDot color={bucketDotColor({ color: mark.color })} />;
  return <>{groupMark(mark.groupBy, mark.key, ctx)}</>;
}

/** Two letters for a section's folded button (it has no icon, research §2). */
function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "·";
}

/** The "+" of a column (default n): it stays visible; disabled says why. */
function AddButton({
  label,
  self,
  state,
  onAdd,
}: {
  label: string;
  self?: boolean;
  state: GroupAddState;
  onAdd: (add: GroupAdd) => void;
}) {
  if (state.kind === "none") return null;
  return (
    <IconButton
      icon={Plus}
      // "Add a task to you", never "to You" (MOD-137).
      label={`Add a task to ${self ? "you" : label}`}
      tooltip={state.kind === "disabled" ? state.reason : undefined}
      aria-description={state.kind === "disabled" ? state.reason : undefined}
      aria-disabled={state.kind === "disabled" || undefined}
      className={cn(state.kind === "disabled" && "opacity-50")}
      onClick={(e) => {
        e.stopPropagation();
        if (state.kind === "add") onAdd(state.add);
      }}
    />
  );
}

/**
 * A column's header: mark · name as typed · count · "+" (always there) · ⋯
 * (on hover): Fold, and a section's Rename… / Delete section, or "Edit
 * statuses…" on one project's status.
 */
export function BoardColumnHeader({
  label,
  count,
  mark,
  markCtx,
  add,
  onAdd,
  onFold,
  section,
  onEditStatuses,
  self,
}: {
  label: string;
  count: number;
  mark: BoardMark;
  markCtx: GroupMarkContext;
  add: GroupAddState;
  onAdd: (add: GroupAdd) => void;
  onFold: () => void;
  /** A section's own edits (a project's board grouped by section). */
  section?: { onRename: (name: string) => void; onDelete: () => void } | null;
  /** One project's status: its ⋯ opens the project's statuses. */
  onEditStatuses?: (() => void) | null;
  /** The reader's own column ("You"): its buttons say "you" (MOD-137). */
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
  return (
    <GroupHeader
      data-board-header={label}
      label={label}
      count={count}
      leading={<BoardMarkView mark={mark} ctx={markCtx} />}
      actions={
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={MoreHorizontal}
              label={self ? "Your column options" : `${label} options`}
              tooltip={null}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={onFold}>Fold</DropdownMenuItem>
            {section ? (
              <>
                <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename…</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={section.onDelete}>
                  Delete section
                </DropdownMenuItem>
              </>
            ) : null}
            {onEditStatuses ? (
              <DropdownMenuItem onSelect={onEditStatuses}>Edit statuses…</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      }
      persistentActions={<AddButton label={label} self={self} state={add} onAdd={onAdd} />}
    />
  );
}

/**
 * A folded column (53b): a small button in the column's place, never a
 * full-height column and never rotated text. The mark, the count and a
 * chevron, stacked; hover names it ("Backlog · 6"). A click unfolds it; it
 * takes drops only once unfolded.
 */
export function FoldedColumn({
  label,
  count,
  mark,
  markCtx,
  onUnfold,
}: {
  label: string;
  count: number;
  mark: BoardMark;
  markCtx: GroupMarkContext;
  onUnfold: () => void;
}) {
  const lead: ReactNode = mark ? (
    <BoardMarkView mark={mark} ctx={markCtx} />
  ) : (
    <span className="font-sans text-2xs font-medium text-muted-foreground">{initials(label)}</span>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-board-folded={label}
          aria-expanded={false}
          aria-label={`${label}, ${count} ${count === 1 ? "task" : "tasks"}, unfold`}
          onClick={onUnfold}
          className={cn(
            "flex w-8 shrink-0 flex-col items-center gap-1.5 self-start rounded-md py-2",
            "ring-1 ring-hairline ring-inset text-muted-foreground",
            "transition-colors duration-(--motion-fade) ease-(--ease-out)",
            "hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
        >
          <span className="flex items-center">{lead}</span>
          <span className="font-sans text-xs text-muted-foreground tabular-nums">{count}</span>
          <ChevronRight aria-hidden className="size-icon-xs text-subtle-foreground" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label} · {count}
      </TooltipContent>
    </Tooltip>
  );
}

/** A lane's header (call 85): full width, foldable, its count; sentence case. */
export function BoardLaneHeader({
  label,
  count,
  mark,
  markCtx,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  mark: BoardMark;
  markCtx: GroupMarkContext;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <GroupHeader
      data-board-lane={label}
      label={label}
      count={count}
      leading={<BoardMarkView mark={mark} ctx={markCtx} />}
      onToggle={onToggle}
      collapsed={collapsed}
      // The label stays at the board's left edge while it scrolls sideways.
      className="sticky start-0 z-(--z-sticky) w-fit min-w-60 bg-background"
    />
  );
}

/** "3 hidden · Show" at the board's end (default o): empty people, teams,
 *  projects and areas. */
export function HiddenColumnsLine({
  hidden,
  shown,
  onToggle,
}: {
  hidden: number;
  shown: boolean;
  onToggle: () => void;
}) {
  if (hidden <= 0) return null;
  return (
    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onToggle}>
      {shown ? "Hide empty" : `${hidden} hidden · Show`}
    </Button>
  );
}

/** "+ Add status" (one project's board by status, 53a) — opens its statuses. */
export function AddStatusButton({ onAdd }: { onAdd: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onAdd}>
      <Plus aria-hidden />
      Add status
    </Button>
  );
}

/** "+ Add section" (a project's board by section, 22a): names the new one in place. */
export function AddSectionButton({ onAdd }: { onAdd: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  if (adding) {
    return (
      <div className="w-(--board-col-w)">
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
      </div>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={() => setAdding(true)}
    >
      <Plus aria-hidden />
      Add section
    </Button>
  );
}
