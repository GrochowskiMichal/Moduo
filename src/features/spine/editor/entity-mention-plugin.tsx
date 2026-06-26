// Connective-tissue spine — the @mention / /ref Lexical plugin (block CT-4).
//
// Drops the registry-backed picker into any LexicalComposer. It watches for an
// `@…` token (mention) or a `/task` `/note` `/contact` token (ref), opens the
// {@link MentionPicker} at the caret, and on selection removes the token, inserts
// an inline {@link EntityRefNode}, and persists the link via `persistMention`
// (kind=mentions for @, references for /ref; a person routes to the notification
// handler; a no-match creates-and-links). Token detection + caret positioning
// mirror src/features/notes/editor/plugins/SlashCommandPlugin.tsx.
//
// Live-mount status: this needs a Supabase-backed, registry-resident editor
// surface to supply a valid `focus` link source. None exists at alpha (Notes are
// Yjs/redb, not registry entities), so the plugin ships ready but unmounted; it
// wires into its first valid consumer (comments CT-5 / a task description CT-7).
// Without `focus` it still inserts the chip but writes no link (display-only).

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
  type NodeKey,
} from "lexical";
import { toast } from "sonner";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import {
  persistMention,
  refCommandType,
  resolveMentionAction,
  type MentionPick,
  type MentionTrigger,
} from "../mention";
import { MentionPicker, type MentionMember } from "../ui/mention-picker";
import { $createEntityRefNode } from "./entity-ref-node";

type TriggerState = {
  trigger: MentionTrigger;
  /** The entity type a `/`-command scoped to (null for `@`). */
  scopeType: string | null;
  /** The query text already typed after the trigger (seeds the picker). */
  query: string;
  nodeKey: NodeKey;
  startOffset: number;
  endOffset: number;
  top: number;
  left: number;
};

const MENTION_RE = /(?:^|\s)(@[^\s@]*)$/;
const REF_RE = /(?:^|\s)(\/(?:task|note|contact)(?:\s+[^/]*)?)$/i;

function caretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  return range.getBoundingClientRect();
}

function resolveTrigger(editor: LexicalEditor): TriggerState | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
    const anchor = selection.anchor;
    if (anchor.type !== "text") return null;
    const node = anchor.getNode();
    if (!$isTextNode(node) || !node.isSimpleText()) return null;

    const textBefore = node.getTextContent().slice(0, anchor.offset);
    const mention = textBefore.match(MENTION_RE);
    const ref = mention ? null : textBefore.match(REF_RE);
    const match = mention ?? ref;
    if (!match) return null;

    const token = match[1] ?? "";
    const startOffset = anchor.offset - token.length;
    if (startOffset < 0) return null;

    let trigger: MentionTrigger;
    let scopeType: string | null;
    let query: string;
    if (mention) {
      trigger = "mention";
      scopeType = null;
      query = token.slice(1); // drop the leading '@'
    } else {
      trigger = "ref";
      const cmd = token.match(/^\/(task|note|contact)/i)?.[1]?.toLowerCase() ?? "";
      scopeType = refCommandType(cmd);
      query = token.replace(/^\/(task|note|contact)\s*/i, "");
    }

    if (typeof window === "undefined") return null;
    const rect = caretRect();
    if (!rect) return null;
    const margin = 12;
    const menuWidth = 280;
    const menuMaxHeight = 360;
    let top = rect.bottom + 8;
    if (top + menuMaxHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - 8 - menuMaxHeight);
    }
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - menuWidth - margin));

    return { trigger, scopeType, query, nodeKey: node.getKey(), startOffset, endOffset: anchor.offset, top, left };
  });
}

export type EntityMentionPluginProps = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** The entity being edited — the link source. When null, chips insert but no link is written. */
  focus?: EntityRef | null;
  /** Workspace members offered for a person `@`-mention. */
  members?: MentionMember[];
  /** Which `/`-command types may create-and-link a no-match (e.g. ["task"]). */
  createTypes?: string[];
  onMentionPerson?: (userId: string, name: string) => Promise<void> | void;
  createEntity?: (entityType: string, label: string) => Promise<EntityRef>;
};

