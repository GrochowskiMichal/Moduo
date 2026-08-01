/**
 * The rebuilt Notes slash menu (Wave-3 NO-4, AC5) — the ratified grammar from
 * slash-commands.ts over the proven caret-anchored machinery (mirrors the
 * spine's MentionMenuPlugin). Tokens-only; replaces the legacy hex-styled
 * SlashCommandPlugin wholesale.
 *
 * Two stages: the COMMAND menu (filtered by the `/query` token), then — for
 * entity nouns — a PICKER (shadcn Command) searching that entity type, with
 * create-and-link for contact/company. `/page` creates a real child note and
 * mirrors it as a page-row block; `/mindmap` inserts the legacy embed.
 */

import { $createCodeNode } from "@lexical/code";
import { $insertList } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $createTableNodeWithDimensions } from "@lexical/table";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $insertNodes,
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
  Network,
  Quote,
  Table,
  Type,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { $createEntityRefNode } from "@/features/spine/editor/entity-ref-node";
import { useMentionSearch } from "@/features/spine/hooks/use-mention-search";
import { type MentionCandidate, resolveMention } from "@/features/spine/mention";
import { executeMention, type MentionContext } from "@/features/spine/mention-actions";
import { MentionCommand } from "@/features/spine/ui/mention-picker";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { filterTaskCandidates, shouldOfferCreate } from "../../tasks/task-line";
import { displayTitle } from "../../title";
import { $createEmbedNode } from "../nodes/EmbedNode";
import { $createPageRowNode } from "../nodes/page-row-node";
import { $createTaskLineNode } from "../nodes/task-line-node";
import { useNotesEditorBridge } from "../notes-editor-bridge";
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
  command: Extract<SlashCommandId, "note" | "task" | "contact" | "company" | "event" | "mindmap">;
  top: number;
  left: number;
};

export type SlashMenuPluginProps = {
  workspaceId: string | null;
  runtime: ModuoRuntime | null;
  /** The note (the link's source end). */
  source: EntityRef;
  sourceLabel?: string;
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
  mindmap: Network,
};

const PICKER_TYPES: Record<PickerState["command"], string> = {
  note: "note",
  task: "task",
  contact: "contact",
  company: "company",
  event: "event",
  mindmap: "mindmap",
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
    const match = textBefore.match(/(?:^|\s)\/([^\s/]*)$/);
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
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  switch (id) {
    case "text":
      $setBlocksType(selection, () => $createParagraphNode());
      break;
    case "h1":
    case "h2":
    case "h3":
      $setBlocksType(selection, () => $createHeadingNode(id));
      break;
    case "bullet":
      $insertList("bullet");
      break;
    case "number":
      $insertList("number");
      break;
    case "todo":
      $insertList("check");
      break;
    case "quote":
      $setBlocksType(selection, () => $createQuoteNode());
      break;
    case "code":
      $setBlocksType(selection, () => $createCodeNode());
      break;
    case "divider":
      $insertNodes([$createHorizontalRuleNode(), $createParagraphNode()]);
      break;
    case "table": {
      const table = $createTableNodeWithDimensions(3, 3, true);
      $insertNodes([table, $createParagraphNode()]);
      break;
    }
    default:
      break;
  }
}

