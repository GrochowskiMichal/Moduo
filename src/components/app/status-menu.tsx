// Your status, from your avatar in the top bar (chat v2 CV-17, spec §10, §15;
// CH28d, CH45; prototype round 4, frame 6 "menu"): Active (automatic) or Do
// not disturb for 1 h · today · until a date; "What's your status?" (an
// emoji, words, "clear after", "do not disturb while it's on"); Moduo's
// presets; your saved ones ("Yours", up to 20) and "Save a new status…".
// One status for every workspace. Settings stays at the bottom: the avatar
// used to open it directly.

import {
  SAVED_STATUSES_MAX,
  STATUS_CLEAR_AFTER,
  STATUS_PRESET_DEFAULTS,
  STATUS_TEXT_MAX,
  type StatusClearAfter,
  type StatusPreset,
} from "@contracts/vocabularies";
import { Settings, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  clearMyStatus,
  forgetStatus,
  listSavedStatuses,
  type SavedStatusDraft,
  type StatusDraft,
  saveStatus,
  setMyStatus,
} from "@/lib/statuses/api";
import {
  clearAfterHint,
  clearAtFor,
  type PersonStatus,
  PRESET_ORDER,
  type SavedStatus,
  statusLine,
} from "@/lib/statuses/model";
import "@/lib/statuses/live";
import { refreshPeopleNow, usePeopleNow } from "@/lib/statuses/store";
import { useTimeRegion } from "@/lib/time-region";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage, PresenceBadge } from "../ui/avatar";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { DateField } from "../ui/date-field";
import { IconButton } from "../ui/icon-button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const CLEAR_AFTER_WORDS: Record<StatusClearAfter, string> = {
  "30m": "30 minutes",
  "1h": "1 hour",
  today: "Today",
  this_week: "This week",
  date: "Pick a date",
  never: "Don't clear",
};

type Editor = {
  mode: "set" | "save";
  emoji: string;
  text: string;
  dnd: boolean;
  clearAfter: StatusClearAfter;
  date: Date | null;
  preset: StatusPreset | null;
  /** Editing a saved one. */
  savedId?: string;
};

const BLANK: Editor = {
  mode: "set",
  emoji: "",
  text: "",
  dnd: false,
  clearAfter: "today",
  date: null,
  preset: null,
};

const ROW =
  "flex h-(--ctrl-h) w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-foreground outline-none transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover focus-visible:bg-state-hover";

export type StatusMenuProps = {
  userId: string | null;
  workspaceId: string | null;
  avatarDataUrl?: string | null;
  profileInitial: string;
  onOpenSettings: () => void;
};

