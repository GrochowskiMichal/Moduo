/**
 * The link under the caret: its address, Open, Edit and Remove, in a small
 * bar under it. A link in a note could not be opened, edited or removed
 * (clicking it did nothing, ⌘-click neither). ⌘-click on a link opens it.
 */

import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import { ExternalLink, Pencil, Unlink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { IconButton } from "@/components/ui/icon-button";

import { OPEN_LINK_DIALOG_COMMAND } from "./link-dialog-plugin";

type Bar = { url: string; top: number; left: number };

/** Open an address in a new tab (http, https and mailto only). */
function openUrl(url: string): void {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function LinkBarPlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [bar, setBar] = useState<Bar | null>(null);

  const recompute = useCallback(() => {
    const next = editor.getEditorState().read((): Bar | null => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
      const parent = selection.anchor.getNode().getParent();
      const link = $isLinkNode(parent) ? parent : null;
      if (!link) return null;
      const url = link.getURL();
      // A note link (moduo://) opens through its chip, not here.
      if (url.startsWith("moduo://")) return null;
      const el = editor.getElementByKey(link.getKey());
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { url, top: r.bottom + 6, left: r.left };
    });
    setBar((prev) =>
      prev && next && prev.url === next.url && prev.top === next.top && prev.left === next.left
        ? prev
        : next,
    );
  }, [editor]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const url = editor.read(() => {
        const node = $getNearestNodeFromDOMNode(anchor);
        const link = $isLinkNode(node) ? node : node?.getParent();
        return $isLinkNode(link) ? link.getURL() : null;
      });
      if (!url) return;
      event.preventDefault();
      openUrl(url);
    };
    const onScroll = () => setBar(null);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return mergeRegister(
      editor.registerRootListener((root, prev) => {
        prev?.removeEventListener("click", onClick);
        root?.addEventListener("click", onClick);
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          recompute();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerUpdateListener(() => recompute()),
      () => {
        editor.getRootElement()?.removeEventListener("click", onClick);
        window.removeEventListener("scroll", onScroll, { capture: true });
      },
    );
  }, [editor, recompute]);

  /** Select the whole link under the caret, then run `then` on it. */
  const onWholeLink = (then: () => void) => {
    editor.update(
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const parent = selection.anchor.getNode().getParent();
        if ($isLinkNode(parent)) parent.select(0, parent.getChildrenSize());
      },
      { discrete: true },
    );
    then();
  };

  if (!bar) return null;
  return createPortal(
    <div
      role="toolbar"
      aria-label="Link"
      className="fixed z-(--z-popover) flex max-w-sm items-center gap-1 rounded-md border border-hairline bg-popover py-0.5 pr-0.5 pl-2 text-popover-foreground shadow-lg"
      style={{ top: bar.top, left: bar.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="min-w-0 truncate font-sans text-xs text-muted-foreground">{bar.url}</span>
      <IconButton
        icon={ExternalLink}
        label="Open link"
        size="sm"
        onClick={() => openUrl(bar.url)}
      />
      {editable ? (
        <>
          <IconButton
            icon={Pencil}
            label="Edit link (⌘K)"
            size="sm"
            onClick={() =>
              onWholeLink(() => editor.dispatchCommand(OPEN_LINK_DIALOG_COMMAND, undefined))
            }
          />
          <IconButton
            icon={Unlink}
            label="Remove link"
            size="sm"
            onClick={() => onWholeLink(() => editor.dispatchCommand(TOGGLE_LINK_COMMAND, null))}
          />
        </>
      ) : null}
    </div>,
    document.body,
  );
}
