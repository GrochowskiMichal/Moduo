// The reader slot while two or more threads are picked (specs/mail-v3.md §6,
// prototype `bulk`, AC20): what is selected, and the five actions that apply
// to all of it as one step that z undoes.

import { Check, Clock, FolderInput, ListTodo, Trash2 } from "lucide-react";
import type { ComponentType } from "react";

import { PersonAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { stripSubject } from "./mail-row-model";

/** The bulk actions, each the same as its key. */
export type MailBulkAction = "done" | "snooze" | "task" | "move" | "delete";

export const BULK_ACTIONS: readonly {
  id: MailBulkAction;
  label: string;
  key: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}[] = [
  { id: "done", label: "Done", key: "e", icon: Check },
  { id: "snooze", label: "Snooze…", key: "s", icon: Clock },
  { id: "task", label: "Make tasks", key: "t", icon: ListTodo },
  { id: "move", label: "Move…", key: "m", icon: FolderInput },
  { id: "delete", label: "Delete", key: "#", icon: Trash2 },
];

/** Threads listed by name; ⌘A over a big tab says how many more there are. */
export const BULK_LIST_MAX = 50;

const newestSender = (row: MailThreadRow) =>
  row.senders[row.senders.length - 1] ?? { name: "", email: "" };

export function MailBulkReader({
  count,
  rows,
  onAction,
}: {
  /** Every picked thread, loaded or not (⌘A takes the whole tab). */
  count: number;
  /** The picked threads that are loaded, in list order. */
  rows: readonly MailThreadRow[];
  onAction: (action: MailBulkAction) => void;
}) {
  const shown = rows.slice(0, BULK_LIST_MAX);
  const more = count - shown.length;
  return (
    <section
      aria-label={`${count} selected`}
      data-slot="mail-bulk-reader"
      className="pane-scroll min-h-0 flex-1 overflow-y-auto"
    >
      <div className="grid max-w-xl content-start gap-3 px-(--panel-inset) py-8">
        <h2 className="text-lg font-semibold text-foreground">{count} selected</h2>
        <p className="text-sm text-muted-foreground">
          Every action below applies to all {count}, as one step that <Kbd>z</Kbd> undoes.
        </p>
        <ul className="grid gap-1">
          {shown.map((row) => {
            const who = newestSender(row);
            const name = who.name.trim() || who.email;
            return (
              <li
                key={row.threadId}
                className="flex min-h-(--row-h-sm) min-w-0 items-center gap-2 text-sm"
              >
                <PersonAvatar name={name} id={who.email.toLowerCase() || name} size="sm" />
                <span className="truncate">
                  <b className="font-semibold">{name}</b> · {stripSubject(row.subject)}
                </span>
              </li>
            );
          })}
          {more > 0 ? <li className="text-sm text-muted-foreground">and {more} more</li> : null}
        </ul>
        <div className="flex flex-wrap gap-2">
          {BULK_ACTIONS.map(({ id, label, key, icon: Icon }) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onAction(id)}
            >
              <Icon aria-hidden className="size-icon-xs" />
              {label}
              <span aria-hidden className="ml-1 flex">
                <Kbd>{key}</Kbd>
              </span>
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          <Kbd>Esc</Kbd> clears the selection.
        </p>
      </div>
    </section>
  );
}
