// The capture's title line (TV-U14): a one-line Lexical editor with the app's
// grammar (spine/grammar.ts) through RF-1's three menu plugins. The host (the
// Task body) adds its own entries and carries out each pick: a person, team,
// tag or `/` command becomes a token chip; a project moves into the
// destination row; a linked thing stays as a live chip. Date words are marked
// with the CSS Custom Highlight API, so they stay plain words until saved.
// ⏎ creates, ⌘⏎ creates more, ⇧⏎ goes to the description (keymap.md); a
// pasted list is handed up ("Create n tasks?").

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  type EditorState,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type NodeKey,
  PASTE_COMMAND,
} from "lexical";
import { type MutableRefObject, useEffect, useMemo, useRef } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { cn } from "../../../lib/utils";
import { MentionMenuPlugin, type MenuPickApi } from "../../spine/editor/mention-menu-plugin";
import type { MentionCandidate } from "../../spine/mention";
import { type CaptureToken, type TitleSegment, tokenText } from "../parse/capture-tokens";
import { $createCaptureTokenNode, $isCaptureTokenNode, CaptureTokenNode } from "./token-node";

/** What the body can do to the title. */
export type TitleEditorApi = {
  focus: () => void;
  /** Replace everything (a restored draft, "Create more", a cleared title). */
  setSegments: (segments: readonly TitleSegment[]) => void;
  /** Turn matching tokens back into words (a pill set by hand wins, research §2). */
  tokensToText: (match: (token: CaptureToken) => boolean) => void;
  /** Swap each token for what `fn` makes of it; null takes it out. */
  mapTokens: (fn: (token: CaptureToken) => CaptureToken | null) => void;
  /** Turn one token back into words (Esc right after it was recognised). */
  tokenToText: (key: NodeKey) => boolean;
  /** Where the caret is: a text node and an offset in it (null when not in text). */
  caret: () => { key: NodeKey; offset: number } | null;
  /** Close an open `@ # /` menu; false when none is open. */
  closeMenu: () => boolean;
  /** Is the caret in the title? */
  hasFocus: () => boolean;
};

export type MenuPick = (candidate: MentionCandidate) => ((api: MenuPickApi) => void) | null;

type Props = {
  apiRef: MutableRefObject<TitleEditorApi | null>;
  initial: readonly TitleSegment[];
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  placeholder: string;
  /** The `@`, `#` and `/` menus' entries, the host's say (see MentionMenuPlugin). */
  mentionCandidates: (
    query: string,
    base: MentionCandidate[],
    loading: boolean,
  ) => MentionCandidate[];
  tagCandidates: (query: string, base: MentionCandidate[], loading: boolean) => MentionCandidate[];
  commandCandidates: (
    query: string,
    base: MentionCandidate[],
    loading: boolean,
  ) => MentionCandidate[];
  onPick: MenuPick;
  /** The title as segments, and each text segment's node (for the highlight). */
  onChange: (segments: TitleSegment[], keys: Array<NodeKey | null>) => void;
  onSubmit: (more: boolean) => void;
  onShiftEnter: () => void;
  /** A paste of two or more lines, or files: the host takes it (true). */
  onPaste: (text: string, files: File[]) => boolean;
  /** Date words to mark: `[start, end)` inside the text segment at `index`. */
  highlights: ReadonlyArray<{ index: number; start: number; end: number }>;
  /** The node of each text segment, as `onChange` reported it. */
  segmentKeys: ReadonlyArray<NodeKey | null>;
};

const HIGHLIGHT = "capture-date";

/** Read the title as segments, with each text segment's node key. */
function $readSegments(): { segments: TitleSegment[]; keys: Array<NodeKey | null> } {
  const segments: TitleSegment[] = [];
  const keys: Array<NodeKey | null> = [];
  for (const block of $getRoot().getChildren()) {
    const children = $isElementNode(block) ? block.getChildren() : [block];
    for (const child of children) {
      if ($isCaptureTokenNode(child)) {
        segments.push({ token: child.getToken() });
        keys.push(null);
      } else if ($isTextNode(child)) {
        const last = segments[segments.length - 1];
        // Adjacent text nodes (a format split) are one run of words.
        if (last && "text" in last && keys[keys.length - 1] !== null) {
          last.text += child.getTextContent();
        } else {
          segments.push({ text: child.getTextContent() });
          keys.push(child.getKey());
        }
      } else if ($isLineBreakNode(child)) {
        segments.push({ text: " " });
        keys.push(null);
      }
    }
  }
  return { segments, keys };
}