export function EntityMentionPlugin({
  runtime,
  workspaceId,
  focus = null,
  members = [],
  createTypes = ["task"],
  onMentionPerson,
  createEntity,
}: EntityMentionPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<TriggerState | null>(null);
  const menuRef = useRef<TriggerState | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);
  menuRef.current = menu;

  const close = useCallback(
    (refocus = true) => {
      setMenu(null);
      if (refocus) editor.focus();
    },
    [editor],
  );

  // Open on trigger appearance. Closing is owned by select / escape / click-away
  // (not the listener) — opening the picker moves focus out of the editor, which
  // would otherwise clear the selection and immediately re-close the menu.
  useEffect(() => {
    return editor.registerUpdateListener(() => {
      if (menuRef.current) return; // already open — picker controls dismissal
      const next = resolveTrigger(editor);
      if (next) setMenu(next);
    });
  }, [editor]);

  // Escape closes (Lexical owns the key while the editor still has focus).
  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (!menuRef.current) return false;
        close();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, close]);

  // Click-away closes.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (portalRef.current && !portalRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [menu, close]);

  const removeToken = useCallback(
    (active: TriggerState) => {
      const node = $getNodeByKey(active.nodeKey);
      if (!$isTextNode(node)) return;
      const len = node.getTextContent().length;
      if (active.startOffset < 0 || active.endOffset > len || active.startOffset >= active.endOffset) return;
      node.spliceText(active.startOffset, active.endOffset - active.startOffset, "", false);
      node.select(active.startOffset, active.startOffset);
    },
    [],
  );

  const handlePick = useCallback(
    async (pick: MentionPick) => {
      const active = menuRef.current;
      if (!active) return;
      const action = resolveMentionAction(active.trigger, pick);
      close(true);

      // Persist first (link write may fail / require permission); only then
      // commit the chip, so a failed write never leaves an unlinked chip. A
      // person mention inserts a durable `user` chip carrying the userId (so the
      // member stays resolvable on reload) while the notification is routed via
      // `onMentionPerson` (CT-5). The link write only happens on a link-capable
      // surface (a registry-resident `focus`).
      let inserted: { entityType: string; entityId: string; label: string; icon: string | null } | null = null;
      try {
        if (focus && runtime && workspaceId) {
          const result = await persistMention({
            runtime,
            workspaceId,
            focus,
            action,
            onMentionPerson,
            createEntity,
          });
          inserted =
            result.kind === "entity"
              ? { entityType: result.ref.type, entityId: result.ref.id, label: result.label, icon: result.icon }
              : { entityType: "user", entityId: result.userId, label: result.name, icon: "user" };
        } else if (action.type === "link-entity") {
          // Display-only surface (no valid link source): insert the chip, no link.
          inserted = {
            entityType: action.ref.type,
            entityId: action.ref.id,
            label: action.label,
            icon: action.icon,
          };
        } else if (action.type === "mention-person") {
          inserted = { entityType: "user", entityId: action.userId, label: action.name, icon: "user" };
        }
        // A no-match create-and-link can't resolve an id without a link-capable
        // surface; `inserted` stays null and we bail below rather than delete text.
      } catch (err) {
        toast.error("Couldn’t create the link", {
          description: err instanceof Error ? err.message : undefined,
        });
        return;
      }

      // Nothing resolved: leave the typed token untouched rather than silently
      // swallowing the user's text.
      if (!inserted) return;
      const toInsert = inserted;

      editor.update(() => {
        removeToken(active);
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const node = $createEntityRefNode(toInsert);
        selection.insertNodes([node, $createTextNode(" ")]);
      });
    },
    [editor, focus, runtime, workspaceId, onMentionPerson, createEntity, close, removeToken],
  );

  if (!menu) return null;

  const createType =
    menu.scopeType && createTypes.includes(menu.scopeType) ? menu.scopeType : null;

  return createPortal(
    <div
      ref={portalRef}
      className="fixed z-50 w-70 overflow-hidden rounded-lg border border-border bg-popover shadow-md"
      style={{ top: menu.top, left: menu.left }}
      onKeyDown={(e) => {
        // The picker steals focus from the editor, so Lexical's
        // KEY_ESCAPE_COMMAND never sees the key — close it here instead.
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <MentionPicker
        runtime={runtime}
        workspaceId={workspaceId}
        types={menu.scopeType ? [menu.scopeType] : undefined}
        members={menu.trigger === "mention" ? members : []}
        createType={createType}
        initialQuery={menu.query}
        onPick={(pick) => void handlePick(pick)}
        placeholder={menu.trigger === "mention" ? "Mention…" : "Reference…"}
      />
    </div>,
    document.body,
  );
}
