// Connective-tissue spine — the inline `@mention` Lexical plugin (block CT-4).
//
// Typing `@` in prose opens a registry-backed menu (entities + people); picking
// an entity inserts a neutral `EntityRefNode` and writes an `entity_link`
// (`kind=mentions`), picking a person writes a person-targeted activity row
// (the op lands with CT-5; here it routes through the `onMentionPerson` seam and
// inserts the person's name). Selection is funnelled through the pure
// `resolveMention` + `executeMention`. The caret detection / positioning /
// keyboard handling mirror the notes slash menu (now slash-menu-plugin); only the
// trigger (`@`) and the menu content/actions differ. Tokens-only (DESIGN_RULES).

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
  type NodeKey,
} from "lexical";
import { User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Eyebrow } from "@/components/ui/eyebrow";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { useMentionSearch } from "../hooks/use-mention-search";
import { resolveEntityIcon } from "../icon-map";
import { type MentionCandidate, type MentionTrigger, resolveMention } from "../mention";
import { executeMention, type MentionContext } from "../mention-actions";
import { $createEntityRefNode } from "./entity-ref-node";

type MentionMenuState = {
  query: string;
  nodeKey: NodeKey;
  startOffset: number;
  endOffset: number;
  top: number;
  left: number;
};

export type MentionMenuPluginProps = {
  workspaceId: string | null;
  runtime: ModuoRuntime | null;
  /** The text surface's own entity (the link's source end). `null` = an
   * insert-only surface with no persistable source (e.g. an unsent email
   * compose draft): the chip is inserted and deep-links, but no `entity_link`
   * is written (there is nothing to link *from* yet). */
  source: EntityRef | null;
  /** The source's registry label/icon (seeds the registry on link). */
  sourceLabel?: string;
  sourceIcon?: string | null;
  currentUserId?: string | null;
  /** Host seam for the person-mention activity row (CT-5 wires the real op). */
  onMentionPerson?: (memberId: string, label: string) => Promise<void> | void;
  /** `@` = workspace people ONLY (the Notes grammar, Wave-3 AC5) — entities
   * leave the picker; they ride the `/` nouns instead. */
  peopleOnly?: boolean;
  /** The character that opens the menu (default `@`). DF-23 mounts a second
   * instance with `/` so the same machinery serves `@mention` and `/ref`. */
  triggerChar?: "@" | "/";
  /** Relation semantics: `mention` (→ `mentions`) or `ref` (→ `references`).
   * Defaults to `mention` so existing (Notes) call sites are unchanged. */
  trigger?: MentionTrigger;
};

const MENU_MIN_WIDTH = 240;
const MENU_MAX_HEIGHT = 320;

// Caret token grammar per trigger char: the trigger must sit at line start or
// after whitespace (so it never fires mid-word — e.g. an email address's `@`,
// or a `7/11` date's `/`), and the query runs until the next whitespace/trigger.
function mentionTokenRegex(triggerChar: string): RegExp {
  // Both `@` and `/` are regex-literal here (incl. inside the char class).
  return new RegExp(`(?:^|\\s)${triggerChar}([^\\s${triggerChar}]*)$`);
}

function resolveMentionMenuState(
  editor: LexicalEditor,
  triggerChar: string,
): MentionMenuState | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

    const anchor = selection.anchor;
    if (anchor.type !== "text") return null;

    const node = anchor.getNode();
    if (!$isTextNode(node) || !node.isSimpleText()) return null;

    const textBefore = node.getTextContent().slice(0, anchor.offset);
    const match = textBefore.match(mentionTokenRegex(triggerChar));
    if (!match) return null;

    const query = match[1] ?? "";
    const token = `${triggerChar}${query}`;
    const startOffset = textBefore.lastIndexOf(token);
    if (startOffset < 0) return null;

    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return null;

    const range = domSelection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    const margin = 12;

    let top = rect.bottom + 8;
    if (top + MENU_MAX_HEIGHT > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - 8 - MENU_MAX_HEIGHT);
    }
    top = Math.min(top, Math.max(margin, window.innerHeight - margin - MENU_MAX_HEIGHT));
    const maxLeft = Math.max(margin, window.innerWidth - MENU_MIN_WIDTH - margin);
    const left = Math.max(margin, Math.min(rect.left, maxLeft));

    return { query, nodeKey: node.getKey(), startOffset, endOffset: anchor.offset, top, left };
  });
}

function removeMentionToken(menu: MentionMenuState): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const node = $getNodeByKey(menu.nodeKey);
  if (!$isTextNode(node)) return;
  const text = node.getTextContent();
  if (menu.startOffset < 0 || menu.endOffset > text.length || menu.startOffset >= menu.endOffset) {
    return;
  }
  node.spliceText(menu.startOffset, menu.endOffset - menu.startOffset, "", false);
  selection.setTextNodeRange(node, menu.startOffset, node, menu.startOffset);
}

