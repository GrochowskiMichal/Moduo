// The event menus (CALR-4b, AC26): the right-click (and ⌃↵) menu at a point
// on the week, without shortcuts, and the Event panel's ⋯ with the same items
// and their keys. The items come from ../event-menu.ts; a picked item runs
// only once the menu has closed (rules: ui-radix), so whatever it opens (the
// Event panel, the link picker, the delete question) keeps its focus.

import { Ellipsis } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
import { isMacPlatform } from "../../../lib/hotkeys/use-app-hotkeys";
import {
  ariaShortcut,
  type EventMenuItem,
  type EventMenuItemId,
  menuShortcut,
  type MoveTarget,
} from "../event-menu";

export type EventMenuPick = { id: EventMenuItemId; targetId?: string };

/** A box on the page the menu opens from: the pointer, or the selected event. */
export type MenuAnchor = { top: number; left: number; width: number; height: number };

function Items({
  items,
  targets,
  shortcuts,
  pick,
}: {
  items: EventMenuItem[];
  targets: readonly MoveTarget[];
  shortcuts: boolean;
  pick: (choice: EventMenuPick) => void;
}) {
  const isMac = isMacPlatform();
  return items.map((item) => {
    if (item.id === "move") {
      return (
        <DropdownMenuSub key={item.id}>
          <DropdownMenuSubTrigger>{item.label}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-40">
            {targets.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => pick({ id: "move", targetId: t.id })}>
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    }
    return (
      <Row key={item.id} destructive={item.destructive}>
        <DropdownMenuItem
          variant={item.destructive ? "destructive" : "default"}
          aria-keyshortcuts={
            shortcuts && item.hotkey ? ariaShortcut(item.hotkey, isMac) : undefined
          }
          onSelect={() => pick({ id: item.id })}
        >
          {/* The key is said through aria-keyshortcuts, so the name is the label alone. */}
          {shortcuts && item.hotkey ? (
            <DropdownMenuShortcut aria-hidden className="order-last">
              {menuShortcut(item.hotkey, isMac)}
            </DropdownMenuShortcut>
          ) : null}
          {item.label}
        </DropdownMenuItem>
      </Row>
    );
  });
}

/** Delete sits apart, under a hairline. */
function Row({ destructive, children }: { destructive?: boolean; children: ReactNode }) {
  return destructive ? (
    <>
      <DropdownMenuSeparator />
      {children}
    </>
  ) : (
    children
  );
}

/** The right-click and ⌃↵ menu: at a point on the week, no shortcuts. */
export function EventContextMenu({
  open,
  anchor,
  title,
  items,
  targets,
  onPick,
  onClose,
  restoreFocus,
  focusFirst,
}: {
  /** Opened by a key: the first item takes focus, as a keyboard-opened menu's does. */
  focusFirst: boolean;
  /** Kept mounted while closed, so its close runs (and hands focus back) in full. */
  open: boolean;
  anchor: MenuAnchor;
  title: string;
  items: EventMenuItem[];
  targets: readonly MoveTarget[];
  onPick: (choice: EventMenuPick) => void;
  onClose: () => void;
  /** Where focus goes back to once the menu has closed (before the item runs). */
  restoreFocus: () => void;
}) {
  // The pick runs once the menu has closed (see the header).
  const pending = useRef<EventMenuPick | null>(null);
  const content = useRef<HTMLDivElement>(null);
  // Radix focuses the menu itself on open; a key-opened menu starts on its first item.
  useEffect(() => {
    if (!open || !focusFirst) return;
    const id = window.setTimeout(() => {
      content.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, focusFirst]);
  return (
    // Not modal, like the system's own context menu: the page stays readable
    // (nothing aria-hidden behind it) and a click elsewhere just closes it.
    <DropdownMenu modal={false} open={open} onOpenChange={(next) => !next && onClose()}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          style={{
            position: "fixed",
            top: anchor.top,
            left: anchor.left,
            width: anchor.width,
            height: anchor.height,
            pointerEvents: "none",
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={content}
        align="start"
        side="bottom"
        className="min-w-52"
        // Named after the event, not the invisible anchor Radix labels it by.
        aria-labelledby={undefined}
        aria-label={title || "Event"}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          restoreFocus();
          const choice = pending.current;
          pending.current = null;
          if (choice) onPick(choice);
        }}
      >
        <Items
          items={items}
          targets={targets}
          shortcuts={false}
          pick={(choice) => (pending.current = choice)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The Event panel's ⋯: the same items, each with its key. */
export function EventPanelMenu({
  items,
  targets,
  onPick,
}: {
  items: EventMenuItem[];
  targets: readonly MoveTarget[];
  onPick: (choice: EventMenuPick) => void;
}) {
  const pending = useRef<EventMenuPick | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton ref={trigger} icon={Ellipsis} label="Event actions" tooltip={null} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-60"
        onCloseAutoFocus={(e) => {
          const choice = pending.current;
          pending.current = null;
          if (!choice) return;
          // Focus back on ⋯ first, then the item runs (it may move focus on).
          e.preventDefault();
          trigger.current?.focus();
          onPick(choice);
        }}
      >
        <Items
          items={items}
          targets={targets}
          shortcuts
          pick={(choice) => (pending.current = choice)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
