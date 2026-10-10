// Connective-tissue spine — the inline `@` / `/` / `#` menu (CT-4; the
// grammar since RF-1, spine/grammar.ts).
//
// Typing a sigil at a word start opens a menu (the caret detection is the
// grammar's one tokenizer, so `C#`, `and/or` and an email's `@` stay text):
// - `@` mentions: people first (when the host can notify them), then projects,
//   then things; picking a thing inserts a Reference and writes a `mentions`
//   link from the surface's own entity;
// - `/` runs commands: the date commands first (`/today`, `/tomorrow`,
//   `/next week`, `/date` → a date chip), then things to insert, then
//   "New task “…”" where the host can create one;
// - `#` links a tag (a link in prose; it never changes the item's tags).
// A reference inserted in running text is a chip; alone on its line it is a
// card (where the surface allows cards); "Show as" follows the insert.
// Selection funnels through the pure `resolveMention` + `executeMention`.
// Tokens-only (DESIGN_RULES).

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
} from "lexical";
import { CalendarDays, Plus, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Calendar } from "@/components/ui/calendar";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { dateCommandDay, isoDay, triggerAt } from "../grammar";
import { useMentionSearch } from "../hooks/use-mention-search";
import { resolveEntityIcon } from "../icon-map";
import { type MentionCandidate, type MentionTrigger, resolveMention } from "../mention";
import { executeMention, type MentionContext, type MentionInsert } from "../mention-actions";
import { $createDateNode } from "../references/date-node";
import { canShowAsCard, referenceKind } from "../references/kinds";
import { $createReferenceNode, markJustInserted } from "../references/reference-node";
import type { ReferenceDisplay } from "../references/types";
import { mentionCandidateKey } from "../ui/mention-picker";

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
  /** The character that opens the menu (default `@`). */
  triggerChar?: "@" | "/" | "#";
  /** Relation semantics: `mention` (→ `mentions`), `ref` (→ `references`),
   * `tag` (a `#tag` link). Defaults to `mention`. */
  trigger?: MentionTrigger;
  /**
   * Store the picked item's title in the document (default true: Notes and
   * email compose, whose readers need the words). Privacy-first surfaces (task
   * descriptions) pass false: the document then holds only `{type, id}`.
   */
  storeLabel?: boolean;
  /** A reference alone on its line becomes a card (RF-1 surfaces). */
  cards?: boolean;
  /** Offer "Show as: Link · Chip · Card" right after inserting. */
  showAs?: boolean;
  /** Offer projects among the things (`@` and `/` in prose). */
  includeProjects?: boolean;
  /** `/` lists the date commands first and inserts date chips (33a). */
  dateCommands?: boolean;
  /** `/` creates too ("New task “…”"): the host's create, returning the new item. */
  onCreateEntity?: (entityType: string, label: string) => Promise<MentionInsert | null>;
  /** The type `/` creates (default "task"). */
  createType?: string;
};

const MENU_MIN_WIDTH = 240;
const MENU_MAX_HEIGHT = 320;

function resolveMentionMenuState(
  editor: LexicalEditor,
  triggerChar: "@" | "/" | "#",
): MentionMenuState | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

    const anchor = selection.anchor;
    if (anchor.type !== "text") return null;

    const node = anchor.getNode();
    if (!$isTextNode(node) || !node.isSimpleText()) return null;

    const textBefore = node.getTextContent().slice(0, anchor.offset);
    // The grammar's one tokenizer: a sigil at a word start, the word since.
    const found = triggerAt(textBefore, [triggerChar]);
    if (!found) return null;

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

    return {
      query: found.query,
      nodeKey: node.getKey(),
      startOffset: found.start,
      endOffset: anchor.offset,
      top,
      left,
    };
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

/**
 * Is the caret's paragraph otherwise empty (a reference there sits alone on
 * its line)? Only blank text counts as empty: a reference or a date chip on the
 * line has no text of its own but is something.
 */
function $caretLineIsEmpty(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  const block = selection.anchor.getNode().getTopLevelElement();
  if (!block || !$isParagraphNode(block)) return false;
  return block
    .getChildren()
    .every((child) => $isTextNode(child) && child.getTextContent().trim() === "");
}

/**
 * Insert a reference at the selection: a card alone on its line (then a fresh
 * line to keep writing on), else a chip and a space. Returns the node's key.
 */
