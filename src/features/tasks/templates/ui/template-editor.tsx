// The template as its own editor (TV-D15, REPLAN 9 and 79): a template opens
// in the centre like a task's full page (call 32), marked *Template*, with its
// dates as days from the start. A task template shows its task (title,
// description, priority, estimate, due, tags, who it's for) and its subtasks;
// a project template its statuses, sections and tasks. Editing a template
// never changes what was made from it. Changes are kept here until Save.

import { ArrowLeft, Plus, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { TagChip } from "../../../../components/tag-chip";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { CollectionHeader } from "../../../../components/ui/collection-header";
import { detailTitleVariants } from "../../../../components/ui/detail-title";
import { EmptyState } from "../../../../components/ui/empty-state";
import { IconButton } from "../../../../components/ui/icon-button";
import { Input } from "../../../../components/ui/input";
import { PropertyRow } from "../../../../components/ui/property-row";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import { Textarea } from "../../../../components/ui/textarea";
import { cn } from "../../../../lib/utils";
import { useAssignees } from "../../assignees";
import type { Bucket, PriorityLevel } from "../../model";
import {
  addTemplateSection,
  addTemplateTask,
  offsetLabel,
  type ProjectTemplateBody,
  patchTemplateSection,
  patchTemplateTask,
  removeTemplateSection,
  removeTemplateTask,
  renameTemplateStatus,
  type TaskTemplateBody,
  type TemplateBody,
  type TemplatePatchable,
  type TemplateTask,
  type TemplateWithBody,
  templateOutline,
} from "../model";

const CATEGORY_LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  wont_do: "Won't do",
};

const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** A day offset: a whole number of days, or nothing (no date). */
function OffsetField({
  value,
  from,
  disabled,
  label,
  onChange,
}: {
  value: number | null;
  from: "start" | "due";
  disabled: boolean;
  label: string;
  onChange: (days: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const t = text.trim();
    if (t === "") return onChange(null);
    const n = Number.parseInt(t, 10);
    if (Number.isFinite(n) && Math.abs(n) <= 3650) onChange(n);
    else setText(value === null ? "" : String(value));
  };
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Input
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={text}
        disabled={disabled}
        placeholder="—"
        className="h-(--ctrl-h-sm) w-16 px-1.5 tabular-nums"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <span className="truncate font-sans text-xs text-muted-foreground">
        {offsetLabel(value, from)}
      </span>
    </span>
  );
}

