// Pieces of the composer (specs/mail-v3.md §9): the instant-intro banner, the
// attachment tiles with the live size check, and the `;;` snippet popup.

import { AlertTriangle, Paperclip, UserPlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

import { introducerFirstName, introducerName } from "./intro";
import type { MailSnippet } from "./snippets";

/** "Priya Shah introduced you." with Move Priya to Bcc; once moved, Undo returns her to To. */
export function IntroBanner(props: {
  introducer: string;
  moved: boolean;
  onMove: () => void;
  onUndo: () => void;
}) {
  const first = introducerFirstName(props.introducer);
  return (
    <div
      role="status"
      className="flex min-h-(--ctrl-h-sm) items-center gap-2 border-b border-hairline px-3 text-xs text-muted-foreground"
    >
      <UserPlus aria-hidden className="size-icon-sm shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {props.moved
          ? `Moved ${first} to Bcc.`
          : `${introducerName(props.introducer)} introduced you.`}
      </span>
      {props.moved ? (
        <Button variant="ghost" size="sm" onClick={props.onUndo}>
          Undo
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={props.onMove}>
          Move {first} to Bcc
        </Button>
      )}
    </div>
  );
}

/** "820 KB", "3.4 MB". */
export function fileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Math.round(mb * 10) / 10} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type Tile = { id: string; filename: string; size?: number };

/** The attachment tiles: name, size and a remove ✕; the largest is marked when over the limit. */
export function AttachmentTiles(props: {
  attachments: readonly Tile[];
  largest: string | null;
  onRemove: (id: string) => void;
}) {
  if (props.attachments.length === 0) return null;
  return (
    <ul aria-label="Attachments" className="flex flex-wrap gap-1.5 px-3 pt-2">
      {props.attachments.map((a) => (
        <li
          key={a.id}
          className={cn(
            "flex h-(--ctrl-h-sm) max-w-64 items-center gap-1.5 rounded-md pr-0.5 pl-2 text-xs ring-1 ring-hairline ring-inset",
            props.largest === a.filename && "ring-warning",
          )}
        >
          <Paperclip aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-foreground">{a.filename}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {fileSize(a.size ?? 0)}
          </span>
          <IconButton
            label={`Remove ${a.filename}`}
            icon={X}
            tooltip={null}
            onClick={() => props.onRemove(a.id)}
          />
        </li>
      ))}
    </ul>
  );
}

/** The over-limit line: provider, its limit and the largest file (AC32). */
export function SizeAlert({ id, message }: { id: string; message: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="mx-3 mt-2 flex items-start gap-2 rounded-md bg-muted px-2 py-1.5 text-xs text-foreground"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-icon-sm shrink-0 text-warning" />
      <span>{message}</span>
    </p>
  );
}

export type SnippetHit = { snippet: MailSnippet; preview: string };

/** The `;;` popup: `;;key`, its name and filled preview; an unknown key shows the help line. */
export function SnippetPopup(props: {
  hits: readonly SnippetHit[];
  active: number;
  missLine: string | null;
  firstName: string;
  onPick: (s: MailSnippet) => void;
}) {
  return (
    <div className="mx-3 mb-2 flex flex-col rounded-md border border-hairline p-1 text-sm">
      {props.hits.length > 0 ? (
        <ul role="listbox" aria-label="Snippets" className="flex flex-col">
          {props.hits.map(({ snippet, preview }, i) => (
            <li
              key={snippet.id}
              role="option"
              aria-selected={i === props.active}
              className={cn(
                "flex cursor-default items-baseline gap-2 rounded-sm px-2 py-1",
                i === props.active && "bg-state-active",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                props.onPick(snippet);
              }}
            >
              <span className="w-24 shrink-0 truncate font-mono text-xs text-muted-foreground">
                ;;{snippet.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {preview}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-2 py-1 text-xs text-muted-foreground">{props.missLine}</p>
      )}
      {props.hits.length > 0 ? (
        // The offer says how to take it before anything is inserted (specs/mail-improve.md AC21).
        <div
          role="group"
          aria-label="Snippet offer"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pt-1 text-xs text-muted-foreground"
        >
          <span>Tab to insert</span>
          <span className="flex items-center gap-1">
            <span aria-hidden>↑↓</span>
            <span>
              {props.active + 1} of {props.hits.length}
            </span>
          </span>
          <span>Esc dismiss</span>
          {props.firstName ? <span>{`{first name} becomes ${props.firstName}`}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
