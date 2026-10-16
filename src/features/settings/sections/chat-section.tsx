import { canonicalReactionKey, isReactionKey } from "@contracts/vocabularies";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Switch } from "../../../components/ui/switch";
import {
  type ChatServerPrefs,
  readChatServerPrefs,
  setChatServerPrefs,
} from "../../../lib/notices/chat-prefs";
import { cn } from "../../../lib/utils";
import { useAuth } from "../../../providers/auth-provider";
import { saveQuickRow, useQuickReactions } from "../../spine/hooks/use-quick-reactions";
import { reactionName } from "../../spine/reactions";

import { PrefGroup, PrefRow } from "./preferences-section";
import { SettingsSectionShell } from "./section-shell";

/**
 * Chat (CV-7c, CH16a; prototype round 5 "your reactions"): your quick
 * reactions, one row for every workspace. Six slots; the first three show
 * when you hover a message, all six in its menu and behind ☺ on task and note
 * comments. A slot takes any emoji (type or paste it, or the OS emoji
 * keyboard; the full picker joins with CV-7b). "Use Moduo's six" goes back to
 * the defaults. CV-6b and later blocks add the rest of chat's settings here.
 */
export function ChatSection() {
  const { userId } = useAuth();
  const { row, saved } = useQuickReactions(userId);

  const save = (next: string[] | null) => {
    void saveQuickRow(next).catch((e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Couldn’t save your reactions.");
    });
  };

  /** Put `key` in slot `at`; if it's already in another slot, the two swap. */
  const place = (at: number, picked: string) => {
    const key = canonicalReactionKey(picked);
    const next = [...row];
    const from = next.indexOf(key);
    if (from === at) return;
    if (from >= 0) next[from] = next[at]!;
    next[at] = key;
    save(next);
  };

  const move = (at: number, by: -1 | 1) => {
    const to = at + by;
    if (to < 0 || to >= row.length) return;
    const next = [...row];
    [next[at], next[to]] = [next[to]!, next[at]!];
    save(next);
  };

  return (
    <SettingsSectionShell title="Chat" description="How chat works for you, in every workspace.">
      <PrefGroup
        label="Quick reactions"
        description="The first three show when you hover a message; all six in its menu and on task and note comments. Reactions never notify anyone."
      >
        <div className="flex flex-col gap-3 py-4">
          <div role="list" aria-label="Your quick reactions" className="flex gap-1.5">
            {row.map((key, at) => (
              <div role="listitem" key={key}>
                <SlotEditor
                  value={key}
                  position={at}
                  count={row.length}
                  onPlace={(k) => place(at, k)}
                  onMove={(by) => move(at, by)}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!saved || saved.length === 0}
              onClick={() => save(null)}
            >
              Use Moduo’s six
            </Button>
          </div>
        </div>
      </PrefGroup>
      <PresenceGroup />
    </SettingsSectionShell>
  );
}

/** Presence and Focus (CV-17, spec §10, §15; CH47): two switches kept on the
 *  server, for every workspace. */
function PresenceGroup() {
  const { userId } = useAuth();
  const [prefs, setPrefs] = useState<ChatServerPrefs | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    readChatServerPrefs().then(
      (p) => {
        if (!cancelled) setPrefs(p);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const save = async (patch: Partial<ChatServerPrefs>) => {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, ...patch });
    setBusy(true);
    try {
      setPrefs(await setChatServerPrefs(patch));
    } catch {
      setPrefs(before);
      toast("Couldn't change that — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PrefGroup label="Presence" description="What teammates see about you, in every workspace.">
      <PrefRow
        title="Show me as online"
        description="Off: you show as offline to everyone, even while Moduo is open."
      >
        <Switch
          checked={prefs?.showOnline ?? true}
          disabled={!prefs || busy}
          onCheckedChange={(v) => void save({ showOnline: v })}
          aria-label="Show me as online"
        />
      </PrefRow>
      <PrefRow
        title="Show what I'm focusing on"
        description="Teammates who can see the task see its name next to “Focusing”."
      >
        <Switch
          checked={prefs?.showFocusTask ?? false}
          disabled={!prefs || busy}
          onCheckedChange={(v) => void save({ showFocusTask: v })}
          aria-label="Show what I'm focusing on"
        />
      </PrefRow>
    </PrefGroup>
  );
}

function SlotEditor({
  value,
  position,
  count,
  onPlace,
  onMove,
}: {
  value: string;
  position: number;
  count: number;
  onPlace: (key: string) => void;
  onMove: (by: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  const valid = isReactionKey(trimmed);

  const submit = () => {
    if (!valid) return;
    onPlace(trimmed);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Slot ${position + 1}: ${reactionName(value)}. Change`}
          className={cn(
            "grid size-10 place-items-center rounded-md text-xl leading-none ring-1 ring-hairline ring-inset",
            "outline-none transition-colors duration-(--motion-fade) ease-(--ease-out)",
            "hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50",
            open && "ring-border bg-state-active",
          )}
        >
          <span aria-hidden>{value}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-64 flex-col gap-2 p-2">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type or paste an emoji"
            aria-label={`Emoji for slot ${position + 1}`}
            aria-invalid={trimmed.length > 0 && !valid}
          />
          <p className="text-xs text-muted-foreground">
            {trimmed.length > 0 && !valid
              ? "That isn’t an emoji."
              : "Tip: ⌃⌘Space opens the emoji keyboard."}
          </p>
          <div className="flex items-center gap-1">
            <IconButton
              icon={ChevronLeft}
              label="Move left"
              size="sm"
              disabled={position === 0}
              onClick={() => onMove(-1)}
            />
            <IconButton
              icon={ChevronRight}
              label="Move right"
              size="sm"
              disabled={position >= count - 1}
              onClick={() => onMove(1)}
            />
            <Button type="submit" size="sm" className="ml-auto" disabled={!valid}>
              Use it
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