export function SlashMenuPlugin({
  workspaceId,
  runtime,
  source,
  sourceLabel,
}: SlashMenuPluginProps) {
  const [editor] = useLexicalComposerContext();
  const bridge = useNotesEditorBridge();
  const [menu, setMenu] = useState<SlashMenuState | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerPortalRef = useRef<HTMLDivElement | null>(null);

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
  // notes). `/task` and `/mindmap` bypass the registry search below.
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
    enabled: picker !== null && picker.command !== "mindmap" && picker.command !== "task",
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

  // Mindmaps never registered into the entities registry — their candidates
  // come from the module's own store (the legacy plugin's source), filtered
  // client-side. "Kept working, no new investment" (§3c).
  const [mindmapCandidates, setMindmapCandidates] = useState<MentionCandidate[]>([]);
  useEffect(() => {
    if (picker?.command !== "mindmap" || !runtime || !workspaceId) return;
    let cancelled = false;
    void import("@/features/mindmap/ui/mindmap-storage")
      .then(async ({ listMindmaps }) => {
        const maps = await listMindmaps(runtime, workspaceId);
        if (cancelled) return;
        setMindmapCandidates(
          maps.map((m) => ({
            kind: "entity" as const,
            ref: { type: "mindmap", id: m.id },
            label: m.name,
            icon: null,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setMindmapCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [picker?.command, runtime, workspaceId]);

  const pickerCandidates =
    picker?.command === "mindmap"
      ? mindmapCandidates.filter((c) =>
          c.label.toLowerCase().includes(pickerQuery.trim().toLowerCase()),
        )
      : picker?.command === "task"
        ? taskCandidates
        : search.candidates;

  useEffect(() => {
    search.setQuery(pickerQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerQuery]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, commands.length - 1)));
  }, [commands.length]);

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
    const id = setTimeout(() => {
      pickerPortalRef.current?.querySelector<HTMLInputElement>("[cmdk-input]")?.focus();
    }, 30);
    return () => clearTimeout(id);
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

    if (active.command === "mindmap") {
      if (candidate.kind !== "entity") return;
      closeAll(true);
      editor.update(() => {
        $insertNodes([$createEmbedNode("mindmap", candidate.ref.id), $createParagraphNode()]);
      });
      return;
    }

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
      const label = displayTitle(bridge?.getNoteMeta(childId)?.title ?? "");
      editor.update(() => {
        $insertNodes([$createPageRowNode(childId, label), $createParagraphNode()]);
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

  // ── keyboard (command stage only — the picker's Command owns its own) ──────
  useEffect(() => {
    return editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        if (!menuRef.current || commandsRef.current.length === 0) return false;
        event?.preventDefault();
        setSelectedIndex((selectedIndexRef.current + 1) % commandsRef.current.length);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        if (!menuRef.current || commandsRef.current.length === 0) return false;
        event?.preventDefault();
        const len = commandsRef.current.length;
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
        if (!menuRef.current && !pickerRef.current) return false;
        event?.preventDefault();
        closeAll();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!menuRef.current || commandsRef.current.length === 0) return false;
        event?.preventDefault();
        const command = commandsRef.current[selectedIndexRef.current] ?? commandsRef.current[0];
        if (command) runCommandRef.current(command);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  // ── render ──────────────────────────────────────────────────────────────────
  if (picker) {
    return createPortal(
      <div
        ref={pickerPortalRef}
        className="fixed z-50 w-72 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
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
          loading={picker.command === "mindmap" ? false : search.loading}
          placeholder={`Search ${picker.command}s…`}
          emptyLabel={`No ${picker.command} found.`}
          autoFocusInput
        />
      </div>,
      document.body,
    );
  }

  if (!menu || commands.length === 0) return null;

  let lastGroup: string | null = null;
  return createPortal(
    <div
      className="fixed z-50 max-h-80 w-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg scrollbar-thin"
      style={{ top: menu.top, left: menu.left }}
      role="listbox"
      aria-label="Insert block"
    >
      {commands.map((command, index) => {
        const isSelected = index === selectedIndex;
        const Icon = COMMAND_ICONS[command.id];
        const groupHeader =
          command.group !== lastGroup ? (
            <div className="px-2 pb-0.5 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground first:pt-1">
              {command.group}
            </div>
          ) : null;
        lastGroup = command.group;
        return (
          <div key={command.id}>
            {groupHeader}
            <button
              type="button"
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
              <span className="min-w-0 flex-1 truncate">{command.title}</span>
              <span className="shrink-0 truncate text-xs text-muted-foreground/70">
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
