// The chat composer (specs/chat-v2.md §4, §16; round 5 frames 5 and 6; CV-7b).
//
// One row at rest: `+` · the text · `@` · emoji · send. Past one line the text
// takes the full width and the tools drop into a row below (until it's empty
// again). It's the shared Lexical editor with RF-1's menus: `@` people first,
// then `@channel`, then things; `#` tags; `/` commands (`/task` `/note`
// `/event` open the app's capture and put the new item's chip here; the date
// commands make date chips); `:` emoji. It saves the stored form (a Markdown
// subset with `moduo://` references, never a title) and reads it back for an
// edit, so what you sent is what you edit. ⏎ sends (never during IME
// composition), ⇧⏎ makes a new line, ↑ in an empty composer edits your last
// message, Esc in an empty one moves to the newest message. The same component
// edits a message in place (`mode="edit"`: ⏎ saves, Esc cancels).

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  type LexicalEditor,
  type RangeSelection,
} from "lexical";
import { AtSign, Plus, SendHorizontal, Smile } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { FEED_COMPOSER_FILLED } from "@/components/ui/feed";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MentionMenuPlugin } from "@/features/spine/editor/mention-menu-plugin";
import type { MentionCandidate } from "@/features/spine/mention";
import { ReferenceViewOverrideProvider } from "@/features/spine/references/mention-view";
import { $createReferenceNode } from "@/features/spine/references/reference-node";
import { WorkspaceContext } from "@/features/workspaces/workspace-context";
import { CAPTURE_TYPES } from "@/lib/capture-registry";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";
import {
  $exportStored,
  $importStored,
  CHAT_EDITOR_NODES,
  chatReferenceDisplay,
} from "../markup-v2/lexical";
import { PERSON_TYPE } from "../markup-v2/types";
import type { ChatPerson } from "../model";
import { Mention } from "../stream/message-body";
import { openCreateCapture } from "./capture";
import { ChatEmojiPicker } from "./emoji-picker";
import {
  CREATE_COMMANDS,
  type CreateCommand,
  createCommandsFor,
  limitCopy,
  MESSAGE_LIMIT,
  offersChannel,
  overLimit,
  peopleFor,
} from "./grammar";
import {
  CHAT_TRANSFORMERS,
  CleanPastePlugin,
  ComposerKeysPlugin,
  ComposerStatePlugin,
  EmojiTypeaheadPlugin,
  focusAtEnd,
  SelectionFormatPlugin,
} from "./plugins";
import { PlusMenu, type PlusPick } from "./plus-menu";

/** Tokens-only theme for the editor's nodes (what a sent row draws, roughly). */
const THEME = {
  paragraph: "m-0",
  quote: "my-0.5 border-l-2 border-border pl-3 text-muted-foreground",
  code: "my-0.5 block rounded-md bg-state-active px-2 py-1 font-mono text-sm whitespace-pre-wrap",
  list: {
    ul: "my-0.5 list-disc pl-5",
    ol: "my-0.5 list-decimal pl-5",
    listitem: "",
  },
  link: "text-foreground underline decoration-muted-foreground underline-offset-2",
  text: {
    bold: "font-semibold",
    italic: "italic",
    strikethrough: "line-through",
    code: "rounded-sm bg-state-active px-1 font-mono text-sm",
  },
};

/** Show the count once a message gets this close to the limit. */
const COUNT_FROM = MESSAGE_LIMIT - 500;

export type ChatComposerHandle = {
  focus: () => void;
  /** Put text at the caret (the emoji button, "any emoji"). */
  insertText: (text: string) => void;
};

export type ChatComposerProps = {
  mode?: "message" | "edit";
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  selfId: string | null;
  /** Who `@` offers (the workspace's people, as chat knows them). */
  people: readonly ChatPerson[];
  placeholder: string;
  /** The stored text it opens with: the conversation's draft, or the message being edited. */
  initial?: string;
  autoFocus?: boolean;
  /** ⏎: the stored text to send (message) or save (edit). `false`: not sent, keep it. */
  onSend: (stored: string) => boolean | void;
  /** The stored text as it changes, for the conversation's draft (message mode). */
  onDraftChange?: (stored: string) => void;
  /** Typing started (true, at most every few seconds by the caller) or stopped (false). */
  onTyping?: (active: boolean) => void;
  onEditLast?: () => void;
  onEscapeEmpty?: () => void;
  onCancel?: () => void;
  /** A line under the box (the `@channel` note after a send). */
  note?: string | null;
  className?: string;
};

