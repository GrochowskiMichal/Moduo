// The two small dialogs of reply chains (CV-12, spec §5): Wrap up asks
// "Which reply settled it?" (the chain's replies, the last one picked), and
// "Reply to…" picks an earlier message of this conversation for a stray one
// to answer (open chains first, then the newest messages; a filter on top).
// Wrap up's "Also mark as decision" (CV-14) is ticked by default in a channel
// linked to a project, client or team (CH53).

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatTime } from "@/lib/time-format";
import { cn } from "@/lib/utils";
import { excerptOf } from "../chains";
import type { ChatMessage, ChatPerson } from "../model";
import { authorName } from "../stream/rows";

type Named = { personOf: (id: string) => ChatPerson | undefined };

const nameOf = (m: ChatMessage, personOf: Named["personOf"]) =>
  authorName(m, m.authorId ? personOf(m.authorId) : undefined);

export function WrapUpDialog({
  open,
  onOpenChange,
  replies,
  loaded,
  linked,
  canDecide,
  personOf,
  onConfirm,
}: Named & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chain's replies, oldest first (deleted and unsent ones left out). */
  replies: readonly ChatMessage[];
  /** The chain's read finished (with or without replies to pick). */
  loaded: boolean;
  /** The channel links to an item: "Also mark as decision" starts ticked. */
  linked: boolean;
  /** You may post here (a decision needs it): otherwise no tick. */
  canDecide: boolean;
  onConfirm: (settledId: string, markDecision: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4" data-slot="wrap-up-dialog">
        {open && replies.length === 0 ? (
          <DialogHeader>
            <DialogTitle>Which reply settled it?</DialogTitle>
            <DialogDescription>
              {loaded ? "There's no reply here to pick." : "Loading the replies…"}
            </DialogDescription>
          </DialogHeader>
        ) : open ? (
          <WrapUpForm
            replies={replies}
            linked={linked}
            canDecide={canDecide}
            personOf={personOf}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function WrapUpForm({
  replies,
  linked,
  canDecide,
  personOf,
  onCancel,
  onConfirm,
}: Named & {
  replies: readonly ChatMessage[];
  linked: boolean;
  canDecide: boolean;
  onCancel: () => void;
  onConfirm: (settledId: string, markDecision: boolean) => void;
}) {
  const [picked, setPicked] = useState(replies[replies.length - 1]?.id ?? "");
  // The tick follows the conversation's link (its default) until you change it;
  // without post rights there's no decision to make.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const markDecision = canDecide && (chosen ?? linked);
  const base = useId();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (picked) onConfirm(picked, markDecision);
      }}
    >
      <DialogHeader>
        <DialogTitle>Which reply settled it?</DialogTitle>
        <DialogDescription>
          The replies leave the stream; the one you pick shows on the message.
        </DialogDescription>
      </DialogHeader>
      <RadioGroup
        value={picked}
        onValueChange={setPicked}
        aria-label="Replies"
        className="max-h-80 gap-0.5 overflow-y-auto"
      >
        {replies.map((r) => (
          <label
            key={r.id}
            htmlFor={`${base}-${r.id}`}
            className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-state-hover"
          >
            <RadioGroupItem id={`${base}-${r.id}`} value={r.id} />
            <span className="shrink-0 font-medium text-foreground">{nameOf(r, personOf)}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{excerptOf(r)}</span>
            <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
              {formatTime(r.createdAt)}
            </span>
          </label>
        ))}
      </RadioGroup>
      {canDecide ? (
        <label
          htmlFor={`${base}-decision`}
          className="flex cursor-pointer items-center gap-2.5 px-2 text-sm text-foreground"
        >
          <Checkbox
            id={`${base}-decision`}
            checked={markDecision}
            onCheckedChange={(v) => setChosen(v === true)}
          />
          Also mark as decision
        </label>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!picked}>
          Wrap up
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ReplyToDialog({
  open,
  onOpenChange,
  choices,
  personOf,
  onPick,
}: Named & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  choices: readonly ChatMessage[];
  onPick: (target: ChatMessage) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4" data-slot="reply-to-dialog">
        {open ? <ReplyToForm choices={choices} personOf={personOf} onPick={onPick} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ReplyToForm({
  choices,
  personOf,
  onPick,
}: Named & { choices: readonly ChatMessage[]; onPick: (target: ChatMessage) => void }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return choices;
    return choices.filter(
      (m) =>
        excerptOf(m, 400).toLowerCase().includes(q) ||
        nameOf(m, personOf).toLowerCase().includes(q),
    );
  }, [choices, query, personOf]);
  return (
    <div className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle>Reply to…</DialogTitle>
        <DialogDescription>The message joins the reply chain of what it answers.</DialogDescription>
      </DialogHeader>
      <Input
        aria-label="Find a message"
        placeholder="Find a message"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && shown[0]) {
            e.preventDefault();
            onPick(shown[0]);
          }
        }}
        autoFocus
      />
      {shown.length === 0 ? (
        <p className="px-2 text-sm text-subtle-foreground">No earlier message matches.</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-px overflow-y-auto" aria-label="Earlier messages">
          {shown.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onPick(m)}
                className={cn(
                  "flex h-(--row-h-sm) w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none",
                  "hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50",
                )}
              >
                <span className="shrink-0 font-medium text-foreground">{nameOf(m, personOf)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {excerptOf(m)}
                </span>
                <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
                  {m.replyCount > 0 && !m.parentId
                    ? m.replyCount === 1
                      ? "1 reply"
                      : `${m.replyCount} replies`
                    : formatTime(m.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
