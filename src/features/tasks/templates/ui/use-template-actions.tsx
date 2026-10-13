// Every template action the Tasks page offers, and the dialogs they open
// (TV-D15): Save as template (a task's or a project's ⋯), Duplicate
// project…, New project from template…, Use… a task template, share or stop
// sharing (asking first when it came from a private project), delete (with
// Undo), and the Templates page with its editor.

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import type { ModuoRuntime } from "../../../../lib/runtime.types";
import type { WorkspaceStore } from "../../../../lib/sync/store";
import { undoToast } from "../../../../lib/undo-toast";
import type { Area, Bucket, Section, Task } from "../../model";
import type { Template, TemplatePatchable, TemplateWithBody } from "../model";
import { applyProjectTemplate, applyTaskTemplate, duplicateProject, newCopyId } from "../ops";
import { forgetTemplate, rememberTemplate, useTemplates } from "../templates-store";
import { CopyProjectDialog, SaveTemplateDialog, UseTaskTemplateDialog } from "./template-dialogs";
import { TemplateEditor } from "./template-editor";
import { TemplatesView } from "./templates-view";

type Dialogs =
  | { kind: "save-task"; task: Task }
  | { kind: "save-project"; bucket: Bucket }
  | { kind: "duplicate"; bucket: Bucket }
  | { kind: "from-template"; templateId: string | null }
  | { kind: "use-task"; template: Template }
  | { kind: "share"; template: Template }
  | null;

const tasksWord = (n: number) => (n === 1 ? "1 task" : `${n} tasks`);