/** Put segments into the editor (one paragraph). */
function $writeSegments(segments: readonly TitleSegment[]): void {
  const root = $getRoot();
  root.clear();
  const p = $createParagraphNode();
  for (const segment of segments) {
    if ("text" in segment) {
      if (segment.text) p.append($createTextNode(segment.text));
    } else {
      p.append($createCaptureTokenNode(segment.token));
    }
  }
  root.append(p);
  p.selectEnd();
}

/** Matching tokens become their words again. */
export function $tokensToText(match: (token: CaptureToken) => boolean): void {
  for (const block of $getRoot().getChildren()) {
    if (!$isElementNode(block)) continue;
    for (const child of block.getChildren()) {
      if ($isCaptureTokenNode(child) && match(child.getToken())) {
        child.replace($createTextNode(tokenText(child.getToken())));
      }
    }
  }
}

function serialize(segments: readonly TitleSegment[]): string {
  return JSON.stringify(segments);
}

function Behaviour({
  apiRef,
  onChange,
  onSubmit,
  onShiftEnter,
  onPaste,
  highlights,
  segmentKeys,
  menuOpen,
}: Pick<
  Props,
  "apiRef" | "onChange" | "onSubmit" | "onShiftEnter" | "onPaste" | "highlights" | "segmentKeys"
> & { menuOpen: MutableRefObject<Record<string, boolean>> }) {
  const [editor] = useLexicalComposerContext();
  const handlers = useRef({ onChange, onSubmit, onShiftEnter, onPaste });
  useEffect(() => {
    handlers.current = { onChange, onSubmit, onShiftEnter, onPaste };
  });

  useEffect(() => {
    apiRef.current = {
      focus: () => editor.focus(undefined, { defaultSelection: "rootEnd" }),
      setSegments: (segments) => editor.update(() => $writeSegments(segments)),
      tokensToText: (match) => editor.update(() => $tokensToText(match)),
      mapTokens: (fn) =>
        editor.update(() => {
          for (const block of $getRoot().getChildren()) {
            if (!$isElementNode(block)) continue;
            for (const child of block.getChildren()) {
              if (!$isCaptureTokenNode(child)) continue;
              const token = child.getToken();
              const next = fn(token);
              if (next === null) child.remove();
              else if (next !== token) child.replace($createCaptureTokenNode(next));
            }
          }
        }),
      tokenToText: (key) => {
        // Decided on a read: an update may run later than this call returns.
        const there = editor.getEditorState().read(() => $isCaptureTokenNode($getNodeByKey(key)));
        if (!there) return false;
        editor.update(() => {
          const live = $getNodeByKey(key);
          if (!$isCaptureTokenNode(live)) return;
          const text = $createTextNode(tokenText(live.getToken()));
          live.replace(text);
          text.selectEnd();
        });
        return true;
      },
      caret: () =>
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
          if (selection.anchor.type !== "text") return null;
          return { key: selection.anchor.key, offset: selection.anchor.offset };
        }),
      closeMenu: () => {
        if (!Object.values(menuOpen.current).some(Boolean)) return false;
        editor.dispatchCommand(KEY_ESCAPE_COMMAND, new KeyboardEvent("keydown", { key: "Escape" }));
        return true;
      },
      hasFocus: () => {
        const root = editor.getRootElement();
        return Boolean(root?.contains(document.activeElement));
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [editor, apiRef, menuOpen]);

  // Report the title as it changes (once per real change).
  useEffect(() => {
    let last = "";
    const report = (state: EditorState) => {
      const read = state.read(() => $readSegments());
      const key = serialize(read.segments);
      if (key === last) return;
      last = key;
      handlers.current.onChange(read.segments, read.keys);
    };
    report(editor.getEditorState());
    return editor.registerUpdateListener(({ editorState }) => report(editorState));
  }, [editor]);

  // ⏎ creates, ⌘⏎ creates more, ⇧⏎ goes to the description. The menus claim
  // ⏎ first (high priority) while one is open.
  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          event?.preventDefault();
          if (event?.isComposing) return true;
          if (event?.shiftKey) handlers.current.onShiftEnter();
          else handlers.current.onSubmit(Boolean(event?.metaKey || event?.ctrlKey));
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor],
  );

  // A pasted list or files go to the host; other text joins the one line.
  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
          const text = event.clipboardData.getData("text/plain");
          const files = Array.from(event.clipboardData.files ?? []);
          if (handlers.current.onPaste(text, files)) {
            event.preventDefault();
            return true;
          }
          if (/\r?\n/.test(text)) {
            event.preventDefault();
            editor.update(() => {
              const selection = $getSelection();
              if ($isRangeSelection(selection)) {
                selection.insertText(text.replace(/\s*\r?\n\s*/g, " ").trim());
              }
            });
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );

  // Mark the date words (no DOM change: the CSS Custom Highlight API).
  useEffect(() => {
    const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
    if (!registry || typeof Highlight === "undefined") return;
    const ranges: Range[] = [];
    for (const h of highlights) {
      const key = segmentKeys[h.index];
      const el = key ? editor.getElementByKey(key) : null;
      const node = el?.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;
      const length = node.textContent?.length ?? 0;
      const range = document.createRange();
      range.setStart(node, Math.min(h.start, length));
      range.setEnd(node, Math.min(h.end, length));
      ranges.push(range);
    }
    if (ranges.length) registry.set(HIGHLIGHT, new Highlight(...ranges));
    else registry.delete(HIGHLIGHT);
  }, [editor, highlights, segmentKeys]);
  useEffect(
    () => () => {
      if (typeof CSS !== "undefined") CSS.highlights?.delete(HIGHLIGHT);
    },
    [],
  );

  return null;
}

