/**
 * /notes — the Wave-3 rebuilt three-pane Notes page (NO-3, AC1/AC2/AC12).
 * Sidebar sections + tree · CRDT editor (first line = title) · right panel
 * arrives with NO-7 (hidden until then). Selection is URL-held (?id=).
 */

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  pointerWithin,
  useDndMonitor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CloudOff, PanelRight } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { cn } from "../../lib/utils";
import {
  asDragPayload,
  asDropLinkTarget,
  isSelfDrop,
  targetAccepts,
} from "../../lib/drag-payload";
import { createLinkWithToast } from "../../features/spine/ui/drop-link-toast";
import { HubDropZone } from "../../features/contacts/ui/hub-drop-zone";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { truncationNotice } from "../../components/app/truncation-notice";
import { onCreateNew } from "../../components/app/create-events";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import {
  RightPanelSwitcher,
  type RightPanelVariant,
} from "../../components/app/right-panel-switcher";
import { IconButton } from "../../components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { HubDropZone } from "../../features/contacts/ui/hub-drop-zone";
import { dispatchLayoutPanelsSet, useFeaturePanelState } from "../../features/layout/panel-events";
import { findQuoteOffset } from "../../features/notes/comments/quote";
import {
  INSERT_ENTITY_CHIP_EVENT,
  INSERT_PAGE_ROW_EVENT,
  type InsertEntityChipDetail,
  NOTE_DETAIL_REFRESH_EVENT,
  type NotesEditorBridge,
} from "../../features/notes/editor/notes-editor-bridge";
import {
  buildZipEntries,
  downloadTextFile,
  downloadZip,
  noteFileName,
  safeFileStem,
} from "../../features/notes/export";
import { useNoteRealtime } from "../../features/notes/hooks/use-note-realtime";
import { useNotesModule } from "../../features/notes/hooks/use-notes-module";
import { useNotesTaskBridge } from "../../features/notes/hooks/use-notes-task-bridge";
import type { OutlineHeading } from "../../features/notes/outline";
import {
  type NotesPanelVariantId,
  readNotesPanelVariant,
  writeNotesPanelVariant,
} from "../../features/notes/panel-prefs";
import { type NotesSearch, shapeNoteSearchResults } from "../../features/notes/search";
import { deriveBody, extractTaskLineIds } from "../../features/notes/sync/doc-text";
import { nameFromEmail } from "../../features/notes/sync/notes-realtime";
import { taskLinksForNote } from "../../features/notes/tasks/detach";
import { displayTitle } from "../../features/notes/title";
import {
  buildNoteSections,
  type DropZone,
  descendantIds,
  resolveDrop,
} from "../../features/notes/tree";
import { NoteCommentsPanel } from "../../features/notes/ui/note-comments-panel";
import { NoteDetailPanel } from "../../features/notes/ui/note-detail-panel";
import { NoteEditor } from "../../features/notes/ui/note-editor";
import { NoteImportDialog } from "../../features/notes/ui/note-import-dialog";
import { NoteOutlinePanel } from "../../features/notes/ui/note-outline-panel";
import { NotePresenceAvatars } from "../../features/notes/ui/note-presence-avatars";
import { NotePublishControl } from "../../features/notes/ui/note-publish-control";
import { NoteTreeSidebar } from "../../features/notes/ui/note-tree-sidebar";
import { createLinkWithToast } from "../../features/spine/ui/drop-link-toast";
import { betweenPositions, endPosition } from "../../features/tasks/helpers";
import { useTasksModule } from "../../features/tasks/hooks/use-tasks-module";
import {
  TASK_DETAIL_REFRESH_EVENT,
  TaskDetailPanel,
} from "../../features/tasks/ui/task-detail-panel";
import { asDragPayload, asDropLinkTarget, isSelfDrop, targetAccepts } from "../../lib/drag-payload";
import type { EntityLink, EntityRef } from "../../lib/entity-links";
import { cn } from "../../lib/utils";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";

