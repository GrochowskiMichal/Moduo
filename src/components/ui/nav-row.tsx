import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { LabelColor } from "../tag-colors";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { eyebrowVariants } from "./eyebrow";
import { Input } from "./input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

// NavRow — the sidebar row for every module (design-state-layer DS-3).
//
//   [icon or dot] label ……………… [indicator] [count ⇄ ⋯]
//
// The count and the ⋯ share ONE trailing slot: on hover, keyboard focus or an
// open menu the count fades out and ⋯ fades in where it was, so nothing
// reflows and the label never re-truncates under the cursor (DESIGN_RULES R6).
// The slot is at least as wide as ⋯, which is why a row with a menu and a
// one-digit count is still steady. A row without a menu reserves nothing: its
// count sits flush right. ⋯ is also a tab stop, and right-click opens the same
// menu, so it is never hover-only.
//
// The current destination is NOT a selection (R5): it takes the neutral
// `bg-state-active` and `aria-current="page"`; hover is `bg-state-hover`.

// ── menu kit ─────────────────────────────────────────────────────────────────

type MenuKitItemProps = {
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  variant?: "default" | "destructive";
  onSelect?: (event: Event) => void;
};
type MenuKitRadioGroupProps = {
  children?: React.ReactNode;
  value?: string;
  onValueChange?: (value: string) => void;
};
type MenuKitRadioItemProps = { children?: React.ReactNode; value: string; disabled?: boolean };
type MenuKitChildrenProps = { children?: React.ReactNode; className?: string };

/**
 * The menu pieces a row's `menu` renders with. NavRow draws the same items in
 * two places, the ⋯ dropdown and the right-click menu, so a consumer writes
 * them once against this kit instead of picking Dropdown* or ContextMenu*.
 */
export type MenuKit = {
  Item: React.ComponentType<MenuKitItemProps>;
  Separator: React.ComponentType<{ className?: string }>;
  Label: React.ComponentType<MenuKitChildrenProps>;
  Sub: React.ComponentType<{ children?: React.ReactNode }>;
  SubTrigger: React.ComponentType<MenuKitChildrenProps>;
  SubContent: React.ComponentType<MenuKitChildrenProps>;
  RadioGroup: React.ComponentType<MenuKitRadioGroupProps>;
  RadioItem: React.ComponentType<MenuKitRadioItemProps>;
  /**
   * For an item that opens something which takes focus (a dialog, a popover,
   * an inline editor): returns an `onSelect` that runs `action` once the menu
   * has closed, instead of letting the closing menu hand focus back to the
   * row and dismiss it (gotchas/ui.md, "A Radix menu item that opens…").
   */
  afterClose: (action: () => void) => () => void;
  /** `onSelect` for a Rename item: the row's inline editor. Rows with `onRename` only. */
  rename: () => void;
};

const DROPDOWN_KIT = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Label: DropdownMenuLabel,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
  RadioGroup: DropdownMenuRadioGroup,
  RadioItem: DropdownMenuRadioItem,
} satisfies Omit<MenuKit, "afterClose" | "rename">;

const CONTEXT_KIT = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Label: ContextMenuLabel,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
  RadioGroup: ContextMenuRadioGroup,
  RadioItem: ContextMenuRadioItem,
} satisfies Omit<MenuKit, "afterClose" | "rename">;

// ── shared slot recipe ───────────────────────────────────────────────────────

const fade = "transition-opacity duration-(--motion-fade) ease-(--ease-out)";

// What swaps the count for the action: pointer over the row, keyboard focus
// anywhere in it, its ⋯ menu open (the trigger's aria-expanded) or its
// right-click menu open (the row's own data-state).
const SWAP_OUT = cn(
  "group-hover/nav:opacity-0 group-has-[:focus-visible]/nav:opacity-0",
  "group-has-[[data-slot=nav-row-action][aria-expanded=true]]/nav:opacity-0",
  "group-data-[state=open]/nav:opacity-0",
);
const SWAP_IN = cn(
  "opacity-0 group-hover/nav:opacity-100 group-has-[:focus-visible]/nav:opacity-100",
  "aria-expanded:opacity-100 group-data-[state=open]/nav:opacity-100",
);