export function useTemplateActions({
  runtime,
  store,
  workspaceId,
  userId,
  canEdit,
  isAdmin,
  active,
  buckets,
  areas,
  sections,
  tasks,
  onOpenProject,
  onOpenTask,
}: {
  runtime: ModuoRuntime | null;
  store: WorkspaceStore | null;
  workspaceId: string;
  userId: string | null;
  canEdit: boolean;
  isAdmin: boolean;
  /** The Templates page is open (its list reads again when it opens). */
  active: boolean;
  buckets: readonly Bucket[];
  areas: readonly Area[];
  sections: readonly Section[];
  tasks: readonly Task[];
  onOpenProject: (projectId: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const supported = Boolean(runtime?.tasks.duplicateProject && runtime.tasks.listTemplates);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [busy, setBusy] = useState(false);
  // May you copy what the open dialog copies (Edit on it, D15-11)? Asked
  // when it opens; null while asking. The server decides again on the copy.
  const [copyAccess, setCopyAccess] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<{ template: Template } | null>(null);
  const [editorTemplate, setEditorTemplate] = useState<TemplateWithBody | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const { templates, loaded } = useTemplates(
    runtime,
    supported ? workspaceId : null,
    `${active}:${dialog?.kind ?? ""}`,
  );
  const projectTemplates = useMemo(
    () => templates.filter((t) => t.kind === "project"),
    [templates],
  );
  // One attempt keeps its id until it lands, so a retry after a lost answer
  // makes nothing twice.
  const attemptId = useRef<string | null>(null);
  const deps = runtime && store && userId ? { runtime, store, workspaceId, userId } : null;

  const close = useCallback(() => {
    setDialog(null);
    attemptId.current = null;
  }, []);

  const copySource: { kind: "task" | "project"; id: string } | null =
    dialog?.kind === "save-task"
      ? { kind: "task", id: dialog.task.id }
      : dialog?.kind === "save-project" || dialog?.kind === "duplicate"
        ? { kind: "project", id: dialog.bucket.id }
        : null;
  const copyKind = copySource?.kind ?? null;
  const copyId = copySource?.id ?? null;
  useEffect(() => {
    if (!copyKind || !copyId) return;
    const ask = runtime?.tasks.canCopyTemplateSource;
    if (!ask) {
      setCopyAccess(true);
      return;
    }
    let live = true;
    setCopyAccess(null);
    ask({ kind: copyKind, id: copyId })
      .then((ok) => live && setCopyAccess(ok))
      // Unknown: let the server decide (it refuses with a clear message).
      .catch(() => live && setCopyAccess(true));
    return () => {
      live = false;
    };
  }, [runtime, copyKind, copyId]);

  // ── saving ──────────────────────────────────────────────────────────────
  const saveAs = async (
    target: { kind: "task"; id: string } | { kind: "project"; id: string },
    name: string,
  ) => {
    if (!runtime?.tasks.saveTaskTemplate || !runtime.tasks.saveProjectTemplate) return;
    try {
      const saved =
        target.kind === "task"
          ? await runtime.tasks.saveTaskTemplate({
              workspaceId,
              taskId: target.id,
              id: newCopyId(),
              name,
            })
          : await runtime.tasks.saveProjectTemplate({
              workspaceId,
              projectId: target.id,
              id: newCopyId(),
              name,
            });
      rememberTemplate(saved);
      toast(`Saved “${saved.name}” as a template`, {
        description: "Only you can use it until you share it.",
        action: { label: "Open", onClick: () => openEditor(saved) },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the template.");
    }
  };

  // ── the editor ──────────────────────────────────────────────────────────
  const openEditor = useCallback(
    (template: Template) => {
      setEditing({ template });
      setEditorTemplate(null);
      if (!runtime?.tasks.getTemplate) return;
      setEditorLoading(true);
      void runtime.tasks
        .getTemplate({ workspaceId, kind: template.kind, id: template.id })
        .then((full) => setEditorTemplate(full))
        .catch(() => setEditorTemplate(null))
        .finally(() => setEditorLoading(false));
    },
    [runtime, workspaceId],
  );
  const closeEditor = useCallback(() => {
    setEditing(null);
    setEditorTemplate(null);
  }, []);
  // Leaving the Templates page closes the editor.
  useEffect(() => {
    if (!active) closeEditor();
  }, [active, closeEditor]);

  const update = async (
    template: Template,
    patch: TemplatePatchable,
  ): Promise<TemplateWithBody | null> => {
    if (!runtime?.tasks.updateTemplate) return null;
    try {
      const saved = await runtime.tasks.updateTemplate({
        workspaceId,
        kind: template.kind,
        id: template.id,
        patch,
      });
      if (saved.deletedAt) forgetTemplate(workspaceId, saved.id);
      else rememberTemplate(saved);
      return saved;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change the template.");
      return null;
    }
  };

  const share = async (template: Template, shared: boolean) => {
    const saved = await update(template, { shared });
    if (!saved) return;
    // Someone else's template you stopped sharing leaves your list.
    if (!shared && saved.ownerId !== userId) forgetTemplate(workspaceId, saved.id);
    toast(
      shared ? `“${saved.name}” is shared with the workspace` : `“${saved.name}” is only yours now`,
    );
  };

  const remove = async (template: Template) => {
    const saved = await update(template, { deleted: true });
    if (!saved) return;
    if (editing?.template.id === template.id) closeEditor();
    undoToast(`Deleted “${template.name}”`, {
      onUndo: () => {
        void update(template, { deleted: false });
      },
    });
  };

  // ── making things ───────────────────────────────────────────────────────
  const runProjectCopy = async (
    make: (
      id: string,
    ) => Promise<
      { ok: true; projectId: string | null } | { ok: false; message: string; offline: boolean }
    >,
    name: string,
  ) => {
    attemptId.current ??= newCopyId();
    setBusy(true);
    const outcome = await make(attemptId.current);
    setBusy(false);
    if (!outcome.ok) {
      toast.error(outcome.message);
      return;
    }
    close();
    toast(`Created “${name}”`);
    if (outcome.projectId) onOpenProject(outcome.projectId);
  };

  /** Duplicate's facts about the source: whether it has dates and people. */
  const sourceFacts = (bucket: Bucket) => {
    const open = tasks.filter(
      (t) =>
        t.bucketId === bucket.id && !t.deletedAt && t.status !== "done" && t.status !== "archived",
    );
    const sectionDated = sections.some(
      (s) => s.projectId === bucket.id && (s.endsOn || s.startsOn),
    );
    return {
      name: bucket.name,
      startsOn: bucket.startsOn ?? null,
      dated: Boolean(
        bucket.startsOn || bucket.targetOn || sectionDated || open.some((t) => t.dueDate),
      ),
      people: open.some((t) => Boolean(t.assigneeId)),
    };
  };
  const duplicateSource = dialog?.kind === "duplicate" ? sourceFacts(dialog.bucket) : null;
  const liveArea = (id: string | null | undefined) =>
    id && areas.some((a) => a.id === id) ? id : null;

  const dialogs: ReactNode = (
    <>
      <SaveTemplateDialog
        open={dialog?.kind === "save-task" || dialog?.kind === "save-project"}
        kind={dialog?.kind === "save-project" ? "project" : "task"}
        defaultName={
          dialog?.kind === "save-task"
            ? dialog.task.title
            : dialog?.kind === "save-project"
              ? dialog.bucket.name
              : ""
        }
        access={copyAccess}
        onSave={(name) => {
          if (dialog?.kind === "save-task") void saveAs({ kind: "task", id: dialog.task.id }, name);
          if (dialog?.kind === "save-project")
            void saveAs({ kind: "project", id: dialog.bucket.id }, name);
        }}
        onClose={close}
      />
      <CopyProjectDialog
        open={dialog?.kind === "duplicate"}
        mode="duplicate"
        source={duplicateSource}
        busy={busy}
        access={copyAccess}
        onCreate={(form) => {
          if (dialog?.kind !== "duplicate" || !deps) return;
          const bucket = dialog.bucket;
          void runProjectCopy(
            (id) =>
              duplicateProject(deps, bucket.id, {
                id,
                name: form.name,
                startsOn: form.startsOn,
                areaId: liveArea(bucket.areaId),
                keepPeople: form.keepPeople,
              }),
            form.name,
          );
        }}
        onClose={close}
      />
      <CopyProjectDialog
        open={dialog?.kind === "from-template"}
        mode="template"
        templates={projectTemplates}
        initialTemplateId={dialog?.kind === "from-template" ? dialog.templateId : null}
        busy={busy}
        onCreate={(form) => {
          if (!deps || !form.templateId) return;
          const templateId = form.templateId;
          void runProjectCopy(
            (id) =>
              applyProjectTemplate(deps, templateId, {
                id,
                name: form.name,
                startsOn: form.startsOn,
                areaId: null,
                keepPeople: form.keepPeople,
              }),
            form.name,
          );
        }}
        onClose={close}
      />
      <UseTaskTemplateDialog
        open={dialog?.kind === "use-task"}
        template={dialog?.kind === "use-task" ? dialog.template : null}
        defaultProjectId={(() => {
          const project = dialog?.kind === "use-task" ? dialog.template.facts.project : null;
          return project && buckets.some((b) => b.id === project && !b.isSystem) ? project : null;
        })()}
        projects={buckets}
        busy={busy}
        onCreate={(form) => {
          if (dialog?.kind !== "use-task" || !deps) return;
          const template = dialog.template;
          attemptId.current ??= newCopyId();
          const id = attemptId.current;
          setBusy(true);
          void applyTaskTemplate(deps, template.id, { id, ...form }).then((outcome) => {
            setBusy(false);
            if (!outcome.ok) {
              toast.error(outcome.message);
              return;
            }
            close();
            const rootId = outcome.taskIds[0] ?? id;
            // Where it landed (the template's project falls back to your Inbox
            // when you can't add tasks there).
            const landed = outcome.result.tasks.find((t) => t.id === rootId)?.bucketId;
            const place = buckets.find((b) => b.id === landed && !b.isSystem)?.name ?? "Inbox";
            toast(form.title, {
              description: `From “${template.name}” · ${place}`,
              action: { label: "Open", onClick: () => onOpenTask(rootId) },
            });
          });
        }}
        onClose={close}
      />
      <Dialog open={dialog?.kind === "share"} onOpenChange={(next) => !next && close()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Share “{dialog?.kind === "share" ? dialog.template.name : ""}”?
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === "share"
                ? `This includes ${tasksWord(dialog.template.facts.tasks)} from a private project. Everyone in the workspace who uses Tasks will see them.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (dialog?.kind === "share") void share(dialog.template, true);
                close();
              }}
            >
              Share
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  // ── the Templates page ──────────────────────────────────────────────────
  const startFrom = (template: Template) => {
    if (template.kind === "project") setDialog({ kind: "from-template", templateId: template.id });
    else setDialog({ kind: "use-task", template });
  };
  const requestShare = (template: Template, shared: boolean) => {
    if (shared && template.privateSource) setDialog({ kind: "share", template });
    else void share(template, shared);
  };
  const page: ReactNode = editing ? (
    <TemplateEditor
      template={editorTemplate}
      loading={editorLoading}
      canEdit={canEdit && editing.template.ownerId === userId}
      projects={buckets}
      onSave={async (patch) => {
        const saved = await update(editing.template, patch);
        if (saved) {
          setEditorTemplate(saved);
          toast("Template saved");
        }
        return Boolean(saved);
      }}
      onUse={canEdit ? () => startFrom(editorTemplate ?? editing.template) : null}
      onClose={closeEditor}
    />
  ) : (
    <TemplatesView
      templates={templates}
      loaded={loaded}
      currentUserId={userId}
      canEdit={canEdit}
      isAdmin={isAdmin}
      onOpen={openEditor}
      onUse={startFrom}
      onNewProjectFromTemplate={() => setDialog({ kind: "from-template", templateId: null })}
      onShare={requestShare}
      onDelete={(t) => void remove(t)}
    />
  );

  return {
    /** The server has templates (a build ahead of its database offers none). */
    supported,
    dialogs,
    /** The Templates page (the list, or a template open as its editor). */
    page,
    requestSaveTask: (task: Task) => setDialog({ kind: "save-task", task }),
    requestSaveProject: (bucket: Bucket) => setDialog({ kind: "save-project", bucket }),
    requestDuplicate: (bucket: Bucket) => setDialog({ kind: "duplicate", bucket }),
    requestNewFromTemplate: () => setDialog({ kind: "from-template", templateId: null }),
  };
}