function $insertReference(
  ref: EntityRef,
  label: string,
  icon: string | null,
  opts: { storeLabel: boolean; cards: boolean },
): NodeKey | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const kind = referenceKind(ref.type);
  const display: ReferenceDisplay =
    opts.cards && canShowAsCard(kind) && $caretLineIsEmpty() ? "card" : "chip";
  const node = $createReferenceNode({
    entityType: ref.type,
    entityId: ref.id,
    // A privacy-first surface stores neither the title nor the item's icon
    // (a note's emoji says as much as its title).
    label: opts.storeLabel ? label : "",
    icon: opts.storeLabel ? icon : null,
    display,
  });
  if (display === "card") {
    const block = selection.anchor.getNode().getTopLevelElement();
    selection.insertNodes([node]);
    const next = $createParagraphNode();
    (block ?? node.getTopLevelElementOrThrow()).insertAfter(next);
    next.select();
  } else {
    selection.insertNodes([node, $createTextNode(" ")]);
  }
  return node.getKey();
}

/** Put a selection saved before an async step back, or the end of the document. */
function $restoreSelection(saved: RangeSelection | null): void {
  if (saved) {
    const anchor = $getNodeByKey(saved.anchor.key);
    const focus = $getNodeByKey(saved.focus.key);
    if (anchor?.isAttached() && focus?.isAttached()) {
      $setSelection(saved.clone());
      return;
    }
  }
  $getRoot().selectEnd();
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
  storeLabel = true,
  cards = false,
  showAs = false,
  includeProjects = false,
  dateCommands = false,
  onCreateEntity,
  createType = "task",
}: MentionMenuPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<MentionMenuState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // `/date` opens a calendar where the menu was; the pick goes where the caret was.
  const [datePicker, setDatePicker] = useState<{ top: number; left: number } | null>(null);
  const pickerSelection = useRef<RangeSelection | null>(null);

  const { setQuery, candidates, loading } = useMentionSearch({
    runtime,
    workspaceId,
    trigger,
    currentUserId,
    // People ride the `@` trigger only, and only once a host wires the
    // person-notification seam (CT-5); a `/` menu is commands and things.
    includePeople: trigger === "mention" && Boolean(onMentionPerson),
    includeEntities: !peopleOnly,
    includeProjects: includeProjects && !peopleOnly,
    dateCommands: dateCommands && trigger === "ref",
    createType: onCreateEntity ? createType : null,
    canCreate: Boolean(onCreateEntity) && trigger === "ref",
    // `/task Order frames` creates; `/` in a sentence never does.
    createNoun: true,
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

  const insertOpts = { storeLabel, cards };

  const insertDay = (day: string) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      selection.insertNodes([$createDateNode(day), $createTextNode(" ")]);
    });
  };

  const commit = (candidate: MentionCandidate) => {
    const activeMenu = menuRef.current;
    if (!activeMenu || !runtime || !workspaceId) return;
    const resolution = resolveMention({ trigger, candidate });

    // `/date` asks for the day first: keep the caret, open the calendar.
    if (resolution.action === "insert-date" && resolution.command === "date") {
      editor.update(() => {
        removeMentionToken(activeMenu);
        const selection = $getSelection();
        pickerSelection.current = $isRangeSelection(selection) ? selection.clone() : null;
      });
      setDatePicker({ top: activeMenu.top, left: activeMenu.left });
      setMenu(null);
      return;
    }

    // "New task “…”": create it, then insert it where the token was.
    if (resolution.action === "create-and-link") {
      let saved: RangeSelection | null = null;
      editor.update(() => {
        removeMentionToken(activeMenu);
        const selection = $getSelection();
        saved = $isRangeSelection(selection) ? selection.clone() : null;
      });
      setMenu(null);
      if (!source) return;
      const ctx: MentionContext = {
        workspaceId,
        source,
        sourceLabel,
        sourceIcon: sourceIcon ?? null,
        onCreateEntity,
      };
      void executeMention(runtime, ctx, resolution)
        .then((created) => {
          if (!created) return;
          editor.update(() => {
            $restoreSelection(saved);
            const key = $insertReference(created.ref, created.label, created.icon, insertOpts);
            if (key && showAs) markJustInserted(editor, key);
          });
        })
        .catch(() => toast.error("Couldn’t create that."));
      return;
    }

    // An entity is inserted at once; a person's name goes in as text; a date
    // command and a tag are text-like nodes. Then the write reconciles.
    editor.focus();
    let insertedKey: NodeKey | null = null;
    editor.update(() => {
      removeMentionToken(activeMenu);
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      if (resolution.action === "link") {
        insertedKey = $insertReference(
          resolution.target,
          resolution.label,
          resolution.icon,
          insertOpts,
        );
      } else if (resolution.action === "notify-person") {
        selection.insertNodes([$createTextNode(`${triggerChar}${resolution.label} `)]);
      } else if (resolution.action === "insert-date") {
        const day = dateCommandDay(resolution.command);
        if (day) selection.insertNodes([$createDateNode(day), $createTextNode(" ")]);
      } else if (resolution.action === "insert-tag") {
        const nodes: LexicalNode[] = [
          $createReferenceNode({
            entityType: "tag",
            entityId: resolution.tagId,
            label: storeLabel ? resolution.label : "",
            display: "link",
          }),
          $createTextNode(" "),
        ];
        selection.insertNodes(nodes);
      }
    });
    if (insertedKey && showAs) markJustInserted(editor, insertedKey);
    setMenu(null);

    // The write just RECONCILES the optimistic insert above (never a
    // `create-and-link` — handled above). Skip it when there's nothing to
    // write against: a `link` with no `source` (insert-only surface), a
    // `notify-person` with no host seam, or a date / tag (text, no link).
    const needsWrite =
      resolution.action === "notify-person"
        ? Boolean(onMentionPerson)
        : resolution.action === "link"
          ? Boolean(source)
          : false;
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

  // Enter and Tab pick (the grammar's research: "↵ or Tab picks, Esc keeps the text").
  useEffect(() => {
    const pick = (event: KeyboardEvent | null) => {
      const active = candidatesRef.current;
      if (!menuRef.current || active.length === 0) return false;
      event?.preventDefault();
      const candidate = active[selectedIndexRef.current] ?? active[0];
      if (candidate) commitRef.current(candidate);
      return true;
    };
    const offEnter = editor.registerCommand(KEY_ENTER_COMMAND, pick, COMMAND_PRIORITY_HIGH);
    const offTab = editor.registerCommand(KEY_TAB_COMMAND, pick, COMMAND_PRIORITY_HIGH);
    return () => {
      offEnter();
      offTab();
    };
  }, [editor]);

  // `/date`'s calendar: the Popover primitive (the one floating surface, Esc
  // and outside clicks close it), anchored where the menu was.
  const closePicker = () => {
    setDatePicker(null);
    pickerSelection.current = null;
    editor.focus();
  };

  if (datePicker) {
    return (
      <Popover
        open
        onOpenChange={(open) => {
          if (!open) closePicker();
        }}
      >
        <PopoverAnchor asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed size-0"
            style={{ top: datePicker.top, left: datePicker.left }}
          />
        </PopoverAnchor>
        <PopoverContent align="start" side="bottom" className="w-auto p-0" aria-label="Pick a date">
          <Calendar
            mode="single"
            autoFocus
            onSelect={(date: Date | undefined) => {
              if (!date) return;
              const day = isoDay(date);
              const saved = pickerSelection.current;
              setDatePicker(null);
              pickerSelection.current = null;
              editor.focus();
              editor.update(() => {
                $restoreSelection(saved);
              });
              insertDay(day);
            }}
          />
        </PopoverContent>
      </Popover>
    );
  }

  // Nothing to offer for a few words after a `/` is ordinary prose: no menu.
  if (!menu || (menu.query.includes(" ") && !loading && candidates.length === 0)) return null;

  return createPortal(
    <div
      className="fixed z-50 max-h-80 min-w-60 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ top: menu.top, left: menu.left }}
      role="listbox"
      aria-label={trigger === "tag" ? "Link a tag" : trigger === "ref" ? "Insert" : "Mention"}
    >
      {loading && candidates.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">Searching…</p>
      ) : candidates.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">No matches.</p>
      ) : (
        candidates.map((candidate, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={mentionCandidateKey(candidate)}
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
              <CandidateIcon candidate={candidate} />
              <span className="min-w-0 flex-1 truncate">
                {candidate.kind === "tag"
                  ? `#${candidate.label}`
                  : candidate.kind === "create"
                    ? `New ${candidate.entityType} “${candidate.label}”`
                    : candidate.label}
              </span>
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

function CandidateIcon({ candidate }: { candidate: MentionCandidate }) {
  if (candidate.kind === "tag") {
    return (
      <span
        data-label={candidate.color ?? "gray"}
        className="tag-dot size-2 shrink-0 rounded-full"
        aria-hidden
      />
    );
  }
  const Icon =
    candidate.kind === "entity"
      ? resolveEntityIcon(candidate.ref.type, candidate.icon)
      : candidate.kind === "command"
        ? CalendarDays
        : candidate.kind === "create"
          ? Plus
          : User;
  return <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />;
}
