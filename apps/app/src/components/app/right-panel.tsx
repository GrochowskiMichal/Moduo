// The right panel's title row and body (tasks-v3 calls 72/72a, spec §9; SH-1).
// Replaces the old segmented RightPanelSwitcher. The title row names the open
// view and switches it: "Details ▾" opens the module's views from the registry
// (lib/panel-registry.ts), *about this* above a hairline, *alongside* below,
// each with its ⌥ shortcut; a page may name the open view otherwise ("4 tasks
// ▾" on a multi-selection, MOD-109). A reference opened in the panel is an item, not a
// view: the title becomes the item's name with a back arrow to the view you
// were on ("← item"), and items stack. Collapse and expand stay in the bottom
// bar (72a), so the header has no close button. The row's right end is the
// open view's (or item's) own actions: its body puts them in `TitleActions`
// (title-actions.tsx), as the task's ↗ and ⋯ do (MOD-118 follow-up), then an
// item's "Open in …" last. Keys: ⌥1–9 pick a view, Esc goes back one item
// (keymap.md, rules 4 and 8).

import { ArrowLeft, ChevronDown, ExternalLink, type LucideIcon } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { HotkeyScope, isMacPlatform, useAppHotkeys, useFocusWithin } from "../../lib/hotkeys";
import {
  type PanelModule,
  type PanelViewDef,
  panelShortcutLabel,
  panelShortcutNumber,
  panelViewsFor,
} from "../../lib/panel-registry";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { IconButton } from "../ui/icon-button";
import { TitleActionsScope } from "./title-actions";

/** Something opened in the panel on top of the current view ("← item"). */
export type PanelItem = {
  /** Stable identity, e.g. `task:<id>`: a new key remounts (and crossfades) the body. */
  key: string;
  /** The item's name; the title row shows it next to the back arrow. */
  title: string;
  icon?: LucideIcon;
  render: () => ReactNode;
  /** An "Open in …" action on the right of the title row. */
  open?: { label: string; onOpen: () => void };
};

type Props = {
  module: PanelModule;
  /** Render functions by view id. A registered view the page leaves out isn't listed. */
  views: Readonly<Record<string, (() => ReactNode) | undefined>>;
  activeId: string;
  onChange: (id: string) => void;
  /**
   * What the title row says for the open view when it isn't the view's name:
   * Tasks' "4 tasks" over a multi-selection (MOD-109). The ▾ still lists the
   * views, the open one checked. Any module's page can set it.
   */
  title?: string;
  /** The "← item" stack, top last. Empty or absent shows the active view. */
  items?: readonly PanelItem[];
  /** Pops the top item (the back arrow, Esc). */
  onBack?: () => void;
  /** Drops every item before a view switch. Without it, `onBack` runs once per item, so its
   *  state update must be functional (pop from the latest stack). */
  onClearItems?: () => void;
  /** ⌥1–9 work from a field too (Chat: its key map says anywhere in Chat). */
  viewKeysInFields?: boolean;
};

/**
 * A page's "← item" stack, kept as plain entries (e.g. `{ key: "task:<id>",
 * type, id }`) that the page turns into PanelItems at render time, so an
 * item's body always reads current state. Opening what's already on top does
 * nothing; anything else goes on top, and back pops one, like history.
 */
export function usePanelStack<T extends { key: string }>() {
  const [stack, setStack] = useState<T[]>([]);
  const push = useCallback(
    (entry: T) =>
      setStack((current) =>
        current[current.length - 1]?.key === entry.key ? current : [...current, entry],
      ),
    [],
  );
  const back = useCallback(() => setStack((current) => current.slice(0, -1)), []);
  const clear = useCallback(() => setStack((current) => (current.length ? [] : current)), []);
  return { stack, push, back, clear };
}

/** Drops every item: the page's `onClearItems`, or one `onBack` per item. */
function clearItems(
  items: readonly PanelItem[],
  onBack: (() => void) | undefined,
  onClearItems: (() => void) | undefined,
) {
  if (onClearItems) onClearItems();
  else for (let i = 0; i < items.length; i++) onBack?.();
}

/** An open dialog (capture, Settings, palette…) that doesn't contain `root`. */
function overlayOver(root: HTMLElement): boolean {
  const open = document.querySelectorAll<HTMLElement>(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  );
  return Array.from(open).some((dialog) => !dialog.contains(root));
}

