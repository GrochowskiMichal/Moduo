// The small dialogs of templates and "Duplicate project…" (TV-D15, Tasks v3
// §15; REPLAN 9 and 79):
// - Save as template: a name (the task's or the project's), and that it's
//   yours until you share it.
// - Duplicate project… / New project from template…: a name and a start date
//   (every date moves with it), and whether people stay assigned.
// - Use a task template: a title, where it goes, and the one date its dates
//   count from.

import { useEffect, useId, useState } from "react";

import { Button } from "../../../../components/ui/button";
import { Checkbox } from "../../../../components/ui/checkbox";
import { DateField } from "../../../../components/ui/date-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import { localDayOf } from "../../../../lib/task-rows";
import type { Bucket } from "../../model";
import { copyName, type Template, type TemplateKind, templateSize } from "../model";

const todayDay = () => localDayOf(new Date().toISOString()) ?? "";
const dayToDate = (day: string | null) => (day ? new Date(`${day}T12:00:00`) : null);
const dateToDay = (d: Date | null) => (d ? localDayOf(d.toISOString()) : null);

const FIELD = "flex flex-col gap-1.5";

/** Why a copy isn't offered (D15-11). */
export function noCopyReason(kind: TemplateKind): string {
  return kind === "task"
    ? "You need edit access to this task to save it as a template."
    : "You need edit access to this project to copy it.";
}
const LABEL = "font-sans text-sm text-muted-foreground";

// ── Save as template ─────────────────────────────────────────────────────────

