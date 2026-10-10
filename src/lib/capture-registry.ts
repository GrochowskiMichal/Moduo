// The capture type registry (tasks-v3 calls 90a/90b, spec §10, §Assumptions #21).
//
// ⌘⇧K opens the app's one capture, always as Task. While it's open, ⌘1–7 switch
// the capture's *type* to the module with that number in the top bar (⌘2 a
// note, ⌘4 an event), never the app behind it. A number whose module has no
// registered type (⌘1 Home, Email, Chat) does nothing. Each module registers
// its own type here: label, icon, default destination and the body it renders.
// Tasks ships the Task type; the others register theirs when rebuilt (until
// then Notes, Calendar and Contacts register the one-line captures ⌘⇧K already
// had, so nothing that worked stops working).

import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

import { calendarCaptureType } from "../features/calendar/capture-type";
import { contactsCaptureType } from "../features/contacts/capture-type";
import { notesCaptureType } from "../features/notes/capture-type";
import { taskCaptureType } from "../features/tasks/capture-type";
import type { ModulePermissions } from "../features/workspaces/types";

/** A top-bar module, by the key its tab carries (app-chrome-constants.ts). */
export type CaptureModule = "notes" | "tasks" | "calendar" | "email" | "contacts" | "chat";

/** What the capture hands the type's body. */
export type CaptureBodyProps = {
  /** The title line, kept while the type switches so nothing typed is lost. */
  draft: string;
  onDraftChange: (draft: string) => void;
  /** Whether this person may create this type (its module's Edit). */
  writable: boolean;
  /** Close the capture (after a create that isn't "Create more"). */
  onDone: () => void;
};

export type CaptureTypeDef = {
  /** Stable id: "task", "note", … */
  type: string;
  /** The module whose top-bar number selects this type. */
  module: CaptureModule;
  /** Sentence case, as the type chip shows it. */
  label: string;
  icon: LucideIcon;
  /** Where a capture lands unless the body says otherwise ("Inbox"). */
  destination: string;
  canWrite: (perms: ModulePermissions) => boolean;
  Body: ComponentType<CaptureBodyProps>;
};

/** Registered types, Task first: the capture always opens as the first one. */
export const CAPTURE_TYPES: readonly CaptureTypeDef[] = [
  taskCaptureType,
  notesCaptureType,
  calendarCaptureType,
  contactsCaptureType,
];

/** One top-bar tab, as far as numbering goes: Home has no module. */
export type NumberedModule = { module?: string };

/**
 * The type ⌘`digit` selects: the one registered for the module at that
 * position among the tabs this person sees, or null (Home, a module with no
 * type, a number past the last tab).
 */
export function captureTypeForDigit(
  digit: number,
  visibleModules: readonly NumberedModule[],
  types: readonly CaptureTypeDef[],
): CaptureTypeDef | null {
  const module = visibleModules[digit - 1]?.module;
  if (!module) return null;
  return types.find((t) => t.module === module) ?? null;
}

/** The ⌘ number a type answers to here, or null when its module isn't shown. */
export function captureDigitFor(
  type: CaptureTypeDef,
  visibleModules: readonly NumberedModule[],
): number | null {
  const index = visibleModules.findIndex((tab) => tab.module === type.module);
  return index === -1 ? null : index + 1;
}

/**
 * The digit (1–7) of a ⌘/Ctrl + number keydown, or null. Same chord as the
 * top bar's module keys (lib/shortcuts.ts), which the open capture claims.
 */
export function captureDigitKey(event: KeyboardEvent, isMac: boolean): number | null {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (!mod || event.shiftKey || event.altKey) return null;
  return /^[1-7]$/.test(event.key) ? Number(event.key) : null;
}
