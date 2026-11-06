// A message whose body isn't on this Mac yet (specs/mail-v3.md §8, AC3): the
// snippet, then "Downloading the rest of this message…" with a 2 px hairline
// while the account is online (the body swaps in when `threads_changed` names
// the thread), or "Available when you're back online" with the attachments as
// dashed pending tiles while that account is offline.

import { CloudOff, Download } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type { MailMessage } from "@/lib/runtime.types.mail-engine";

/** True when the reader shows the pending state instead of the body. */
export function bodyIsPending(message: MailMessage): boolean {
  return message.bodyState !== "full";
}

function PendingTiles({ message, offline }: { message: MailMessage; offline: boolean }) {
  const files = message.attachments.filter((a) => !a.isInline);
  if (files.length === 0) return null;
  return (
    <ul aria-label="Attachments" className="flex flex-wrap gap-2">
      {files.map((a) => (
        <li
          key={a.id}
          data-pending=""
          className="flex min-w-0 max-w-full items-center gap-2 rounded-md border border-dashed border-hairline px-2 py-1 text-xs text-muted-foreground"
        >
          <span className="font-mono text-2xs">
            {a.filename.split(".").pop()?.slice(0, 4).toUpperCase() ?? ""}
          </span>
          <span className="min-w-0 truncate text-foreground">{a.filename}</span>
          <span>{offline ? "when online" : "on open"}</span>
        </li>
      ))}
    </ul>
  );
}

export function BodyPending({ message, offline }: { message: MailMessage; offline: boolean }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      {message.snippet ? <p className="text-muted-foreground">{message.snippet}</p> : null}
      <div
        role="status"
        className="flex items-start gap-2 rounded-md border border-dashed border-hairline px-3 py-2.5"
      >
        {offline ? (
          <CloudOff aria-hidden className="mt-0.5 size-icon-sm shrink-0 text-muted-foreground" />
        ) : (
          <Download aria-hidden className="mt-0.5 size-icon-sm shrink-0 text-muted-foreground" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <b className="font-medium text-foreground">
            {offline
              ? "Available when you're back online"
              : "Downloading the rest of this message…"}
          </b>
          <small className="text-xs text-muted-foreground">
            {offline
              ? "This Mac has the headers and the first lines. The full message downloads the moment you're connected."
              : "Older mail keeps only its first lines on this Mac until you open it."}
          </small>
          {offline ? null : (
            <Progress size="sm" value={0} max={0} label="Downloading the message" />
          )}
        </div>
      </div>
      <PendingTiles message={message} offline={offline} />
    </div>
  );
}
