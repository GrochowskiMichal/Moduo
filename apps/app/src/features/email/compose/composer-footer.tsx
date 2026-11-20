// The composer's footer (specs/mail-v3.md §9): Send ⌘↵ (disabled with the
// reason when over the size limit), "Remind me Thu if no reply" with the `w`
// presets, "Also mark the email Done", the draft status on the right (AC10),
// attach and discard.

import { BellRing, Check, FileText, Paperclip, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { snoozePresets } from "../snooze";
import type { DraftSaved } from "./session";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const PRESET_HINT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** "Remind me Thu if no reply", or "Remind me if no reply" when none is set. */
export function remindLabel(dueMs: number | null): string {
  return dueMs === null
    ? "Remind me if no reply"
    : `Remind me ${WEEKDAY.format(new Date(dueMs))} if no reply`;
}

/** The draft status text and its tooltip (AC10). */
export function draftStatus(
  saved: DraftSaved,
  offline: boolean,
  accountLabel: string,
): { text: string; title?: string } | null {
  if (saved === "server")
    return { text: "Saved to Drafts", title: `Saved to Drafts on ${accountLabel}` };
  if (saved === "local")
    return {
      text: offline ? "Saved on this Mac · reaches Drafts when you're online" : "Saved on this Mac",
    };
  return null;
}

function RemindMenu(props: {
  dueMs: number | null;
  now: () => number;
  onPick: (dueMs: number | null) => void;
}) {
  const label = remindLabel(props.dueMs);
  // The `w` presets, resolved when the footer renders.
  const presets = snoozePresets(new Date(props.now()));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} className="min-w-0 gap-1.5 px-2">
          <BellRing aria-hidden className="text-muted-foreground" />
          <span className="truncate text-sm text-muted-foreground">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {presets.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => props.onPick(p.at.getTime())}>
            {p.label}
            <DropdownMenuShortcut>{PRESET_HINT.format(p.at)}</DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
        {props.dueMs !== null ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => props.onPick(null)}>Don’t remind me</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SendButton({ blocked, onSend }: { blocked: string | null; onSend: () => void }) {
  const button = (
    <Button size="sm" disabled={!!blocked} onClick={onSend} className="gap-1.5">
      <Send aria-hidden />
      Send
      <Kbd className="border-transparent bg-transparent text-current">⌘↵</Kbd>
    </Button>
  );
  if (!blocked) return button;
  // A disabled button gets no pointer events: the tooltip sits on a wrapper.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label={`Send is off: ${blocked}`} className="rounded-md">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{blocked}</TooltipContent>
    </Tooltip>
  );
}

export type ComposerFooterProps = {
  /** Why Send is off (over the size limit), else null. */
  blocked: string | null;
  onSend: () => void;
  /** Remind and "Also mark the email Done" apply to replies only. */
  threaded: boolean;
  followUp: number | null;
  onFollowUp: (dueMs: number | null) => void;
  markDone: boolean;
  onMarkDone: (on: boolean) => void;
  saved: DraftSaved;
  offline: boolean;
  accountLabel: string;
  onAttach?: () => void;
  onDiscard: () => void;
  now: () => number;
};

export function ComposerFooter(props: ComposerFooterProps) {
  const status = draftStatus(props.saved, props.offline, props.accountLabel);
  return (
    <footer className="flex items-center gap-2 border-t border-hairline px-3 py-2">
      <SendButton blocked={props.blocked} onSend={props.onSend} />
      {props.threaded ? (
        <>
          <RemindMenu dueMs={props.followUp} now={props.now} onPick={props.onFollowUp} />
          <label className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
            <Checkbox
              checked={props.markDone}
              onCheckedChange={(v) => props.onMarkDone(v === true)}
            />
            Also mark the email Done
          </label>
        </>
      ) : null}
      <span className="flex-1" />
      {status ? (
        <span
          role="status"
          title={status.title}
          className="flex min-w-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground"
        >
          {props.saved === "server" ? (
            <Check aria-hidden className="size-icon-sm shrink-0" />
          ) : (
            <FileText aria-hidden className="size-icon-sm shrink-0" />
          )}
          <span className="truncate">{status.text}</span>
        </span>
      ) : null}
      {props.onAttach ? (
        <IconButton label="Attach files" icon={Paperclip} onClick={props.onAttach} />
      ) : null}
      <IconButton label="Discard draft" icon={Trash2} onClick={props.onDiscard} />
    </footer>
  );
}