export function NotesPage() {
  const { runtime, userId, userEmail, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as NotesSearch;

  const module = useNotesModule(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.notes,
  });
  const { notes, loading, degraded, truncated, loadError, syncStatus, engine, canEdit, welcomeNoteId } =
    module;

  const sections = useMemo(() => buildNoteSections(notes), [notes]);
  // The summon affordance (DF-13) mirrors + toggles the shell's right-panel
  // state over the shared panel-event contract — the shell owns the state.
  const notesPanels = useFeaturePanelState("notes");
  const rightPanelOpen = notesPanels.right;
  const toggleRightPanel = useCallback(
    () =>
      dispatchLayoutPanelsSet({
        feature: "notes",
        left: notesPanels.left,
        right: !notesPanels.right,
      }),
    [notesPanels.left, notesPanels.right],
  );
  const selectedId = search.id ?? null;
  const selectedNote = useMemo(
    () => (selectedId ? (notes.find((n) => n.id === selectedId) ?? null) : null),
    [notes, selectedId],
  );

  const select = useCallback(
    (id: string | null, replace = false) => {
      void navigate({
        to: "/notes",
        replace,
        search: (prev: Record<string, unknown>) => {
          const next = { ...prev };
          delete next.action;
          if (id) next.id = id;
          else delete next.id;
          return next;
        },
      });
    },
    [navigate],
  );

  // Capture: palette/global `?action=new` + the app-wide ⌘N create event.
  const create = useCallback(
    (parentId: string | null = null) => {
      const id = module.createNote(parentId);
      if (id) select(id, true);
    },
    [module, select],
  );
  const createRef = useRef(create);
  useEffect(() => {
    createRef.current = create;
  });

  useEffect(() => {
    if (search.action === "new" && canEdit && !loading) {
      createRef.current(null);
    }
  }, [search.action, canEdit, loading]);

  useEffect(() => onCreateNew(() => createRef.current(null)), []);

  // Stale deep link: loaded and the id doesn't exist → clear quietly.
  useEffect(() => {
    if (loading || !selectedId) return;
    if (!notes.some((n) => n.id === selectedId)) select(null, true);
  }, [loading, selectedId, notes, select]);

  // Opening a note jumps it to the front of the blank-note repair queue
  // (NOTE-FIX-1) — the background sweep is sequential, and a note you open
  // and type into before it is reached would lose its imported body.
  useEffect(() => {
    if (loading || !selectedId) return;
    void module.repairNoteNow(selectedId);
  }, [loading, selectedId, module.repairNoteNow]);

  // Task lines (NO-5): the Tasks module rides along so lines render live
  // rows, the `/task` picker searches real tasks, and the Task-detail rail
  // edits without leaving /notes.
  const tasksApi = useTasksModule(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.tasks,
  });

  // Task-detail rail variant — meta click opens it; note switch closes it.
  const [taskDetailId, setTaskDetailId] = useState<string | null>(null);
  useEffect(() => {
    setTaskDetailId(null);
  }, [selectedId]);

  // "Reflects on refresh/refocus" (AC3): re-pull the tasks bundle when the
  // window regains focus, min 5s apart.
  const lastFocusReload = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusReload.current < 5000) return;
      lastFocusReload.current = now;
      void tasksApi.reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [tasksApi.reload]);

  const taskBridge = useNotesTaskBridge({
    runtime,
    workspaceId: selectedWorkspaceId,
    noteId: selectedId,
    noteLabel: displayTitle(selectedNote?.title ?? ""),
    tasksApi,
    onOpenTaskDetail: setTaskDetailId,
  });

  // The editor ↔ module bridge (NO-4): page-rows read live titles, click-
  // through selects, and /page creates a child of the open note.
  const bridge = useMemo<NotesEditorBridge>(
    () => ({
      getNoteMeta: (id) => notes.find((n) => n.id === id) ?? null,
      openNote: (id) => select(id),
      createChildNote: () => (selectedId ? module.createNote(selectedId) : null),
      tasks: taskBridge,
    }),
    [notes, select, selectedId, module, taskBridge],
  );

  // Sidebar "+ child" while the parent is open ALSO mirrors a page-row into
  // the parent's body (DESIGN_BRIEF §3c) — via the editor's canonical path.
  const createChildFromSidebar = useCallback(
    (parentId: string) => {
      const id = module.createNote(parentId);
      if (!id) return;
      if (parentId === selectedId) {
        window.dispatchEvent(
          new CustomEvent(INSERT_PAGE_ROW_EVENT, {
            detail: { parentId, childId: id },
          }),
        );
      }
      select(id, true);
    },
    [module, selectedId, select],
  );

  // Trashing a note with task lines: tasks soft-detach and survive, folded
  // into the ONE trash toast (AC4) — the note↔task links are dropped (real
  // detach, not just copy) and the toast's Undo restores note AND links.
  // The docs are read via the sync engine so unopened notes work too —
  // gesture note + descendants (capped) — best-effort: a slow boot falls
  // back to the plain trash toast, never blocks the gesture.
  const trashWithTaskDetach = useCallback(
    async (id: string) => {
      const noteIds = [id, ...descendantIds(notes, id)].slice(0, 20);
      const taskIdsByNote = new Map<string, string[]>();
      if (engine) {
        for (const noteId of noteIds) {
          try {
            const session = engine.getOrCreateSession(noteId);
            await Promise.race([
              session.booted,
              new Promise((resolve) => setTimeout(resolve, 800)),
            ]);
            const ids = extractTaskLineIds(session.doc);
            if (ids.length > 0) taskIdsByNote.set(noteId, ids);
          } catch {
            // skip this doc — honest undercount beats blocking the gesture
          }
        }
      }
      const allTaskIds = [...new Set([...taskIdsByNote.values()].flat())];

      // Drop the note↔task links (the actual detach); remember them so the
      // toast's Undo can put them back (links_op_create is idempotent).
      const dropped: {
        source: { type: string; id: string };
        target: { type: string; id: string };
        relationKind: EntityLink["relationKind"];
        origin: EntityLink["origin"];
      }[] = [];
      if (runtime && selectedWorkspaceId && taskIdsByNote.size > 0) {
        try {
          for (const [noteId, ids] of taskIdsByNote) {
            const links = await runtime.spine.listLinks({
              workspaceId: selectedWorkspaceId,
              entityType: "note",
              entityId: noteId,
            });
            const toDrop = taskLinksForNote(links, noteId, new Set(ids));
            for (const l of toDrop) {
              await runtime.spine.deleteLink({
                workspaceId: selectedWorkspaceId,
                linkId: l.id,
              });
              dropped.push({
                source: { type: l.sourceType, id: l.sourceId },
                target: { type: l.targetType, id: l.targetId },
                relationKind: l.relationKind,
                origin: l.origin,
              });
            }
          }
        } catch {
          // link drop is best-effort; trash itself must never fail on it
        }
      }

      module.trashNote(
        id,
        allTaskIds.length > 0
          ? {
              detachedTaskIds: allTaskIds,
              onDeleteTasks: (ids) => {
                ids.forEach((taskId) => void tasksApi.deleteTask(taskId));
              },
              onUndo: () => {
                if (!runtime || !selectedWorkspaceId) return;
                for (const l of dropped) {
                  void runtime.spine.createLink({ workspaceId: selectedWorkspaceId, ...l });
                }
              },
            }
          : undefined,
      );
    },
    [engine, module, tasksApi, notes, runtime, selectedWorkspaceId],
  );

  const onDropRow = useCallback(
    (dragId: string, targetId: string, zone: DropZone) => {
      const drop = resolveDrop(notes, dragId, targetId, zone, {
        endPosition,
        betweenPositions,
      });
      if (!drop) return; // self/cycle/unknown — quiet no-op
      module.moveNote(dragId, drop.parentId, drop.position);
    },
    [notes, module],
  );

  const canRender = Boolean(
    runtime && userId && selectedWorkspaceId && !configError && modulePermissions.notes !== "none",
  );

  // Live multiplayer (NO-6, AC7): a broadcast + presence channel for the open
  // note — near-live edits + a viewer facepile. No-ops without a note/identity.
  const selfName = useMemo(() => nameFromEmail(userEmail), [userEmail]);
  const { viewers } = useNoteRealtime({
    engine: engine ?? null,
    noteId: selectedNote && !selectedNote.deletedAt ? selectedNote.id : null,
    enabled: canRender && Boolean(selectedWorkspaceId),
    selfUserId: userId,
    selfName,
  });

  // Right-panel variant (NO-7): remembered per user+workspace.
  const [panelVariant, setPanelVariant] = useState<NotesPanelVariantId>("detail");
  useEffect(() => {
    if (userId && selectedWorkspaceId)
      setPanelVariant(readNotesPanelVariant(userId, selectedWorkspaceId));
  }, [userId, selectedWorkspaceId]);
  const changePanelVariant = useCallback(
    (v: NotesPanelVariantId) => {
      setPanelVariant(v);
      if (userId && selectedWorkspaceId) writeNotesPanelVariant(userId, selectedWorkspaceId, v);
    },
    [userId, selectedWorkspaceId],
  );

  // Page-level DnD (NO-7b): one context so a sidebar note can be dropped INTO the
  // editor (→ reference chip, no link write) or ONTO the Detail hub (→ a link).
  // Reorder rides the same context via the sidebar's monitor; the three drops are
  // spatially disjoint (editor / hub / a note row) so only one ever fires.
  const notesSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const onNotesDragEnd = useCallback(
    (event: DragEndEvent) => {
      // Editor-chip + reorder are owned by their own consumers; here we only act
      // on a drop onto a link target (the Detail hub) → create a spine link.
      const payload = asDragPayload(event.active.data.current);
      const target = asDropLinkTarget(event.over?.data.current);
      if (!payload || !target) return;
      if (!runtime || !selectedWorkspaceId || !canEdit) return;
      if (isSelfDrop(payload, target)) {
        toast("You can’t link a note to itself");
        return;
      }
      if (!targetAccepts(target, payload)) return;
      void (async () => {
        // Guard a pre-existing edge: links_op_create is idempotent, but a fresh
        // "Undo" toast on an already-linked pair would delete a link the user
        // didn't make in THIS gesture (mirrors the FX-9 already-linked guard).
        try {
          const links = await runtime.spine.listLinks({
            workspaceId: selectedWorkspaceId,
            entityType: target.entityType,
            entityId: target.entityId,
          });
          const already = links.some(
            (l) =>
              (l.sourceType === payload.entityType && l.sourceId === payload.entityId) ||
              (l.targetType === payload.entityType && l.targetId === payload.entityId),
          );
          if (already) {
            toast("Already linked");
            return;
          }
        } catch {
          // a failed pre-check must not block a legitimate link
        }
        await createLinkWithToast({
          runtime,
          workspaceId: selectedWorkspaceId,
          source: payload,
          target,
          origin: "drag",
          onChanged: () => {
            window.dispatchEvent(new CustomEvent(NOTE_DETAIL_REFRESH_EVENT));
            // A note→task drop must also refresh the embedded task hub (DF-8).
            if (target.entityType === "task") {
              window.dispatchEvent(new CustomEvent(TASK_DETAIL_REFRESH_EVENT));
            }
          },
        });
      })();
    },
    [runtime, selectedWorkspaceId, canEdit],
  );

  // Detail hub "open" — notes select in place; other entities deep-link out.
  const handleOpenEntity = useCallback(
    (ref: EntityRef) => {
      if (ref.type === "note") {
        select(ref.id);
        return;
      }
      window.dispatchEvent(
        new CustomEvent("moduo:entity:open", { detail: { type: ref.type, id: ref.id } }),
      );
    },
    [select],
  );

  // Quote-comments (AC9): grab the editor's current selection; scroll the editor
  // to a quoted snippet (best-effort — edited-away text degrades quietly).
  const getSelectionQuote = useCallback((): string | null => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const editorEl = document.querySelector(".notes-editor-v2");
    const anchor = sel.anchorNode;
    if (!editorEl || !anchor || !editorEl.contains(anchor)) return null;
    return sel.toString().trim() || null;
  }, []);
  const scrollToQuote = useCallback((quote: string) => {
    const editorEl = document.querySelector(".notes-editor-v2");
    if (!editorEl) return;
    if (findQuoteOffset(editorEl.textContent ?? "", quote) === null) {
      toast.info("That text isn’t in the note anymore.");
      return;
    }
    const firstWord = quote.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    for (const b of editorEl.querySelectorAll("p, h1, h2, h3, h4, li, blockquote")) {
      if ((b.textContent ?? "").toLowerCase().includes(firstWord)) {
        b.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
  }, []);
  const outlineNavigate = useCallback((h: OutlineHeading) => {
    const editorEl = document.querySelector(".notes-editor-v2");
    if (!editorEl) return;
    const headings = editorEl.querySelectorAll("h1, h2, h3, h4, h5, h6");
    headings[h.index - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Markdown interchange (NO-8): import wizard + per-note / subtree export.
  const [importOpen, setImportOpen] = useState(false);
  const exportNote = useCallback(
    async (id: string, title: string) => {
      const name = displayTitle(title);
      let md = "";
      if (engine && id === selectedId) {
        // The open note derives freshest from its live doc; others read body_md.
        md = deriveBody(engine.getOrCreateSession(id).doc).md;
      }
      // Fall back to the server body_md when the note isn't open OR its live doc
      // is still empty (e.g. a just-imported note not yet materialized) — M2/m3.
      if (!md && runtime && selectedWorkspaceId) {
        const docs = await runtime.notesV2.fetchExportDocs({
          workspaceId: selectedWorkspaceId,
          ids: [id],
        });
        md = docs[0]?.bodyMd ?? "";
      }
      downloadTextFile(noteFileName(name), md || `# ${name}\n`);
    },
    [engine, selectedId, runtime, selectedWorkspaceId],
  );
  const exportTree = useCallback(
    async (id: string) => {
      if (!runtime || !selectedWorkspaceId) return;
      const ids = [id, ...descendantIds(notes, id)];
      const byId = new Map(notes.map((n) => [n.id, n]));
      const docs = await runtime.notesV2.fetchExportDocs({ workspaceId: selectedWorkspaceId, ids });
      const mdById = new Map(docs.map((d) => [d.id, d.bodyMd]));
      // Folder path = the note's ancestor titles from the export root down.
      const pathOf = (nid: string): string[] => {
        if (nid === id) return [];
        const chain: string[] = [];
        let cur = byId.get(nid)?.parentId ?? null;
        while (cur && chain.length < 12) {
          const p = byId.get(cur);
          if (!p) break;
          chain.unshift(displayTitle(p.title));
          if (cur === id) break;
          cur = p.parentId ?? null;
        }
        return chain;
      };
      const zipNotes = ids
        .filter((nid) => byId.has(nid))
        .map((nid) => ({
          id: nid,
          title: displayTitle(byId.get(nid)!.title),
          md: mdById.get(nid) ?? "",
          pathSegments: pathOf(nid),
        }));
      downloadZip(
        `${safeFileStem(displayTitle(byId.get(id)?.title ?? "notes"))}.zip`,
        buildZipEntries(zipNotes),
      );
    },
    [runtime, selectedWorkspaceId, notes],
  );

  if (!canRender) {
    return (
      <FeaturePanelsShell
        feature="notes"
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
            <h2 className="font-display text-2xl text-foreground">Notes unavailable</h2>
            <p className="text-sm">
              {configError ??
                (modulePermissions.notes === "none"
                  ? "You do not have Notes access in this workspace."
                  : "Authentication or workspace is missing.")}
            </p>
          </div>
        }
      />
    );
  }

  const sidebar = selectedWorkspaceId ? (
    <NoteTreeSidebar
      workspaceId={selectedWorkspaceId}
      sections={sections}
      selectedId={selectedId}
      canEdit={canEdit}
      dndMode="external"
      onSelect={(id) => select(id)}
      onCreateRoot={() => create(null)}
      onCreateChild={createChildFromSidebar}
      onDropRow={onDropRow}
      onTogglePin={module.togglePin}
      onSetIcon={module.setIcon}
      onDuplicate={(id) =>
        void module.duplicateNote(id).then((copyId) => {
          if (copyId) select(copyId);
        })
      }
      onArchive={(id, archived) => module.archiveNote(id, archived)}
      onTrash={(id) => {
        void trashWithTaskDetach(id);
        if (selectedId === id) select(null, true);
      }}
      onRestore={module.restoreNote}
      onPurge={(id) => {
        void module.purgeNote(id);
        if (selectedId === id) select(null, true);
      }}
      onSearch={
        runtime && selectedWorkspaceId && !degraded
          ? (q) =>
              runtime.notesV2
                .search({ workspaceId: selectedWorkspaceId, query: q })
                .then((rows) => shapeNoteSearchResults(rows, q))
          : undefined
      }
      onImport={canEdit ? () => setImportOpen(true) : undefined}
      onExportNote={exportNote}
      onExportTree={exportTree}
    />
  ) : null;

  const center = (
    <div className="relative flex h-full min-h-0 flex-col">
      {degraded ? (
        <div className="border-b border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
          Notes is waiting on a server update — reading is fine, editing comes back shortly.
        </div>
      ) : null}
      {loadError ? (
        <div className="border-b border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
          Couldn't refresh notes — showing what's saved on this device.
        </div>
      ) : null}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        <NotePresenceAvatars viewers={viewers} />
        {syncStatus === "offline" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center rounded-full bg-muted p-1.5 text-muted-foreground">
                <CloudOff className="size-3.5" aria-label="Saved locally" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">Saved locally — will sync</TooltipContent>
          </Tooltip>
        ) : null}
        {selectedNote && !selectedNote.deletedAt && !degraded && runtime ? (
          <NotePublishControl
            note={selectedNote}
            notes={notes}
            canEdit={canEdit}
            publishedUrl={(token) => runtime.notesV2.publishedUrl(token)}
            onPublish={() => module.publishNote(selectedNote.id)}
            onUnpublish={() => module.unpublishNote(selectedNote.id)}
          />
        ) : null}
        {/* Persistent right-panel summon (DF-13): the spine payoff — Detail ·
            Comments · Outline — must be reachable without knowing the bottom-
            bar toggle exists. Always present, never conditional. */}
        <IconButton
          icon={PanelRight}
          label={rightPanelOpen ? "Hide side panel" : "Show links, comments & outline"}
          aria-pressed={rightPanelOpen}
          className={rightPanelOpen ? "text-foreground" : "text-muted-foreground"}
          tooltipSide="left"
          onClick={toggleRightPanel}
        />
      </div>
      <div className="min-h-0 flex-1">
        {selectedNote && !selectedNote.deletedAt && engine && selectedWorkspaceId ? (
          <NoteEditor
            key={selectedNote.id}
            engine={engine}
            workspaceId={selectedWorkspaceId}
            noteId={selectedNote.id}
            editable={canEdit && !degraded}
            titleForLabel={displayTitle(selectedNote.title)}
            onTitleDerived={(title) => module.renameNote(selectedNote.id, title)}
            seedWelcome={welcomeNoteId === selectedNote.id}
            bridge={bridge}
          />
        ) : selectedNote?.deletedAt ? (
          <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
            <p className="text-sm">This note is in the Trash.</p>
            {canEdit ? (
              <button
                type="button"
                className="justify-self-center rounded-md bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => module.restoreNote(selectedNote.id)}
              >
                Restore
              </button>
            ) : null}
          </div>
        ) : (
          <div className="grid h-full place-content-center gap-1 text-center text-muted-foreground">
            {loading ? (
              <p className="text-sm">Loading notes…</p>
            ) : (
              <>
                <p className="font-display text-lg text-foreground">Write something down</p>
                <p className="text-sm">
                  Select a note on the left{canEdit ? ", or press ⌘N for a fresh one" : ""}.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // The right panel is now the switchable surface (NO-7): Detail · Comments ·
  // Outline for the open note, plus a transient Task-detail variant that a
  // focused task line (NO-5) prepends and activates.
  // Bridge lookup (bundle + just-minted overlay) so it works the instant a mint
  // lands, before the bundle reload catches up.
  const detailTask = taskDetailId ? taskBridge.getTask(taskDetailId) : null;
  const noteForPanel = selectedNote && !selectedNote.deletedAt ? selectedNote : null;
  const panelSession = noteForPanel && engine ? engine.getOrCreateSession(noteForPanel.id) : null;

  const noteVariants: RightPanelVariant[] =
    noteForPanel && selectedWorkspaceId
      ? [
          {
            id: "detail",
            label: "Detail",
            render: () => (
              // The hub is a drop target (NO-7b): dropping a note here links it
              // to the open note (drag-onto-hub = link only).
              <HubDropZone
                target={{ type: "note", id: noteForPanel.id }}
                disabled={!canEdit || degraded}
              >
                <NoteDetailPanel
                  runtime={runtime}
                  workspaceId={selectedWorkspaceId}
                  noteId={noteForPanel.id}
                  canEdit={canEdit && !degraded}
                  currentUserId={userId}
                  onOpenEntity={handleOpenEntity}
                />
              </HubDropZone>
            ),
          },
          {
            id: "comments",
            label: "Comments",
            render: () => (
              <NoteCommentsPanel
                runtime={runtime}
                workspaceId={selectedWorkspaceId}
                noteId={noteForPanel.id}
                noteLabel={displayTitle(noteForPanel.title)}
                canComment={modulePermissions.notes !== "none"}
                currentUserId={userId}
                getSelectionQuote={getSelectionQuote}
                onScrollToQuote={scrollToQuote}
              />
            ),
          },
          {
            id: "outline",
            label: "Outline",
            render: () => (
              <NoteOutlinePanel doc={panelSession?.doc ?? null} onNavigate={outlineNavigate} />
            ),
          },
        ]
      : [];

  const taskVariant: RightPanelVariant | null = detailTask
    ? {
        id: "task",
        label: "Task",
        render: () => (
          // The embedded task hub is a drop target too (DF-8): dragging a note
          // onto it links the note to the task, using the page's DndContext.
          <HubDropZone target={{ type: "task", id: detailTask.id }} disabled={!canEdit || degraded}>
            <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
              <TaskDetailPanel
                task={detailTask}
                buckets={tasksApi.buckets}
                inbox={tasksApi.inbox}
                canEdit={tasksApi.canEdit}
                onRequestCapture={() => {}}
                onSelectTask={setTaskDetailId}
                api={tasksApi}
                runtime={runtime}
                workspaceId={selectedWorkspaceId}
                onOpenEntity={handleOpenEntity}
              />
            </div>
          </HubDropZone>
        ),
      }
    : null;

  const panelVariants = taskVariant ? [taskVariant, ...noteVariants] : noteVariants;
  const activePanel = taskVariant ? "task" : panelVariant;
  const onPanelChange = (id: string) => {
    if (id === "task") return;
    setTaskDetailId(null); // leaving the Task tab closes the focused task
    changePanelVariant(id as NotesPanelVariantId);
  };

  // Always give the shell a right slot (DF-13): with no note open the panel
  // shows a quiet empty state instead of vanishing — the surface stays real.
  const right =
    noteForPanel && panelVariants.length > 0 ? (
      <RightPanelSwitcher
        variants={panelVariants}
        activeId={activePanel}
        onChange={onPanelChange}
      />
    ) : (
      <div className="grid h-full place-content-center px-4 text-center text-sm text-muted-foreground">
        Select a note to see its links, comments, and outline.
      </div>
    );

  const editorNoteId = noteForPanel?.id ?? null;

  return (
    <>
      <DndContext
        sensors={notesSensors}
        collisionDetection={pointerWithin}
        autoScroll={false}
        onDragEnd={onNotesDragEnd}
      >
        <FeaturePanelsShell
          feature="notes"
          notice={truncationNotice(truncated)}
          left={sidebar}
          center={
            <NotesEditorDropZone noteId={editorNoteId} editable={canEdit && !degraded}>
              {center}
            </NotesEditorDropZone>
          }
          right={right}
        />
      </DndContext>
      <NoteImportDialog
        runtime={runtime}
        workspaceId={selectedWorkspaceId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={module.refresh}
        // So the import APPENDS to the tree instead of interleaving with it.
        existingRootPositions={notes
          .filter((n) => !n.parentId && !n.deletedAt)
          .map((n) => n.position)}
      />
    </>
  );
}

const NOTES_EDITOR_DROP_ID = "notes-editor-drop";

/**
 * Wraps the editor pane as a drop target (NO-7b): dropping an entity here fires
 * the chip-insert event (a reference chip, no `entity_links` write). The chip
 * lands at the release coordinates — tracked via a raw pointer listener (the
 * TL-2 lesson: dnd-kit's `delta` folds auto-scroll, unreliable for a point).
 */
function NotesEditorDropZone({
  noteId,
  editable,
  children,
}: {
  noteId: string | null;
  editable: boolean;
  children: ReactNode;
}) {
  const pointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const active = editable && !!noteId;
  const {
    setNodeRef,
    isOver,
    active: dragActive,
  } = useDroppable({
    id: NOTES_EDITOR_DROP_ID,
    data: { kind: "note-editor" },
    disabled: !active,
  });
  const overWithPayload = isOver && !!asDragPayload(dragActive?.data?.current);

  // Track the pointer only WHILE a drag is in flight (parity with the sidebar's
  // gated tracker) — the release coords give the chip its drop point.
  const isDragging = !!dragActive;
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener("pointermove", onMove, { capture: true });
    return () => document.removeEventListener("pointermove", onMove, { capture: true });
  }, [isDragging]);

  useDndMonitor({
    onDragEnd: (event) => {
      if (!active || !noteId) return;
      if (event.over?.id !== NOTES_EDITOR_DROP_ID) return;
      const payload = asDragPayload(event.active.data.current);
      if (!payload) return;
      const detail: InsertEntityChipDetail = {
        noteId,
        entityType: payload.entityType,
        entityId: payload.entityId,
        label: payload.label ?? payload.entityType,
        icon: payload.icon ?? null,
        clientX: pointer.current.x,
        clientY: pointer.current.y,
      };
      window.dispatchEvent(new CustomEvent(INSERT_ENTITY_CHIP_EVENT, { detail }));
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "h-full min-h-0",
        overWithPayload && "rounded-lg ring-2 ring-inset ring-primary/40",
      )}
    >
      {children}
    </div>
  );
}
