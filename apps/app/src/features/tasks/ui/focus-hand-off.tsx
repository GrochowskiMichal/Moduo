// Hand off W on the Now card (Tasks v3 TV-F8; call 5's reshape of TV-F4,
// REPLAN 62a's "Keep it going while you wait"): the task waits on someone or
// something (a Waiting on… entry, the field TV-D10 made), optionally with a
// check-back (one of my reminders: it arrives on its own, bell and OS, and the
// In flight card brightens) and a note of where I left off (a comment). Two
// steps, both on the keyboard: pick who or what (⏎), then ⏎ hands it off.

import { Hourglass } from "lucide-react";
import { type ReactNode, useContext, useMemo, useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../components/ui/command";
import { Input } from "../../../components/ui/input";
import { Kbd } from "../../../components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { getResolvedTimeRegion } from "../../../lib/time-region";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import { type Assignee, toAssignees } from "../assignee-options";
import type { TaskWaitingEntry } from "../model";
import { AssigneeAvatar } from "./assignee-avatar";

/** Who or what the task now waits on. */
export type HandOffTarget =
  { kind: "person"; ref: string; name: string } | { kind: "text"; label: string };

export type HandOff = {
  target: HandOffTarget;
  /** When to check back (ISO), or null for none. */
  checkBackAt: string | null;
  /** Where I left off; becomes a comment on the task. */
  note: string;
};

/** The check-back choices: none by default (it's optional, call 5). */
export const CHECK_BACKS = ["none", "30m", "2h", "tomorrow", "week"] as const;
export type CheckBack = (typeof CHECK_BACKS)[number];

const CHECK_BACK_LABELS: Record<CheckBack, string> = {
  none: "None",
  "30m": "30m",
  "2h": "2h",
  tomorrow: "Tomorrow",
  week: "Next week",
};

/**
 * When a check-back lands: in half an hour, in two hours, tomorrow at 9:00, or
 * at 9:00 on the first day of next week (Time & region's week start).
 */
export function checkBackAt(choice: CheckBack, now: Date, weekStartsOn = 1): Date | null {
  if (choice === "none") return null;
  if (choice === "30m") return new Date(now.getTime() + 30 * 60_000);
  if (choice === "2h") return new Date(now.getTime() + 2 * 60 * 60_000);
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  if (choice === "tomorrow") return at;
  const ahead = (weekStartsOn - at.getDay() + 7) % 7;
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + ahead, 9, 0, 0, 0);
}

/** What a waiting entry is called on a card: the person, the text, or its kind. */
export function waitingLabel(
  entry: Pick<TaskWaitingEntry, "kind" | "ref" | "label">,
  personName: (id: string | null) => string | null,
): string {
  if (entry.kind === "person") return personName(entry.ref) ?? "a former member";
  if (entry.kind === "text") return entry.label?.trim() || "something";
  return entry.kind === "email" ? "an email" : "an agent";
}

/** Workspace members as people to wait on (never yourself); safe without a provider. */
export function usePeople(me: string | null): Assignee[] {
  const members = useContext(WorkspaceContext)?.members;
  return useMemo(() => toAssignees(members ?? [], me).filter((a) => !a.isMe), [members, me]);
}

export function HandOffPopover({
  open,
  onOpenChange,
  me,
  onHandOff,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: string | null;
  onHandOff: (handOff: HandOff) => void;
  /** The Hand off button the popover hangs from. */
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{children}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Keep it going while you wait: it moves to In flight</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80 p-0" data-slot="focus-hand-off">
        {open ? (
          <HandOffForm
            me={me}
            onCancel={() => onOpenChange(false)}
            onHandOff={(h) => {
              onOpenChange(false);
              onHandOff(h);
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function HandOffForm({
  me,
  onHandOff,
  onCancel,
}: {
  me: string | null;
  onHandOff: (handOff: HandOff) => void;
  onCancel: () => void;
}) {
  const people = usePeople(me);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<HandOffTarget | null>(null);
  const [checkBack, setCheckBack] = useState<CheckBack>("none");
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!target) return;
    const at = checkBackAt(checkBack, new Date(), getResolvedTimeRegion().weekStartsOn);
    onHandOff({ target, checkBackAt: at ? at.toISOString() : null, note: note.trim() });
  };

  if (!target) {
    const typed = query.trim();
    return (
      <Command>
        <CommandInput
          autoFocus
          placeholder="Waiting on…"
          aria-label="Waiting on"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>Type what you’re waiting on.</CommandEmpty>
          {people.length > 0 ? (
            <CommandGroup heading="People">
              {people.map((a) => (
                <CommandItem
                  key={a.userId}
                  value={`${a.fullName || a.name} ${a.userId}`}
                  onSelect={() => {
                    setTarget({ kind: "person", ref: a.userId, name: a.fullName || a.name });
                    requestAnimationFrame(() => noteRef.current?.focus());
                  }}
                >
                  <AssigneeAvatar assignee={a} size="icon" />
                  <span className="min-w-0 flex-1 break-words">{a.fullName || a.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {typed ? (
            <CommandGroup heading="Something else">
              <CommandItem
                value={`text ${typed}`}
                onSelect={() => {
                  setTarget({ kind: "text", label: typed.slice(0, 200) });
                  requestAnimationFrame(() => noteRef.current?.focus());
                }}
              >
                <Hourglass className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 break-words">{typed}</span>
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <p className="flex items-center gap-1.5 font-sans text-sm text-foreground">
        <span className="text-muted-foreground">Waiting on</span>
        <span className="min-w-0 flex-1 break-words">
          {target.kind === "person" ? target.name : target.label}
        </span>
        <button
          type="button"
          onClick={() => setTarget(null)}
          className="hit-min shrink-0 rounded-sm font-sans text-xs text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Change
        </button>
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="font-sans text-xs text-muted-foreground" id="hand-off-check-back">
          Check back
        </span>
        <SegmentedControl
          size="sm"
          value={checkBack}
          onValueChange={(v) => setCheckBack(v as CheckBack)}
          items={CHECK_BACKS.map((value) => ({ value, label: CHECK_BACK_LABELS[value] }))}
          aria-label="Check back"
          aria-describedby="hand-off-check-back"
        />
      </div>
      <Input
        ref={noteRef}
        size="sm"
        value={note}
        maxLength={2000}
        placeholder="Where you left off (optional)"
        aria-label="Where you left off"
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Hand off
          <Kbd className="border-primary-foreground/30 bg-transparent text-primary-foreground">
            ⏎
          </Kbd>
        </Button>
      </div>
    </form>
  );
}
