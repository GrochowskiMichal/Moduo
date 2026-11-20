/**
 * The rebuilt Notes slash menu (Wave-3 NO-4, AC5) — the ratified grammar from
 * slash-commands.ts over the proven caret-anchored machinery (mirrors the
 * spine's MentionMenuPlugin). Tokens-only; replaces the legacy hex-styled
 * SlashCommandPlugin wholesale.
 *
 * Two stages: the COMMAND menu (filtered by the `/query` token), then — for
 * entity nouns — a PICKER (shadcn Command) searching that entity type, with
 * create-and-link for contact/company. `/page` creates a real child note and
 * mirrors it as a page-row block. Where `[[` links are on (the new Notes),
 * `/note` is its alias: it leaves `[[` at the caret and the note picker opens.
 */

import { $createHorizontalRuleNode } from "@lexical/extension";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createTableNodeWithDimensions } from "@lexical/table";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type LexicalEditor,
  type NodeKey,
} from "lexical";
import {
  Building2,
  Calendar,
  CheckSquare,
  Code,
  Contact as ContactIcon,
  FilePlus2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Table,
  Type,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Eyebrow } from "@/components/ui/eyebrow";
import { FLOATING_SURFACE } from "@/components/ui/surface";
import { $createEntityRefNode } from "@/features/spine/editor/entity-ref-node";
import { closeOnOutsidePointer, registerMenuKeys } from "@/features/spine/editor/menu-keys";
import { useMentionSearch } from "@/features/spine/hooks/use-mention-search";
import { type MentionCandidate, resolveMention } from "@/features/spine/mention";
import { executeMention, type MentionContext } from "@/features/spine/mention-actions";
import { MentionCommand } from "@/features/spine/ui/mention-picker";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";

import { filterTaskCandidates, shouldOfferCreate } from "../../tasks/task-line";
import { displayTitle } from "../../title";
import { afterFocusRestore } from "../after-focus-restore";
import { $runBlockCommand } from "../block-actions";
import { useNotesEditorBridge } from "../notes-editor-bridge";
import { $createPageRowNode } from "../schema/page-row-node";
import { $createTaskLineNode } from "../schema/task-line-node";
import { filterSlashCommands, type SlashCommandDef, type SlashCommandId } from "../slash-commands";
import { degradePendingLine, stampMintedTask } from "./task-line-plugin";

type SlashMenuState = {
  query: string;
  nodeKey: NodeKey;
  startOffset: number;
  endOffset: number;
  top: number;
  left: number;
};

type PickerState = {
  /** The entity noun that opened it. */
  command: Extract<SlashCommandId, "note" | "task" | "contact" | "company" | "event">;
  top: number;
  left: number;
};

export type SlashMenuPluginProps = {
  workspaceId: string | null;
  runtime: ModuoRuntime | null;
  /** The note (the link's source end). */
  source: EntityRef;
  sourceLabel?: string;
  /** `[[` note links are on: `/note` hands over to the `[[` picker. */
  noteLinks?: boolean;
};

const MENU_MIN_WIDTH = 264;
const MENU_MAX_HEIGHT = 320;

const COMMAND_ICONS: Record<SlashCommandId, typeof Type> = {
  text: Type,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bullet: List,
  number: ListOrdered,
  todo: ListChecks,
  quote: Quote,
  code: Code,
  divider: Minus,
  table: Table,
  page: FilePlus2,
  note: FileText,
  task: CheckSquare,
  contact: ContactIcon,
  company: Building2,
  event: Calendar,
};

const PICKER_TYPES: Record<PickerState["command"], string> = {
  note: "note",
  task: "task",
  contact: "contact",
  company: "company",
  event: "event",
};

function resolveSlashMenuState(editor: LexicalEditor): SlashMenuState | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
    const anchor = selection.anchor;
    if (anchor.type !== "text") return null;
    const node = anchor.getNode();
    if (!$isTextNode(node) || !node.isSimpleText()) return null;

    const textBefore = node.getTextContent().slice(0, anchor.offset);
    // One space is allowed ("/heading 1", "/head 2"); a second word ends it.
    const match = textBefore.match(/(?:^|\s)\/([^\s/]*(?: [^\s/]*)?)$/);
    if (!match) return null;

    const query = match[1] ?? "";
    const token = `/${query}`;
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

