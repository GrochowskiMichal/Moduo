// Connective-tissue spine — the shared entity-rich text editor (DF-23; the
// References host since RF-1; a task's one description editor since dogfood
// call #15).
//
// A minimal standalone (non-collab) Lexical editor for short prose fields —
// the task description and calendar event notes. It is deliberately NOT a
// block editor (no headings / tables / slash-menu blocks): the point is linking
// in prose, with the app's grammar (spine/grammar.ts):
// - `@` mentions things (projects first) and inserts a Reference;
// - `#` links a tag (never changes the item's tags);
// - `/` runs the date commands (`/today` … `/date` → a date chip), inserts
//   things, and creates ("New task “…”") where the page can;
// - a typed handle (`MOD-142`) links itself.
// A reference alone on its line is a card, in running text a chip; "Show as"
// follows the insert. References are stored as `{type, id, display}` only,
// never a title (RF-1 privacy), and render per reader.
//
// Two storage formats:
// - `markdown` (task descriptions, call #15, MOD-98 / MOD-120): stored as
//   plain Markdown, formatting rendered as you type (bold, italic, inline
//   code, links, bulleted, numbered and checkbox lists, quotes), references
//   as `moduo://` links (`description-markdown.ts`). An older HTML
//   description is read as Markdown and saved as Markdown the next time it
//   changes. Quick capture, the details panel, the full page and Focus's Now
//   card all use this one editor;
// - `html` (calendar event notes, as before): our HTML → parsed; foreign or
//   legacy plain text → verbatim, never parsed as markup.
// It commits on blur (`onCommit`), or reports every change (`onChange`, the
// capture's live draft). Tokens-only theme (Tailwind utilities, plus the
// description's lists in styles/description-prose.css).

import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { $isLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { DRAG_DROP_PASTE, QuoteNode } from "@lexical/rich-text";
import { $findMatchingParent } from "@lexical/utils";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $isElementNode,
  BLUR_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type TextFormatType,
} from "lexical";
import {
  type MutableRefObject,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

import type { EntityRef } from "@/lib/entity-links";
import { isTauriRuntime } from "@/lib/runtime";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import type { MentionInsert } from "../mention-actions";
import { useReferenceHost } from "../references/context";
import { DateNode } from "../references/date-node";
import { HandleAutolinkPlugin, SEED_TAG } from "../references/handle-autolink-plugin";
import {
  $exportDescription,
  $importDescription,
  DESCRIPTION_TRANSFORMERS,
} from "./description-markdown";
import { $isEntityRefNode, EntityRefNode } from "./entity-ref-node";
import { looksLikeRichHtml, plainListLine } from "./entity-rich-html";
import { MentionMenuPlugin } from "./mention-menu-plugin";

/** How the editor stores its text. */
export type EntityTextFormat = "html" | "markdown";

/** Tokens-only theme (Tailwind utilities → no bespoke CSS, no raw values). */
const THEME = {
  paragraph: "mb-2 last:mb-0",
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
  },
};

/**
 * The description's Markdown blocks. Bullets follow round-1c frame 3's
 * `.ldesc` (styles/description-prose.css); numbered and checkbox lists,
 * quotes, inline code and links aren't drawn there (agent's layout,
 * revisitable): the checkbox mirrors Notes' round one.
 */
const MARKDOWN_THEME = {
  ...THEME,
  quote: "mb-2 border-s-2 border-border ps-3 text-muted-foreground last:mb-0",
  link: "text-primary underline underline-offset-2",
  list: {
    ul: "desc-ul",
    ol: "desc-ol",
    checklist: "desc-checklist",
    listitem: "desc-li",
    listitemChecked: "desc-li-checked",
    listitemUnchecked: "desc-li-unchecked",
    nested: { listitem: "desc-li-nested" },
  },
  text: {
    ...THEME.text,
    code: "rounded-sm bg-muted px-1 py-px font-mono text-sm",
  },
};

/** Formats Markdown can't write: refused in the Markdown editor, so nothing
 *  shows that wouldn't be saved (⌘U). */
const UNSAVED_FORMATS: ReadonlySet<TextFormatType> = new Set([
  "underline",
  "highlight",
  "subscript",
  "superscript",
]);

/** The stored value and the plain text, as the format writes them. Empty
 * content persists as "" (not "<p><br></p>") so `looksLikeRichHtml` reads it
 * as plain — a body of only references or date chips is NOT empty (they
 * carry no text but leave their markers). */
