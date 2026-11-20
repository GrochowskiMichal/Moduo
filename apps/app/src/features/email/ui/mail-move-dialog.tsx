// `m` move (AC9): pick a folder of the thread's account; the page applies the
// move through the shell so the list auto-advances (AC14).

import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { MailMailbox } from "@/lib/runtime.types.mail-engine";

export function MailMoveDialog({
  mailboxes,
  onPick,
  onClose,
}: {
  mailboxes: readonly MailMailbox[];
  onPick: (mailboxId: string) => void;
  onClose: () => void;
}) {
  return (
    <CommandDialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title="Move to folder"
      description="Pick the folder to move the selected mail to."
    >
      <CommandInput placeholder="Move to…" />
      <CommandList>
        <CommandEmpty>No folder matches.</CommandEmpty>
        {mailboxes.map((b) => (
          <CommandItem key={b.id} value={`${b.name} ${b.path}`} onSelect={() => onPick(b.id)}>
            {b.name}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