/** Put the caret back where it was (`saved`), else keep the live one, else at the end. */
function $restoreOrEnd(saved: RangeSelection | null): void {
  const anchor = saved ? $getNodeByKey(saved.anchor.key) : null;
  const focus = saved ? $getNodeByKey(saved.focus.key) : null;
  if (saved && anchor?.isAttached() && focus?.isAttached()) {
    $setSelection(saved.clone());
    return;
  }
  if (!saved && $isRangeSelection($getSelection())) return;
  $getRoot().selectEnd();
}

/** Insert a reference (and a space after it) at the caret. */
function $insertRef(type: string, id: string): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  selection.insertNodes([
    $createReferenceNode({
      entityType: type,
      entityId: id,
      display: chatReferenceDisplay(type, false),
    }),
    $createTextNode(" "),
  ]);
}

function EditorHandle({ onEditor }: { onEditor: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => onEditor(editor), [editor, onEditor]);
  return null;
}

function BlurPlugin({ onBlur }: { onBlur: () => void }) {
  const [editor] = useLexicalComposerContext();
  const ref = useRef(onBlur);
  ref.current = onBlur;
  useEffect(
    () =>
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          ref.current();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor],
  );
  return null;
}

/**
 * The caret a just-made item's chip left (after it): the capture closing hands
 * focus back to the box a moment later, and the browser would put the caret at
 * its start, so the next words would land before the chip.
 */
function CaretAfterChipPlugin({ pending }: { pending: React.RefObject<RangeSelection | null> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          const caret = pending.current;
          pending.current = null;
          if (caret) queueMicrotask(() => editor.update(() => $restoreOrEnd(caret)));
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, pending],
  );
  return null;
}

const ToolButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    keys?: string;
    onClick?: () => void;
    children: React.ReactNode;
    className?: string;
  }