function serialize(
  editor: LexicalEditor,
  format: EntityTextFormat,
): {
  value: string;
  text: string;
} {
  return editor.read(() => {
    const text = $getRoot().getTextContent();
    if (format === "markdown") return { value: $exportDescription(), text };
    const html = $generateHtmlFromNodes(editor, null);
    const isEmpty =
      text.trim() === "" &&
      !html.includes("data-lexical-entity-ref") &&
      !html.includes("data-moduo-date");
    return { value: isEmpty ? "" : html, text };
  });
}

/** Drop the stored title of every reference under `node`. */
function $dropStoredLabels(node: LexicalNode): void {
  if ($isEntityRefNode(node)) node.dropStoredLabel();
  if ($isElementNode(node)) for (const child of node.getChildren()) $dropStoredLabels(child);
}

/** Fill the editor from a stored value (inside an update). */
function $seed(editor: LexicalEditor, value: string, format: EntityTextFormat): void {
  const root = $getRoot();
  root.clear();
  if (format === "markdown") {
    // Markdown as it is; an older HTML description read as Markdown (call #15).
    $importDescription(value);
  } else if (looksLikeRichHtml(value)) {
    const dom = new DOMParser().parseFromString(value, "text/html");
    const nodes = $generateNodesFromDOM(editor, dom);
    // Root children must be blocks: append block elements directly, gather
    // stray inline / text / decorator nodes into a paragraph.
    let inline: LexicalNode[] = [];
    const flush = () => {
      if (inline.length === 0) return;
      const p = $createParagraphNode();
      p.append(...inline);
      root.append(p);
      inline = [];
    };
    for (const node of nodes) {
      // A block element opens a new root child; inline elements, decorator
      // chips, and bare text nodes gather into a wrapping paragraph.
      if ($isElementNode(node) && !node.isInline()) {
        flush();
        root.append(node);
      } else {
        inline.push(node);
      }
    }
    flush();
  } else if (value) {
    const p = $createParagraphNode();
    value.split("\n").forEach((raw, i) => {
      const line = plainListLine(raw);
      if (i > 0) p.append($createLineBreakNode());
      if (line) p.append($createTextNode(line));
    });
    root.append(p);
  }
  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
  // An older chip carried its item's title in the stored HTML: forget
  // it, so the next save writes `{type, id, display}` only (RF-1).
  $dropStoredLabels(root);
}

/** Seed the editor once from the stored value. Our HTML is parsed; foreign /
 * legacy plain text is inserted verbatim (line breaks preserved) so a literal
 * "<x>" is never swallowed as an element, except that a Markdown bullet line
 * ("- a") reads as "• a". In Markdown the value is Markdown (or the old HTML,
 * read as Markdown). Tagged so nothing that reacts to typing (handle
 * auto-links) treats stored text as typed. */
function SeedPlugin({ value, format }: { value: string; format: EntityTextFormat }) {
  const [editor] = useLexicalComposerContext();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    editor.update(() => $seed(editor, value, format), { tag: SEED_TAG });
  }, [editor, value, format]);
  return null;
}