export function MentionMenuPlugin({
  workspaceId,
  runtime,
  source,
  sourceLabel,
  sourceIcon,
  currentUserId,
  onMentionPerson,
  peopleOnly = false,
  triggerChar = "@",
  trigger = "mention",
}: MentionMenuPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<MentionMenuState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { query, setQuery, candidates, loading } = useMentionSearch({
    runtime,
    workspaceId,
    trigger,
    currentUserId,
    // People ride the `@`/mention trigger only, and only once a host wires the
    // person-notification seam (CT-5); a `/ref` menu is entities-only.
    includePeople: trigger === "mention" && Boolean(onMentionPerson),
    includeEntities: !peopleOnly,
    enabled: menu !== null,
  });

  const menuRef = useRef<MentionMenuState | null>(null);
  const candidatesRef = useRef<MentionCandidate[]>([]);
  const selectedIndexRef = useRef(0);
  useEffect(() => {
    menuRef.current = menu;
    candidatesRef.current = candidates;
    selectedIndexRef.current = selectedIndex;
  });

  // Drive the search off the caret query.
  useEffect(() => {
    setQuery(menu?.query ?? "");
  }, [menu?.query, setQuery]);

  // Keep the selection in range as the candidate list changes.
  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, candidates.length - 1)));
  }, [candidates.length]);

  const commit = (candidate: MentionCandidate) => {
    const activeMenu = menuRef.current;
    if (!activeMenu || !runtime || !workspaceId) return;
    const resolution = resolveMention({ trigger, candidate });

    // For an existing entity, insert the chip optimistically (we hold its
    // label/icon already); for a person, insert their name. Then reconcile.
    editor.focus();
    editor.update(() => {
      removeMentionToken(activeMenu);
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      if (resolution.action === "link") {
        selection.insertNodes([
          $createEntityRefNode({
            entityType: resolution.target.type,
            entityId: resolution.target.id,
            label: resolution.label,
            icon: resolution.icon,
          }),
          $createTextNode(" "),
        ]);
      } else if (resolution.action === "notify-person") {
        selection.insertNodes([$createTextNode(`${triggerChar}${resolution.label} `)]);
      }
    });
    setMenu(null);

    // The write just RECONCILES the optimistic insert above (never a
    // `create-and-link` — that's a picker-only candidate). Skip it when there's
    // nothing to write against: a `link` with no `source` (insert-only surface),
    // or a `notify-person` with no host seam. On failure the chip/text stays and
    // Retry recovers the link — never silently lost.
    const needsWrite =
      resolution.action === "notify-person" ? Boolean(onMentionPerson) : Boolean(source);
    if (!needsWrite) return;

    const ctx: MentionContext = {
      // `source` is non-null on the `link` path here (needsWrite gated it); the
      // fallback only ever backs a `notify-person`, which reads onMentionPerson.
      workspaceId,
      source: source ?? { type: "", id: "" },
      sourceLabel,
      sourceIcon: sourceIcon ?? null,
      onMentionPerson,
    };
    const failCopy =
      resolution.action === "notify-person" ? "Couldn't send that mention." : "Couldn't link that.";
    void executeMention(runtime, ctx, resolution).catch(() => {
      toast.error(failCopy, {
        action: { label: "Retry", onClick: () => void executeMention(runtime, ctx, resolution) },
      });
    });
  };

  // The keyboard handler is registered once; route through a ref so Enter always
  // calls the latest `commit` (fresh runtime / workspace / context), not a stale
  // first-render closure.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  // ── caret detection ─────────────────────────────────────────────────────────
  // A people-only surface with no person handler has NOTHING to offer — never
  // open a menu that can only say "No matches".
  const canOffer = !peopleOnly || Boolean(onMentionPerson);
  useEffect(() => {
    if (!canOffer) {
      setMenu(null);
      return;
    }
    return editor.registerUpdateListener(() => {
      if (typeof window === "undefined") return;
      setMenu(resolveMentionMenuState(editor, triggerChar));
    });
  }, [editor, canOffer, triggerChar]);

  // Fresh query → fresh highlight (never a stale mid-list selection).
  useEffect(() => {
    setSelectedIndex(0);
  }, [menu?.query]);

  // ── keyboard ────────────────────────────────────────────────────────────────
  useEffect(() => {
    return editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        if (!menuRef.current || candidatesRef.current.length === 0) return false;
        event?.preventDefault();
        const next = (selectedIndexRef.current + 1) % candidatesRef.current.length;
        setSelectedIndex(next);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        if (!menuRef.current || candidatesRef.current.length === 0) return false;
        event?.preventDefault();
        const len = candidatesRef.current.length;
        setSelectedIndex((selectedIndexRef.current - 1 + len) % len);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        if (!menuRef.current) return false;
        event?.preventDefault();
        setMenu(null);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const active = candidatesRef.current;
        if (!menuRef.current || active.length === 0) return false;
        event?.preventDefault();
        const candidate = active[selectedIndexRef.current] ?? active[0];
        if (candidate) commitRef.current(candidate);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!menu) return null;

  return createPortal(
    <div
      className="fixed z-50 max-h-80 min-w-60 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ top: menu.top, left: menu.left }}
      role="listbox"
      aria-label={trigger === "ref" ? "Insert reference" : "Mention"}
    >
      {loading && candidates.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">Searching…</p>
      ) : candidates.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">No matches.</p>
      ) : (
        candidates.map((candidate, index) => {
          const isSelected = index === selectedIndex;
          // The `@` trigger only ever yields entity / person candidates
          // (`buildMentionCandidates` reserves "create" for `/ref`).
          const Icon =
            candidate.kind === "entity"
              ? resolveEntityIcon(candidate.ref.type, candidate.icon)
              : User;
          return (
            <button
              key={`${candidate.kind}:${index}`}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-(--motion-fade) ease-(--ease-out) ${
                isSelected ? "bg-accent text-foreground" : "text-foreground hover:bg-accent"
              }`}
              onMouseEnter={() => setSelectedIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                commit(candidate);
              }}
            >
              <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
              {candidate.kind === "person" ? (
                <Eyebrow className="shrink-0" tone="tag">
                  person
                </Eyebrow>
              ) : null}
            </button>
          );
        })
      )}
    </div>,
    document.body,
  );
}