export function StatusMenu({
  userId,
  workspaceId,
  avatarDataUrl,
  profileInitial,
  onOpenSettings,
}: StatusMenuProps) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedStatus[] | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const region = useTimeRegion();
  const now = usePeopleNow(userId, workspaceId);
  const mine: PersonStatus | null = userId ? (now.people.get(userId)?.status ?? null) : null;

  // Saved statuses are private: another person on this tab starts empty.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on a new person only
  useEffect(() => {
    setSaved(null);
    setEditor(null);
    setOpen(false);
  }, [userId]);

  const loadSaved = useCallback(() => {
    void listSavedStatuses().then(setSaved, () => setSaved([]));
  }, []);
  useEffect(() => {
    if (open && saved === null) loadSaved();
    if (!open) setEditor(null);
  }, [open, saved, loadSaved]);

  const run = async (work: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try {
      await work();
      refreshPeopleNow(userId, workspaceId);
      return true;
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : failed);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const clearAt = (choice: StatusClearAfter, date: Date | null) =>
    clearAtFor(choice, new Date(), {
      date,
      weekStart: region.weekStartsOn,
      timeZone: region.timeZone,
    });

  const apply = async (draft: StatusDraft) => {
    if (await run(() => setMyStatus(draft), "Couldn't set your status — try again.")) {
      setOpen(false);
    }
  };

  const dndFor = (choice: StatusClearAfter, date: Date | null = null) =>
    apply({ emoji: null, text: null, dnd: true, clearAt: clearAt(choice, date), preset: null });

  const pickPreset = (preset: StatusPreset) => {
    const d = STATUS_PRESET_DEFAULTS[preset];
    if (d.clearAfter === "date") {
      setEditor({
        mode: "set",
        emoji: d.emoji,
        text: d.text,
        dnd: d.dnd,
        clearAfter: "date",
        date: null,
        preset,
      });
      return;
    }
    void apply({
      emoji: d.emoji,
      text: d.text,
      dnd: d.dnd,
      clearAt: clearAt(d.clearAfter, null),
      preset,
    });
  };

  const pickSaved = (s: SavedStatus) => {
    if (s.clearAfter === "date") {
      setEditor({
        mode: "set",
        emoji: s.emoji ?? "",
        text: s.text ?? "",
        dnd: s.dnd,
        clearAfter: "date",
        date: null,
        preset: null,
      });
      return;
    }
    void apply({
      emoji: s.emoji,
      text: s.text,
      dnd: s.dnd,
      clearAt: clearAt(s.clearAfter, null),
      preset: null,
    });
  };

  const submit = async (e: Editor) => {
    const emoji = e.emoji.trim() || null;
    const text = e.text.trim() || null;
    if (!emoji && !text && !e.dnd) return;
    if (e.mode === "save") {
      const draft: SavedStatusDraft = { emoji, text, dnd: e.dnd, clearAfter: e.clearAfter };
      if (await run(() => saveStatus(draft, e.savedId), "Couldn't save that status.")) {
        setEditor(null);
        loadSaved();
      }
      return;
    }
    if (e.clearAfter === "date" && !e.date) return;
    await apply({
      emoji,
      text,
      dnd: e.dnd,
      clearAt: clearAt(e.clearAfter, e.date),
      preset: e.preset,
    });
  };

  const forget = (id: string) =>
    void run(() => forgetStatus(id), "Couldn't forget that status.").then(loadSaved);

  const dnd = !!mine?.dnd;
  const full = (saved?.length ?? 0) >= SAVED_STATUSES_MAX;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        data-slot="status-menu-trigger"
        className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-avatar border border-border bg-muted text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={mine ? `Your status: ${statusLine(mine)}` : "Your status and settings"}
      >
        <Avatar size="sm" className="size-full">
          {avatarDataUrl ? <AvatarImage src={avatarDataUrl} alt="" /> : null}
          <AvatarFallback>{profileInitial}</AvatarFallback>
        </Avatar>
        {dnd ? <PresenceBadge state="dnd" /> : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-1 p-1" data-slot="status-menu">
        {editor ? (
          <StatusEditor
            editor={editor}
            busy={busy}
            onChange={setEditor}
            onCancel={() => setEditor(null)}
            onSubmit={() => void submit(editor)}
          />
        ) : (
          <>
            {mine ? (
              <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {statusLine(mine)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(clearMyStatus, "Couldn't clear your status.").then(() =>
                      setOpen(false),
                    )
                  }
                >
                  Clear
                </Button>
              </div>
            ) : null}
            <button
              type="button"
              className={ROW}
              disabled={busy}
              onClick={() => {
                if (!dnd || !mine) {
                  setOpen(false);
                  return;
                }
                // Back to active: a status with words keeps them, only do not
                // disturb goes; do not disturb by hand (no words) clears.
                if (mine.emoji || mine.text) {
                  void apply({
                    emoji: mine.emoji,
                    text: mine.text,
                    dnd: false,
                    clearAt: mine.clearAt,
                    preset: mine.preset,
                  });
                  return;
                }
                void run(clearMyStatus, "Couldn't clear your status.").then(() => setOpen(false));
              }}
            >
              <PresenceBadge state="reachable" inline />
              <span className="flex-1">Active</span>
              <span className="text-xs text-subtle-foreground">automatic</span>
            </button>
            <div className={cn(ROW, "hover:bg-transparent")}>
              <PresenceBadge state="dnd" inline />
              <span className="flex-1">Do not disturb</span>
              <span className="flex items-center gap-1 text-xs">
                <button
                  type="button"
                  className="rounded-sm px-1 text-muted-foreground hover:bg-state-hover hover:text-foreground"
                  disabled={busy}
                  onClick={() => void dndFor("1h")}
                >
                  1 h
                </button>
                <button
                  type="button"
                  className="rounded-sm px-1 text-muted-foreground hover:bg-state-hover hover:text-foreground"
                  disabled={busy}
                  onClick={() => void dndFor("today")}
                >
                  today
                </button>
                <button
                  type="button"
                  className="rounded-sm px-1 text-muted-foreground hover:bg-state-hover hover:text-foreground"
                  disabled={busy}
                  onClick={() => setEditor({ ...BLANK, dnd: true, clearAfter: "date" })}
                >
                  until…
                </button>
              </span>
            </div>
            <button
              type="button"
              className={cn(ROW, "bg-state-hover text-muted-foreground")}
              onClick={() => setEditor({ ...BLANK })}
            >
              <span aria-hidden className="w-4.5 text-center">
                ☺
              </span>
              What's your status?
            </button>

            <MenuHeading>Moduo's</MenuHeading>
            {PRESET_ORDER.map((p) => {
              const d = STATUS_PRESET_DEFAULTS[p];
              return (
                <button
                  key={p}
                  type="button"
                  className={ROW}
                  data-preset={p}
                  disabled={busy}
                  onClick={() => pickPreset(p)}
                >
                  <span aria-hidden className="w-4.5 text-center">
                    {d.emoji}
                  </span>
                  <span className="flex-1 truncate">{d.text}</span>
                  <span className="text-xs text-subtle-foreground">
                    {clearAfterHint(d.clearAfter, d.dnd)}
                  </span>
                </button>
              );
            })}

            {saved && saved.length > 0 ? <MenuHeading>Yours</MenuHeading> : null}
            {saved?.map((s) => (
              <div key={s.id} className="group/saved flex items-center">
                <button
                  type="button"
                  className={cn(ROW, "flex-1")}
                  data-saved={s.id}
                  disabled={busy}
                  onClick={() => pickSaved(s)}
                >
                  <span aria-hidden className="w-4.5 text-center">
                    {s.emoji ?? ""}
                  </span>
                  <span className="flex-1 truncate">{s.text ?? "Do not disturb"}</span>
                  <span className="text-xs text-subtle-foreground">
                    {clearAfterHint(s.clearAfter, s.dnd)}
                  </span>
                </button>
                <IconButton
                  icon={X}
                  size="sm"
                  label={`Forget “${s.text ?? s.emoji ?? "status"}”`}
                  className="opacity-0 group-hover/saved:opacity-100 focus-visible:opacity-100"
                  onClick={() => forget(s.id)}
                />
              </div>
            ))}
            <button
              type="button"
              className={cn(ROW, "text-muted-foreground")}
              disabled={full}
              title={full ? "You can save up to 20 statuses." : undefined}
              onClick={() => setEditor({ ...BLANK, mode: "save", clearAfter: "never" })}
            >
              Save a new status…
            </button>

            <div className="my-1 h-px bg-hairline" aria-hidden />
            <button
              type="button"
              className={ROW}
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <Settings aria-hidden className="size-icon text-muted-foreground" />
              Settings
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MenuHeading({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pt-2 pb-1 text-xs font-medium text-subtle-foreground">{children}</p>;
}

function StatusEditor({
  editor,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  editor: Editor;
  busy: boolean;
  onChange: (e: Editor) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const set = (patch: Partial<Editor>) => onChange({ ...editor, ...patch });
  const empty = !editor.emoji.trim() && !editor.text.trim() && !editor.dnd;
  const needsDate = editor.mode === "set" && editor.clearAfter === "date" && !editor.date;
  return (
    <form
      className="flex flex-col gap-2 p-2"
      data-slot="status-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!empty && !needsDate) onSubmit();
      }}
    >
      <p className="text-sm font-medium text-foreground">
        {editor.mode === "save" ? "Save a status" : "Set your status"}
      </p>
      <div className="flex gap-2">
        <Input
          aria-label="Emoji"
          placeholder="☺"
          value={editor.emoji}
          maxLength={16}
          className="w-12 text-center"
          onChange={(e) => set({ emoji: e.target.value, preset: null })}
        />
        <Input
          autoFocus
          aria-label="What's your status?"
          placeholder="What's your status?"
          value={editor.text}
          maxLength={STATUS_TEXT_MAX}
          className="flex-1"
          onChange={(e) => set({ text: e.target.value, preset: null })}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Clear after</span>
        <Select
          value={editor.clearAfter}
          onValueChange={(v) => set({ clearAfter: v as StatusClearAfter })}
        >
          <SelectTrigger size="sm" aria-label="Clear after" className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_CLEAR_AFTER.filter((c) => editor.mode === "set" || c !== "date").map((c) => (
              <SelectItem key={c} value={c}>
                {CLEAR_AFTER_WORDS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {editor.mode === "set" && editor.clearAfter === "date" ? (
        <DateField
          value={editor.date}
          onChange={(d) => set({ date: d })}
          placeholder="Pick a date"
          variant="outline"
        />
      ) : null}
      <label htmlFor="status-dnd" className="flex items-center gap-2 text-sm text-foreground">
        <Checkbox
          id="status-dnd"
          checked={editor.dnd}
          onCheckedChange={(v) => set({ dnd: v === true })}
        />
        Do not disturb while it's on
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" size="sm" disabled={busy || empty || needsDate}>
          {editor.mode === "save" ? "Save" : "Set status"}
        </Button>
      </div>
    </form>
  );
}
