// The event menus (CALR-4b, AC26): which items an event's right-click menu
// (and ⌃↵) offers, in the spec's order, and the same items in the Event
// panel's ⋯ with their keys. Each item is a key the week already has (copy,
// duplicate, delete with Undo, V / P / L), so the two menus and the keys can't
// disagree. "Move to another calendar" lists only moves Moduo can make whole:
// one event, never two (the spec's "New events go to" assumption).

import { type HotkeyId, HOTKEYS, keysFor } from "../../lib/hotkeys/registry";
import { canAddMeet, canMakePrivate } from "./event-view";
import type { CalendarAccountModel, CalendarEventModel } from "./events";
import { formatChord } from "./keys-sheet";
import type { EventWriter } from "./writable";

export type EventMenuItemId =
  "open" | "copy" | "duplicate" | "meet" | "private" | "move" | "link" | "release" | "delete";

/** The grid's right-click menu (no shortcuts) or the Event panel's ⋯ (with them). */
export type EventMenuSurface = "grid" | "panel";

export type MoveTarget = { id: string; label: string };

export type EventMenuItem = {
  id: EventMenuItemId;
  label: string;
  /** The key that does the same from the week (shown only in the panel's ⋯). */
  hotkey: HotkeyId | null;
  destructive?: boolean;
};

const isBusy = (event: Pick<CalendarEventModel, "id">) => event.id.startsWith("busy");

export function eventMenuItems(input: {
  event: CalendarEventModel;
  writer: EventWriter | null;
  /** You can change Calendar at all (the module permission). */
  canEdit: boolean;
  currentUserId: string | null;
  targets: readonly MoveTarget[];
  surface: EventMenuSurface;
}): EventMenuItem[] {
  const { event, writer, canEdit, currentUserId, targets, surface } = input;
  const items: EventMenuItem[] = [];
  // You are already in the Event panel: Open is the grid's.
  if (surface === "grid") items.push({ id: "open", label: "Open", hotkey: "calendar.open" });
  // A teammate's private event reaches you as "Busy": nothing to copy or change.
  if (isBusy(event)) return items;
  const writes = canEdit && writer !== null;
  items.push({ id: "copy", label: "Copy", hotkey: "calendar.copy" });
  // A copy of an event you can't write to lands on Your calendar (as ⌘D).
  if (canEdit) items.push({ id: "duplicate", label: "Duplicate", hotkey: "calendar.duplicate" });
  if (canEdit && canAddMeet(writer, event)) {
    items.push({ id: "meet", label: "Add a Meet link", hotkey: "calendar.add-meet" });
  }
  if (canMakePrivate(event, currentUserId, writes)) {
    items.push({
      id: "private",
      label: event.isPrivate ? "Make public" : "Make private",
      hotkey: "calendar.private",
    });
  }
  if (writes && targets.length > 0) {
    items.push({ id: "move", label: "Move to another calendar", hotkey: null });
  }
  // Linking changes the links, not the event: as in the Event panel, any event.
  if (canEdit)
    items.push({ id: "link", label: "Link a person, note or task", hotkey: "calendar.link" });
  // An offer's hold (CALR-19): its holds go together.
  if (writes && event.kind === "hold" && event.offerId) {
    items.push({ id: "release", label: "Release holds", hotkey: null });
  }
  if (writes) {
    items.push({ id: "delete", label: "Delete", hotkey: "calendar.delete", destructive: true });
  }
  return items;
}

/** The key as the keys sheet says it: ⌫ over Delete, ⌃↵, ⌘C (Ctrl C elsewhere). */
export function menuShortcut(id: HotkeyId, isMac: boolean): string {
  return formatChord(chordOf(id, isMac), isMac);
}

/** The same key for `aria-keyshortcuts` ("Meta+C", "Backspace"). */
export function ariaShortcut(id: HotkeyId, isMac: boolean): string {
  return chordOf(id, isMac).replace("Mod", isMac ? "Meta" : "Control");
}

function chordOf(id: HotkeyId, isMac: boolean): string {
  return id === "calendar.delete" ? "Backspace" : String(keysFor(HOTKEYS[id], isMac)[0] ?? "");
}

/**
 * Where "Move to another calendar" may take an event. Only a one-off Moduo
 * event with nothing Google's create would drop (people, place, link,
 * privacy, a repeat or an override, focus time) that is yours goes, to a Google calendar
 * you connected and can write: Google gets it first, then the Moduo row goes,
 * with one Undo. A Google event stays put for now: moving it off Google
 * deletes it there (its guests hear) and has no Undo.
 */
export function moveTargets(
  event: CalendarEventModel,
  accounts: readonly CalendarAccountModel[],
  userId: string | null,
): MoveTarget[] {
  // Your own: moving a teammate's event to your Google would take it off their week.
  if (!userId || event.sourceAccountId !== null || isBusy(event) || event.ownerId !== userId) {
    return [];
  }
  const plain =
    !event.rrule &&
    !event.seriesId &&
    (event.attendees ?? []).length === 0 &&
    !event.location?.trim() &&
    !event.conferenceUrl?.trim() &&
    !event.isPrivate &&
    (event.kind ?? "event") === "event";
  if (!plain) return [];
  return accounts
    .filter(
      (a) =>
        a.provider === "google" &&
        !a.deletedAt &&
        !a.readOnly &&
        a.status !== "reauth" &&
        a.ownerId === userId,
    )
    .map((a) => ({ id: a.id, label: a.displayLabel || "Google" }));
}
