// The chat composer's editor plugins (CV-7b): the keys of §16, the clean
// paste, the Markdown shortcuts as you type, the formatting buttons that show
// only over a selection, and the `:` emoji menu. Each registers on the shared
// Lexical editor and touches nothing outside it.

import { $isCodeNode } from "@lexical/code";
import { $isListItemNode } from "@lexical/list";
import {
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  CODE,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  type Transformer,
  UNORDERED_LIST,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { mergeRegister } from "@lexical/utils";
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  PASTE_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type TextFormatType,
  type TextNode,
} from "lexical";
import { Bold, Code, Italic, Strikethrough } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { enterIntent } from "../markup-v2/enter";
import { $blocksToNodes, $exportStored } from "../markup-v2/lexical";
import { pastedBlocks } from "../markup-v2/paste";
import { type ChatEmoji, loadChatEmoji, matchEmoji } from "./emoji-data";
import { composerKeyAction, linkAppRefs } from "./grammar";

/** The Markdown shortcuts the composer keeps (no headings, rules or checklists). */
export const CHAT_TRANSFORMERS: Transformer[] = [
  CODE,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  INLINE_CODE,
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
];

/** The text formats the stored form holds (underline and the rest have no form). */
const KEPT_FORMATS = new Set<TextFormatType>(["bold", "italic", "strikethrough", "code"]);

/** Whether the editor holds nothing that would be sent. */
export function $isComposerEmpty(): boolean {
  return $exportStored().trim() === "";
}

function $caretIn(test: (node: LexicalNode) => boolean): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  let node: LexicalNode | null = selection.anchor.getNode();
  while (node && !$isRootOrShadowRoot(node)) {
    if (test(node)) return true;
    node = node.getParent();
  }
  return false;
}

// ── keys (§16) ──────────────────────────────────────────────────────────────

export type ComposerKeysProps = {
  mode: "message" | "edit";
  /** ⏎ / ⌘⏎: send (or save an edit). */
  onSend: () => void;
  /** ↑ in an empty composer. */
  onEditLast?: () => void;
  /** Esc in an empty composer with nothing open (message mode). */
  onEscapeEmpty?: () => void;
  /** Esc while editing a message. */
  onCancel?: () => void;
  /** A grammar menu is showing (it takes ↑, ⏎, Tab and Esc first). */
  menuOpen: () => boolean;
};

