// Gmail labels (AC9): add or remove a label on the selected threads. A label
// is a custom folder of a Gmail account; the op carries its mailbox id in
// `args.mailboxId`, which the engine COPYs from All Mail (add) or moves back
// into All Mail (remove), `mail/ops/plan.rs`.

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type {
  MailAccount,
  MailEngine,
  MailMailbox,
  MailOpInput,
  MailThread,
  MailThreadRow,
} from "@/lib/runtime.types.mail-engine";

export type MailLabelKind = Extract<MailOpInput["kind"], "label_add" | "label_remove">;

/** Labels exist only on Gmail accounts. */
export function supportsLabels(account: Pick<MailAccount, "provider"> | null | undefined): boolean {
  return account?.provider === "gmail" || account?.provider === "google_workspace";
}

/** The account's labels: its custom folders, by name. */
export function labelChoices(boxes: readonly MailMailbox[]): MailMailbox[] {
  return boxes.filter((b) => b.role === "custom").sort((a, b) => a.name.localeCompare(b.name));
}

/** The op a label pick sends (the engine requires `args.mailboxId`). */
export function labelOp(kind: MailLabelKind, threadIds: string[], mailboxId: string): MailOpInput {
  return { kind, threadIds: [...threadIds], args: { mailboxId } };
}

export function MailLabelDialog({
  labels,
  onPick,
  onClose,
}: {
  labels: readonly MailMailbox[];
  onPick: (kind: MailLabelKind, mailboxId: string) => void;
  onClose: () => void;
}) {
  return (
    <CommandDialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title="Labels"
      description="Add or remove a label on the selected mail."
    >
      <CommandInput placeholder="Label…" />
      <CommandList>
        <CommandEmpty>No label matches.</CommandEmpty>
        <CommandGroup heading="Add label">
          {labels.map((b) => (
            <CommandItem
              key={`add:${b.id}`}
              value={`add ${b.name} ${b.path}`}
              onSelect={() => onPick("label_add", b.id)}
            >
              Add “{b.name}”
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Remove label">
          {labels.map((b) => (
            <CommandItem
              key={`remove:${b.id}`}
              value={`remove ${b.name} ${b.path}`}
              onSelect={() => onPick("label_remove", b.id)}
            >
              Remove “{b.name}”
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

/**
 * The Labels flow for the page: the reader's ⋯ menu, the multi-select button
 * and the dialog, all sending `label_*` through the shell's `act`.
 */
export function useMailLabels({
  engine,
  accounts,
  rowOf,
  act,
}: {
  engine: MailEngine | null;
  accounts: readonly MailAccount[];
  rowOf: (threadId: string) => Promise<MailThreadRow | null>;
  act: (kind: MailLabelKind, threadIds: string[], args: MailOpInput["args"]) => void;
}) {
  const [open, setOpen] = useState<{ ids: string[]; boxes: MailMailbox[] } | null>(null);
  const accountOf = (id: string | undefined) => accounts.find((a) => a.id === id) ?? null;

  const openFor = async (threadIds: string[]) => {
    const row = threadIds[0] ? await rowOf(threadIds[0]) : null;
    const account = accountOf(row?.accountId);
    if (!engine || !account || !supportsLabels(account)) {
      toast.error("Labels are a Gmail feature.");
      return;
    }
    setOpen({ ids: threadIds, boxes: labelChoices(await engine.listMailboxes(account.id)) });
  };

  const enabled = engine !== null && accounts.some(supportsLabels);
  return {
    selectionActions: enabled
      ? (ids: string[]) => (
          <Button size="sm" variant="ghost" onClick={() => void openFor(ids)}>
            Labels…
          </Button>
        )
      : undefined,
    /** Labels… in the reader's ⋯ menu (Gmail threads only). */
    readerMenuItems: (thread: MailThread) =>
      enabled && supportsLabels(accountOf(thread.row.accountId)) ? (
        <DropdownMenuItem onSelect={() => void openFor([thread.row.threadId])}>
          Labels…
        </DropdownMenuItem>
      ) : null,
    dialog: open ? (
      <MailLabelDialog
        labels={open.boxes}
        onClose={() => setOpen(null)}
        onPick={(kind, mailboxId) => {
          setOpen(null);
          const op = labelOp(kind, open.ids, mailboxId);
          act(kind, op.threadIds, op.args);
        }}
      />
    ) : null,
  };
}
