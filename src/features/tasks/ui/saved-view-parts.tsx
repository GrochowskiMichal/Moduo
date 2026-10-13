// Saved views' page parts (TV-U8): the "Save as view…" dialog, and the line
// under the toolbar while an open view's Filter or Display differs from what
// it saved ("Unsaved changes · Save · Revert"; someone else's view offers
// "Save as new view…" instead, since only its maker changes it).

import { useEffect, useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";

export function SaveViewDialog({
  open,
  title,
  description,
  initialName,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  /** What the view will keep, in a sentence. */
  description: string;
  initialName: string;
  /** Answers once it's saved (or refused, false). */
  onSave: (name: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setSaving(false);
  }, [open, initialName]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const ok = await onSave(trimmed);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            ref={inputRef}
            aria-label="View name"
            value={name}
            maxLength={80}
            placeholder="View name"
            onChange={(e) => setName(e.target.value)}
          />
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || saving} onClick={() => void save()}>
            Save view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Unsaved changes · Save · Revert" under the toolbar of an open view. */
export function ViewChangesLine({
  canSave,
  onSave,
  onSaveAsNew,
  onRevert,
}: {
  /** The view is yours: Save writes into it. Else only Save as new view…. */
  canSave: boolean;
  onSave: () => void;
  onSaveAsNew: () => void;
  onRevert: () => void;
}) {
  const action =
    "rounded-sm text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
  return (
    <p
      className="flex items-center gap-1.5 px-1 font-sans text-xs text-muted-foreground"
      data-testid="view-changes"
    >
      <span>Unsaved changes</span>
      <span aria-hidden>·</span>
      {canSave ? (
        <button type="button" onClick={onSave} className={action}>
          Save
        </button>
      ) : null}
      {canSave ? <span aria-hidden>·</span> : null}
      <button type="button" onClick={onSaveAsNew} className={action}>
        Save as new view…
      </button>
      <span aria-hidden>·</span>
      <button type="button" onClick={onRevert} className={action}>
        Revert
      </button>
    </p>
  );
}
