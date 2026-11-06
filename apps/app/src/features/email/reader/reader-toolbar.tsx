// The reader's toolbar (specs/mail-v3.md §8, AC22): Reply r, Reply all a,
// Forward f | Done e, Snooze s, Remind w | Task t, Link l, Note n | Pin, Move m,
// ⋯ | the side-panel toggle. Icon buttons whose tooltips name the key; a pressed
// one (snoozed, reminding, linked, pinned) shows a dot.

import {
  BellRing,
  Check,
  Clock,
  FolderInput,
  Forward,
  Link2,
  ListTodo,
  MoreHorizontal,
  PanelRight,
  Pin,
  Reply,
  ReplyAll,
  StickyNote,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";

export type ReaderAction =
  | "reply"
  | "reply-all"
  | "forward"
  | "done"
  | "snooze"
  | "remind"
  | "task"
  | "link"
  | "note"
  | "pin"
  | "move";

type Tool = {
  action: ReaderAction;
  label: string;
  key: string | null;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const GROUPS: Tool[][] = [
  [
    { action: "reply", label: "Reply", key: "r", icon: Reply },
    { action: "reply-all", label: "Reply all", key: "a", icon: ReplyAll },
    { action: "forward", label: "Forward", key: "f", icon: Forward },
  ],
  [
    { action: "done", label: "Done", key: "e", icon: Check },
    { action: "snooze", label: "Snooze", key: "s", icon: Clock },
    { action: "remind", label: "Remind me if no reply", key: "w", icon: BellRing },
  ],
  [
    { action: "task", label: "Make a task", key: "t", icon: ListTodo },
    { action: "link", label: "Link to a task, contact or note", key: "l", icon: Link2 },
    { action: "note", label: "Private note", key: "n", icon: StickyNote },
  ],
  [
    { action: "pin", label: "Pin", key: "p", icon: Pin },
    { action: "move", label: "Move", key: "m", icon: FolderInput },
  ],
];

/** The label a pressed tool reads instead (the task or note already exists). */
const PRESSED_LABEL: Partial<Record<ReaderAction, string>> = {
  task: "Open the task",
  note: "Open the private note",
  pin: "Unpin",
};

function Tip({ label, keyCap }: { label: string; keyCap: string | null }) {
  return (
    <span className="flex items-center gap-1.5">
      {label}
      {keyCap ? <Kbd>{keyCap}</Kbd> : null}
    </span>
  );
}

function ToolButton({
  tool,
  pressed,
  onAction,
}: {
  tool: Tool;
  pressed: boolean;
  onAction: (action: ReaderAction) => void;
}) {
  const label = (pressed && PRESSED_LABEL[tool.action]) || tool.label;
  return (
    <span className="relative flex">
      <IconButton
        icon={tool.icon}
        label={label}
        tooltip={<Tip label={label} keyCap={tool.key} />}
        tooltipSide="bottom"
        aria-pressed={pressed || undefined}
        className={pressed ? "text-foreground" : undefined}
        onClick={() => onAction(tool.action)}
      />
      {pressed ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-primary"
        />
      ) : null}
    </span>
  );
}

const Sep = () => <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-hairline" />;

export type ReaderToolbarProps = {
  onAction: (action: ReaderAction) => void;
  pressed?: Partial<Record<ReaderAction, boolean>>;
  /** The ⋯ menu's items; the button hides when there are none. */
  menu?: ReactNode;
  /** The side-panel toggle (MV-11 wires it); absent hides it. */
  panel?: { open: boolean; onToggle: () => void } | null;
};

export function ReaderToolbar({ onAction, pressed = {}, menu, panel }: ReaderToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Conversation actions"
      className="flex shrink-0 items-center gap-0.5 overflow-hidden px-3 pt-3"
    >
      {GROUPS.map((group, i) => (
        <span key={group[0]!.action} className="flex items-center gap-0.5">
          {i > 0 ? <Sep /> : null}
          {group.map((tool) => (
            <ToolButton
              key={tool.action}
              tool={tool}
              pressed={!!pressed[tool.action]}
              onAction={onAction}
            />
          ))}
        </span>
      ))}
      {menu ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton icon={MoreHorizontal} label="More actions" tooltip={null} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <span className="flex-1" />
      {panel ? (
        <IconButton
          icon={PanelRight}
          label={panel.open ? "Hide the side panel" : "Today, contact and task"}
          tooltip={
            <Tip
              label={panel.open ? "Hide the side panel" : "Today, contact and task"}
              keyCap="⌥1"
            />
          }
          tooltipSide="bottom"
          aria-pressed={panel.open}
          className={panel.open ? "bg-state-active text-foreground" : undefined}
          onClick={panel.onToggle}
        />
      ) : null}
    </div>
  );
}
