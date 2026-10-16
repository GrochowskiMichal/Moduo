/**
 * ⌘K on a selection (NR-4, AC8): a small dialog that links the selected text
 * to a URL or to a note. Typing a URL offers "Link to …" first; typing words
 * searches notes, and picking one turns the selection into that note's live
 * chip and records a `references` link. "Remove link" shows when the selection
 * already holds one. The selection toolbar opens the same dialog. With nothing
 * selected, ⌘K is left alone and the global palette opens as usual.
 */

import { $isLinkNode, $toggleLink } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  KEY_MODIFIER_COMMAND,
  type LexicalCommand,
  type RangeSelection,
} from "lexical";
import { FileText, Globe, Unlink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { $createEntityRefNode } from "@/features/spine/editor/entity-ref-node";
import { resolveMention } from "@/features/spine/mention";
import { executeMention } from "@/features/spine/mention-actions";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { type LinkDialogRow, linkDialogRows } from "../link-dialog";
import { noteLinkCandidate } from "../note-link";
import { useNotesEditorBridge } from "../notes-editor-bridge";

/** Open the link dialog over the current selection (⌘K and the toolbar). */
export const OPEN_LINK_DIALOG_COMMAND: LexicalCommand<void> = createCommand("OPEN_LINK_DIALOG");

type Opened = { selection: RangeSelection; text: string; url: string | null };

function $selectionLinkUrl(selection: RangeSelection): string | null {
  for (const node of selection.getNodes()) {
    const link = $isLinkNode(node) ? node : node.getParent();
    if ($isLinkNode(link)) return link.getURL();
  }
  return null;
}

export function LinkDialogPlugin({
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
  const [opened, setOpened] = useState<Opened | null>(null);
  const [input, setInput] = useState("");
  const openedRef = useRef(opened);
  openedRef.current = opened;

  useEffect(() => {
    const open = () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) return false;
      const url = $selectionLinkUrl(selection);
      setOpened({ selection: selection.clone(), text: selection.getTextContent(), url });
      setInput(url ?? "");
      return true;
    };
    const offOpen = editor.registerCommand(OPEN_LINK_DIALOG_COMMAND, open, COMMAND_PRIORITY_NORMAL);
    const offKey = editor.registerCommand(
      KEY_MODIFIER_COMMAND,
      (event: KeyboardEvent) => {
        if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return false;
        if (event.key.toLowerCase() !== "k") return false;
        if (!open()) return false;
        // Keeps the global ⌘K palette shut (it skips a handled key).
        event.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    );
    return () => {
      offOpen();
      offKey();
    };
  }, [editor]);

  const close = () => {
    const saved = openedRef.current;
    setOpened(null);
    setInput("");
    if (saved) {
      editor.update(() => $setSelection(saved.selection.clone()));
      editor.focus();
    }
  };

  const apply = (row: LinkDialogRow) => {
    const saved = openedRef.current;
    if (!saved) return;
    setOpened(null);
    setInput("");
    editor.focus();
    editor.update(() => {
      $setSelection(saved.selection.clone());
      if (row.kind === "url") $toggleLink(row.url);
      else if (row.kind === "unlink") $toggleLink(null);
      else {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        selection.insertNodes([
          $createEntityRefNode({
            entityType: "note",
            entityId: row.id,
            label: saved.text.trim() || row.title,
            icon: "note",
          }),
        ]);
      }
    });
    if (row.kind === "note" && runtime) {
      const resolution = resolveMention({
        trigger: "ref",
        candidate: noteLinkCandidate(row.id, row.title),
      });
      const ctx = {
        workspaceId,
        source: { type: "note", id: noteId },
        sourceLabel,
        sourceIcon: "note",
      };
      void executeMention(runtime, ctx, resolution).catch(() => {
        toast.error("Couldn't link that note.");
      });
    }
  };

  const rows = opened
    ? linkDialogRows(input, bridge?.listNotes?.() ?? [], noteId, opened.url !== null)
    : [];

  return (
    <CommandDialog
      open={opened !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Link"
      description="Link the selected text to a web address or a note."
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        value={input}
        onValueChange={setInput}
        placeholder="Paste a link, or search notes…"
      />
      <CommandList>
        <CommandEmpty>Type a web address, or a note's title.</CommandEmpty>
        {rows.map((row) => {
          const key = row.kind === "note" ? `note:${row.id}` : row.kind;
          return (
            <CommandItem key={key} value={key} onSelect={() => apply(row)}>
              {row.kind === "url" ? (
                <>
                  <Globe aria-hidden />
                  <span className="truncate">Link to {row.url}</span>
                </>
              ) : row.kind === "note" ? (
                <>
                  <FileText aria-hidden />
                  <span className="truncate">{row.title}</span>
                </>
              ) : (
                <>
                  <Unlink aria-hidden />
                  Remove link
                </>
              )}
            </CommandItem>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