export function SaveTemplateDialog({
  open,
  kind,
  defaultName,
  access = true,
  onSave,
  onClose,
}: {
  open: boolean;
  kind: TemplateKind;
  defaultName: string;
  /** May you copy it (Edit on it, D15-11)? null while asking. */
  access?: boolean | null;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const nameId = useId();
  const [name, setName] = useState(defaultName);
  useEffect(() => {
    if (open) setName(defaultName.slice(0, 120));
  }, [open, defaultName]);
  const trimmed = name.trim();
  const save = () => {
    if (!trimmed || access !== true) return;
    onSave(trimmed);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            {kind === "task"
              ? "Keeps the task and its subtasks, tags, priority, estimate and dates (as days from the start). Comments, time and done states stay here."
              : "Keeps the statuses, sections and open tasks, with their dates as days from the start. Nothing done, commented or tracked."}
          </DialogDescription>
        </DialogHeader>
        <div className={FIELD}>
          <Label htmlFor={nameId} className={LABEL}>
            Name
          </Label>
          <Input
            id={nameId}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
          />
        </div>
        {access === false ? (
          <p className="font-sans text-sm text-foreground">{noCopyReason(kind)}</p>
        ) : (
          <p className="font-sans text-xs text-muted-foreground">
            Only you can use it until you share it with the workspace.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {access === false ? "Close" : "Cancel"}
          </Button>
          {access === false ? null : (
            <Button disabled={!trimmed || access !== true} onClick={save}>
              Save template
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Duplicate project… / New project from template… ─────────────────────────

export type ProjectCopyForm = {
  name: string;
  /** YYYY-MM-DD; null = no dates. */
  startsOn: string | null;
  keepPeople: boolean;
  /** "From template": which one. */
  templateId: string | null;
};

export function CopyProjectDialog({
  open,
  mode,
  source,
  templates = [],
  initialTemplateId = null,
  busy = false,
  access = true,
  onCreate,
  onClose,
}: {
  open: boolean;
  /** Duplicate a live project, or make one from a project template. */
  mode: "duplicate" | "template";
  /** Duplicate: may you copy it (Edit on it, D15-11)? null while asking. */
  access?: boolean | null;
  /** Duplicate: the project copied (its name, whether it has dates and people). */
  source?: { name: string; dated: boolean; people: boolean; startsOn: string | null } | null;
  /** From template: the project templates to pick from. */
  templates?: readonly Template[];
  initialTemplateId?: string | null;
  busy?: boolean;
  onCreate: (form: ProjectCopyForm) => void;
  onClose: () => void;
}) {
  const nameId = useId();
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId);
  const picked = mode === "template" ? (templates.find((t) => t.id === templateId) ?? null) : null;
  const dated = mode === "duplicate" ? Boolean(source?.dated) : Boolean(picked?.facts.dated);
  const people = mode === "duplicate" ? Boolean(source?.people) : Boolean(picked?.facts.people);
  const [name, setName] = useState("");
  const [start, setStart] = useState<string | null>(null);
  const [keepPeople, setKeepPeople] = useState(true);
  // Fresh each time it opens (or another template is picked).
  // Fresh each time it opens; typing is never reset by a re-render or a
  // list read (keyed on what was picked, not on objects).
  useEffect(() => {
    if (!open) return;
    setTemplateId(initialTemplateId);
    setKeepPeople(true);
  }, [open, initialTemplateId]);
  const firstTemplateId = templates[0]?.id ?? null;
  useEffect(() => {
    if (open && mode === "template" && templateId === null && firstTemplateId) {
      setTemplateId(firstTemplateId);
    }
  }, [open, mode, templateId, firstTemplateId]);
  const sourceName = source?.name ?? "";
  const pickedId = picked?.id ?? null;
  const pickedName = picked?.name ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: the start resets with what it starts from (`dated` follows it)
  useEffect(() => {
    if (!open) return;
    setName(mode === "duplicate" ? (sourceName ? copyName(sourceName) : "") : pickedName);
    setStart(dated ? todayDay() : null);
  }, [open, mode, sourceName, pickedId]);
  const trimmed = name.trim();
  const blocked = mode === "duplicate" && access === false;
  const ready =
    trimmed.length > 0 && (mode === "template" ? picked !== null : access === true) && !busy;
  const create = () => {
    if (!ready) return;
    onCreate({
      name: trimmed,
      startsOn: dated ? start : null,
      keepPeople: people ? keepPeople : true,
      templateId: picked?.id ?? null,
    });
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === "duplicate"
              ? `Duplicate “${source?.name ?? ""}”`
              : "New project from template"}
          </DialogTitle>
          <DialogDescription>
            {mode === "duplicate"
              ? "Copies its statuses, sections and open tasks. Nothing done, commented or tracked."
              : "Makes a project with the template's statuses, sections and tasks."}
          </DialogDescription>
        </DialogHeader>
        {blocked ? (
          <p className="font-sans text-sm text-foreground">{noCopyReason("project")}</p>
        ) : null}
        <div className={blocked ? "hidden" : "flex flex-col gap-3"}>
          {mode === "template" ? (
            templates.length === 0 ? (
              <p className="font-sans text-sm text-muted-foreground">
                No project templates yet. Save one from a project's ⋯ → Save as template.
              </p>
            ) : (
              <div className={FIELD}>
                <span className={LABEL}>Template</span>
                <Select value={templateId ?? ""} onValueChange={(v) => setTemplateId(v)}>
                  <SelectTrigger aria-label="Template">
                    <SelectValue placeholder="Pick a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} · {templateSize(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )
          ) : null}
          <div className={FIELD}>
            <Label htmlFor={nameId} className={LABEL}>
              Name
            </Label>
            <Input
              id={nameId}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  create();
                }
              }}
            />
          </div>
          {dated ? (
            <div className={FIELD}>
              <span className={LABEL}>Starts on</span>
              <DateField
                variant="outline"
                value={dayToDate(start)}
                onChange={(d) => setStart(dateToDay(d))}
                placeholder="No dates"
                aria-label="Starts on"
              />
              <span className="font-sans text-xs text-muted-foreground">
                Every date moves with the start.
              </span>
            </div>
          ) : null}
          {people ? (
            <Label className="flex items-center gap-2 font-sans text-sm text-foreground">
              <Checkbox
                checked={keepPeople}
                onCheckedChange={(v) => setKeepPeople(v === true)}
                aria-label="Keep who's assigned"
              />
              Keep who's assigned
            </Label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {blocked ? "Close" : "Cancel"}
          </Button>
          {blocked ? null : (
            <Button disabled={!ready} onClick={create}>
              {busy ? "Creating…" : mode === "duplicate" ? "Duplicate" : "Create project"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Use a task template ──────────────────────────────────────────────────────

export type TaskTemplateForm = {
  title: string;
  /** Omitted: the template's own project and section. null: your Inbox. */
  projectId?: string | null;
  /** YYYY-MM-DD; null = no dates. */
  date: string | null;
};

export function UseTaskTemplateDialog({
  open,
  template,
  defaultProjectId,
  projects,
  busy = false,
  onCreate,
  onClose,
}: {
  open: boolean;
  template: Template | null;
  /** The template's own project, when you can still add tasks there. */
  defaultProjectId: string | null;
  projects: readonly Bucket[];
  busy?: boolean;
  onCreate: (form: TaskTemplateForm) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !template) return;
    setTitle(template.facts.title ?? template.name);
    setProjectId(defaultProjectId);
    setDate(template.facts.dated ? todayDay() : null);
  }, [open, template, defaultProjectId]);
  const fromDue = template?.facts.anchor === "due";
  const ready = Boolean(template) && title.trim().length > 0 && !busy;
  const create = () => {
    if (!ready) return;
    onCreate({
      title: title.trim(),
      // The template's own project keeps its section too (the server's default).
      ...(projectId === defaultProjectId ? {} : { projectId }),
      date: template?.facts.dated ? date : null,
    });
  };
  return (
    <Dialog open={open && template !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New task from “{template?.name ?? ""}”</DialogTitle>
          <DialogDescription>{template ? templateSize(template) : ""}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className={FIELD}>
            <Label htmlFor={titleId} className={LABEL}>
              Title
            </Label>
            <Input
              id={titleId}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  create();
                }
              }}
            />
          </div>
          <div className={FIELD}>
            <span className={LABEL}>Project</span>
            <Select
              value={projectId ?? "inbox"}
              onValueChange={(v) => setProjectId(v === "inbox" ? null : v)}
            >
              <SelectTrigger aria-label="Project">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inbox">Inbox</SelectItem>
                {projects
                  .filter((p) => !p.isSystem && !p.archivedAt && !p.deletedAt)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {template?.facts.dated ? (
            <div className={FIELD}>
              <span className={LABEL}>{fromDue ? "Due" : "Starts on"}</span>
              <DateField
                variant="outline"
                value={dayToDate(date)}
                onChange={(d) => setDate(dateToDay(d))}
                placeholder="No dates"
                aria-label={fromDue ? "Due" : "Starts on"}
              />
              <span className="font-sans text-xs text-muted-foreground">
                Its subtasks' dates count from this one.
              </span>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={create}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