export function RightPanel({
  module,
  views,
  activeId,
  onChange,
  title,
  items = [],
  onBack,
  onClearItems,
  viewKeysInFields = false,
}: Props) {
  const listed = panelViewsFor(module, (id) => Boolean(views[id]));
  const active = listed.find((v) => v.id === activeId) ?? listed[0];
  const item = items.length > 0 ? items[items.length - 1] : null;
  const isMac = isMacPlatform();

  // ⌥1–9 pick a view while the panel is on screen; Esc steps back one item from
  // anywhere inside the panel but a field. Registry bindings in the "panel"
  // scope (nested in the page's, so its Esc outranks the page's): they listen
  // on document in the bubble phase, after React's own handlers, so a child (or
  // a Radix menu, which handles Esc on its document capture listener) that
  // claims the key first wins. Esc is only live while focus is in the panel,
  // so the page keeps it otherwise. Both stay out of the way while a dialog
  // that doesn't hold the panel is open.
  const rootRef = useRef<HTMLDivElement>(null);
  const focusInside = useFocusWithin(rootRef);
  useAppHotkeys(
    {
      "panel.view": (event) => {
        const root = rootRef.current;
        if (!root || overlayOver(root)) return false;
        const n = panelShortcutNumber(event);
        const view = n === null ? undefined : listed[n - 1];
        if (!view) return false;
        if (item) clearItems(items, onBack, onClearItems);
        if (view.id !== active?.id) onChange(view.id);
      },
    },
    { inInputs: viewKeysInFields },
  );
  useAppHotkeys(
    {
      "panel.back": () => {
        const root = rootRef.current;
        if (!root || !item || !onBack || overlayOver(root)) return false;
        onBack();
      },
    },
    { enabled: focusInside && !!item && !!onBack },
  );

  // The body crossfades when the view or item changes, never when the panel
  // mounts (a page load, or the shell remounting it when the other side panel
  // toggles). React's "adjust state while rendering" pattern, not an effect.
  const bodyKey = item ? `item:${item.key}` : `view:${active?.id ?? ""}`;
  const [shownKey, setShownKey] = useState(bodyKey);
  const [crossfade, setCrossfade] = useState(false);
  if (shownKey !== bodyKey) {
    setShownKey(bodyKey);
    setCrossfade(true);
  }

  // Where the body's `TitleActions` show (state, so the body re-renders into it).
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);

  // Going back unmounts the back arrow that had focus, which would drop it on
  // <body>. After the item on top changes, put focus on the title row, but only
  // if it fell out or was already in the panel (never steal it from the page).
  const itemKey = item?.key ?? null;
  const prevItemKey = useRef(itemKey);
  const titleRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = prevItemKey.current;
    prevItemKey.current = itemKey;
    if (prev === null || prev === itemKey) return;
    const focused = document.activeElement;
    const root = rootRef.current;
    if (focused && focused !== document.body && !root?.contains(focused)) return;
    const row = titleRowRef.current;
    row?.querySelector<HTMLElement>("button:not([disabled]), [tabindex]")?.focus();
  }, [itemKey]);

  if (!active) return null;

  const pick = (id: string) => {
    if (item) clearItems(items, onBack, onClearItems);
    if (id !== active.id) onChange(id);
  };

  const body = item ? item.render() : views[active.id]?.();

  return (
    <HotkeyScope scope="panel">
      <div ref={rootRef} className="flex h-full min-h-0 flex-col gap-2" data-panel-module={module}>
        {/* One row tall, like the left panel's first row, so the first lines
          share a centre (MOD-121). The chip's fill starts at the panel's edge
          padding and its text 8 in; the body's 4 plus a view's own 4 put the
          body's text on that same 16 px column. */}
        <div ref={titleRowRef} className="flex min-h-(--row-h) shrink-0 items-center gap-1">
          {item ? (
            <ItemTitle
              item={item}
              backTo={items.length > 1 ? items[items.length - 2].title : active.label}
              onBack={onBack}
            />
          ) : listed.length > 1 ? (
            <ViewMenu
              listed={listed}
              active={active}
              title={title ?? active.label}
              isMac={isMac}
              onPick={pick}
            />
          ) : (
            <h2
              tabIndex={-1}
              className="min-w-0 flex-1 px-2 font-display text-base font-medium text-foreground outline-none"
            >
              {title ?? active.label}
            </h2>
          )}
          {/* The body's own actions, right-aligned; hidden while it has none. */}
          <div
            ref={setActionsSlot}
            data-slot="panel-title-actions"
            className="ml-auto flex shrink-0 items-center gap-1 empty:hidden"
          />
          {item?.open ? (
            <IconButton
              icon={ExternalLink}
              label={item.open.label}
              onClick={item.open.onOpen}
              className="shrink-0"
            />
          ) : null}
        </div>
        <div key={bodyKey} className={cn("min-h-0 flex-1 px-1", crossfade && "motion-view")}>
          <TitleActionsScope slot={actionsSlot}>{body}</TitleActionsScope>
        </div>
      </div>
    </HotkeyScope>
  );
}

function ViewMenu({
  listed,
  active,
  title,
  isMac,
  onPick,
}: {
  listed: PanelViewDef[];
  active: PanelViewDef;
  /** What the row says: the view's name, or the page's override (MOD-109). */
  title: string;
  isMac: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          // The open view's name first, then what the row says instead.
          aria-label={
            title === active.label
              ? `Panel view: ${active.label}`
              : `Panel view: ${active.label}, ${title}`
          }
          className="gap-1 px-2 font-medium"
          // A small row tall, not a full one: 2 px over the 26 px buttons
          // beside it, as round-2b frame 7 draws it (.vpick 28). Button sets
          // its height inline, so the override is inline too.
          style={{ height: "var(--row-h-sm)" }}
        >
          {title}
          <ChevronDown className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuRadioGroup value={active.id} onValueChange={onPick}>
          {listed.map((view, index) => (
            <Fragment key={view.id}>
              {index > 0 && listed[index - 1].group !== view.group ? (
                <DropdownMenuSeparator />
              ) : null}
              <DropdownMenuRadioItem value={view.id}>
                <view.icon aria-hidden />
                {view.label}
                <DropdownMenuShortcut>{panelShortcutLabel(index, isMac)}</DropdownMenuShortcut>
              </DropdownMenuRadioItem>
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ItemTitle({
  item,
  backTo,
  onBack,
}: {
  item: PanelItem;
  backTo: string;
  onBack?: () => void;
}) {
  const Icon = item.icon;
  return (
    <>
      <IconButton
        icon={ArrowLeft}
        label={`Back to ${backTo}`}
        onClick={onBack}
        disabled={!onBack}
        className="shrink-0"
      />
      <h2
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 font-display text-base font-medium text-foreground",
          "break-words",
        )}
      >
        {Icon ? <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden /> : null}
        <span className="min-w-0 break-words">{item.title}</span>
      </h2>
    </>
  );
}
