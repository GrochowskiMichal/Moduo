// The message composer — one component for the channel, a thread, and inline
// edit (specs/chat.md §Composer).
//
// Plain-text-with-markup on purpose (Slack's "markup mode"): it's fast, it
// pastes cleanly, and what you see is what's stored. Three autocompletes open
// at the caret: `@` people (+ @channel), `#` any Moduo item (task, note,
// contact, event … via the spine registry — the link-from-anywhere moat), and
// `:` emoji. Enter sends, Shift+Enter breaks a line, ↑ on an empty composer
// edits your last message, Esc cancels an edit.

import {
  AtSign,
  Bold,
  Code,
  Hash,
  Italic,
  Quote,
  SendHorizontal,
  Smile,
  SquareCode,
  Strikethrough,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMentionSearch } from "@/features/spine/hooks/use-mention-search";
import { resolveEntityIcon } from "@/features/spine/icon-map";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";
import { searchEmoji } from "../emoji";
import { activeTrigger, type ComposerPick } from "../markup";
import type { ChatPerson } from "../model";
import { EmojiPicker } from "./emoji-picker";
import { PersonAvatar } from "./person-avatar";

const MAX_LEN = 8000;
const MAX_ROWS_PX = 240;

type Suggestion =
  | { kind: "person"; person: ChatPerson; key: string }
  | { kind: "channel"; key: string }
  | { kind: "entity"; type: string; id: string; label: string; icon: string | null; key: string }
  | { kind: "emoji"; emoji: string; name: string; key: string };

