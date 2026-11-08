// The reader's toolbar (specs/mail-v3.md §8, AC22; specs/mail-improve.md §4, AC14):
// one roving Tab stop (`components/ui/toolbar.tsx`, arrows inside), grouped
// Reply r · Reply all a · Forward f | Done e · Snooze s · Remind w | Task t · Link l |
// the side-panel toggle ⌥0 | ⋯ (Pin, Move, Private note and the rest). Done always
// shows its label; Snooze and Remind show theirs from 1280 px. Every name starts with
// its visible label, keys go in aria-keyshortcuts and the tooltip ("Label  key"). A
// pressed one (snoozed, reminding, linked) shows a dot. While the sender waits in the
// Screener the toolbar is aria-disabled and acts on nothing (AC24).

import {
  BellRing,
  Check,
  Clock,
  Forward,
  Link2,
  ListTodo,
  MoreHorizontal,
  PanelRight,
  Reply,
  ReplyAll,
} from "lucide-react";
import { type ComponentType, Fragment, type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Toolbar } from "@/components/ui/toolbar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
  /** The visible word: always, from 1280 px, or never (icon only). */
  shown?: { text: string; from: "always" | "wide" };
};

const GROUPS: Tool[][] = [
  [
    { action: "reply", label: "Reply", key: "r", icon: Reply },
    { action: "reply-all", label: "Reply all", key: "a", icon: ReplyAll },
    { action: "forward", label: "Forward", key: "f", icon: Forward },
  ],
  [
    {
      action: "done",
      label: "Done",
      key: "e",
      icon: Check,
      shown: { text: "Done", from: "always" },
    },
    {
      action: "snooze",
      label: "Snooze",
      key: "s",
      icon: Clock,
      shown: { text: "Snooze", from: "wide" },
    },
    {
      action: "remind",
      label: "Remind me if no reply",
      key: "w",
      icon: BellRing,
      shown: { text: "Remind", from: "wide" },
    },
  ],
  [
    { action: "task", label: "Make a task", key: "t", icon: ListTodo },
    { action: "link", label: "Link to a task, contact or note", key: "l", icon: Link2 },
  ],
];

/** Snooze and Remind show their words from this window width (§4). */
export const TOOLBAR_LABELS_FROM = 1280;

function useWide(): boolean {
  const read = () => typeof window !== "undefined" && window.innerWidth >= TOOLBAR_LABELS_FROM;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    const on = () => setWide(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return wide;
}

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
  wide,
  disabled,
  onAction,
}: {
  tool: Tool;
  pressed: boolean;
  wide: boolean;
  disabled: boolean;
  onAction: (action: ReaderAction) => void;
}) {
  const label = (pressed && PRESSED_LABEL[tool.action]) || tool.label;
  const word = tool.shown && (tool.shown.from === "always" || wide) ? tool.shown.text : null;
  const Icon = tool.icon;
  const common = {
    "aria-pressed": pressed || undefined,
    "aria-disabled": disabled || undefined,
    "aria-keyshortcuts": tool.key ?? undefined,
    "data-reader-action": tool.action,
    onClick: () => {
      if (!disabled) onAction(tool.action);
    },
  };
  const dot = pressed ? (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-primary"
    />
  ) : null;
  if (!word) {
    return (
      <span className="relative flex">
        <IconButton
          icon={Icon}
          label={label}
          tooltip={<Tip label={label} keyCap={tool.key} />}
          tooltipSide="bottom"
          className={cn(pressed && "text-foreground", disabled && "opacity-50")}
          {...common}
        />
        {dot}
      </span>
    );
  }
  return (
    <span className="relative flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            // The name starts with the visible word ("Remind me if no reply").
            aria-label={label === word ? undefined : label}
            className={cn(
              tool.action === "done" ? "text-foreground" : "text-muted-foreground",
              disabled && "opacity-50",
            )}
            {...common}
          >
            <Icon aria-hidden />
            {word}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Tip label={label} keyCap={tool.key} />
        </TooltipContent>
      </Tooltip>
      {dot}
    </span>
  );
}

/** A menu item that opened a popover (the remind picker) keeps the focus there
 *  instead of handing it back to the ⋯ button. */
function keepPopoverFocus(e: Event) {
  const at = document.activeElement;
  if (at && at !== document.body && at.closest('[data-slot="popover-content"]')) e.preventDefault();
}

const Sep = () => (
  <span
    role="separator"
    aria-orientation="vertical"
    className="mx-1 h-4 w-px shrink-0 bg-hairline"
  />
);

export type ReaderToolbarProps = {
  onAction: (action: ReaderAction) => void;
  pressed?: Partial<Record<ReaderAction, boolean>>;
  /** The ⋯ menu's items; the button hides when there are none. */
  menu?: ReactNode;
  /** The side-panel toggle; absent hides it. */
  panel?: { open: boolean; onToggle: () => void } | null;
  /** The sender waits in the Screener: decide it first (AC24). */
  disabled?: boolean;
};

export function ReaderToolbar({
  onAction,
  pressed = {},
  menu,
  panel,
  disabled = false,
}: ReaderToolbarProps) {
  const wide = useWide();
  const panelLabel = panel?.open ? "Hide the side panel" : "Show the side panel";
  return (
    <Toolbar
      gap="tight"
      aria-label="Conversation actions"
      aria-disabled={disabled || undefined}
      className="shrink-0 overflow-hidden px-3 pt-3"
    >
      {GROUPS.map((group, i) => (
        <Fragment key={group[0]!.action}>
          {i > 0 ? <Sep /> : null}
          {group.map((tool) => (
            <ToolButton
              key={tool.action}
              tool={tool}
              pressed={!!pressed[tool.action]}
              wide={wide}
              disabled={disabled}
              onAction={onAction}
            />
          ))}
        </Fragment>
      ))}
      {panel ? (
        <>
          <Sep />
          <IconButton
            icon={PanelRight}
            label={panelLabel}
            tooltip={<Tip label={panelLabel} keyCap="⌥0" />}
            tooltipSide="bottom"
            aria-pressed={panel.open}
            aria-keyshortcuts="Alt+0"
            data-reader-action="panel"
            className={panel.open ? "bg-state-active text-foreground" : undefined}
            onClick={panel.onToggle}
          />
        </>
      ) : null}
      {menu ? (
        <>
          {panel ? <Sep /> : null}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <IconButton
                icon={MoreHorizontal}
                label="More actions"
                tooltip={null}
                data-reader-action="more"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={keepPopoverFocus}>
              {menu}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </Toolbar>
  );
}
