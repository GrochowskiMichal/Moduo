// Statuses (TV-D9, REPLAN 53a): a project's statuses, or the workspace
// default set, grouped by the five fixed categories. Rename, add, hide and
// reorder inside a category; delete moves a status's tasks to the category's
// first other status (the server says how many, `deleteStatus` toasts it). The
// icons belong to the categories and aren't editable. Minimal on purpose:
// TV-U11 and TV-U13 polish the surfaces around it.

import type { TaskStatusCategory } from "@contracts/vocabularies";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import type { ProjectStatus } from "../model";
import { CATEGORY_HINTS, CATEGORY_LABELS, statusesByCategory } from "../statuses";
import { StatusIcon } from "./status-icon";

export type StatusesDialogProps = {
  open: boolean;
  /** "Website" for a project, null for the workspace default set. */
  projectName: string | null;
  /** The set being edited, any order. */
  statuses: readonly ProjectStatus[];
  canEdit: boolean;
  /** Open with the add field of this category showing ("+ Add status"). */
  addingTo?: TaskStatusCategory | null;
  onCreate: (category: TaskStatusCategory, name: string) => Promise<boolean>;
  onUpdate: (
    status: ProjectStatus,
    patch: { name?: string; hidden?: boolean; after?: string | null },
  ) => Promise<boolean>;
  onDelete: (status: ProjectStatus) => Promise<boolean>;
  onClose: () => void;
};

export function StatusesDialog(props: StatusesDialogProps) {
  const { open, projectName, onClose } = props;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {projectName ? `Statuses · ${projectName}` : "Default statuses"}
          </DialogTitle>
          <DialogDescription>
            {projectName
              ? "Each status belongs to one of five categories, and the category decides how Moduo treats it."
              : "New projects start with these, and the Inbox uses them."}
          </DialogDescription>
        </DialogHeader>
        {open ? <StatusesEditor {...props} /> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusesEditor({
  statuses,
  canEdit,
  addingTo = null,
  onCreate,
  onUpdate,
  onDelete,
}: StatusesDialogProps) {
  const [adding, setAdding] = useState<TaskStatusCategory | null>(addingTo);
  const [busy, setBusy] = useState(false);
  const run = async (op: () => Promise<boolean>) => {
    setBusy(true);
    try {
      return await op();
    } finally {
      setBusy(false);
    }
  };
  const groups = statusesByCategory(statuses);

  return (
    <div className="-mx-1 flex max-h-96 flex-col gap-4 overflow-y-auto px-1">
      {groups.map(({ category, statuses: list }) => (
        <section
          key={category}
          aria-label={CATEGORY_LABELS[category]}
          className="flex flex-col gap-1"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-foreground">{CATEGORY_LABELS[category]}</span>
            <span className="text-xs text-muted-foreground">{CATEGORY_HINTS[category]}</span>
          </div>
          {list.map((status, i) => (
            <StatusRow
              key={`${status.id}:${status.name}`}
              status={status}
              canEdit={canEdit}
              busy={busy}
              isFirst={i === 0}
              isLast={i === list.length - 1}
              onlyOne={list.length === 1}
              onRename={(name) => run(() => onUpdate(status, { name }))}
              onToggleHidden={() => run(() => onUpdate(status, { hidden: !status.hidden }))}
              onMoveUp={() => run(() => onUpdate(status, { after: list[i - 2]?.id ?? null }))}
              onMoveDown={() => run(() => onUpdate(status, { after: list[i + 1]!.id }))}
              onDelete={() => run(() => onDelete(status))}
            />
          ))}
          {canEdit ? (
            adding === category ? (
              <NewStatusInput
                category={category}
                disabled={busy}
                onCommit={async (name) => {
                  const ok = await run(() => onCreate(category, name));
                  if (ok) setAdding(null);
                  return ok;
                }}
                onCancel={() => setAdding(null)}
              />
            ) : (
              <div>
                <Button variant="ghost" size="sm" onClick={() => setAdding(category)}>
                  <Plus aria-hidden />
                  Add status
                </Button>
              </div>
            )
          ) : null}
        </section>
      ))}
    </div>
  );
}

function StatusRow({
  status,
  canEdit,
  busy,
  isFirst,
  isLast,
  onlyOne,
  onRename,
  onToggleHidden,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  status: ProjectStatus;
  canEdit: boolean;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** The category's last status: it can't be deleted (hide it instead). */
  onlyOne: boolean;
  onRename: (name: string) => Promise<boolean>;
  onToggleHidden: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(status.name);
  const commit = () => {
    const name = draft.trim();
    if (!name || name === status.name) {
      setDraft(status.name);
      return;
    }
    void onRename(name).then((ok) => {
      if (!ok) setDraft(status.name);
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };
  return (
    <div className="flex min-h-(--ctrl-h-sm) items-center gap-2">
      <StatusIcon
        category={status.category}
        className={cn("text-muted-foreground", status.hidden && "opacity-50")}
      />
      <Input
        size="sm"
        variant="bare"
        value={draft}
        disabled={!canEdit || busy}
        aria-label={`Name of ${status.name}`}
        className={cn("min-w-0 flex-1", status.hidden && "text-muted-foreground")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {status.hidden ? <span className="text-xs text-muted-foreground">Hidden</span> : null}
      {canEdit ? (
        <div className="flex items-center">
          <IconButton
            icon={status.hidden ? Eye : EyeOff}
            label={status.hidden ? `Show ${status.name}` : `Hide ${status.name}`}
            disabled={busy}
            onClick={onToggleHidden}
          />
          <IconButton
            icon={ArrowUp}
            label={`Move ${status.name} up`}
            disabled={busy || isFirst}
            onClick={onMoveUp}
          />
          <IconButton
            icon={ArrowDown}
            label={`Move ${status.name} down`}
            disabled={busy || isLast}
            onClick={onMoveDown}
          />
          <IconButton
            icon={Trash2}
            label={onlyOne ? "A category always keeps one status" : `Delete ${status.name}`}
            disabled={busy || onlyOne}
            onClick={onDelete}
          />
        </div>
      ) : null}
    </div>
  );
}

function NewStatusInput({
  category,
  disabled,
  onCommit,
  onCancel,
}: {
  category: TaskStatusCategory;
  disabled: boolean;
  onCommit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const submit = () => {
    const value = name.trim();
    if (!value) {
      onCancel();
      return;
    }
    void onCommit(value);
  };
  return (
    <div className="flex min-h-(--ctrl-h-sm) items-center gap-2">
      <StatusIcon category={category} className="text-muted-foreground" />
      <Input
        size="sm"
        // biome-ignore lint/a11y/noAutofocus: the field opens on the user's own "Add status".
        autoFocus
        value={name}
        disabled={disabled}
        placeholder={`New ${CATEGORY_LABELS[category].toLowerCase()} status`}
        aria-label={`New status in ${CATEGORY_LABELS[category]}`}
        className="min-w-0 flex-1"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        onBlur={() => {
          if (!name.trim()) onCancel();
        }}
      />
      <Button size="sm" variant="secondary" disabled={disabled} onClick={submit}>
        Add
      </Button>
    </div>
  );
}
