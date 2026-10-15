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

import type { PriorityLevel, TaskStatusCategory } from "@contracts/vocabularies";
import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { calendarCaptureType } from "../features/calendar/capture-type";
import { contactsCaptureType } from "../features/contacts/capture-type";
import { notesCaptureType } from "../features/notes/capture-type";
import { taskCaptureType } from "../features/tasks/capture-type";
import type { ModulePermissions } from "../features/workspaces/types";

import type { CaptureSource } from "./capture-source";
import type { EntityRef } from "./entity-links";

/** A top-bar module, by the key its tab carries (app-chrome-constants.ts). */
export type CaptureModule = "notes" | "tasks" | "calendar" | "email" | "contacts" | "chat";

/**
 * Where a capture was opened from (tasks-v3 call 90). ⌘⇧K opens with nothing
 * here: the type's own default (Task → your Inbox), never asking where. ⌘N,
 * "+ New" and `c` pass "here": the project, the section, the top of Up next.
 */
export type CaptureRequest = {
  /** File into this project (and section), not the type's default. */
  destination?: { projectId: string; sectionId?: string | null };
  /** Put the new task at the top of your Up next (⌘N in Focus). */
  queueTop?: boolean;
  /**
   * What a filtered scope pre-fills (its tags, assignee and priority), and
   * what a List group's "+" fills in (TV-U10): the group's team, due day
   * (YYYY-MM-DD) or status category.
   */
  seed?: {
    tagIds?: string[];
    assigneeId?: string | null;
    priority?: PriorityLevel | null;
    teamId?: string | null;
    dueDay?: string | null;
    status?: TaskStatusCategory | null;
    /** A Board column's own status (TV-U11): applies with `status` while
     *  the task files into `destination`'s project; `statusName` names it. */
    statusId?: string | null;
    statusName?: string | null;
  };
  /**
   * Open as this registered type ("task", "note", "event") instead of the
   * first, when this person may create it (chat's `/note`, `/event`).
   */
  type?: string;
  /**
   * The title line, prefilled (a chat message's "Make a task", the words after
   * `/task`). It takes the place of the words the capture kept, as a type
   * switch's words do.
   */
  draft?: string;
  /**
   * Told when the item is made (or waits on this device to sync), so the
   * opener can put a chip where it asked (chat's `/task`).
   */
  onCreated?: (ref: EntityRef, title: string) => void;
  /**
   * With `draft`: start from this person's refused capture (its toast's
   * Restore while they keep another draft). The refused one stays kept on
   * the device until it's made. Only the Task body reads it.
   */
  fromRefused?: boolean;
};

/** A request as the body gets it: plus what was open when it was opened (93). */
export type CaptureContext = CaptureRequest & {
  /** The email, note, event or contact open when the capture opened. */
  source: CaptureSource | null;
  /** Bumped on every open, so a body can tell a fresh open from a re-render. */
  openId: number;
  /**
   * A prefilled open's own draft (set only when the opener passed `draft`):
   * it lives for this open, type switches included, and is never stored, so
   * the person's kept draft is never read, written or cleared by it. Only the
   * Task body writes it (its `CaptureDraft`).
   */
  held?: { current: unknown };
};

/** What the capture hands the type's body. */
export type CaptureBodyProps = {
  /** The title line, kept while the type switches so nothing typed is lost. */
  draft: string;
  onDraftChange: (draft: string) => void;
  /** Whether this person may create this type (its module's Edit). */
  writable: boolean;
  /** Close the capture (after a create that isn't "Create more"). */
  onDone: () => void;
  /** Where it was opened from and what was open (types with `ownsHeader` read it). */
  context?: CaptureContext;
  /** The type chip, for a body that lays out its own header row. */
  typeChip?: ReactNode;
  /**
   * A body that claims Esc before the capture closes (a menu, a recognition to
   * undo, research §5) registers a handler: it returns true when it used the key.
   */
  registerEscape?: (handler: (() => boolean) | null) => void;
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
  /**
   * The body lays out its own header row (the type chip it's handed, its own
   * destination picker and "From:" chip): Task. Others get "Type ▾ · Destination".
   */
  ownsHeader?: boolean;
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