function TaskLine({
  task,
  index,
  depth,
  from,
  disabled,
  sections,
  onPatch,
  onRemove,
  onAddSubtask,
}: {
  task: TemplateTask;
  index: number;
  depth: 0 | 1;
  from: "start" | "due";
  disabled: boolean;
  /** Project templates: the sections a task can sit in. */
  sections: readonly { name: string }[] | null;
  onPatch: (patch: Partial<TemplateTask>) => void;
  onRemove: (() => void) | null;
  onAddSubtask: (() => void) | null;
}) {
  const { byId } = useAssignees();
  const person = task.assignee ? byId(task.assignee) : null;
  return (
    <li
      className={cn(
        "group/line flex min-h-(--row-h) min-w-0 flex-wrap items-center gap-2 rounded-md px-2 hover:bg-state-hover",
        depth === 1 && "pl-8",
      )}
    >
      <Input
        aria-label={depth === 0 ? `Task ${index + 1}` : `Subtask ${index + 1}`}
        value={task.title}
        disabled={disabled}
        placeholder={depth === 0 ? "Task title" : "Subtask title"}
        className="h-(--ctrl-h-sm) min-w-40 flex-1 border-transparent bg-transparent px-1.5 shadow-none hover:border-hairline"
        onChange={(e) => onPatch({ title: e.target.value })}
      />
      {sections && depth === 0 ? (
        <Select
          value={
            task.section === null || task.section === undefined ? "none" : String(task.section)
          }
          disabled={disabled}
          onValueChange={(v) => onPatch({ section: v === "none" ? null : Number(v) })}
        >
          <SelectTrigger size="sm" className="w-36" aria-label="Section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No section</SelectItem>
            {sections.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a section is its position
              <SelectItem key={i} value={String(i)}>
                {s.name || "Untitled section"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <OffsetField
        value={task.due}
        from={from}
        disabled={disabled}
        label="Due, in days"
        onChange={(due) => onPatch({ due })}
      />
      {person ? (
        <span className="flex shrink-0 items-center gap-0.5 font-sans text-xs text-muted-foreground">
          {person.fullName || person.name}
          {!disabled ? (
            <IconButton
              icon={X}
              label={`Unassign ${person.fullName || person.name}`}
              tooltip={null}
              onClick={() => onPatch({ assignee: null })}
            />
          ) : null}
        </span>
      ) : null}
      {!disabled ? (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out) group-hover/line:opacity-100 group-focus-within/line:opacity-100">
          {onAddSubtask ? (
            <IconButton icon={Plus} label="Add a subtask" onClick={onAddSubtask} />
          ) : null}
          {onRemove ? <IconButton icon={X} label="Remove" onClick={onRemove} /> : null}
        </span>
      ) : null}
    </li>
  );
}

function TaskTemplateFields({
  body,
  disabled,
  projects,
  onChange,
}: {
  body: TaskTemplateBody;
  disabled: boolean;
  projects: readonly Bucket[];
  onChange: (body: TaskTemplateBody) => void;
}) {
  const root = body.tasks[0];
  const from = body.anchor;
  if (!root) return null;
  const patchRoot = (patch: Partial<TemplateTask>) => onChange(patchTemplateTask(body, 0, patch));
  const subtasks = templateOutline(body).filter((x) => x.depth === 1);
  const projectChoices = projects.filter((p) => !p.isSystem && !p.archivedAt && !p.deletedAt);
  const projectKnown = body.project === null || projectChoices.some((p) => p.id === body.project);
  return (
    <>
      <Input
        aria-label="Task title"
        value={root.title}
        disabled={disabled}
        placeholder="Task title"
        className={cn(
          detailTitleVariants({ size: "lead" }),
          "h-auto border-transparent bg-transparent px-1.5 py-1 shadow-none hover:border-hairline",
        )}
        onChange={(e) => patchRoot({ title: e.target.value })}
      />
      <div className="flex flex-col gap-px">
        <PropertyRow label="Project">
          <Select
            value={body.project && projectKnown ? body.project : "inbox"}
            disabled={disabled}
            onValueChange={(v) =>
              onChange({ ...body, project: v === "inbox" ? null : v, section: null })
            }
          >
            <SelectTrigger size="sm" className="w-56" aria-label="Project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inbox">Inbox (whoever uses it)</SelectItem>
              {projectChoices.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropertyRow>
        <PropertyRow label="Due">
          <OffsetField
            value={root.due}
            from={from}
            disabled={disabled}
            label="Due, in days"
            onChange={(due) => patchRoot({ due })}
          />
        </PropertyRow>
        <PropertyRow label="Priority">
          <Select
            value={root.priority ?? "none"}
            disabled={disabled}
            onValueChange={(v) =>
              patchRoot({ priority: v === "none" ? null : (v as PriorityLevel) })
            }
          >
            <SelectTrigger size="sm" className="w-36" aria-label="Priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No priority</SelectItem>
              {(Object.keys(PRIORITY_LABEL) as PriorityLevel[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropertyRow>
        <PropertyRow label="Estimate">
          <span className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              aria-label="Estimate, in minutes"
              value={root.estimate ?? ""}
              disabled={disabled}
              placeholder="—"
              className="h-(--ctrl-h-sm) w-20 px-1.5 tabular-nums"
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                patchRoot({ estimate: Number.isFinite(n) && n >= 0 ? n : null });
              }}
            />
            <span className="font-sans text-xs text-muted-foreground">minutes</span>
          </span>
        </PropertyRow>
        {root.tags.length > 0 ? (
          <PropertyRow label="Tags" align="start">
            <span className="flex flex-wrap gap-1.5">
              {root.tags.map((tag) => (
                <TagChip
                  key={tag.name}
                  name={tag.name}
                  color={tag.color}
                  size="md"
                  onRemove={
                    disabled
                      ? undefined
                      : () => patchRoot({ tags: root.tags.filter((t) => t.name !== tag.name) })
                  }
                />
              ))}
            </span>
          </PropertyRow>
        ) : null}
      </div>
      <Textarea
        aria-label="Description"
        value={root.description}
        disabled={disabled}
        placeholder="Add a description…"
        className="min-h-24 font-sans text-base"
        onChange={(e) => patchRoot({ description: e.target.value })}
      />
      <section>
        <CollectionHeader
          label="Subtasks"
          count={subtasks.length || undefined}
          action={
            !disabled ? (
              <IconButton
                icon={Plus}
                label="Add a subtask"
                onClick={() => onChange(addTemplateTask(body, { title: "", parent: 0 }))}
              />
            ) : undefined
          }
        />
        <ul className="flex flex-col">
          {subtasks.map(({ index, task }) => (
            <TaskLine
              key={index}
              task={task}
              index={index}
              depth={1}
              from={from}
              disabled={disabled}
              sections={null}
              onPatch={(patch) => onChange(patchTemplateTask(body, index, patch))}
              onRemove={() => onChange(removeTemplateTask(body, index))}
              onAddSubtask={null}
            />
          ))}
        </ul>
      </section>
    </>
  );
}

function ProjectTemplateFields({
  body,
  disabled,
  onChange,
}: {
  body: ProjectTemplateBody;
  disabled: boolean;
  onChange: (body: ProjectTemplateBody) => void;
}) {
  const outline = templateOutline(body);
  return (
    <>
      <Textarea
        aria-label="Description"
        value={body.description}
        disabled={disabled}
        // Projects have no description yet (TV-U16): these notes stay with the template.
        placeholder="Notes about this template (they stay with it)…"
        className="min-h-20 font-sans text-base"
        onChange={(e) => onChange({ ...body, description: e.target.value })}
      />
      <section>
        <CollectionHeader label="Statuses" count={body.statuses.length} />
        <ul className="flex flex-col">
          {body.statuses.map((s, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a status is its position
              key={i}
              className="flex min-h-(--row-h) items-center gap-2 px-2"
            >
              <span className="w-24 shrink-0 font-sans text-xs text-muted-foreground">
                {CATEGORY_LABEL[s.category]}
              </span>
              <Input
                aria-label={`Status ${i + 1}`}
                defaultValue={s.name}
                disabled={disabled}
                maxLength={60}
                className="h-(--ctrl-h-sm) max-w-64 border-transparent bg-transparent px-1.5 shadow-none hover:border-hairline"
                onBlur={(e) => {
                  const next = renameTemplateStatus(body, i, e.target.value);
                  // A name another status has (or an empty one) goes back.
                  if (next === body) e.target.value = s.name;
                  else onChange(next);
                }}
              />
              {s.hidden ? (
                <span className="font-sans text-xs text-muted-foreground">Hidden</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <CollectionHeader
          label="Sections"
          count={body.sections.length || undefined}
          action={
            !disabled ? (
              <IconButton
                icon={Plus}
                label="Add a section"
                onClick={() => onChange(addTemplateSection(body, "New section"))}
              />
            ) : undefined
          }
        />
        <ul className="flex flex-col">
          {body.sections.map((s, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a section is its position
              key={i}
              className="group/line flex min-h-(--row-h) flex-wrap items-center gap-2 rounded-md px-2 hover:bg-state-hover"
            >
              <Input
                aria-label={`Section ${i + 1}`}
                value={s.name}
                disabled={disabled}
                maxLength={120}
                className="h-(--ctrl-h-sm) min-w-40 flex-1 border-transparent bg-transparent px-1.5 shadow-none hover:border-hairline"
                onChange={(e) => onChange(patchTemplateSection(body, i, { name: e.target.value }))}
              />
              <span className="font-sans text-xs text-muted-foreground">Starts</span>
              <OffsetField
                value={s.starts}
                from="start"
                disabled={disabled || s.ends === null}
                label="Section start, in days"
                onChange={(starts) => onChange(patchTemplateSection(body, i, { starts }))}
              />
              <span className="font-sans text-xs text-muted-foreground">Ends</span>
              <OffsetField
                value={s.ends}
                from="start"
                disabled={disabled}
                label="Section end, in days"
                onChange={(ends) => onChange(patchTemplateSection(body, i, { ends }))}
              />
              {!disabled ? (
                <span className="opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out) group-hover/line:opacity-100 group-focus-within/line:opacity-100">
                  <IconButton
                    icon={X}
                    label="Remove section"
                    onClick={() => onChange(removeTemplateSection(body, i))}
                  />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <CollectionHeader
          label="Tasks"
          count={body.tasks.length || undefined}
          action={
            !disabled ? (
              <IconButton
                icon={Plus}
                label="Add a task"
                onClick={() => onChange(addTemplateTask(body, { title: "" }))}
              />
            ) : undefined
          }
        />
        {outline.length === 0 ? (
          <p className="px-2 font-sans text-sm text-muted-foreground">No tasks.</p>
        ) : (
          <ul className="flex flex-col">
            {outline.map(({ index, task, depth }) => (
              <TaskLine
                key={index}
                task={task}
                index={index}
                depth={depth}
                from="start"
                disabled={disabled}
                sections={body.sections}
                onPatch={(patch) => onChange(patchTemplateTask(body, index, patch))}
                onRemove={() => onChange(removeTemplateTask(body, index))}
                onAddSubtask={
                  depth === 0
                    ? () => onChange(addTemplateTask(body, { title: "", parent: index }))
                    : null
                }
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Untitled tasks are left out on Save (a blank line isn't work). */
function withoutBlankTasks(body: TemplateBody): TemplateBody {
  let next = body;
  for (let i = next.tasks.length - 1; i >= 0; i--) {
    const t = next.tasks[i];
    if (t && !t.title.trim() && !(next.kind === "task" && i === 0))
      next = removeTemplateTask(next, i);
  }
  return next;
}

export function TemplateEditor({
  template,
  loading,
  canEdit,
  projects,
  onSave,
  onUse,
  onClose,
}: {
  template: TemplateWithBody | null;
  loading: boolean;
  /** Its owner, with edit access to Tasks. */
  canEdit: boolean;
  projects: readonly Bucket[];
  onSave: (patch: TemplatePatchable) => Promise<boolean>;
  onUse: (() => void) | null;
  onClose: () => void;
}) {
  const nameId = useId();
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState<TemplateBody | null>(template?.body ?? null);
  const [saving, setSaving] = useState(false);
  // A newly opened (or freshly saved) template replaces the draft.
  useEffect(() => {
    setName(template?.name ?? "");
    setBody(template?.body ?? null);
  }, [template]);
  const dirty = useMemo(
    () =>
      !!template &&
      (name.trim() !== template.name || JSON.stringify(body) !== JSON.stringify(template.body)),
    [template, name, body],
  );
  const save = async () => {
    if (!template || !body || !dirty || saving) return;
    const cleaned = withoutBlankTasks(body);
    setSaving(true);
    const ok = await onSave({
      ...(name.trim() && name.trim() !== template.name ? { name: name.trim() } : {}),
      ...(JSON.stringify(cleaned) !== JSON.stringify(template.body) ? { body: cleaned } : {}),
    });
    setSaving(false);
    if (ok) setBody(cleaned);
  };

  return (
    <section
      aria-label="Template"
      data-slot="template-editor"
      className="motion-view mx-auto flex h-full min-h-0 w-full max-w-280 flex-col gap-2 px-4 pt-2"
    >
      <div className="flex min-h-(--ctrl-h) shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="-ml-2">
          <ArrowLeft aria-hidden />
          Templates
        </Button>
        <span className="grow" />
        {dirty ? (
          <span className="font-sans text-xs text-muted-foreground" aria-live="polite">
            Not saved yet
          </span>
        ) : null}
        {onUse ? (
          <Button size="sm" variant="outline" onClick={onUse} disabled={dirty}>
            Use…
          </Button>
        ) : null}
        {canEdit ? (
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        ) : null}
      </div>
      {loading || !template || !body ? (
        loading ? null : (
          <EmptyState
            title="Template not found"
            description="It was deleted, or it's no longer shared."
          />
        )
      ) : (
        <div className="pane-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-6">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <Badge variant="secondary">Template</Badge>
              <span className="font-sans text-xs text-muted-foreground">
                {template.kind === "task" ? "Task" : "Project"}
                {template.shared ? " · Shared with the workspace" : " · Only you"}
                {" · Dates are days from "}
                {body.kind === "task" && body.anchor === "due" ? "the due date" : "the start"}
              </span>
            </span>
            <label htmlFor={nameId} className="sr-only">
              Template name
            </label>
            <Input
              id={nameId}
              value={name}
              disabled={!canEdit}
              maxLength={120}
              className={cn(
                detailTitleVariants({ size: "lead" }),
                "h-auto border-transparent bg-transparent px-1.5 py-1 shadow-none hover:border-hairline",
              )}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="px-1.5 font-sans text-xs text-muted-foreground">
              Editing a template never changes what was made from it.
            </p>
          </div>
          {body.kind === "task" ? (
            <TaskTemplateFields
              body={body}
              disabled={!canEdit}
              projects={projects}
              onChange={(next) => setBody(next)}
            />
          ) : (
            <ProjectTemplateFields
              body={body}
              disabled={!canEdit}
              onChange={(next) => setBody(next)}
            />
          )}
        </div>
      )}
    </section>
  );
}