function readDraft(key: string | undefined): { text: string; picks: ComposerPick[] } | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(`moduo:chat:draft:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { text?: unknown; picks?: unknown };
    if (typeof parsed.text !== "string") return null;
    return {
      text: parsed.text,
      picks: Array.isArray(parsed.picks) ? (parsed.picks as ComposerPick[]) : [],
    };
  } catch {
    return null;
  }
}

function writeDraft(key: string | undefined, text: string, picks: ComposerPick[]): void {
  if (!key) return;
  try {
    const k = `moduo:chat:draft:${key}`;
    if (text.trim()) window.localStorage.setItem(k, JSON.stringify({ text, picks }));
    else window.localStorage.removeItem(k);
  } catch {
    /* storage disabled */
  }
}

export type ComposerProps = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  selfId: string | null;
  people: ChatPerson[];
  placeholder: string;
  onSubmit: (text: string, picks: ComposerPick[]) => void;
  /** Persist an unsent draft under this key (channel / thread id). */
  draftKey?: string;
  /** Edit mode: start from this text, show Save/Cancel. */
  initial?: { text: string; picks: ComposerPick[] };
  onCancel?: () => void;
  /** ↑ in an empty composer. */
  onEditLast?: () => void;
  onTyping?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Who's typing here — rendered above the box, quietly. */
  typingLine?: string | null;
  compact?: boolean;
};

export function Composer({
  runtime,
  workspaceId,
  selfId,
  people,
  placeholder,
  onSubmit,
  draftKey,
  initial,
  onCancel,
  onEditLast,
  onTyping,
  autoFocus,
  disabled,
  disabledReason,
  typingLine,
  compact,
}: ComposerProps) {
  const editing = Boolean(initial);
  const [text, setText] = useState(() => initial?.text ?? readDraft(draftKey)?.text ?? "");
  const [picks, setPicks] = useState<ComposerPick[]>(
    () => initial?.picks ?? readDraft(draftKey)?.picks ?? [],
  );
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Swap drafts when the conversation changes (same component instance).
  const lastKey = useRef(draftKey);
  useEffect(() => {
    if (editing || lastKey.current === draftKey) return;
    lastKey.current = draftKey;
    const d = readDraft(draftKey);
    setText(d?.text ?? "");
    setPicks(d?.picks ?? []);
  }, [draftKey, editing]);

  useEffect(() => {
    if (editing) return;
    const t = setTimeout(() => writeDraft(draftKey, text, picks), 250);
    return () => clearTimeout(t);
  }, [draftKey, text, picks, editing]);

  // Autosize.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [text]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus, draftKey]);

  // ── autocomplete ──────────────────────────────────────────────────────────
  const trigger = useMemo(() => {
    const t = activeTrigger(text, caret);
    if (!t || t.start === dismissedAt) return null;
    return t;
  }, [text, caret, dismissedAt]);

  const entitySearch = useMentionSearch({
    runtime,
    workspaceId,
    trigger: "ref",
    includePeople: false,
    enabled: trigger?.trigger === "#",
  });
  const setEntityQuery = entitySearch.setQuery;
  useEffect(() => {
    if (trigger?.trigger === "#") setEntityQuery(trigger.query);
  }, [trigger, setEntityQuery]);

  const suggestions: Suggestion[] = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    if (trigger.trigger === "@") {
      const list: Suggestion[] = people
        .filter((p) => p.userId !== selfId && p.name.toLowerCase().includes(q))
        .sort(
          (a, b) =>
            Number(!a.name.toLowerCase().startsWith(q)) -
            Number(!b.name.toLowerCase().startsWith(q)),
        )
        .slice(0, 6)
        .map((person) => ({ kind: "person", person, key: `p:${person.userId}` }));
      if ("channel".startsWith(q) || "here".startsWith(q))
        list.push({ kind: "channel", key: "channel" });
      return list;
    }
    if (trigger.trigger === "#") {
      return entitySearch.candidates
        .filter((c) => c.kind === "entity")
        .slice(0, 8)
        .map((c) =>
          c.kind === "entity"
            ? {
                kind: "entity",
                type: c.ref.type,
                id: c.ref.id,
                label: c.label,
                icon: c.icon,
                key: `e:${c.ref.type}:${c.ref.id}`,
              }
            : (null as never),
        );
    }
    return searchEmoji(q, 8).map((e) => ({
      kind: "emoji",
      emoji: e.e,
      name: e.n[0] ?? "",
      key: `m:${e.e}`,
    }));
  }, [trigger, people, selfId, entitySearch.candidates]);

  useEffect(() => setHighlight(0), [trigger?.trigger, trigger?.query]);

  const replaceRange = useCallback((start: number, end: number, insert: string) => {
    setText((prev) => prev.slice(0, start) + insert + prev.slice(end));
    const pos = start + insert.length;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }, []);

  const accept = useCallback(
    (s: Suggestion) => {
      if (!trigger) return;
      const end = trigger.start + 1 + trigger.query.length;
      if (s.kind === "person") {
        replaceRange(trigger.start, end, `@${s.person.name} `);
        setPicks((prev) => [
          ...prev.filter((p) => !(p.kind === "person" && p.userId === s.person.userId)),
          { kind: "person", userId: s.person.userId, label: s.person.name },
        ]);
      } else if (s.kind === "channel") {
        replaceRange(trigger.start, end, "@channel ");
      } else if (s.kind === "entity") {
        replaceRange(trigger.start, end, `#${s.label} `);
        setPicks((prev) => [...prev, { kind: "entity", type: s.type, id: s.id, label: s.label }]);
      } else {
        replaceRange(trigger.start, end, `${s.emoji} `);
      }
    },
    [trigger, replaceRange],
  );

  // ── formatting ────────────────────────────────────────────────────────────
  const wrap = useCallback((before: string, after = before, block = false) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const selected = value.slice(s, e);
    let insert: string;
    if (block) {
      const pad = s > 0 && value[s - 1] !== "\n" ? "\n" : "";
      insert = `${pad}${before}${selected || ""}${after}`;
    } else {
      insert = `${before}${selected}${after}`;
    }
    const next = value.slice(0, s) + insert + value.slice(e);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const inner = s + insert.length - after.length;
      el.setSelectionRange(
        selected ? s + insert.length : inner,
        selected ? s + insert.length : inner,
      );
    });
  }, []);

  const quote = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const segment = value.slice(lineStart, e);
    const quoted = segment
      .split("\n")
      .map((l) => (l.startsWith("> ") ? l : `> ${l}`))
      .join("\n");
    setText(value.slice(0, lineStart) + quoted + value.slice(e));
    requestAnimationFrame(() => el.focus());
  }, []);

  const insertAtCaret = useCallback(
    (insert: string) => {
      const el = ref.current;
      const s = el?.selectionStart ?? text.length;
      const e = el?.selectionEnd ?? text.length;
      replaceRange(s, e, insert);
    },
    [text.length, replaceRange],
  );

  // ── submit ────────────────────────────────────────────────────────────────
  const tooLong = text.length > MAX_LEN;
  const canSend = !disabled && text.trim().length > 0 && !tooLong;

  const submit = useCallback(() => {
    if (!canSend) return;
    // Keep only picks whose visible text survived editing.
    const live = picks.filter((p) => text.includes(`${p.kind === "person" ? "@" : "#"}${p.label}`));
    onSubmit(text, live);
    if (!editing) {
      setText("");
      setPicks([]);
      writeDraft(draftKey, "", []);
    }
  }, [canSend, picks, text, onSubmit, editing, draftKey]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const d = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((h) => (h + d + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const s = suggestions[highlight];
        if (s) accept(s);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissedAt(trigger?.start ?? null);
        return;
      }
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "b") {
      event.preventDefault();
      wrap("**");
      return;
    }
    if (mod && event.key.toLowerCase() === "i") {
      event.preventDefault();
      wrap("_");
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === "x") {
      event.preventDefault();
      wrap("~~");
      return;
    }
    if (mod && event.key.toLowerCase() === "e") {
      event.preventDefault();
      wrap("`");
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      // Inside an open ``` block, Enter is a newline (code wants line breaks).
      const fences = (text.slice(0, caret).match(/```/g) ?? []).length;
      if (fences % 2 === 1) return;
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Escape" && editing) {
      event.preventDefault();
      event.stopPropagation();
      onCancel?.();
      return;
    }
    if (event.key === "ArrowUp" && !editing && text === "" && onEditLast) {
      event.preventDefault();
      onEditLast();
    }
  };

  const fmtButtons = [
    { icon: Bold, label: "Bold (⌘B)", run: () => wrap("**") },
    { icon: Italic, label: "Italic (⌘I)", run: () => wrap("_") },
    { icon: Strikethrough, label: "Strikethrough (⌘⇧X)", run: () => wrap("~~") },
    { icon: Code, label: "Code (⌘E)", run: () => wrap("`") },
    { icon: SquareCode, label: "Code block", run: () => wrap("```\n", "\n```", true) },
    { icon: Quote, label: "Quote", run: quote },
  ];

  return (
    <div className="relative flex flex-col gap-1">
      {/* Typing line: reserved height so the box never jumps (R6). */}
      {!editing ? (
        <div
          className="h-4 px-1 text-2xs text-muted-foreground transition-opacity duration-(--motion-fade)"
          style={{ opacity: typingLine ? 1 : 0 }}
          aria-live="polite"
        >
          {typingLine ?? ""}
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <div
          role="listbox"
          aria-label="Suggestions"
          className="absolute right-0 bottom-full left-0 mb-1 flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground"
          style={{ zIndex: "var(--z-popover)", boxShadow: "var(--shadow-md)" }}
        >
          <span className="px-2 pt-1 pb-0.5 text-2xs text-muted-foreground">
            {trigger?.trigger === "@"
              ? "People"
              : trigger?.trigger === "#"
                ? "Link a Moduo item"
                : "Emoji"}
          </span>
          {suggestions.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => accept(s)}
              className={cn(
                "flex min-h-(--row-h) items-center gap-2 rounded-md px-2 text-left text-sm",
                i === highlight ? "bg-accent text-foreground" : "text-foreground",
              )}
            >
              {s.kind === "person" ? (
                <>
                  <PersonAvatar person={s.person} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{s.person.name}</span>
                </>
              ) : s.kind === "channel" ? (
                <>
                  <AtSign className="size-icon-sm text-muted-foreground" aria-hidden />
                  <span className="flex-1">@channel</span>
                  <span className="text-2xs text-muted-foreground">Notify everyone here</span>
                </>
              ) : s.kind === "entity" ? (
                <EntitySuggestion type={s.type} label={s.label} icon={s.icon} />
              ) : (
                <>
                  <span className="text-lg leading-none">{s.emoji}</span>
                  <span className="text-muted-foreground">:{s.name}:</span>
                </>
              )}
            </button>
          ))}
          {trigger?.trigger === "#" && entitySearch.loading && suggestions.length === 0 ? (
            <span className="px-2 py-1 text-xs text-muted-foreground">Searching…</span>
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          "flex flex-col rounded-lg border border-border bg-background transition-colors focus-within:border-ring",
          disabled && "opacity-60",
        )}
      >
        <textarea
          ref={ref}
          value={text}
          disabled={disabled}
          rows={1}
          aria-label={placeholder}
          placeholder={disabled ? (disabledReason ?? placeholder) : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setDismissedAt(null);
            if (e.target.value) onTyping?.();
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onBlur={() => setDismissedAt(trigger?.start ?? null)}
          className={cn(
            "scrollbar-thin w-full resize-none bg-transparent px-3 font-sans text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none",
            compact ? "pt-2 pb-1" : "pt-2.5 pb-1.5",
          )}
        />
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          {fmtButtons.map((b) => (
            <IconButton
              key={b.label}
              icon={b.icon}
              label={b.label}
              onClick={b.run}
              disabled={disabled}
              tooltipSide="top"
            />
          ))}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <IconButton
            icon={AtSign}
            label="Mention someone"
            onClick={() => insertAtCaret("@")}
            disabled={disabled}
            tooltipSide="top"
          />
          <IconButton
            icon={Hash}
            label="Link a task, note or contact"
            onClick={() => insertAtCaret("#")}
            disabled={disabled}
            tooltipSide="top"
          />
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Insert emoji"
                disabled={disabled}
                style={{ height: "var(--ctrl-h-sm)", width: "var(--ctrl-h-sm)" }}
              >
                <Smile aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-auto p-2">
              <EmojiPicker
                onPick={(emoji) => {
                  setEmojiOpen(false);
                  insertAtCaret(emoji);
                }}
              />
            </PopoverContent>
          </Popover>
          <span className="flex-1" />
          {tooLong ? (
            <span className="mr-2 text-2xs text-danger tabular-nums">{MAX_LEN - text.length}</span>
          ) : null}
          {editing ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancel}
                style={{ height: "var(--ctrl-h-sm)" }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={!canSend}
                style={{ height: "var(--ctrl-h-sm)" }}
              >
                Save
              </Button>
            </div>
          ) : (
            <IconButton
              icon={SendHorizontal}
              label="Send (Enter)"
              variant={canSend ? "default" : "ghost"}
              onClick={submit}
              disabled={!canSend}
              tooltipSide="top"
            />
          )}
        </div>
      </div>
      {editing ? (
        <p className="px-1 text-2xs text-muted-foreground">
          <Kbd>Esc</Kbd> to cancel · <Kbd>Enter</Kbd> to save
        </p>
      ) : null}
    </div>
  );
}

function EntitySuggestion({
  type,
  label,
  icon,
}: {
  type: string;
  label: string;
  icon: string | null;
}) {
  const Icon = resolveEntityIcon(type, icon);
  return (
    <>
      <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-2xs text-muted-foreground capitalize">{type.replace(/_/g, " ")}</span>
    </>
  );
}
