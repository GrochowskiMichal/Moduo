// The right panel's title row and body (tasks-v3 calls 72/72a, spec §9; SH-1).
// Replaces the old segmented RightPanelSwitcher. The title row names the open
// view and switches it: "Details ▾" opens the module's views from the registry
// (lib/panel-registry.ts), *about this* above a hairline, *alongside* below,
// each with its ⌥ shortcut. A reference opened in the panel is an item, not a
// view: the title becomes the item's name with a back arrow to the view you
// were on ("← item"), and items stack. Collapse and expand stay in the bottom
// bar (72a), so the header has no close button. Keys: ⌥1–9 pick a view, Esc
// goes back one item (keymap.md, rules 4 and 8).

import { ArrowLeft, ChevronDown, ExternalLink, type LucideIcon } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import {
  type PanelModule,
  type PanelViewDef,
  panelShortcutLabel,
  panelShortcutNumber,
  panelViewsFor,
} from "../../lib/panel-registry";
import { isMacPlatform } from "../../lib/shortcuts";
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
  /** The "← item" stack, top last. Empty or absent shows the active view. */
  items?: readonly PanelItem[];
  /** Pops the top item (the back arrow, Esc). */
  onBack?: () => void;
  /** Drops every item; called before switching views with an item open. Defaults to `onBack`. */
  onClearItems?: () => void;
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

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

export function RightPanel({
  module,
  views,
  activeId,
  onChange,
  items = [],
  onBack,
  onClearItems,
}: Props) {
  const listed = panelViewsFor(module, (id) => Boolean(views[id]));
  const active = listed.find((v) => v.id === activeId) ?? listed[0];
  const item = items.length > 0 ? items[items.length - 1] : null;
  const isMac = isMacPlatform();

  // ⌥1–9 pick a view while the panel is on screen. The latest props live in a
  // ref so the listener is bound once per mount.
  const latest = useRef({ listed, active, item, onChange, onBack, onClearItems });
  latest.current = { listed, active, item, onChange, onBack, onClearItems };
  const rootRef = useRef<HTMLDivElement>(null);
  const hasActive = Boolean(active);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const n = panelShortcutNumber(event);
      if (n === null || isEditable(event.target)) return;
      const { listed, active, item, onChange, onBack, onClearItems } = latest.current;
      const view = listed[n - 1];
      if (!view) return;
      event.preventDefault();
      if (item) (onClearItems ?? onBack)?.();
      if (view.id !== active?.id) onChange(view.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Esc steps back one item, from anywhere inside the panel but a field. A
  // menu or popover opened from the panel is portaled, so its Esc never
  // bubbles here; Radix closes it on its own document listener first.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebinds once the root exists (no views → no root)
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKey = (event: KeyboardEvent) => {
      const { item, onBack } = latest.current;
      if (event.key !== "Escape" || !item || !onBack) return;
      if (event.defaultPrevented || isEditable(event.target)) return;
      event.preventDefault();
      onBack();
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [hasActive]);

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
    if (item) (onClearItems ?? onBack)?.();
    if (id !== active.id) onChange(id);
  };

  const body = item ? item.render() : views[active.id]?.();

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col gap-2" data-panel-module={module}>
      <div ref={titleRowRef} className="flex min-h-(--ctrl-h) shrink-0 items-center gap-1">
        {item ? (
          <ItemTitle
            item={item}
            backTo={items.length > 1 ? items[items.length - 2].title : active.label}
            onBack={onBack}
          />
        ) : listed.length > 1 ? (
          <ViewMenu listed={listed} active={active} isMac={isMac} onPick={pick} />
        ) : (
          <h2
            tabIndex={-1}
            className="min-w-0 flex-1 font-display text-base font-medium text-foreground outline-none"
          >
            {active.label}
          </h2>
        )}
      </div>
      <div
        key={item ? `item:${item.key}` : `view:${active.id}`}
        className="motion-view min-h-0 flex-1"
      >
        {body}
      </div>
    </div>
  );
}

function ViewMenu({
  listed,
  active,
  isMac,
  onPick,
}: {
  listed: PanelViewDef[];
  active: PanelViewDef;
  isMac: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Panel view: ${active.label}`}
          className="-ml-2.5 gap-1 font-medium"
        >
          {active.label}
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
        className="-ml-1.5 shrink-0"
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
      {item.open ? (
        <IconButton
          icon={ExternalLink}
          label={item.open.label}
          onClick={item.open.onOpen}
          className="shrink-0"
        />
      ) : null}
    </>
  );
}