/** Commit the value when the text loses focus, only when it actually changed. */
function CommitOnBlurPlugin({
  format,
  onCommit,
}: {
  format: EntityTextFormat;
  onCommit?: (value: string, text: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  // Baseline against the SERIALIZED seed (not the raw stored string): a legacy
  // plain-text value re-serializes to `<p>…</p>` (an HTML description to its
  // Markdown), so baselining off the raw value would make a bare focus+blur
  // look "changed" and fire a spurious write (updatedAt bump + phantom
  // activity row). SeedPlugin renders first, so the editor is already seeded
  // when this mount effect runs. An old HTML description therefore turns into
  // Markdown on its next real edit, never on a visit (call #15).
  const last = useRef<string | null>(null);
  // onCommit closes over the entity id but has a fresh identity each render;
  // route through a ref so the command registers once (not per render).
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });
  useEffect(() => {
    last.current = serialize(editor, format).value;
    const commit = () => {
      const { value, text } = serialize(editor, format);
      if (value !== last.current) {
        last.current = value;
        onCommitRef.current?.(value, text);
      }
    };
    /** Focus going somewhere outside the text (not to one of its checkboxes). */
    const leaving = (next: EventTarget | null) => {
      const root = editor.getRootElement();
      return !(root && next instanceof Node && root.contains(next));
    };
    // A checkbox click hands the focus to its list item, inside the text: the
    // root's blur then isn't the focus leaving, and the item's later focusout
    // is (call #15's checkbox lists).
    const onFocusOut = (event: FocusEvent) => {
      if (event.target === editor.getRootElement()) return;
      if (leaving(event.relatedTarget)) commit();
    };
    const offRoot = editor.registerRootListener((root, prev) => {
      prev?.removeEventListener("focusout", onFocusOut);
      root?.addEventListener("focusout", onFocusOut);
    });
    const offBlur = editor.registerCommand(
      BLUR_COMMAND,
      (event) => {
        if (leaving(event.relatedTarget)) commit();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    return () => {
      offRoot();
      offBlur();
      editor.getRootElement()?.removeEventListener("focusout", onFocusOut);
    };
  }, [editor, format]);
  return null;
}

/** Report every change of the value (the capture's live draft), never the seed. */
function ChangePlugin({
  format,
  onChange,
}: {
  format: EntityTextFormat;
  onChange: (value: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    let last = serialize(editor, format).value;
    return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      const { value } = serialize(editor, format);
      // Text the host put in (a cleared "Create more", a restored draft) isn't
      // reported, but it's the new baseline: typing the old words again after
      // a clear must still be reported.
      if (tags.has(SEED_TAG)) {
        last = value;
        return;
      }
      if (value === last) return;
      last = value;
      onChangeRef.current(value);
    });
  }, [editor, format]);
  return null;
}

/**
 * ⏎ creates and ⇧⏎ starts a new line (quick capture, MOD-117, call #14); ⌘⏎
 * creates more. Low priority: an open `@ # /` menu claims ⏎ first, for its
 * pick. ⇧⏎ makes a new paragraph rather than a soft break, so a list goes on
 * to its next item and Markdown shortcuts work on the new line.
 */
function EnterCreatesPlugin({ onEnter }: { onEnter: (more: boolean) => void }) {
  const [editor] = useLexicalComposerContext();
  const onEnterRef = useRef(onEnter);
  useEffect(() => {
    onEnterRef.current = onEnter;
  });
  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (event?.isComposing) return false;
          event?.preventDefault();
          if (event?.shiftKey) {
            editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
            return true;
          }
          onEnterRef.current(Boolean(event?.metaKey || event?.ctrlKey));
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor],
  );
  return null;
}

/** Underline and the like have no Markdown: refused, so nothing shows that won't be saved. */
function MarkdownFormatsPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        FORMAT_TEXT_COMMAND,
        (format) => UNSAVED_FORMATS.has(format),
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );
  return null;
}

/**
 * A link opens in the browser (the desktop app hands it to the system): a
 * click when the text is read-only, ⌘-click (Ctrl-click) while editing, where
 * a plain click places the caret. Only http(s), mailto and tel links, as
 * Lexical's link node allows.
 */
function LinkOpenPlugin({
  editable,
  runtime,
}: {
  editable: boolean;
  runtime: ModuoRuntime | null;
}) {
  const [editor] = useLexicalComposerContext();
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (editable && !event.metaKey && !event.ctrlKey) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      const url = editor.read(() => {
        const node = $getNearestNodeFromDOMNode(target);
        const link = node ? $findMatchingParent(node, $isLinkNode) : null;
        return $isLinkNode(link) ? link.sanitizeUrl(link.getURL()) : null;
      });
      if (url === null) return;
      // The browser never follows a description's link itself: a relative
      // one (`/settings`) would take the app's own window somewhere.
      event.preventDefault();
      if (!/^(?:https?:|mailto:|tel:)/i.test(url)) return;
      const rt = runtimeRef.current;
      if (isTauriRuntime() && rt) void rt.window.openExternalUrl(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    };
    return editor.registerRootListener((root, prev) => {
      prev?.removeEventListener("click", onClick);
      root?.addEventListener("click", onClick);
    });
  }, [editor, editable]);
  return null;
}

/** What a host can do to the editor (the capture: restore, clear, Esc). */
export type EntityTextEditorApi = {
  focus: () => void;
  /** Replace the content (a restored draft, "Create more"). */
  setValue: (value: string) => void;
  /** Close an open `@ # /` menu; false when none is open. */
  closeMenu: () => boolean;
};

