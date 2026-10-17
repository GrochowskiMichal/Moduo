// `/task` `/note` `/event` and the `+` menu's "Create" open the app's one
// capture as that type, with the words typed after the command on its title
// line; when the item is made its chip goes where the caret was (AC9.7).
// The Message capture type and its "From:" chip are CV-10's.

import { dispatchOpenCapture } from "@/lib/capture-open";
import type { EntityRef } from "@/lib/entity-links";

import type { CreateCommand } from "./grammar";

export function openCreateCapture(
  command: CreateCommand,
  title: string,
  onCreated: (ref: EntityRef, title: string) => void,
): void {
  dispatchOpenCapture({ type: command, draft: title, onCreated });
}