// The slot action (⋯ on a row, + on a section header): 20 px, quiet, one
// state step up on hover. It sits on top of the count, right-aligned.
const slotAction = cn(
  "pointer-events-auto absolute inset-y-0 right-0 flex size-5 items-center justify-center rounded-sm",
  "text-muted-foreground outline-none hover:bg-state-active hover:text-foreground",
  "focus-visible:ring-2 focus-visible:ring-ring/50",
  "transition-[opacity,background-color,color] duration-(--motion-fade) ease-(--ease-out)",
  SWAP_IN,
);

const countClass = "font-sans text-xs tabular-nums text-muted-foreground";

function TrailingSlot({
  count,
  swaps,
  children,
}: {
  count: number | undefined;
  /** An action shares the slot, so the count fades out for it. */
  swaps: boolean;
  children?: React.ReactNode;
}) {
  const showCount = typeof count === "number" && count > 0;
  if (!showCount && !swaps) return null;
  return (
    <span
      data-slot="nav-row-trail"
      className={cn(
        // Clicks fall through to the row's main button, except on the action.
        "pointer-events-none relative flex h-5 shrink-0 items-center justify-end",
        swaps && "min-w-5",
      )}
    >
      {showCount ? (
        <span
          data-slot="nav-row-count"
          aria-hidden
          className={cn(countClass, fade, swaps && SWAP_OUT)}
        >
          {count}
        </span>
      ) : null}
      {children}
    </span>
  );
}

// ── NavRow ───────────────────────────────────────────────────────────────────

type NavRowProps = Omit<React.ComponentProps<"div">, "children" | "onSelect"> & {
  label: string;
  /** Leading slot: a 16 px icon or a {@link NavRowDot}. Keeps labels aligned. */
  icon?: React.ReactNode;
  /** Trailing count. Hidden at 0. */
  count?: number;
  /** What a screen reader hears for the count (default: the number). */
  countLabel?: string;
  /** The destination you are on: `aria-current="page"`, neutral active fill. */
  current?: boolean;
  onSelect?: () => void;
  /** An always-visible mark before the slot (drift, unread). Never swaps. */
  indicator?: React.ReactNode;
  /** The row's actions: rendered in the ⋯ menu and the right-click menu. */
  menu?: (kit: MenuKit) => React.ReactNode;
  /** Accessible name of ⋯ (default "<label> options"). */
  menuLabel?: string;
  /** Enables inline rename: double-click, F2, or a `kit.rename` menu item. */
  onRename?: (name: string) => void;
  /** Indent for nested rows (the notes tree). */
  level?: 0 | 1 | 2;
  /** A drag is hovering this row and would drop here. */
  dropTarget?: boolean;
  /** This row is the drag source. */
  dragging?: boolean;
  /** Identifies the row for {@link focusNavRow}. */
  navId?: string;
};

const LEVEL_PAD = { 0: "pl-2", 1: "pl-6", 2: "pl-10" } as const;