export function ComposerKeysPlugin({
  mode,
  onSend,
  onEditLast,
  onEscapeEmpty,
  onCancel,
  menuOpen,
}: ComposerKeysProps) {
  const [editor] = useLexicalComposerContext();
  const live = useRef({ onSend, onEditLast, onEscapeEmpty, onCancel, menuOpen, mode });
  live.current = { onSend, onEditLast, onEscapeEmpty, onCancel, menuOpen, mode };

  useEffect(
    () =>
      mergeRegister(
        // An input method's ⏎ (WebKit's commit Enter, keyCode 229) belongs to
        // it, before any menu can take it as a pick.
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => enterIntent(event, editor.isComposing()) === "compose",
          COMMAND_PRIORITY_CRITICAL,
        ),
        // ⏎ sends, never during IME composition; ⇧⏎ makes a new line (a new
        // item inside a list). The menus claim ⏎ first, at a higher priority.
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            const intent = enterIntent(event, editor.isComposing());
            if (intent === "compose") return true;
            if (intent === "newline") {
              if (editor.getEditorState().read(() => $caretIn($isListItemNode))) {
                event?.preventDefault();
                editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
                return true;
              }
              return false;
            }
            event?.preventDefault();
            live.current.onSend();
            return true;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          KEY_ARROW_UP_COMMAND,
          (event) => {
            if (live.current.mode !== "message") return false;
            const empty = editor.getEditorState().read($isComposerEmpty);
            const action = composerKeyAction({
              key: "ArrowUp",
              empty,
              menuOpen: live.current.menuOpen(),
              modifiers: Boolean(
                event?.shiftKey || event?.metaKey || event?.ctrlKey || event?.altKey,
              ),
            });
            if (action !== "edit-last" || !live.current.onEditLast) return false;
            event?.preventDefault();
            live.current.onEditLast();
            return true;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          (event) => {
            if (live.current.mode === "edit") {
              event?.preventDefault();
              event?.stopPropagation();
              live.current.onCancel?.();
              return true;
            }
            const empty = editor.getEditorState().read($isComposerEmpty);
            const action = composerKeyAction({
              key: "Escape",
              empty,
              menuOpen: live.current.menuOpen(),
              modifiers: false,
            });
            if (action !== "to-stream" || !live.current.onEscapeEmpty) return false;
            event?.preventDefault();
            live.current.onEscapeEmpty();
            return true;
          },
          COMMAND_PRIORITY_LOW,
        ),
        // ⌘E inline code, ⌘⇧X strikethrough (⌘B and ⌘I are the editor's own).
        editor.registerCommand(
          KEY_DOWN_COMMAND,
          (event) => {
            const mod = event.metaKey || event.ctrlKey;
            if (!mod || event.altKey) return false;
            const key = event.key.toLowerCase();
            if (key === "e" && !event.shiftKey) {
              event.preventDefault();
              editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code");
              return true;
            }
            if (key === "x" && event.shiftKey) {
              event.preventDefault();
              editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
              return true;
            }
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        // Formats the stored form can't hold (⌘U underline …) do nothing.
        editor.registerCommand(
          FORMAT_TEXT_COMMAND,
          (format) => !KEPT_FORMATS.has(format),
          COMMAND_PRIORITY_HIGH,
        ),
      ),
    [editor],
  );
  return null;
}

// ── clean paste ─────────────────────────────────────────────────────────────

/**
 * Pasting stays clean text (CH15): lines, links, lists, quotes and code blocks
 * come in, styles don't; this app's own links become references. Inside a
 * code block a paste is its plain text. Files are left alone (uploads: CV-9).
 */
export function CleanPastePlugin({ origins }: { origins: readonly string[] }) {
  const [editor] = useLexicalComposerContext();
  const originsRef = useRef(origins);
  originsRef.current = origins;
  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
          const data = event.clipboardData;
          const html = data.getData("text/html");
          const text = data.getData("text/plain");
          // Only files: left alone (uploads are CV-9's). Files with words: the words, clean.
          if (!html && !text) return false;
          event.preventDefault();
          editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return;
            if ($caretIn($isCodeNode)) {
              selection.insertRawText(text);
              return;
            }
            const blocks = linkAppRefs(pastedBlocks({ html, text }), originsRef.current);
            const first = blocks[0];
            if (blocks.length === 1 && first?.t === "p") {
              // One paragraph goes in where the caret is, inline.
              const [para] = $blocksToNodes(blocks);
              const children = $isElementNode(para) ? para.getChildren() : [];
              if (children.length) selection.insertNodes(children);
              return;
            }
            const nodes = $blocksToNodes(blocks);
            if (nodes.length) selection.insertNodes(nodes);
          });
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );
  return null;
}

// ── state: empty, grown, the stored text ────────────────────────────────────

/**
 * Report the composer's content as it changes: the stored text (drafts, the
 * limit), whether it's empty, and whether the text has grown past one line
 * (the tools then drop to a row below and stay there until it's empty).
 */
export function ComposerStatePlugin({
  onChange,
}: {
  onChange: (state: { stored: string; empty: boolean; multiline: boolean }) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
        const state = editorState.read(() => {
          const stored = $exportStored();
          const root = $getRoot();
          const multiline = root.getChildrenSize() > 1 || root.getTextContent().includes("\n");
          return { stored, empty: stored.trim() === "", multiline };
        });
        ref.current(state);
      }),
    [editor],
  );
  return null;
}

// ── formatting buttons over a selection ─────────────────────────────────────

const FORMAT_BUTTONS: ReadonlyArray<{
  format: TextFormatType;
  label: string;
  keys: string;
  Icon: typeof Bold;
}> = [
  { format: "bold", label: "Bold", keys: "⌘B", Icon: Bold },
  { format: "italic", label: "Italic", keys: "⌘I", Icon: Italic },
  { format: "strikethrough", label: "Strikethrough", keys: "⌘⇧X", Icon: Strikethrough },
  { format: "code", label: "Code", keys: "⌘E", Icon: Code },
];