function ApiPlugin({
  apiRef,
  format,
  menuOpen,
}: {
  apiRef: MutableRefObject<EntityTextEditorApi | null>;
  format: EntityTextFormat;
  menuOpen: MutableRefObject<Record<string, boolean>>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    apiRef.current = {
      focus: () => editor.focus(undefined, { defaultSelection: "rootEnd" }),
      setValue: (value) => editor.update(() => $seed(editor, value, format), { tag: SEED_TAG }),
      closeMenu: () => {
        if (!Object.values(menuOpen.current).some(Boolean)) return false;
        editor.dispatchCommand(KEY_ESCAPE_COMMAND, new KeyboardEvent("keydown", { key: "Escape" }));
        return true;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [editor, apiRef, format, menuOpen]);
  return null;
}

export type EntityTextEditorProps = {
  /** Stored value — Markdown (format "markdown", old HTML read as Markdown), or our HTML / foreign plain text (format "html"). */
  value: string;
  editable: boolean;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** The surface's own entity (link source). `null` → insert-only (no link). */
  source: EntityRef | null;
  sourceLabel?: string;
  sourceIcon?: string | null;
  currentUserId?: string | null;
  placeholder?: string;
  ariaLabel?: string;
  /** How the value is stored (default `html`, Calendar's notes). Task descriptions are `markdown` (call #15). */
  format?: EntityTextFormat;
  /** Extra classes for the editable/readable surface (merged: they win over the defaults). */
  className?: string;
  /**
   * How editing shows: `ring` (default) rings the text on focus; `soft` reads
   * as plain text with no box, and editing fills a quiet surface with the
   * padding inside it, so nothing reaches past the field (the task panel,
   * MOD-115); `bare` shows no focus at all (quick capture's description, which
   * sits in its dialog like the title). The placeholder takes the same inset.
   */
  surface?: "ring" | "soft" | "bare";
  /** Extra classes for the placeholder (match a changed text size). */
  placeholderClassName?: string;
  onCommit?: (value: string, text: string) => void;
  /** Every change of the value as it happens (quick capture's live draft). */
  onChange?: (value: string) => void;
  /** ⏎ creates instead of a new line, ⇧⏎ makes the new line (quick capture, MOD-117); `more` for ⌘⏎. */
  onEnter?: (more: boolean) => void;
  /** The host's handle on the editor (focus, replace the text, close a menu). */
  apiRef?: MutableRefObject<EntityTextEditorApi | null>;
  /**
   * People in the `@` menu (TV-D12): picking one inserts their name as text
   * and calls this, which notifies them (a task's description). Without it
   * the menu offers things only.
   */
  onMentionPerson?: (memberId: string, label: string) => Promise<void> | void;
  /** Files pasted or dropped into the text (AT-2): handed to the caller, which
   * attaches them. Never inserted as image nodes (attachments-only). Without
   * it, Lexical drops them as before. */
  onFiles?: (files: File[]) => void;
};

/** Pasted/dropped files go to `onFiles` (the attachments service), not into
 * the text. Lexical's rich-text paste and drop dispatch DRAG_DROP_PASTE. */
function FilesPlugin({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [editor] = useLexicalComposerContext();
  const ref = useRef(onFiles);
  ref.current = onFiles;
  useEffect(
    () =>
      editor.registerCommand(
        DRAG_DROP_PASTE,
        (files) => {
          if (files.length > 0) ref.current(files);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor],
  );
  return null;
}

export function EntityTextEditor({
  value,
  editable,
  runtime,
  workspaceId,
  source,
  sourceLabel,
  sourceIcon,
  currentUserId,
  placeholder,
  ariaLabel,
  format = "html",
  className,
  surface = "ring",
  placeholderClassName,
  onCommit,
  onChange,
  onEnter,
  apiRef,
  onMentionPerson,
  onFiles,
}: EntityTextEditorProps) {
  const soft = surface === "soft";
  const markdown = format === "markdown";
  const initialConfig = useMemo(
    () => ({
      namespace: markdown ? "entity-text-markdown" : "entity-text",
      editable,
      onError: (error: Error) => {
        console.error("EntityTextEditor error:", error);
      },
      nodes: markdown
        ? [EntityRefNode, DateNode, ListNode, ListItemNode, QuoteNode, LinkNode]
        : [EntityRefNode, DateNode],
      theme: markdown ? MARKDOWN_THEME : THEME,
    }),
    [editable, markdown],
  );
  const taskKey = useContext(WorkspaceContext)?.selectedWorkspace?.taskKey ?? null;
  const taskKeys = useMemo(() => (taskKey ? [taskKey] : []), [taskKey]);
  // `/` creates where the page can ("New task “…”" in Tasks), and only where
  // the new item has something to link from (not an unsaved capture).
  const host = useReferenceHost();
  const createEntity = source ? host?.createEntity : undefined;
  const onCreateEntity = useMemo(
    () =>
      createEntity
        ? async (type: string, label: string): Promise<MentionInsert | null> => {
            const ref = await createEntity(type, label);
            return ref ? { ref, label, icon: type } : null;
          }
        : undefined,
    [createEntity],
  );
  // Which of the three menus is open (a host's Esc closes a menu first).
  const menuOpen = useRef<Record<string, boolean>>({});
  const menuChange = (sigil: string) => (open: boolean) => {
    menuOpen.current = { ...menuOpen.current, [sigil]: open };
  };

  // A typed handle that linked itself is a mention like `@` (it shows in Linked).
  const linkTypedHandle = (taskId: string) => {
    if (!runtime || !workspaceId || !source) return;
    if (source.type === "task" && source.id === taskId) return;
    void runtime.spine
      .createLink({
        workspaceId,
        source,
        target: { type: "task", id: taskId },
        relationKind: "mentions",
        origin: "mention",
        sourceLabel,
        sourceIcon: sourceIcon ?? null,
      })
      .catch(() => {
        // Quiet: the reference is in the text either way; Linked catches up on the next link.
      });
  };

  const shared = {
    runtime,
    workspaceId,
    source,
    sourceLabel,
    sourceIcon,
    currentUserId,
    // Privacy first: a description stores `{type, id, display}`, never a title.
    storeLabel: false,
    cards: true,
    showAs: true,
    includeProjects: true,
  } as const;

  let markdownPlugins: ReactNode = null;
  if (markdown) {
    markdownPlugins = (
      <>
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <LinkOpenPlugin editable={editable} runtime={runtime} />
        {editable ? (
          <>
            <MarkdownShortcutPlugin transformers={DESCRIPTION_TRANSFORMERS} />
            <MarkdownFormatsPlugin />
          </>
        ) : null}
      </>
    );
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label={ariaLabel ?? "Description"}
              className={cn(
                "min-h-16 rounded-md text-sm leading-relaxed text-foreground outline-none",
                soft && "px-2 py-1 transition-colors duration-(--motion-fade) ease-(--ease-out)",
                !editable || surface === "bare"
                  ? !editable && "cursor-default"
                  : soft
                    ? "focus:bg-state-hover"
                    : "focus-visible:ring-2 focus-visible:ring-ring",
                className,
              )}
            />
          }
          placeholder={
            placeholder ? (
              <div
                className={cn(
                  "pointer-events-none absolute text-sm text-muted-foreground",
                  soft ? "inset-x-2 top-1" : "left-0 top-0",
                  placeholderClassName,
                )}
              >
                {placeholder}
              </div>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <SeedPlugin value={value} format={format} />
      {markdownPlugins}
      {editable && onCommit ? <CommitOnBlurPlugin format={format} onCommit={onCommit} /> : null}
      {editable && onChange ? <ChangePlugin format={format} onChange={onChange} /> : null}
      {editable && onEnter ? <EnterCreatesPlugin onEnter={onEnter} /> : null}
      {apiRef ? <ApiPlugin apiRef={apiRef} format={format} menuOpen={menuOpen} /> : null}
      {editable && onFiles ? <FilesPlugin onFiles={onFiles} /> : null}
      {editable ? (
        <>
          <MentionMenuPlugin
            {...shared}
            triggerChar="@"
            trigger="mention"
            onMentionPerson={onMentionPerson}
            onMenuChange={menuChange("@")}
          />
          <MentionMenuPlugin
            {...shared}
            triggerChar="/"
            trigger="ref"
            dateCommands
            onCreateEntity={onCreateEntity}
            onMenuChange={menuChange("/")}
          />
          <MentionMenuPlugin
            {...shared}
            triggerChar="#"
            trigger="tag"
            onMenuChange={menuChange("#")}
          />
          <HandleAutolinkPlugin taskKeys={taskKeys} onLinked={linkTypedHandle} />
        </>
      ) : null}
    </LexicalComposer>
  );
}
