// "Move to…" (CV-16, spec §5 "Tidy up afterwards", prototype frame 5): pick
// the conversation the selected messages go to, then, when people there
// couldn't read this conversation, the audience warning first ("2 people who
// aren't in Founders will see this", CH55). The op decides; this asks.

import { useMemo, useState } from "react";

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
import { cn } from "@/lib/utils";

import { messageDestinations } from "../capture-type";
import type { ChatChannel, ChatPerson } from "../model";

/** Where messages can move: conversations you're in, recent first, not this one or an archived one. */
export function moveTargets(
  channels: readonly ChatChannel[],
  people: readonly ChatPerson[],
  selfId: string,
  currentId: string,
  memberOf: ReadonlySet<string>,
  query: string,
): { channel: ChatChannel; title: string }[] {
  return messageDestinations(channels, people, selfId, query, memberOf).flatMap((d) =>
    d.kind === "conversation" && d.channel.id !== currentId
      ? [{ channel: d.channel, title: d.title }]
      : [],
  );
}

/** "2 people who aren't in Founders will see this" (CH55). */
export function audienceWarning(newly: number, sourceTitle: string): string {
  return `${newly === 1 ? "1 person" : `${newly} people`} who ${newly === 1 ? "isn't" : "aren't"} in ${sourceTitle} will see this`;
}

export type MoveStep =
  { step: "pick" } | { step: "confirm"; target: ChatChannel; targetTitle: string; newly: number };

export function MoveToDialog({
  open,
  onOpenChange,
  count,
  sourceTitle,
  targets,
  step,
  busy,
  onPick,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many messages are selected (a root's chain comes along). */
  count: number;
  sourceTitle: string;
  targets: (query: string) => { channel: ChatChannel; title: string }[];
  step: MoveStep;
  busy: boolean;
  onPick: (target: ChatChannel, title: string) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4" data-slot="move-dialog">
        {!open ? null : step.step === "confirm" ? (
          <div className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>Move to {step.targetTitle}?</DialogTitle>
              <DialogDescription>{audienceWarning(step.newly, sourceTitle)}.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={onConfirm} autoFocus>
                Move
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <MovePicker count={count} targets={targets} busy={busy} onPick={onPick} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MovePicker({
  count,
  targets,
  busy,
  onPick,
}: {
  count: number;
  targets: (query: string) => { channel: ChatChannel; title: string }[];
  busy: boolean;
  onPick: (target: ChatChannel, title: string) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => targets(query), [targets, query]);
  return (
    <div className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle>Move to…</DialogTitle>
        <DialogDescription>
          {count === 1 ? "The message moves" : `${count} messages move`} with their replies; both
          conversations show who moved them.
        </DialogDescription>
      </DialogHeader>
      <Input
        aria-label="Find a conversation"
        placeholder="Find a conversation"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && shown[0] && !busy) {
            e.preventDefault();
            onPick(shown[0].channel, shown[0].title);
          }
        }}
        autoFocus
      />
      {shown.length === 0 ? (
        <p className="px-2 text-sm text-subtle-foreground">No conversation matches.</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-px overflow-y-auto" aria-label="Conversations">
          {shown.map(({ channel, title }) => (
            <li key={channel.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(channel, title)}
                className={cn(
                  "flex h-(--row-h-sm) w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none",
                  "hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
                )}
              >
                <span className="w-3 shrink-0 text-subtle-foreground" aria-hidden>
                  {channel.kind === "channel" ? "#" : "@"}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{title}</span>
                {channel.isPrivate && channel.kind === "channel" ? (
                  <span className="shrink-0 text-xs text-subtle-foreground">Private</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