export function TitleEditor({
  apiRef,
  initial,
  runtime,
  workspaceId,
  placeholder,
  mentionCandidates,
  tagCandidates,
  commandCandidates,
  onPick,
  onChange,
  onSubmit,
  onShiftEnter,
  onPaste,
  highlights,
  segmentKeys,
}: Props) {
  // Seeded once; later changes come through the api.
  const seed = useRef(initial);
  const initialConfig = useMemo(
    () => ({
      namespace: "capture-title",
      onError: (error: Error) => {
        console.error("Capture title error:", error);
      },
      nodes: [CaptureTokenNode],
      editorState: () => {
        $writeSegments(seed.current);
      },
    }),
    [],
  );
  // Which of the three menus is open (Esc closes a menu before the capture).
  const menuOpen = useRef<Record<string, boolean>>({});
  const menuChange = (sigil: string) => (open: boolean) => {
    menuOpen.current = { ...menuOpen.current, [sigil]: open };
  };
  const shared = {
    runtime,
    workspaceId,
    source: null,
    storeLabel: false,
    onPick,
  } as const;

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Task title"
              data-capture-title=""
              className={cn(
                "min-h-(--ctrl-h-lg) w-full py-2 font-display text-xl leading-normal text-foreground outline-none",
              )}
            />
          }
          placeholder={
            <div className="pointer-events-none absolute top-2 left-0 font-display text-xl text-muted-foreground">
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <MentionMenuPlugin
        {...shared}
        triggerChar="@"
        trigger="mention"
        candidatesFor={mentionCandidates}
        onMenuChange={menuChange("@")}
      />
      <MentionMenuPlugin
        {...shared}
        triggerChar="/"
        trigger="ref"
        dateCommands
        candidatesFor={commandCandidates}
        onMenuChange={menuChange("/")}
      />
      <MentionMenuPlugin
        {...shared}
        triggerChar="#"
        trigger="tag"
        candidatesFor={tagCandidates}
        onMenuChange={menuChange("#")}
      />
      <Behaviour
        apiRef={apiRef}
        onChange={onChange}
        onSubmit={onSubmit}
        onShiftEnter={onShiftEnter}
        onPaste={onPaste}
        highlights={highlights}
        segmentKeys={segmentKeys}
        menuOpen={menuOpen}
      />
    </LexicalComposer>
  );
}
