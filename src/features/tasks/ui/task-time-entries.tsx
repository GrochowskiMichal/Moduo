// "Add time…" and your own entries, inside the Time field's popover (TV-D14,
// spec §14, REPLAN 75): one quick line ("2h yesterday call with Anna") logs a
// dated entry; the list under it is yours alone (RLS), editable and
// removable for what you logged or tracked in Focus.

import { Pencil, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { CollectionHeader } from "../../../components/ui/collection-header";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { formatDay } from "../../../lib/time-format";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task, TaskTimeEntry } from "../model";
import {
  dayToDate,
  entryDay,
  entryEditChange,
  entryEditLine,
  entryLine,
  parseTimeEntry,
} from "../time-entries";
import { formatTracked } from "../time-format";

type TimeApi = Pick<
  TasksModuleApi,
  "logTime" | "editTimeEntry" | "removeTimeEntry" | "listMyTimeEntries"
>;

/** "2h · Yesterday · call with Anna" — what the quick line will log. */
function previewOf(text: string, now: Date): string | null {
  const parsed = parseTimeEntry(text, now);
  if (!parsed) return null;
  const day = dayToDate(parsed.day);
  return [formatTracked(parsed.minutes * 60), day ? formatDay(day, now) : parsed.day, parsed.note]
    .filter(Boolean)
    .join(" · ");
}

export function TaskTimeEntries({ task, api }: { task: Task; api: TimeApi }) {
  const [entries, setEntries] = useState<TaskTimeEntry[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const now = new Date();

  const reload = useCallback(() => {
    api.listMyTimeEntries(task.id).then(setEntries, () => setEntries([]));
  }, [api, task.id]);
  // A saved total (Focus, a teammate) may bring a new entry of yours.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the total is the signal to read again
  useEffect(() => {
    reload();
  }, [reload, task.timeSpentSeconds]);

  const preview = draft.trim() ? previewOf(draft, now) : null;
  const add = () => {
    const parsed = parseTimeEntry(draft);
    if (!parsed || busy) return;
    setBusy(true);
    void api
      .logTime(task.id, { seconds: parsed.minutes * 60, on: parsed.day, note: parsed.note })
      .then((ok) => {
        if (ok) {
          setDraft("");
          reload();
        }
      })
      .finally(() => setBusy(false));
  };

  const startEdit = (entry: TaskTimeEntry) => {
    setEditing(entry.id);
    setEditDraft(entryEditLine(entry));
    setEditError(null);
  };
  const saveEdit = (entry: TaskTimeEntry) => {
    // Only what changed goes: a note-only edit leaves a Focus stretch's
    // seconds as they were.
    const change = entryEditChange(entry, editDraft);
    if (!change) {
      setEditError(
        entry.kind === "focus"
          ? "Start with a length: 25m or 1h 30m."
          : "Start with a length: 2h, 45m or 1h 30m, up to 24h.",
      );
      return;
    }
    if (Object.keys(change).length === 0) {
      setEditing(null);
      return;
    }
    setBusy(true);
    void api
      .editTimeEntry(
        task.id,
        entry.id,
        change,
        change.seconds === undefined ? 0 : change.seconds - entry.seconds,
      )
      .then((ok) => {
        if (ok) {
          setEditing(null);
          reload();
        }
      })
      .finally(() => setBusy(false));
  };
  const remove = (entry: TaskTimeEntry) => {
    setBusy(true);
    void api
      .removeTimeEntry(task.id, entry.id, entry.seconds)
      .then((ok) => {
        if (!ok) return;
        reload();
        // Undo logs the same time back, on the same day (as logged time).
        const undoable = entry.seconds >= 60 && entry.seconds <= 86_400;
        toast(`Removed ${formatTracked(entry.seconds)}`, {
          ...(undoable
            ? {
                action: {
                  label: "Undo",
                  onClick: () =>
                    void api
                      .logTime(task.id, {
                        seconds: entry.seconds,
                        on: entryDay(entry),
                        note: entry.note,
                      })
                      .then(reload),
                },
              }
            : {}),
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-2.5">
      <Label htmlFor="task-time-add" className="font-normal text-muted-foreground">
        Add time
      </Label>
      <div className="flex items-center gap-1.5">
        <Input
          id="task-time-add"
          size="sm"
          value={draft}
          placeholder="2h yesterday · call with Anna"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              add();
            }
          }}
          aria-describedby="task-time-add-preview"
        />
        <Button size="sm" variant="secondary" disabled={!preview || busy} onClick={add}>
          Add
        </Button>
      </div>
      <p
        id="task-time-add-preview"
        className="min-h-4 text-xs text-muted-foreground"
        aria-live="polite"
      >
        {preview ?? (draft.trim() ? "Start with a length: 2h, 45m or 1h 30m, up to 24h." : "")}
      </p>
      {entries && entries.length > 0 ? (
        <div className="flex flex-col">
          <CollectionHeader label="Your entries" count={entries.length} />
          <ul className="flex max-h-48 flex-col overflow-y-auto">
            {entries.map((entry) => {
              const line = entryLine(entry, now);
              if (editing === entry.id) {
                return (
                  <li key={entry.id} className="flex flex-wrap items-center gap-1.5 py-1">
                    <Input
                      size="sm"
                      autoFocus
                      value={editDraft}
                      aria-label="Edit the entry"
                      aria-invalid={editError ? true : undefined}
                      onChange={(e) => {
                        setEditDraft(e.target.value);
                        setEditError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          saveEdit(entry);
                        } else if (e.key === "Escape") {
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => saveEdit(entry)}
                    >
                      Save
                    </Button>
                    {editError ? (
                      <p className="w-full text-xs text-muted-foreground" role="alert">
                        {editError}
                      </p>
                    ) : null}
                  </li>
                );
              }
              return (
                <li key={entry.id} className="group flex items-start gap-2 py-1">
                  <span className="w-20 shrink-0 text-muted-foreground">{line.day}</span>
                  <span className="w-14 shrink-0 tabular-nums">{line.length}</span>
                  <span className="min-w-0 flex-1 break-words">
                    {line.label}
                    {line.note ? (
                      <span className="text-muted-foreground"> · {line.note}</span>
                    ) : null}
                  </span>
                  {line.editable ? (
                    <span className="flex shrink-0 items-center">
                      <IconButton
                        icon={Pencil}
                        label="Edit the entry"
                        onClick={() => startEdit(entry)}
                      />
                      <IconButton icon={X} label="Remove the entry" onClick={() => remove(entry)} />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