>(function ToolButton({ label, keys, onClick, children, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={keys ? `${label}  ${keys}` : label}
      onClick={onClick}
      // Keep the caret in the text (the emoji or chip goes where it was).
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "grid size-(--ctrl-h-sm) shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-active hover:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
  {
    mode = "message",
    runtime,
    workspaceId,
    selfId,
    people,
    placeholder,
    initial = "",
    autoFocus,
    onSend,
    onDraftChange,
    onTyping,
    onEditLast,
    onEscapeEmpty,
    onCancel,
    note,
    className,
  },
  ref,
) {
  const editorRef = useRef<LexicalEditor | null>(null);
  // What an untouched edit exports (a body written elsewhere may not be in the
  // canonical form): ⏎ on it saves nothing.
  const baseline = useRef<string | null>(null);
  const setEditor = useCallback((editor: LexicalEditor) => {
    editorRef.current = editor;
    baseline.current = editor.getEditorState().read($exportStored);
  }, []);
  const [empty, setEmpty] = useState(() => initial.trim() === "");
  const [grown, setGrown] = useState(() => initial.includes("\n"));
  const [count, setCount] = useState(initial.length);
  const [error, setError] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const menus = useRef(new Set<string>());
  const menuOpen = useCallback(() => menus.current.size > 0, []);
  const trackMenu = useCallback(
    (name: string) => (open: boolean) => {
      if (open) menus.current.add(name);
      else menus.current.delete(name);
    },
    [],
  );
  const savedSelection = useRef<RangeSelection | null>(null);
  const caretAfterChip = useRef<RangeSelection | null>(null);

  // Who may create what (their module's Edit), as the capture decides.
  const modulePermissions = useContext(WorkspaceContext)?.modulePermissions;
  const canCreate = useCallback(
    (command: CreateCommand) =>
      !!modulePermissions &&
      CAPTURE_TYPES.some((t) => t.type === command && t.canWrite(modulePermissions)),
    [modulePermissions],
  );

  // Seeded once per mount (a conversation switch remounts it with its draft).
  const [initialConfig] = useState(() => ({
    namespace: mode === "edit" ? "chat-edit" : "chat-composer",
    nodes: [...CHAT_EDITOR_NODES],
    theme: THEME,
    onError: (error: Error) => console.error("Chat composer:", error),
    editorState: () => $importStored(initial),
  }));

  // ── drafts and typing ───────────────────────────────────────────────────
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<string | null>(null);
  const live = useRef({ onDraftChange, onTyping });
  live.current = { onDraftChange, onTyping };
  const flushDraft = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    if (pendingDraft.current !== null) live.current.onDraftChange?.(pendingDraft.current);
    pendingDraft.current = null;
  }, []);
  useEffect(() => flushDraft, [flushDraft]);

  const onState = useCallback(
    (state: { stored: string; empty: boolean; multiline: boolean }) => {
      setEmpty(state.empty);
      setCount(state.stored.length);
      setError(null);
      if (state.empty) setGrown(false);
      else if (state.multiline) setGrown(true);
      if (mode !== "message") return;
      pendingDraft.current = state.empty ? "" : state.stored;
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(flushDraft, 400);
      live.current.onTyping?.(!state.empty);
    },
    [mode, flushDraft],
  );

  // Past one line of wrapped text the tools drop below (and stay until empty).
  const textRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = textRef.current;
    if (!el || grown || typeof ResizeObserver === "undefined") return;
    const check = () => {
      const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 22;
      if (el.scrollHeight > line * 1.6 + 8) setGrown(true);
    };
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [grown]);

  // ── sending ─────────────────────────────────────────────────────────────
  const send = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const stored = editor.getEditorState().read($exportStored);
    if (!stored.trim()) {
      if (mode === "edit") onCancel?.();
      return;
    }
    const over = overLimit(stored);
    if (over !== null) {
      setError(limitCopy(over));
      return;
    }
    if (mode === "edit") {
      if (stored === initial || stored === baseline.current) onCancel?.();
      else onSend(stored);
      return;
    }
    // Nothing could be sent (no store yet): the text stays.
    if (onSend(stored) === false) return;
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
        root.selectEnd();
      },
      { discrete: true },
    );
    pendingDraft.current = "";
    flushDraft();
    live.current.onTyping?.(false);
    setGrown(false);
  }, [mode, initial, onCancel, onSend, flushDraft]);

  // ── inserting: chips, emoji, captures ───────────────────────────────────
  const insertAt = useCallback((saved: RangeSelection | null, run: () => void) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.update(() => {
      $restoreOrEnd(saved);
      run();
    });
  }, []);

  /** A menu closed: back to the text, unless focus already went to another one. */
  const backToText = useCallback((e: Event) => {
    e.preventDefault();
    if (document.activeElement?.closest("[data-radix-popper-content-wrapper]")) return;
    editorRef.current?.focus();
  }, []);

  const rememberCaret = useCallback(() => {
    const editor = editorRef.current;
    savedSelection.current =
      editor?.getEditorState().read(() => {
        const s = $getSelection();
        return $isRangeSelection(s) ? s.clone() : null;
      }) ?? null;
  }, []);

  /** Open the app's capture as `command`, and put the new item's chip where the caret was. */
  const openCreate = useCallback(
    (command: CreateCommand, title: string, saved: RangeSelection | null) => {
      openCreateCapture(command, title, (made) => {
        insertAt(saved, () => {
          $insertRef(made.type, made.id);
          const after = $getSelection();
          caretAfterChip.current = $isRangeSelection(after) ? after.clone() : null;
        });
        // Only for the focus the closing capture hands back.
        window.setTimeout(() => {
          caretAfterChip.current = null;
        }, 1_000);
      });
    },
    [insertAt],
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        const editor = editorRef.current;
        if (editor) focusAtEnd(editor);
      },
      insertText: (text: string) =>
        insertAt(null, () => {
          const s = $getSelection();
          if ($isRangeSelection(s)) s.insertText(text);
        }),
    }),
    [insertAt],
  );

  useEffect(() => {
    if (!autoFocus) return;
    const id = window.setTimeout(() => {
      const editor = editorRef.current;
      if (editor) focusAtEnd(editor);
    }, 0);
    return () => window.clearTimeout(id);
  }, [autoFocus]);

  // ── the grammar's menus ─────────────────────────────────────────────────
  const mentionable = useMemo(
    () => people.filter((p) => !p.former).map((p) => ({ id: p.userId, name: p.name })),
    [people],
  );
  const personOf = useMemo(() => new Map(people.map((p) => [p.userId, p])), [people]);

  const atCandidates = useCallback(
    (query: string, found: MentionCandidate[]): MentionCandidate[] => [
      ...peopleFor(mentionable, query, selfId).map(
        (p): MentionCandidate => ({ kind: "person", memberId: p.id, label: p.name, icon: null }),
      ),
      ...(offersChannel(query)
        ? [
            {
              kind: "action",
              id: "channel",
              label: "@channel",
              hint: "Everyone here",
              icon: AtSign,
            } satisfies MentionCandidate,
          ]
        : []),
      ...found.filter((c) => c.kind !== "person"),
    ],
    [mentionable, selfId],
  );
  const atPick = useCallback((candidate: MentionCandidate) => {
    if (candidate.kind === "person") {
      return (api: { removeQuery: () => void }) => {
        api.removeQuery();
        $insertRef(PERSON_TYPE, candidate.memberId);
      };
    }
    if (candidate.kind === "action" && candidate.id === "channel") {
      return (api: { removeQuery: () => void; insert: (n: never[]) => void }) => {
        api.removeQuery();
        const s = $getSelection();
        if ($isRangeSelection(s)) s.insertText("@channel ");
      };
    }
    return null;
  }, []);

  const slashCandidates = useCallback(
    (query: string, found: MentionCandidate[]): MentionCandidate[] => [
      ...createCommandsFor(query)
        .filter((c) => canCreate(c.id))
        .map(
          (c): MentionCandidate => ({
            kind: "action",
            id: `create:${c.id}`,
            label: c.title
              ? `${CREATE_COMMANDS.find((x) => x.id === c.id)?.label ?? c.id} “${c.title}”`
              : `/${c.id}`,
            hint: "Create, linked",
          }),
        ),
      ...found,
    ],
    [canCreate],
  );
  const slashPick = useCallback(
    (candidate: MentionCandidate) => {
      if (candidate.kind !== "action" || !candidate.id.startsWith("create:")) return null;
      const command = candidate.id.slice("create:".length) as CreateCommand;
      const title = candidate.label.match(/“(.*)”$/)?.[1] ?? "";
      return (api: { removeQuery: () => void }) => {
        api.removeQuery();
        const s = $getSelection();
        const saved = $isRangeSelection(s) ? s.clone() : null;
        queueMicrotask(() => openCreate(command, title, saved));
      };
    },
    [openCreate],
  );

  const drawPerson = useCallback(
    (type: string, id: string) =>
      type === PERSON_TYPE ? (
        <Mention label={`@${personOf.get(id)?.name ?? "former member"}`} me={id === selfId} />
      ) : null,
    [personOf, selfId],
  );

  const onPlusPick = (pick: PlusPick) => {
    setPlusOpen(false);
    const saved = savedSelection.current;
    if (pick.kind === "ref") insertAt(saved, () => $insertRef(pick.type, pick.id));
    else openCreate(pick.command, "", saved);
  };

  const origins = useMemo(
    () =>
      typeof window === "undefined"
        ? []
        : [
            window.location.origin,
            ((import.meta.env.PUBLIC_WEB_ORIGIN as string | undefined) ?? "").replace(/\/+$/, ""),
          ].filter(Boolean),
    [],
  );

  const shared = {
    runtime,
    workspaceId,
    source: null,
    currentUserId: selfId,
    storeLabel: false,
    cards: true,
    showAs: false,
    includeProjects: true,
  } as const;

  const showCount = count > COUNT_FROM;
  const message = mode === "message";

  return (
    <ReferenceViewOverrideProvider value={drawPerson}>
      <LexicalComposer initialConfig={initialConfig}>
        <div className={cn("flex flex-col", className)}>
          <div
            data-composer-box
            className={cn(
              FEED_COMPOSER_FILLED,
              "relative flex flex-wrap items-center gap-1",
              grown ? "px-1.5 pt-1.5 pb-1" : "min-h-10 px-1.5 py-1",
            )}
          >
            {message ? (
              <Popover
                open={plusOpen}
                onOpenChange={(open) => {
                  if (open) rememberCaret();
                  setPlusOpen(open);
                }}
              >
                <PopoverTrigger asChild>
                  <ToolButton label="Add: link or create" className="order-1">
                    <Plus className="size-icon" aria-hidden />
                  </ToolButton>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  className="w-auto p-0"
                  onCloseAutoFocus={backToText}
                >
                  <PlusMenu
                    runtime={runtime}
                    workspaceId={workspaceId}
                    selfId={selfId}
                    people={people}
                    canCreate={canCreate}
                    onPick={onPlusPick}
                  />
                </PopoverContent>
              </Popover>
            ) : null}
            <div
              ref={textRef}
              className={cn(
                "relative min-w-0",
                grown ? "order-first basis-full px-1.5 pt-1 pb-1" : "order-2 flex-1",
              )}
            >
              <RichTextPlugin
                contentEditable={
                  <ContentEditable
                    aria-label={mode === "edit" ? "Edit message" : placeholder}
                    aria-multiline
                    className="max-h-60 overflow-y-auto px-1 py-1 text-md leading-normal text-foreground outline-none"
                  />
                }
                placeholder={
                  <div className="pointer-events-none absolute top-1 left-1 truncate px-1 py-0 text-md leading-normal text-muted-foreground select-none">
                    {placeholder}
                  </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
            </div>
            <ToolButton
              label="Mention or link"
              keys="@"
              className="order-3"
              onClick={() =>
                insertAt(null, () => {
                  const s = $getSelection();
                  if (!$isRangeSelection(s)) return;
                  const before = s.anchor.getNode().getTextContent().slice(0, s.anchor.offset);
                  s.insertText(before && !/\s$/.test(before) ? " @" : "@");
                })
              }
            >
              <AtSign className="size-icon" aria-hidden />
            </ToolButton>
            <Popover
              open={emojiOpen}
              onOpenChange={(open) => {
                if (open) rememberCaret();
                setEmojiOpen(open);
              }}
            >
              <PopoverTrigger asChild>
                <ToolButton label="Emoji" keys=":" className="order-4">
                  <Smile className="size-icon" aria-hidden />
                </ToolButton>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                className="w-auto p-0"
                onCloseAutoFocus={backToText}
              >
                <ChatEmojiPicker
                  onPick={(emoji) => {
                    setEmojiOpen(false);
                    insertAt(savedSelection.current, () => {
                      const s = $getSelection();
                      if ($isRangeSelection(s)) s.insertText(emoji);
                    });
                  }}
                />
              </PopoverContent>
            </Popover>
            {grown ? <span className="order-5 flex-1" /> : null}
            <ToolButton
              label={mode === "edit" ? "Save" : "Send"}
              keys="⏎"
              onClick={send}
              className={cn(
                "order-6",
                !empty &&
                  "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
              )}
            >
              <SendHorizontal className="size-icon" aria-hidden />
            </ToolButton>
          </div>
          {error || note || showCount || mode === "edit" ? (
            <p
              className={cn(
                "mt-1 flex gap-3 px-1 text-xs",
                error ? "text-destructive" : "text-muted-foreground",
              )}
              role={error ? "alert" : undefined}
            >
              <span className="min-w-0 flex-1">
                {error ?? note ?? (mode === "edit" ? "Esc to cancel · ⏎ to save" : null)}
              </span>
              {showCount ? (
                <span className="tabular-nums">
                  {count.toLocaleString("en-US")} / {MESSAGE_LIMIT.toLocaleString("en-US")}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <EditorHandle onEditor={setEditor} />
        <HistoryPlugin />
        <ListPlugin />
        <MarkdownShortcutPlugin transformers={CHAT_TRANSFORMERS} />
        <CleanPastePlugin origins={origins} />
        <ComposerStatePlugin onChange={onState} />
        <SelectionFormatPlugin />
        <CaretAfterChipPlugin pending={caretAfterChip} />
        <BlurPlugin
          onBlur={() => {
            flushDraft();
            live.current.onTyping?.(false);
          }}
        />
        <ComposerKeysPlugin
          mode={mode}
          onSend={send}
          onEditLast={onEditLast}
          onEscapeEmpty={onEscapeEmpty}
          onCancel={onCancel}
          menuOpen={menuOpen}
        />
        <MentionMenuPlugin
          {...shared}
          triggerChar="@"
          trigger="mention"
          candidatesFor={atCandidates}
          onPick={atPick}
          onMenuChange={trackMenu("@")}
        />
        <MentionMenuPlugin
          {...shared}
          triggerChar="/"
          trigger="ref"
          dateCommands
          candidatesFor={slashCandidates}
          onPick={slashPick}
          onMenuChange={trackMenu("/")}
        />
        <MentionMenuPlugin
          {...shared}
          triggerChar="#"
          trigger="tag"
          onMenuChange={trackMenu("#")}
        />
        <EmojiTypeaheadPlugin onOpenChange={trackMenu(":")} />
      </LexicalComposer>
    </ReferenceViewOverrideProvider>
  );
});
