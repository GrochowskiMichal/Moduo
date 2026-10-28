// The event menus wired to the week (CALR-4b, AC26, AC22's ⌃↵): a
// right-click on an event chip (any view) or ⌃↵ on the selected one opens
// the short menu; the Event panel gets the same items as its ⋯. Every item
// is an action the week already has, passed in by the page: the keyboard's
// copy and duplicate (Google-first through the create path), delete through
// the occurrence question (Undo, or Google's confirm), the panel's V / P
// (patchEvent) and L (the panel's Link row), and the move hook.

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppHotkeys } from "../../../lib/hotkeys";
import { eventMenuItems, type EventMenuSurface, moveTargets } from "../event-menu";
import type {
  CalendarAccountModel,
  CalendarEventModel,
  CalendarEventPatch,
  EventChip,
  EventChipsByDay,
} from "../events";
import { writableEvent } from "../writable";
import { requestEventLink } from "./event-link-request";
import {
  EventContextMenu,
  type EventMenuPick,
  EventPanelMenu,
  type MenuAnchor,
} from "./event-menu";
import { inCalendarOverlay } from "./use-calendar-hotkeys";

type Input = {
  chips: EventChipsByDay;
  eventsById: Map<string, CalendarEventModel>;
  accounts: readonly CalendarAccountModel[];
  userId: string | null;
  /** You can change Calendar (the module permission). */
  canEdit: boolean;
  selectedOccurrenceKey: string | null;
  select: (key: string | null) => void;
  openDetail: (target: { type: "event"; id: string }) => void;
  patchEvent: (eventId: string, patch: CalendarEventPatch) => void;
  requestEventDelete: (eventId: string, occurrenceStartMs?: number) => void;
  copyChip: (chip: EventChip) => void;
  duplicateChip: (chip: EventChip) => void;
  moveEvent: (eventId: string, targetId: string) => void;
};

type MenuState = {
  open: boolean;
  key: string;
  anchor: MenuAnchor;
  /** What had focus as it opened; it gets focus back (else the grid). */
  opener: HTMLElement | null;
  byKey: boolean;
};

const GRID = "[data-calendar-grid]";
const CHIP = '[data-chip="event"][data-occurrence-key]';

/** The chip on the page for an occurrence (no CSS.escape: keys hold ":"). */
function chipElement(key: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>("[data-occurrence-key]")) {
    if (el.dataset.occurrenceKey === key) return el;
  }
  return null;
}

function findChip(key: string | null, list: readonly EventChip[]): EventChip | null {
  return key ? (list.find((c) => c.occurrenceKey === key) ?? null) : null;
}

/** The items an event gets here, and where Move may take it. */
function itemsFor(
  event: CalendarEventModel,
  surface: EventMenuSurface,
  who: Pick<Input, "accounts" | "userId" | "canEdit">,
) {
  const targets = moveTargets(event, who.accounts, who.userId);
  const items = eventMenuItems({
    event,
    writer: writableEvent(event, who.accounts, who.userId),
    canEdit: who.canEdit,
    currentUserId: who.userId,
    targets,
    surface,
  });
  return { items, targets };
}

/** An occurrence for an event the week doesn't draw right now (the panel's own). */
function chipFor(event: CalendarEventModel): EventChip {
  const startMs = Date.parse(event.startsAt);
  return {
    eventId: event.id,
    occurrenceKey: `${event.id}:${startMs}`,
    title: event.title,
    startMs,
    endMs: Date.parse(event.endsAt),
    dayKey: "",
    allDay: event.allDay,
    external: event.sourceAccountId !== null,
    readOnly: false,
    recurring: Boolean(event.rrule),
    sourceAccountId: event.sourceAccountId,
    color: event.color,
    continuesFromMs: null,
    continuesToMs: null,
    locked: false,
  };
}

