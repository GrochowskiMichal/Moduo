// Saved views' page parts (TV-U8): the "Save as view…" dialog, and the
// toolbar's Save while an open view's Filter or Display differs from what it
// saved (MOD-142: a clear button, where TV-U8 had a quiet "Unsaved changes ·
// Save · Revert" line under the toolbar; someone else's view offers "Save as
// new view…" instead, since only its maker changes it).

import { ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
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

export type ViewSaveAction = { label: string; onSelect: () => void };

/**
 * The toolbar's Save (MOD-142, agent's layout, revisitable): while one of
 * your saved views has unsaved changes, a clear Save button sits in the
 * toolbar, its ▾ holding "Save as new view…" and "Revert changes" (someone
 * else's view leads with "Save as new view…"; a new view with "Save view…").
 * A secondary button: New stays the toolbar's one primary (R5).
 */
export function ViewSaveControl({
  primary,
  more = [],
}: {
  primary: ViewSaveAction;
  /** The ▾ menu's items; none, no ▾. */
  more?: readonly ViewSaveAction[];
}) {
  const split = more.length > 0;
  // "Save as new view…" opens a dialog: run it once the menu has closed, so
  // the closing menu doesn't take focus back from it (gotchas/ui.md).
  const afterClose = useRef<(() => void) | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The control goes once the view is saved or reverted. Focus that was in
  // it, or that its closing menu left on the page, moves to Display beside it
  // (else the toolbar's first control), never the page body. A layout
  // cleanup runs while the control is still in the page, so it can tell.
  useLayoutEffect(() => {
    const root = rootRef.current;
    return () => {
      if (!root) return;
      const active = document.activeElement;
      if (active && active !== document.body && !root.contains(active)) return;
      const toolbar = root.closest<HTMLElement>('[role="toolbar"]');
      setTimeout(() => {
        const now = document.activeElement;
        if (now && now !== document.body && now.isConnected) return;
        if (!toolbar?.isConnected) return;
        const target =
          toolbar.querySelector<HTMLElement>('[data-slot="plan-display"] button') ??
          toolbar.querySelector<HTMLElement>("button");
        target?.focus();
      }, 0);
    };
  }, []);
  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Saved view"
      data-testid="view-changes"
      className="flex gap-px"
    >
      <Button
        size="sm"
        variant="secondary"
        onClick={primary.onSelect}
        className={split ? "rounded-r-none" : undefined}
      >
        {primary.label}
      </Button>
      {split ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={ChevronDown}
              label="More ways to save"
              tooltip={null}
              variant="secondary"
              className="rounded-l-none"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-44"
            onCloseAutoFocus={(event) => {
              const run = afterClose.current;
              if (!run) return;
              afterClose.current = null;
              event.preventDefault();
              run();
            }}
          >
            {more.map((item) => (
              <DropdownMenuItem
                key={item.label}
                onSelect={() => {
                  afterClose.current = item.onSelect;
                }}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