function removeSlashToken(menu: SlashMenuState): void {
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

function runBasicCommand(id: SlashCommandId): void {
  switch (id) {
    case "divider":
      $insertNodes([$createHorizontalRuleNode(), $createParagraphNode()]);
      break;
    case "table": {
      // A header row only: a header COLUMN greyed the first column of every
      // table and read as a rendering bug.
      const table = $createTableNodeWithDimensions(3, 3, { rows: true, columns: false });
      $insertNodes([table, $createParagraphNode()]);
      // Start typing in the first cell, not on the line under the table.
      const firstCell = table.getFirstChild<ElementNode>()?.getFirstChild<ElementNode>();
      firstCell?.selectStart();
      break;
    }
    case "text":
    case "h1":
    case "h2":
    case "h3":
    case "bullet":
    case "number":
    case "todo":
    case "quote":
    case "code":
      $runBlockCommand(id);
      break;
    default:
      break;
  }
}

export function SlashMenuPlugin({
  workspaceId,
  runtime,
  source,
  sourceLabel,
  noteLinks = false,
}: SlashMenuPluginProps) {
  const [editor] = useLexicalComposerContext();
  const bridge = useNotesEditorBridge();
  const [menu, setMenu] = useState<SlashMenuState | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerPortalRef = useRef<HTMLDivElement | null>(null);
  const menuBoxRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const commands = filterSlashCommands(menu?.query ?? "");

  const menuRef = useRef<SlashMenuState | null>(null);
  const pickerRef = useRef<PickerState | null>(null);
  const commandsRef = useRef<SlashCommandDef[]>(commands);
  const selectedIndexRef = useRef(0);
  useEffect(() => {
    menuRef.current = menu;
    pickerRef.current = picker;
    commandsRef.current = commands;
    selectedIndexRef.current = selectedIndex;
  });

  // Entity search for the picker stage. Create-and-link only where a creator
  // exists (contact/company — DESIGN_BRIEF §3c: event no at v1; /page creates
  // notes). `/task` bypasses the registry search below.
  const pickerType = picker ? PICKER_TYPES[picker.command] : null;
  const canCreate = picker?.command === "contact" || picker?.command === "company";
  const search = useMentionSearch({
    runtime,
    workspaceId,
    trigger: "ref",
    types: pickerType ? [pickerType] : undefined,
    createType: canCreate ? pickerType : null,
    canCreate,
    includePeople: false,
    enabled: picker !== null && picker.command !== "task",
  });

  // `/task` candidates come from the loaded tasks bundle, not the registry
  // (the registry only knows already-linked tasks): fuzzy over open work +
  // "Create task '<text>'" as the top row when nothing matches exactly
  // (DESIGN_BRIEF §3b). The picker inserts a task LINE, never a chip.
  const taskCandidates: MentionCandidate[] =
    picker?.command === "task" && bridge
      ? (() => {
          const matches = filterTaskCandidates(bridge.tasks.listLinkableTasks(), pickerQuery);
          const list: MentionCandidate[] = [];
          if (bridge.tasks.canEditTasks && shouldOfferCreate(pickerQuery, matches)) {
            list.push({ kind: "create", entityType: "task", label: pickerQuery.trim() });
          }
          for (const t of matches) {
            list.push({
              kind: "entity",
              ref: { type: "task", id: t.id },
              label: t.title,
              icon: null,
            });
          }
          return list;
        })()
      : [];

  const pickerCandidates = picker?.command === "task" ? taskCandidates : search.candidates;

  useEffect(() => {
    search.setQuery(pickerQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerQuery]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, commands.length - 1)));
  }, [commands.length]);

  // Arrowing past the visible rows scrolls the highlight along.
  useEffect(() => {
    menuBoxRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // A fresh query means a fresh list — never a stale mid-list highlight.
  useEffect(() => {
    setSelectedIndex(0);
  }, [menu?.query]);

  const closeAll = (refocusEditor = false) => {
    setMenu(null);
    setPicker(null);
    setPickerQuery("");
    setSelectedIndex(0);
    if (refocusEditor) editor.focus();
  };

  // Focus the picker input AFTER Lexical's own post-update focus restore —
  // a plain autoFocus mounts too early and the editor steals focus back,
  // stranding the keyboard in the document body (validator BLOCKER).
  useEffect(() => {
    if (!picker) return;
    return afterFocusRestore(() => {
      pickerPortalRef.current?.querySelector<HTMLInputElement>("[cmdk-input]")?.focus();
    });
  }, [picker]);

  // The stage-2 picker's dismissal paths: Escape inside the picker (the
  // editor's KEY_ESCAPE only fires while the EDITOR has focus) and any
  // pointer-down outside it.
  useEffect(() => {
    if (!picker) return;
    const onPointerDown = (event: PointerEvent) => {
      const portal = pickerPortalRef.current;
      if (portal && event.target instanceof Node && portal.contains(event.target)) return;
      closeAll();
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker]);

  const ctx: MentionContext = {
    workspaceId: workspaceId ?? "",
    source,
    sourceLabel,
    sourceIcon: "note",
    onCreateEntity: async (entityType, label) => {
      if (!runtime || !workspaceId) return null;
      const name = label.trim();
      if (entityType === "contact") {
        const contact = await runtime.contacts.createContact({ workspaceId, name });
        return { ref: { type: "contact", id: contact.id }, label: contact.name, icon: null };
      }
      if (entityType === "company") {
        const company = await runtime.contacts.createCompany({ workspaceId, name });
        return { ref: { type: "company", id: company.id }, label: company.name, icon: null };
      }
      return null;
    },
  };

  // ── stage 2: picker selection ───────────────────────────────────────────────
  const commitPick = (candidate: MentionCandidate) => {
    const active = pickerRef.current;
    if (!active || !runtime || !workspaceId) return;

    // `/task` — the great moment (NO-5): both picks insert a task LINE block.
    // Create inserts PENDING and stamps the REAL id when the mint resolves
    // (never a `tmp-` id — the known race); linking an existing task writes
    // a `references` back-link (minted mints get `spawned-from` in the page).
    if (active.command === "task") {
      const tasksBridge = bridge?.tasks ?? null;
      if (!tasksBridge) return;
      closeAll(true);

      if (candidate.kind === "entity") {
        const task = tasksBridge.getTask(candidate.ref.id);
        editor.update(() => {
          const line = $createTaskLineNode(candidate.ref.id, task ? task.status === "done" : false);
          line.append($createTextNode(task?.title ?? candidate.label));
          $insertNodes([line]);
          line.selectEnd();
        });
        if (task) tasksBridge.linkExistingTask(task);
        return;
      }

      if (candidate.kind === "create") {
        const title = candidate.label.trim();
        if (title === "") return;
        let nodeKey: NodeKey | null = null;
        editor.update(() => {
          const line = $createTaskLineNode(null, false);
          line.append($createTextNode(title));
          $insertNodes([line]);
          line.selectEnd();
          nodeKey = line.getKey();
        });
        if (!nodeKey) return;
        const key = nodeKey;
        void tasksBridge.mintTask(title).then((task) => {
          if (!task) {
            degradePendingLine(editor, key);
            return;
          }
          if (!stampMintedTask(editor, key, task)) {
            // The pending line vanished while minting — take the task back.
            tasksBridge.revertMintIfJustMinted(task.id);
          }
        });
      }
      return;
    }

    const resolution = resolveMention({ trigger: "ref", candidate });
    if (resolution.action === "link") {
      // Optimistic chip; the link write reconciles behind it.
      closeAll(true);
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        selection.insertNodes([
          $createEntityRefNode({
            entityType: resolution.target.type,
            entityId: resolution.target.id,
            label: resolution.label,
            icon: resolution.icon,
          }),
          $createTextNode(" "),
        ]);
      });
      void executeMention(runtime, ctx, resolution).catch(() => {
        toast.error("Couldn't link that.", {
          action: { label: "Retry", onClick: () => void executeMention(runtime, ctx, resolution) },
        });
      });
      return;
    }

    if (resolution.action === "create-and-link") {
      closeAll(true);
      void executeMention(runtime, ctx, resolution)
        .then((created) => {
          if (!created) return;
          editor.focus();
          editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return;
            selection.insertNodes([
              $createEntityRefNode({
                entityType: created.ref.type,
                entityId: created.ref.id,
                label: created.label,
                icon: created.icon,
              }),
              $createTextNode(" "),
            ]);
          });
        })
        .catch(() => {
          toast.error("Couldn't create that.");
        });
    }
  };

  // ── stage 1: command selection ──────────────────────────────────────────────
  const runCommand = (command: SlashCommandDef) => {
    const activeMenu = menuRef.current;
    if (!activeMenu) return;

    if (command.group === "Basics") {
      editor.update(() => {
        removeSlashToken(activeMenu);
        runBasicCommand(command.id);
      });
      closeAll();
      return;
    }

    if (command.id === "page") {
      editor.update(() => {
        removeSlashToken(activeMenu);
      });
      const childId = bridge?.createChildNote() ?? null;
      if (!childId) {
        toast.error("Couldn't create a child page here.");
        closeAll();
        return;
      }
      // The page lists its sub-pages under the body (MOD-81): open the new
      // child, like the sidebar's "+", instead of mirroring it as a row.
      if (bridge?.subpagesListedFor) {
        closeAll();
        bridge.openNote(childId);
        return;
      }
      const label = displayTitle(bridge?.getNoteMeta(childId)?.title ?? "");
      editor.update(() => {
        $insertNodes([$createPageRowNode(childId, label), $createParagraphNode()]);
      });
      closeAll();
      return;
    }

    if (command.id === "note" && noteLinks) {
      editor.update(() => {
        removeSlashToken(activeMenu);
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText("[[");
      });
      closeAll();
      return;
    }

    // Entity nouns → stage 2 picker at the same anchor.
    editor.update(() => {
      removeSlashToken(activeMenu);
    });
    setMenu(null);
    setPickerQuery("");
    setPicker({
      command: command.id as PickerState["command"],
      top: activeMenu.top,
      left: activeMenu.left,
    });
  };

  const runCommandRef = useRef(runCommand);
  useEffect(() => {
    runCommandRef.current = runCommand;
  });

  // ── caret detection ─────────────────────────────────────────────────────────
  useEffect(() => {
    return editor.registerUpdateListener(() => {
      if (typeof window === "undefined") return;
      if (pickerRef.current) return; // the picker owns the surface now
      setMenu(resolveSlashMenuState(editor));
    });
  }, [editor]);

  // ── keyboard + dismissal (command stage): the one caret-menu regime shared
  // with `@` and `[[` (spine/editor/menu-keys). The picker's Command owns its
  // own keys.
  useEffect(
    () =>
      registerMenuKeys(editor, {
        // A menu with no matching command is not drawn, so it must not hold
        // ↵ either ("call /api" + ↵ is a new line).
        isOpen: () =>
          (menuRef.current !== null && commandsRef.current.length > 0) ||
          pickerRef.current !== null,
        count: () => (menuRef.current ? commandsRef.current.length : 0),
        index: () => selectedIndexRef.current,
        setIndex: setSelectedIndex,
        pick: (index) => {
          const command = commandsRef.current[index];
          if (command) runCommandRef.current(command);
        },
        close: () => closeAll(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor],
  );
  const menuOpen = menu !== null && commands.length > 0;
  // The text is the menu's input: tell assistive tech which list it drives
  // and which option ↑↓ are on (the caret never leaves the text).
  useEffect(() => {
    const root = editor.getRootElement();
    if (!root || !menuOpen) return;
    root.setAttribute("aria-autocomplete", "list");
    root.setAttribute("aria-controls", listId);
    root.setAttribute("aria-activedescendant", `${listId}-${selectedIndex}`);
    return () => {
      root.removeAttribute("aria-autocomplete");
      root.removeAttribute("aria-controls");
      root.removeAttribute("aria-activedescendant");
    };
  }, [editor, menuOpen, selectedIndex, listId]);
  useEffect(() => {
    if (!menuOpen) return;
    return closeOnOutsidePointer(
      (target) => menuBoxRef.current?.contains(target) ?? false,
      () => setMenu(null),
    );
  }, [menuOpen]);

  // ── render ──────────────────────────────────────────────────────────────────
  if (picker) {
    return createPortal(
      <div
        ref={pickerPortalRef}
        className={cn(FLOATING_SURFACE, "fixed z-(--z-popover) w-72 overflow-hidden shadow-lg")}
        style={{ top: picker.top, left: picker.left }}
        onKeyDown={(event) => {
          // Focus lives in the picker's input — the editor's Escape handler
          // can't fire; own the dismissal here.
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeAll(true);
          }
        }}
      >
        <MentionCommand
          candidates={pickerCandidates}
          query={pickerQuery}
          onQueryChange={setPickerQuery}
          onSelect={commitPick}
          loading={search.loading}
          placeholder={`Search ${picker.command}s…`}
          emptyLabel={
            picker.command === "task" && pickerQuery.trim() === ""
              ? "No open tasks yet. Type a title to create one."
              : `No ${picker.command} found.`
          }
          autoFocusInput
        />
      </div>,
      document.body,
    );
  }

  if (!menu) return null;
  if (commands.length === 0) {
    // A one-word miss says so (the menu used to just vanish); after a space
    // you are writing prose, so nothing shows.
    if (menu.query.includes(" ")) return null;
    return createPortal(
      <div
        className={cn(FLOATING_SURFACE, "fixed z-(--z-popover) w-72 p-1 shadow-lg")}
        style={{ top: menu.top, left: menu.left }}
        role="status"
      >
        <p className="px-2 py-1.5 text-sm text-muted-foreground">No matching block</p>
      </div>,
      document.body,
    );
  }

  // Filtered results are ranked across groups: headers would repeat
  // ("Basics · Insert · Basics…"), so only the full menu shows them.
  const grouped = menu.query === "";
  let lastGroup: string | null = null;
  return createPortal(
    <div
      ref={menuBoxRef}
      className={cn(
        FLOATING_SURFACE,
        "fixed z-(--z-popover) max-h-80 w-72 overflow-y-auto p-1 shadow-lg scrollbar-thin",
      )}
      style={{ top: menu.top, left: menu.left }}
      id={listId}
      role="listbox"
      aria-label="Insert block"
    >
      {commands.map((command, index) => {
        const isSelected = index === selectedIndex;
        const Icon = COMMAND_ICONS[command.id];
        const groupHeader =
          grouped && command.group !== lastGroup ? (
            <Eyebrow as="div" className="px-2 pb-0.5 pt-2 first:pt-1">
              {command.group}
            </Eyebrow>
          ) : null;
        lastGroup = command.group;
        return (
          <div key={command.id}>
            {groupHeader}
            <button
              type="button"
              id={`${listId}-${index}`}
              tabIndex={-1}
              role="option"
              aria-selected={isSelected}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-(--motion-fade) ease-(--ease-out) ${
                isSelected ? "bg-accent text-foreground" : "text-foreground hover:bg-accent"
              }`}
              onMouseEnter={() => setSelectedIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                runCommand(command);
              }}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {/* The name never truncates; the hint gives way ("Che…" read as
                  nothing). */}
              <span className="shrink-0">{command.title}</span>
              <span className="min-w-0 flex-1 truncate text-right text-xs text-subtle-foreground">
                {command.description}
              </span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