/** Bold · Italic · Strikethrough · Code, floating over selected text only. */
export function SelectionFormatPlugin() {
  const [editor] = useLexicalComposerContext();
  const [box, setBox] = useState<{ top: number; left: number; active: Set<string> } | null>(null);

  useEffect(() => {
    const read = () => {
      const state = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || selection.isCollapsed()) return null;
        if (selection.getTextContent().trim() === "") return null;
        const active = new Set<string>();
        for (const b of FORMAT_BUTTONS) if (selection.hasFormat(b.format)) active.add(b.format);
        return active;
      });
      const root = editor.getRootElement();
      const dom = window.getSelection();
      if (!state || !root || !dom || dom.rangeCount === 0 || !root.contains(dom.anchorNode)) {
        setBox(null);
        return;
      }
      const rect = dom.getRangeAt(0).getBoundingClientRect();
      setBox({ top: rect.top, left: rect.left + rect.width / 2, active: state });
    };
    return mergeRegister(
      editor.registerUpdateListener(() => read()),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          read();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor]);

  if (!box) return null;
  return createPortal(
    <div
      role="toolbar"
      aria-label="Format"
      className="pointer-events-auto fixed z-(--z-popover) flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-md"
      style={{ top: box.top - 6, left: box.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {FORMAT_BUTTONS.map(({ format, label, keys, Icon }) => (
        <button
          key={format}
          type="button"
          aria-label={`${label} ${keys}`}
          title={`${label} ${keys}`}
          aria-pressed={box.active.has(format)}
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)}
          className={cn(
            "grid size-(--ctrl-h-sm) place-items-center rounded-sm text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground",
            box.active.has(format) && "bg-state-active text-foreground",
          )}
        >
          <Icon className="size-icon-sm" aria-hidden />
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ── `:` emoji ───────────────────────────────────────────────────────────────

class EmojiOption extends MenuOption {
  constructor(readonly item: ChatEmoji) {
    super(item.emoji + item.label);
  }
}

/**
 * `:` opens emoji by name (`:thu` → 👍). Two letters at least, so a time
 * ("at 10:30") or a smiley (":)") never opens it. The workspace's own emoji
 * come first once CV-20 adds them.
 */
export function EmojiTypeaheadPlugin({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const [list, setList] = useState<ChatEmoji[] | null>(null);
  const match = useBasicTypeaheadTriggerMatch(":", { minLength: 2, maxLength: 32 });

  useEffect(() => {
    if (query === null || list) return;
    void loadChatEmoji()
      .then((data) => setList(data.list))
      .catch(() => {
        // Tried again on the next keystroke.
      });
  }, [query, list]);

  const options = query && list ? matchEmoji(list, query).map((e) => new EmojiOption(e)) : [];

  return (
    <LexicalTypeaheadMenuPlugin<EmojiOption>
      triggerFn={(text, ed) => {
        const found = match(text, ed);
        // A shortcode's own characters only: `a-z 0-9 _ + -`.
        if (found && !/^[a-z0-9_+-]+$/i.test(found.matchingString)) return null;
        return found;
      }}
      onQueryChange={setQuery}
      options={options}
      commandPriority={COMMAND_PRIORITY_HIGH}
      onOpen={() => onOpenChange?.(true)}
      onClose={() => onOpenChange?.(false)}
      onSelectOption={(option, textNode: TextNode | null, closeMenu) => {
        editor.update(() => {
          if (textNode) {
            const emoji = $createTextNode(option.item.emoji);
            textNode.replace(emoji);
            emoji.select();
          }
        });
        closeMenu();
      }}
      menuRenderFn={(anchor, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
        anchor.current && options.length > 0
          ? createPortal(
              <div
                role="listbox"
                aria-label="Emoji"
                className="absolute bottom-full z-(--z-popover) mb-1 min-w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              >
                {options.map((option, i) => (
                  <button
                    key={option.key}
                    type="button"
                    role="option"
                    aria-selected={selectedIndex === i}
                    ref={(el) => option.setRefElement(el)}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectOptionAndCleanUp(option);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground",
                      selectedIndex === i ? "bg-accent" : "hover:bg-accent",
                    )}
                  >
                    <span className="text-base leading-none">{option.item.emoji}</span>
                    <span className="truncate">
                      :{option.item.codes[0] ?? option.item.label.replace(/\s+/g, "_")}:
                    </span>
                  </button>
                ))}
              </div>,
              anchor.current,
            )
          : null
      }
    />
  );
}

/** Focus the editor with the caret at its end. */
export function focusAtEnd(editor: LexicalEditor): void {
  editor.focus(() => {
    editor.update(() => {
      $getRoot().selectEnd();
    });
  });
}
