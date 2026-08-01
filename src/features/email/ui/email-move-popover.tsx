// The "move to folder" popover (EM-5). Lists the account's server folders
// (runtime.email.listFolders → EmailFolderInfo[]); picking one moves the active
// thread there via email.triage(thread, "move", folder.name). Controlled by the
// page (opened by the `m` shortcut or the reader's move action), anchored to a
// child trigger. Non-selectable folders (containers) render disabled.

import { Folder, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { EmailFolderInfo } from "../model/email-types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runtime: ModuoRuntime | null;
  /** The account whose folders to list; null closes the list to an empty state. */
  accountId: string | null;
  onSelect: (folder: EmailFolderInfo) => void;
  /** The anchor — usually an invisible span positioned over the selected row. */
  children: React.ReactNode;
};

export function EmailMovePopover({
  open,
  onOpenChange,
  runtime,
  accountId,
  onSelect,
  children,
}: Props) {
  const [folders, setFolders] = useState<EmailFolderInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !runtime || !accountId) return;
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const list = (await runtime.email.listFolders({ accountId })) as EmailFolderInfo[];
        if (active) setFolders(list ?? []);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Couldn't list folders.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, runtime, accountId]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="px-2 py-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          Move to folder
        </div>
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-icon-sm animate-spin" aria-hidden />
            Loading folders…
          </div>
        ) : error ? (
          <p className="px-2 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : folders.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">No folders found.</p>
        ) : (
          <div className="scrollbar-thin flex max-h-72 flex-col overflow-y-auto">
            {folders.map((folder) => (
              <button
                key={folder.name}
                type="button"
                disabled={!folder.selectable}
                onClick={() => {
                  if (!folder.selectable) return;
                  onSelect(folder);
                  onOpenChange(false);
                }}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:text-muted-foreground/60 disabled:hover:bg-transparent"
              >
                <Folder className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{folder.displayName || folder.name}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