export function useEventMenu(input: Input): {
  menu: ReactNode;
  panelMenu: (event: CalendarEventModel) => ReactNode;
} {
  const all = useMemo(
    () => [...[...input.chips.timed.values()].flat(), ...[...input.chips.allDay.values()].flat()],
    [input.chips],
  );
  const latest = useRef({ ...input, all });
  useEffect(() => {
    latest.current = { ...input, all };
  });
  const [state, setState] = useState<MenuState | null>(null);

  const find = (key: string | null, list: EventChip[] = latest.current.all) => findChip(key, list);

  const openAt = (chip: EventChip, anchor: MenuAnchor, byKey: boolean) => {
    const active = document.activeElement;
    latest.current.select(chip.occurrenceKey);
    setState({
      open: true,
      key: chip.occurrenceKey,
      anchor,
      opener: active instanceof HTMLElement && active !== document.body ? active : null,
      byKey,
    });
  };
  const openAtRef = useRef(openAt);
  useEffect(() => {
    openAtRef.current = openAt;
  });

  // A right-click on an event, in any view; elsewhere the browser keeps its own.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>(CHIP) : null;
      const key = el?.dataset.occurrenceKey;
      const chip = key ? latest.current.all.find((c) => c.occurrenceKey === key) : undefined;
      if (!chip) return;
      e.preventDefault();
      openAtRef.current(chip, { top: e.clientY, left: e.clientX, width: 0, height: 0 }, false);
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // ⌃↵: the same menu, under the selected event.
  useAppHotkeys({
    "calendar.menu": (e) => {
      if (inCalendarOverlay(e)) return false;
      const chip = find(latest.current.selectedOccurrenceKey);
      const el = chip ? chipElement(chip.occurrenceKey) : null;
      if (!chip || !el) return false;
      const r = el.getBoundingClientRect();
      openAt(chip, { top: r.top, left: r.left, width: r.width, height: r.height }, true);
    },
  });

  const run = (chip: EventChip, choice: EventMenuPick) => {
    const k = latest.current;
    const event = k.eventsById.get(chip.eventId);
    if (!event) return;
    switch (choice.id) {
      case "open":
        k.openDetail({ type: "event", id: event.id });
        return;
      case "copy":
        k.copyChip(chip);
        return;
      case "duplicate":
        k.duplicateChip(chip);
        return;
      case "meet":
        k.patchEvent(event.id, { meet: "add" });
        return;
      case "private":
        k.patchEvent(event.id, { isPrivate: !event.isPrivate });
        return;
      case "move":
        if (choice.targetId) k.moveEvent(event.id, choice.targetId);
        return;
      case "link":
        k.openDetail({ type: "event", id: event.id });
        requestEventLink(event.id);
        return;
      case "delete":
        k.requestEventDelete(event.id, chip.startMs);
        return;
    }
  };

  const menuChip = state ? find(state.key, all) : null;
  const menuEvent = menuChip ? input.eventsById.get(menuChip.eventId) : undefined;
  let menu: ReactNode = null;
  if (state && menuChip && menuEvent) {
    const { items, targets } = itemsFor(menuEvent, "grid", input);
    menu = (
      <EventContextMenu
        open={state.open}
        anchor={state.anchor}
        title={menuEvent.title}
        items={items}
        targets={targets}
        focusFirst={state.byKey}
        onPick={(choice) => run(menuChip, choice)}
        onClose={() => setState((cur) => (cur ? { ...cur, open: false } : cur))}
        restoreFocus={() => {
          const back = state.opener?.isConnected ? state.opener : null;
          (back ?? document.querySelector<HTMLElement>(GRID))?.focus({ preventScroll: true });
        }}
      />
    );
  }

  // Stable while the week and the selection are, so the panel doesn't redraw per page render.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const { accounts, userId, canEdit, selectedOccurrenceKey } = input;
  const panelMenu = useCallback(
    (event: CalendarEventModel) => {
      const chip =
        [findChip(selectedOccurrenceKey, all)].find((c) => c?.eventId === event.id) ??
        all.find((c) => c.eventId === event.id) ??
        chipFor(event);
      const { items, targets } = itemsFor(event, "panel", { accounts, userId, canEdit });
      return (
        <EventPanelMenu
          items={items}
          targets={targets}
          onPick={(choice) => runRef.current(chip, choice)}
        />
      );
    },
    [all, accounts, userId, canEdit, selectedOccurrenceKey],
  );

  return { menu, panelMenu };
}