function NavRow({
  label,
  icon,
  count,
  countLabel,
  current = false,
  onSelect,
  indicator,
  menu,
  menuLabel,
  onRename,
  level = 0,
  dropTarget = false,
  dragging = false,
  navId,
  className,
  ...props
}: NavRowProps) {
  const [editing, setEditing] = useState(false);
  const mainRef = useRef<HTMLButtonElement>(null);
  const pending = useRef<(() => void) | null>(null);

  const afterClose = (action: () => void) => () => {
    pending.current = action;
  };
  const runPending = (event: Event) => {
    const action = pending.current;
    if (!action) return;
    pending.current = null;
    event.preventDefault(); // the action places focus, not the closing menu
    action();
  };
  const startRename = () => {
    if (onRename) setEditing(true);
  };
  const kit = (base: typeof DROPDOWN_KIT | typeof CONTEXT_KIT): MenuKit => ({
    ...(base as Omit<MenuKit, "afterClose" | "rename">),
    afterClose,
    rename: afterClose(startRename),
  });

  const showCount = typeof count === "number" && count > 0;
  const hasMenu = !!menu;

  const row = (
    <div
      data-slot="nav-row"
      data-nav-id={navId}
      data-current={current || undefined}
      data-drop-target={dropTarget || undefined}
      data-dragging={dragging || undefined}
      className={cn(
        "group/nav relative flex h-(--row-h) min-w-0 items-center gap-2.5 rounded-md pr-1.5",
        "font-display text-base font-medium select-none",
        "transition-[color,background-color,box-shadow,opacity] duration-(--motion-fade) ease-(--ease-out)",
        "has-[[data-slot=nav-row-main]:focus-visible]:ring-2 has-[[data-slot=nav-row-main]:focus-visible]:ring-ring/50",
        LEVEL_PAD[level],
        current
          ? "bg-state-active text-foreground"
          : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
        dropTarget && "bg-state-active text-foreground ring-1 ring-inset ring-primary/60",
        dragging && "opacity-50",
        className,
      )}
      {...props}
    >
      {editing ? (
        <>
          {icon ? <IconSlot>{icon}</IconSlot> : null}
          <RenameField
            initial={label}
            onDone={(next) => {
              setEditing(false);
              if (next !== null && next !== label) onRename?.(next);
            }}
            onExit={() => mainRef.current?.focus()}
          />
        </>
      ) : (
        <>
          <button
            ref={mainRef}
            type="button"
            data-slot="nav-row-main"
            aria-current={current ? "page" : undefined}
            onClick={onSelect}
            onDoubleClick={onRename ? startRename : undefined}
            onKeyDown={(e) => {
              if (onRename && e.key === "F2") {
                e.preventDefault();
                startRename();
              }
            }}
            // The ::after stretches the click target over the whole row; the
            // indicator and the slot action sit above it.
            className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left outline-none after:absolute after:inset-0"
          >
            {icon ? <IconSlot>{icon}</IconSlot> : null}
            <span data-slot="nav-row-label" className="min-w-0 flex-1 truncate">
              {label}
            </span>
            {showCount ? <span className="sr-only">, {countLabel ?? String(count)}</span> : null}
          </button>
          {indicator ? (
            <span className="relative flex shrink-0 items-center">{indicator}</span>
          ) : null}
          <TrailingSlot count={count} swaps={hasMenu}>
            {menu ? (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        data-slot="nav-row-action"
                        aria-label={menuLabel ?? `${label} options`}
                        className={slotAction}
                      >
                        <MoreHorizontal className="size-icon-sm" aria-hidden />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Options</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" onCloseAutoFocus={runPending}>
                  {menu(kit(DROPDOWN_KIT))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </TrailingSlot>
        </>
      )}
    </div>
  );

  // Always wrapped, so a menu that comes and goes (Inbox's, while it has
  // drift) never remounts the row and drops its focus.
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={editing || !menu}>
        {row}
      </ContextMenuTrigger>
      {menu ? (
        <ContextMenuContent onCloseAutoFocus={runPending}>
          {menu(kit(CONTEXT_KIT))}
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
}

function IconSlot({ children }: { children: React.ReactNode }) {
  return (
    <span
      data-slot="nav-row-icon"
      className="flex w-icon shrink-0 items-center justify-center [&_svg:not([class*='size-'])]:size-icon"
    >
      {children}
    </span>
  );
}

/** Inline rename: Enter or blur saves, Esc throws the draft away. */
function RenameField({
  initial,
  onDone,
  onExit,
}: {
  initial: string;
  /** The trimmed new name, or null for "no change". */
  onDone: (next: string | null) => void;
  /** Enter/Esc hand focus back to the row (blur leaves it where it went). */
  onExit: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (save: boolean, refocus: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = value.trim();
    onDone(save && next ? next : null);
    // The row's button remounts on this render; focus it after the commit.
    if (refocus) setTimeout(onExit, 0);
  };

  return (
    <Input
      ref={ref}
      size="sm"
      aria-label="Name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(false, true);
        }
      }}
      onBlur={() => finish(true, false)}
      className="min-w-0 flex-1 px-1.5 font-sans"
    />
  );
}

// ── NavRowDot ────────────────────────────────────────────────────────────────

/** The leading dot for a row without an icon (a bucket, a calendar). Neutral by default. */
function NavRowDot({ color = "gray", className }: { color?: LabelColor; className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="nav-row-dot"
      data-label={color}
      className={cn("tag-dot size-2 shrink-0 rounded-full", className)}
    />
  );
}

// ── NavSectionHeader ─────────────────────────────────────────────────────────

type NavSectionHeaderProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: string;
  /** Aggregate count, flush right with the rows' counts. Hidden at 0. */
  count?: number;
  countLabel?: string;
  /** Collapsible when `onToggle` is set. */
  collapsed?: boolean;
  onToggle?: () => void;
  /** A hover "+" in the count's slot (e.g. New bucket). */
  onAdd?: () => void;
  addLabel?: string;
  /** An always-visible mark before the slot, e.g. drift hidden by a collapse. */
  indicator?: React.ReactNode;
};

/** A rail section's eyebrow header: optional collapse and a hover "+" that swaps with the count. */
function NavSectionHeader({
  label,
  count,
  countLabel,
  collapsed = false,
  onToggle,
  onAdd,
  addLabel,
  indicator,
  className,
  ...props
}: NavSectionHeaderProps) {
  const showCount = typeof count === "number" && count > 0;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const text = (
    <>
      <span className={cn(eyebrowVariants({ tone: "inherit" }), "min-w-0 truncate")}>{label}</span>
      {onToggle ? <Chevron className="size-icon-xs shrink-0" aria-hidden /> : null}
      {showCount ? <span className="sr-only">, {countLabel ?? String(count)}</span> : null}
    </>
  );
  return (
    <div
      data-slot="nav-section-header"
      className={cn(
        "group/nav relative flex h-(--row-h-sm) min-w-0 items-center gap-2.5 rounded-md pr-1.5 pl-2 text-muted-foreground",
        onToggle && "hover:text-foreground",
        "has-[[data-slot=nav-row-main]:focus-visible]:ring-2 has-[[data-slot=nav-row-main]:focus-visible]:ring-ring/50",
        className,
      )}
      {...props}
    >
      {onToggle ? (
        <button
          type="button"
          data-slot="nav-row-main"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="flex h-full min-w-0 flex-1 items-center gap-1 text-left outline-none after:absolute after:inset-0"
        >
          {text}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1">{text}</span>
      )}
      {indicator ? <span className="relative flex shrink-0 items-center">{indicator}</span> : null}
      <TrailingSlot count={count} swaps={!!onAdd}>
        {onAdd ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-slot="nav-row-action"
                aria-label={addLabel ?? `Add to ${label}`}
                onClick={onAdd}
                className={slotAction}
              >
                <Plus className="size-icon-sm" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>{addLabel ?? `Add to ${label}`}</TooltipContent>
          </Tooltip>
        ) : null}
      </TrailingSlot>
    </div>
  );
}

// ── focus ────────────────────────────────────────────────────────────────────

/**
 * Put focus back on a rail after something its row menu opened has closed (a
 * dialog with no trigger otherwise leaves it on the page body). Tries the row
 * `navId`, then the current row, then the first row. Returns whether it
 * focused anything.
 */
function focusNavRow(container: ParentNode | null | undefined, navId?: string | null): boolean {
  if (!container) return false;
  const mains = Array.from(
    container.querySelectorAll<HTMLElement>('[data-slot="nav-row"] [data-slot="nav-row-main"]'),
  );
  const target =
    (navId
      ? mains.find(
          (el) => el.closest<HTMLElement>('[data-slot="nav-row"]')?.dataset.navId === navId,
        )
      : undefined) ??
    mains.find((el) => el.getAttribute("aria-current") === "page") ??
    mains[0];
  if (!target) return false;
  target.focus();
  return true;
}

/**
 * The `onCloseAutoFocus` for a dialog or popover a row's menu opened. It has no
 * trigger to return to, so focus goes back to the rail with `focusNavRow`,
 * unless the person already put it somewhere else: a non-modal popover closed
 * by clicking into a field must leave the caret in that field.
 */
function restoreNavFocus(
  event: Event,
  container: ParentNode | null | undefined,
  navId?: string | null,
): void {
  event.preventDefault();
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  focusNavRow(container, navId);
}

export type { NavRowProps, NavSectionHeaderProps };
export { focusNavRow, NavRow, NavRowDot, NavSectionHeader, restoreNavFocus };
