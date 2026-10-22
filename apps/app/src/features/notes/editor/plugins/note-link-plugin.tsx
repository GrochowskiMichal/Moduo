/**
 * The `[[` note picker (NR-4, AC8). Typing `[[` opens it at the caret; the
 * query filters live notes, and "Create '…'" makes a new Inbox note when no
 * title matches. A pick swaps `[[query` for a live note chip and records a
 * `references` link from this note (for a created note, once its row exists).
 * Keys and dismissal are the shared caret-menu regime (spine/editor/menu-keys),
 * the same as `/` and `@`. Tokens-only.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, $isTextNode, type LexicalEditor } from "lexical";
import { FilePlus2, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { closeOnOutsidePointer, registerMenuKeys } from "@/features/spine/editor/menu-keys";
import { resolveMention } from "@/features/spine/mention";
import { executeMention, type MentionContext } from "@/features/spine/mention-actions";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";

import {
  $insertNoteLink,
  noteLinkCandidate,
  noteLinkQueryAt,
  type NoteLinkRow,
  noteLinkRows,
  type NoteLinkToken,
} from "../note-link";
import { useNotesEditorBridge } from "../notes-editor-bridge";

type MenuState = NoteLinkToken & { query: string; top: number; left: number };

const MENU_WIDTH = 288;
const MENU_MAX_HEIGHT = 320;

function resolveMenu(editor: LexicalEditor): MenuState | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
    const anchor = selection.anchor;
    if (anchor.type !== "text") return null;
    const node = anchor.getNode();
    if (!$isTextNode(node) || !node.isSimpleText()) return null;
    const found = noteLinkQueryAt(node.getTextContent().slice(0, anchor.offset));
    if (!found) return null;
    const dom = window.getSelection();
    if (!dom || dom.rangeCount === 0) return null;
    const range = dom.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    const margin = 12;
    let top = rect.bottom + 8;
    if (top + MENU_MAX_HEIGHT > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - 8 - MENU_MAX_HEIGHT);
    }
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - MENU_WIDTH - margin));
    return {
      nodeKey: node.getKey(),
      start: found.start,
      end: anchor.offset,
      query: found.query,
      top,
      left,
    };
  });
}

export function NoteLinkPlugin({
  workspaceId,
  runtime,
  noteId,
  sourceLabel,
}: {
  workspaceId: string;
  runtime: ModuoRuntime | null;
  noteId: string;
  sourceLabel: string;
}) {
  const [editor] = useLexicalComposerContext();
  const bridge = useNotesEditorBridge();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [selected, setSelected] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const listNotes = bridge?.listNotes;
  const canCreate = Boolean(bridge?.createLinkedNote);
  const rows: NoteLinkRow[] = menu
    ? noteLinkRows(listNotes?.() ?? [], menu.query, noteId).filter(
        (r) => r.kind === "note" || canCreate,
      )
    : [];

  const live = useRef({ menu, rows, selected });
  live.current = { menu, rows, selected };

  useEffect(() => {
    if (!listNotes) return;
    return editor.registerUpdateListener(() => setMenu(resolveMenu(editor)));
  }, [editor, listNotes]);

  // A fresh query starts at the top row.
  const query = menu?.query;
  useEffect(() => {
    if (query !== undefined) setSelected(0);
  }, [query]);

  const link = (target: { id: string; title: string }) => {
    if (!runtime) return;
    const ctx: MentionContext = {
      workspaceId,
      source: { type: "note", id: noteId },
      sourceLabel,
      sourceIcon: "note",
    };
    const resolution = resolveMention({
      trigger: "ref",
      candidate: noteLinkCandidate(target.id, target.title),
    });
    const write = () => executeMention(runtime, ctx, resolution);
    void write().catch(() => {
      toast.error("Couldn't link that note.", {
        action: { label: "Retry", onClick: () => void write() },
      });
    });
  };

  const pick = (row: NoteLinkRow) => {
    const active = live.current.menu;
    if (!active) return;
    let target: { id: string; title: string } | null = null;
    let created: Promise<boolean> = Promise.resolve(true);
    if (row.kind === "note") {
      target = { id: row.id, title: row.title };
    } else {
      const made = bridge?.createLinkedNote?.(row.title) ?? null;
      if (!made) {
        toast.error("Couldn't create that note here.");
        return;
      }
      target = { id: made.id, title: row.title };
      created = made.created;
    }
    const chosen = target;
    setMenu(null);
    editor.update(() => {
      $insertNoteLink(active, chosen);
    });
    void created.then((ok) => {
      if (ok) link(chosen);
    });
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(
    () =>
      registerMenuKeys(editor, {
        isOpen: () => live.current.menu !== null && live.current.rows.length > 0,
        count: () => live.current.rows.length,
        index: () => live.current.selected,
        setIndex: setSelected,
        pick: (index) => {
          const row = live.current.rows[index];
          if (row) pickRef.current(row);
        },
        close: () => setMenu(null),
      }),
    [editor],
  );

  const open = menu !== null && rows.length > 0;
  useEffect(() => {
    if (!open) return;
    return closeOnOutsidePointer(
      (target) => boxRef.current?.contains(target) ?? false,
      () => setMenu(null),
    );
  }, [open]);

  if (!menu || !open) return null;
  return createPortal(
    <div
      ref={boxRef}
      className="fixed z-[var(--z-popover)] max-h-80 w-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg scrollbar-thin"
      style={{ top: menu.top, left: menu.left }}
      role="listbox"
      aria-label="Link a note"
    >
      {rows.map((row, index) => {
        const Icon = row.kind === "create" ? FilePlus2 : FileText;
        return (
          <button
            key={row.kind === "note" ? row.id : "create"}
            type="button"
            role="option"
            aria-selected={index === selected}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-accent",
              index === selected && "bg-accent",
            )}
            onMouseEnter={() => setSelected(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              pick(row);
            }}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {row.kind === "create" ? `Create “${row.title}”` : row.title}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
