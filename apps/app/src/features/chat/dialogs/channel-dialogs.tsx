// A channel's managers' dialogs (spec §12, CV-15, prototype round 5 frame 4
// "As a manager"): add people, edit the name and topic, the one confirm for
// making it private (#33), the delete confirm, and Recently deleted (from the
// left panel's ⋯). The server decides each; its refusal shows inline.

import { type FormEvent, useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/time-format";
import type { ChatChannel, ChatDeletedChannel, ChatPerson } from "../model";
import { CHANNEL_NAME_MAX, channelNameProblem } from "../panel/details-model";
import { PeoplePicker } from "./new-conversation-dialog";

const errorText = (err: unknown) =>
  err instanceof Error && err.message ? err.message : "That didn't work. Try again.";

/** The make-private confirm's words (#33). */
export function makePrivateCopy(name: string, people: number): { title: string; body: string } {
  return {
    title: `Make ${name} private?`,
    body: `It can't go back to public. ${people} ${people === 1 ? "person stays" : "people stay"} in it.`,
  };
}

/** Days left before a deleted channel goes for good (0 on its last day). */
export function daysLeft(purgeAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(purgeAt) - now) / 86_400_000));
}

// ── Add people ────────────────────────────────────────────────────────────────

export function AddPeopleDialog({
  open,
  onOpenChange,
  channelName,
  people,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelName: string;
  /** Who could be added (the workspace's people not in it). */
  people: readonly ChatPerson[];
  onAdd: (userIds: string[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPicked([]);
      setError(null);
    }
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(picked);
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4" data-slot="add-people">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Add people to {channelName}</DialogTitle>
            <DialogDescription>
              They'll see it in their sidebar with a quiet line in Catch up.
            </DialogDescription>
          </DialogHeader>
          <PeoplePicker
            id="add-people"
            label="People"
            people={people}
            picked={picked}
            onChange={setPicked}
            autoFocus
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={picked.length === 0 || busy}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Name and topic ────────────────────────────────────────────────────────────

export function EditChannelDialog({
  open,
  onOpenChange,
  channel,
  canRename,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: ChatChannel;
  /** Renaming is a manager's; the topic is everyone's who posts (§12). */
  canRename: boolean;
  onSave: (patch: { name?: string; topic?: string }) => Promise<void>;
}) {
  const [name, setName] = useState(channel.name ?? "");
  const [topic, setTopic] = useState(channel.topic);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh form each time it opens
  useEffect(() => {
    if (!open) return;
    setName(channel.name ?? "");
    setTopic(channel.topic);
    setTried(false);
    setError(null);
  }, [open]);
  const nameProblem = canRename ? channelNameProblem(name) : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (nameProblem || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: canRename && name.trim() !== channel.name ? name.trim() : undefined,
        topic: topic !== channel.topic ? topic : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4" data-slot="edit-channel">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Name and topic</DialogTitle>
            <DialogDescription className="sr-only">
              Change the channel's name and topic.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-channel-name">Name</Label>
            <Input
              id="edit-channel-name"
              autoFocus={canRename}
              disabled={!canRename}
              value={name}
              maxLength={CHANNEL_NAME_MAX}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              aria-invalid={tried && !!nameProblem}
            />
            {tried && nameProblem ? (
              <p className="text-xs text-destructive">{nameProblem}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-channel-topic">Topic</Label>
            <Input
              id="edit-channel-topic"
              autoFocus={!canRename}
              value={topic}
              maxLength={250}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── The confirms ──────────────────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  action,
  destructive = false,
  onConfirm,
  slot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  action: string;
  destructive?: boolean;
  onConfirm: () => void;
  slot?: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-slot={slot}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Recently deleted ──────────────────────────────────────────────────────────

export function RecentlyDeletedDialog({
  open,
  onOpenChange,
  load,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  load: () => Promise<ChatDeletedChannel[]>;
  onRestore: (id: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<ChatDeletedChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once each time it opens
  useEffect(() => {
    if (!open) return;
    let live = true;
    setRows(null);
    setError(null);
    load().then(
      (r) => live && setRows(r),
      (err: unknown) => {
        if (!live) return;
        setRows([]);
        setError(errorText(err));
      },
    );
    return () => {
      live = false;
    };
  }, [open]);
  const restore = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await onRestore(id);
      setRows((r) => r?.filter((x) => x.id !== id) ?? null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4" data-slot="recently-deleted">
        <DialogHeader>
          <DialogTitle>Recently deleted</DialogTitle>
          <DialogDescription>
            Channels you manage stay here for 30 days. Restore brings back everything in them.
          </DialogDescription>
        </DialogHeader>
        {rows === null ? (
          <p className="text-sm text-subtle-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-subtle-foreground">Nothing deleted in the last 30 days.</p>
        ) : (
          <ul className="flex flex-col gap-px" aria-label="Deleted channels">
            {rows.map((c) => {
              const left = daysLeft(c.purgeAt);
              return (
                <li key={c.id} className="flex min-h-(--row-h-sm) items-center gap-2 px-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-foreground">{c.name}</span>
                  <span
                    className="shrink-0 text-xs text-subtle-foreground tabular-nums"
                    title={`Deleted ${formatDate(c.deletedAt)}`}
                  >
                    {left === 0 ? "Goes today" : `${left} ${left === 1 ? "day" : "days"} left`}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void restore(c.id)}
                  >
                    Restore
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
