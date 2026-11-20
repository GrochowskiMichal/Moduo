// "Import tasks…" (TV-U18, spec §15, REPLAN 35): one dialog, opened from the
// sidebar's hairline ⋯.
//   1. Pick a file — Todoist or Asana project CSV, Trello board JSON, Linear or
//      Jira issue CSV. It's read here, in the app; the limits are said up
//      front. Your earlier imports are listed with "Undo this import".
//   2. The preview — "12 tasks, 1 project, 3 skipped · Import": each project
//      (new, or the one an earlier run filled), the statuses with their
//      categories to confirm (Trello's lists), what won't come across, and the
//      two choices (finished tasks; tasks nobody is on).
//   3. Importing — a bar and Stop.
//   4. Done — what the server says it made, what it refused, Undo.
// The writes go through the import engine as the person (run.ts).

import type { TaskStatusCategory } from "@contracts/vocabularies";
import { FileUp } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../../components/ui/button";
import { Checkbox } from "../../../../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { Label } from "../../../../components/ui/label";
import { Progress } from "../../../../components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import type { ModuoRuntime } from "../../../../lib/runtime.types";
import type { ImportRun } from "../../../../lib/runtime.web.agents";
import { formatDate } from "../../../../lib/time-format";
import { getResolvedTimeRegion } from "../../../../lib/time-region";
import { type Assignee, assigneeListName, UNASSIGNED } from "../../assignee-options";
import { CATEGORY_LABELS } from "../../statuses";
import {
  choosePlan,
  describeNotes,
  describeSkips,
  finishedCount,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_TASKS,
  IMPORT_SOURCES,
  type ImportPlan,
  planPeople,
  planTasks,
  skippedTotal,
  sourceLabel,
  suggestAssignees,
} from "../plan";
import { readImportText, sizeProblem } from "../read";
import {
  type ImportContext,
  type ImportOutcome,
  resolvePlan,
  runImport,
  type RunOptions,
} from "../run";
import { importApiOf } from "./import-api";

export { importApiOf };

const CATEGORIES: TaskStatusCategory[] = ["backlog", "todo", "in_progress", "done", "wont_do"];
const MB = 1024 * 1024;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

type Step =
  | { kind: "pick"; error: string | null; reading: boolean }
  | { kind: "preview"; plan: ImportPlan; fileName: string }
  | { kind: "running"; done: number; total: number }
  | {
      kind: "done";
      outcome: Extract<ImportOutcome, { ok: true }>;
      source: string;
      names: string[];
    };

export type TaskImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runtime: ModuoRuntime | null;
  workspaceId: string;
  userId: string;
  userEmail: string | null;
  /** The workspace's people as the assignee pickers show them (names; no emails). */
  assignees: readonly Assignee[];
  /** What's in the workspace now (the shared store), read when needed. */
  readContext: () => Omit<ImportContext, "workspaceId" | "userId">;
  /**
   * Resolves once the store has every task you can see (closed ones come
   * after the open), so a re-run finds all of its earlier tasks.
   */
  whenReady?: () => Promise<void>;
  /** After writes land: read the store again. */
  onChanged: () => Promise<void> | void;
  onOpenProject?: (projectId: string) => void;
};

export function TaskImportDialog(props: TaskImportDialogProps) {
  const { open, onOpenChange, runtime, workspaceId, userId, userEmail, readContext, onChanged } =
    props;
  const api = useMemo(() => importApiOf(runtime), [runtime]);
  const [step, setStep] = useState<Step>({ kind: "pick", error: null, reading: false });
  const stopRef = useRef<AbortController | null>(null);
  const running = step.kind === "running";
  // Leaving the page mid-run stops it between tasks; "Your imports" keeps its Undo.
  useEffect(() => () => stopRef.current?.abort(), []);

  useEffect(() => {
    if (open) setStep({ kind: "pick", error: null, reading: false });
  }, [open]);

  const readFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    const big = sizeProblem(file.size);
    if (big) {
      setStep({ kind: "pick", error: big, reading: false });
      return;
    }
    setStep({ kind: "pick", error: null, reading: true });
    try {
      const text = await file.text();
      const res = readImportText(file.name, text, { zone: getResolvedTimeRegion().timeZone });
      setStep(
        res.ok
          ? { kind: "preview", plan: res.plan, fileName: file.name }
          : { kind: "pick", error: res.message, reading: false },
      );
    } catch {
      setStep({ kind: "pick", error: "This file can't be read.", reading: false });
    }
  }, []);

  const start = async (
    previewed: ReturnType<typeof resolvePlan>,
    people: Pick<RunOptions, "assignNobodyToMe" | "assigneeOf">,
  ) => {
    if (!api) return;
    // Read what's here once more at Import: the preview may be minutes old.
    const ctx: ImportContext = { ...readContext(), workspaceId, userId };
    const resolved = resolvePlan(previewed.plan, ctx);
    const total = planTasks(resolved.plan).length;
    const stop = new AbortController();
    stopRef.current = stop;
    setStep({ kind: "running", done: 0, total });
    const outcome = await runImport(api, resolved, ctx, {
      ...people,
      signal: stop.signal,
      onProgress: (done, all) => setStep({ kind: "running", done, total: all }),
    });
    stopRef.current = null;
    onChanged();
    if (!outcome.ok) {
      setStep({ kind: "pick", error: outcome.message, reading: false });
      return;
    }
    // Names only what was made or filled: the server's answers, never the file's.
    const names = [
      ...outcome.projects.map((p) => p.name),
      ...resolved.targets.flatMap((t) => (t.kind === "existing" ? [t.name] : [])),
    ];
    setStep({ kind: "done", outcome, source: resolved.plan.source, names });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // An import in flight finishes (or is stopped) before the dialog goes.
        if (!next && running) return;
        onOpenChange(next);
      }}
    >
      {/* While it runs, Stop is the one way out: no × that does nothing. */}
      <DialogContent
        className="max-w-lg"
        data-testid="task-import-dialog"
        showCloseButton={!running}
      >
        <DialogHeader>
          <DialogTitle>Import tasks</DialogTitle>
          <DialogDescription>
            {step.kind === "preview"
              ? `From ${sourceLabel(step.plan.source)} · ${step.fileName}`
              : "Bring a project over from Todoist, Trello, Linear, Jira or Asana. The file is read here; nothing is saved until you press Import."}
          </DialogDescription>
        </DialogHeader>

        {step.kind === "pick" ? (
          <PickStep
            reading={step.reading}
            error={step.error}
            onFile={readFile}
            runtime={runtime}
            workspaceId={workspaceId}
            onChanged={onChanged}
          />
        ) : null}

        {step.kind === "preview" && api ? (
          <PreviewStep
            plan={step.plan}
            workspaceId={workspaceId}
            userId={userId}
            userEmail={userEmail}
            assignees={props.assignees}
            readContext={readContext}
            whenReady={props.whenReady}
            onBack={() => setStep({ kind: "pick", error: null, reading: false })}
            onImport={start}
          />
        ) : null}

        {step.kind === "running" ? (
          <div className="flex flex-col gap-2">
            <Progress value={step.done} max={step.total} label={`Importing ${step.total} tasks`} />
            <p className="font-sans text-xs text-muted-foreground" role="status">
              Imported {Math.min(step.done, step.total).toLocaleString("en-US")} of{" "}
              {plural(step.total, "task")}…
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => stopRef.current?.abort()}>
                Stop
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {step.kind === "done" ? (
          <DoneStep
            step={step}
            runtime={runtime}
            workspaceId={workspaceId}
            onChanged={onChanged}
            onClose={() => onOpenChange(false)}
            onOpenProject={
              props.onOpenProject && step.outcome.projects[0]
                ? () => {
                    props.onOpenProject?.(step.outcome.projects[0]!.id);
                    onOpenChange(false);
                  }
                : undefined
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ── 1. pick a file ───────────────────────────────────────────────────────────

function PickStep({
  reading,
  error,
  onFile,
  runtime,
  workspaceId,
  onChanged,
}: {
  reading: boolean;
  error: string | null;
  onFile: (file: File | null | undefined) => void;
  runtime: ModuoRuntime | null;
  workspaceId: string;
  onChanged: () => Promise<void> | void;
}) {
  const inputId = useId();
  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center font-sans text-sm text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-muted/70"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFile(e.dataTransfer.files[0]);
        }}
      >
        <FileUp className="size-icon-lg" aria-hidden />
        <span className="text-foreground">
          {reading ? "Reading…" : "Drop an export file here, or click to choose"}
        </span>
        <span className="text-xs">
          CSV or JSON · up to {IMPORT_MAX_BYTES / MB} MB ·{" "}
          {IMPORT_MAX_TASKS.toLocaleString("en-US")} tasks at a time
        </span>
        <input
          id={inputId}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          className="sr-only"
          aria-label="Export file"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {error ? (
        <p className="font-sans text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1 font-sans text-xs text-muted-foreground">
        {IMPORT_SOURCES.map((s) => (
          <li key={s.id}>
            <span className="text-foreground">{s.label}</span> · {s.file}
          </li>
        ))}
      </ul>
      <PastImports runtime={runtime} workspaceId={workspaceId} onChanged={onChanged} />
    </div>
  );
}

/** Your earlier runs in this workspace, newest first, each with Undo. */
function PastImports({
  runtime,
  workspaceId,
  onChanged,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  onChanged: () => Promise<void> | void;
}) {
  const [runs, setRuns] = useState<ImportRun[] | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const list = runtime?.tasks.listImports;
  const undo = runtime?.tasks.undoImport;
  const load = useCallback(() => {
    if (!list) return;
    list(workspaceId).then(
      (res) => setRuns(res.imports.slice(0, 8)),
      () => setRuns([]),
    );
  }, [list, workspaceId]);
  useEffect(load, [load]);
  if (!runs?.length) return null;
  return (
    <section
      aria-label="Your imports"
      className="flex flex-col gap-1.5 border-t border-hairline pt-3"
    >
      <h3 className="font-sans text-xs text-muted-foreground">Your imports</h3>
      <ul className="flex flex-col gap-1">
        {runs.map((run) => {
          const made = run.rows.filter(
            (r) => r.entityType === "task" && r.action === "created",
          ).length;
          return (
            <li key={run.id} className="flex items-center gap-2 font-sans text-sm">
              <span className="min-w-0 flex-1 break-words text-foreground">
                {sourceLabel(run.source as ImportPlan["source"])}
                {run.label ? ` · ${run.label}` : ""}
                <span className="text-muted-foreground">
                  {" "}
                  · {formatDate(run.startedAt)} · {plural(made, "task")}
                  {run.keyId ? " · through an app" : ""}
                </span>
              </span>
              {run.undoneAt ? (
                <span className="shrink-0 text-xs text-muted-foreground">Undone</span>
              ) : undo ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={undoing !== null}
                  onClick={() => {
                    setUndoing(run.id);
                    undo({ workspaceId, importId: run.id })
                      .then(async (r) => {
                        toast(undoneSentence(r));
                        // The store reads the change before another file is read.
                        await onChanged();
                        load();
                      })
                      .catch((e: unknown) =>
                        toast.error("Couldn’t undo the import", {
                          description: e instanceof Error ? e.message : undefined,
                        }),
                      )
                      .finally(() => setUndoing(null));
                  }}
                >
                  {undoing === run.id ? "Undoing…" : "Undo this import"}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function undoneSentence(r: {
  tasksRemoved: number;
  tasksKept: number;
  projectsRemoved: number;
}): string {
  const parts = [`Moved ${plural(r.tasksRemoved, "task")} to Recently deleted`];
  if (r.projectsRemoved) parts.push(plural(r.projectsRemoved, "project"));
  const kept = r.tasksKept ? ` · ${plural(r.tasksKept, "task")} kept (changed since)` : "";
  return `${parts.join(" and ")}${kept}`;
}

// ── 2. the preview ───────────────────────────────────────────────────────────

function PreviewStep({
  plan,
  workspaceId,
  userId,
  userEmail,
  assignees,
  readContext,
  whenReady,
  onBack,
  onImport,
}: {
  plan: ImportPlan;
  workspaceId: string;
  userId: string;
  userEmail: string | null;
  assignees: readonly Assignee[];
  readContext: TaskImportDialogProps["readContext"];
  whenReady?: () => Promise<void>;
  onBack: () => void;
  onImport: (
    resolved: ReturnType<typeof resolvePlan>,
    people: Pick<RunOptions, "assignNobodyToMe" | "assigneeOf">,
  ) => void;
}) {
  const finished = finishedCount(plan);
  const [includeFinished, setIncludeFinished] = useState(true);
  const [assignNobodyToMe, setAssignNobodyToMe] = useState(plan.source === "todoist");
  const [categories, setCategories] = useState<Record<string, Record<string, TaskStatusCategory>>>(
    {},
  );
  // The importer's own picks, per person in the file (over the suggestions).
  const [picked, setPicked] = useState<Record<string, string | null>>({});

  const chosen = useMemo(
    () => choosePlan(plan, { includeFinished, categories }),
    [plan, includeFinished, categories],
  );
  // Every task you can see, closed ones included, before matching keys.
  const [readyAt, setReadyAt] = useState<number | null>(whenReady ? null : 0);
  useEffect(() => {
    if (!whenReady) return;
    let live = true;
    whenReady().then(
      () => live && setReadyAt(Date.now()),
      () => live && setReadyAt(Date.now()),
    );
    return () => {
      live = false;
    };
  }, [whenReady]);
  const ctx = useMemo<ImportContext>(
    () => ({ ...readContext(), workspaceId, userId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again once the store has every task
    [readContext, workspaceId, userId, readyAt],
  );
  const resolved = useMemo(() => resolvePlan(chosen, ctx), [chosen, ctx]);
  // The people the file names, matched only from what the member list
  // already shows you (names; your own email). Nothing is asked of the server.
  const people = useMemo(
    () => planPeople(chosen, (t) => !resolved?.existing.has(t.key)),
    [chosen, resolved],
  );
  const takers = useMemo(() => assignees.filter((a) => a.canTakeTasks), [assignees]);
  const suggested = useMemo(
    () => suggestAssignees(people, takers, { userId, email: userEmail }),
    [people, takers, userId, userEmail],
  );
  const assigneeOf = useMemo(() => {
    const out = new Map<string, string | null>();
    for (const p of people) {
      const pick = p.key in picked ? picked[p.key] : suggested.get(p.key);
      out.set(p.key, pick && takers.some((a) => a.userId === pick) ? pick : null);
    }
    return out;
  }, [people, picked, suggested, takers]);
  const taskCount = planTasks(chosen).length;
  const skipped = skippedTotal(chosen.skipped);
  const notes = [...describeNotes(plan.notes)];
  const statusProjects = plan.projects.filter((p) => p.statuses.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-base text-foreground" data-testid="import-preview-line">
        {plural(taskCount, "task")}, {plural(chosen.projects.length, "project")},{" "}
        {skipped.toLocaleString("en-US")} skipped
      </p>

      <ul className="flex flex-col gap-1 font-sans text-sm">
        {chosen.projects.map((p, i) => {
          const target = resolved?.targets[i];
          return (
            <li key={p.name} className="flex flex-wrap items-baseline gap-x-2">
              <span className="break-words text-foreground">{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {target?.kind === "existing"
                  ? `into “${target.name}”, imported before`
                  : "new project"}{" "}
                · {plural(p.tasks.length, "task")}
                {p.sections.length ? ` · ${plural(p.sections.length, "section")}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      {resolved && resolved.counts.updatedTasks > 0 ? (
        <p className="font-sans text-xs text-muted-foreground">
          {plural(resolved.counts.updatedTasks, "task")} came in before: their text and dates are
          updated; where they are and their status stay as they are. Nothing is duplicated.
        </p>
      ) : null}

      {statusProjects.length ? (
        <section aria-label="Statuses" className="flex flex-col gap-1.5">
          <h3 className="font-sans text-xs text-muted-foreground">
            {plan.source === "trello"
              ? "Each list becomes a status. Check where it belongs:"
              : "Statuses:"}
          </h3>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto scrollbar-thin">
            {statusProjects.flatMap((p) =>
              p.statuses.map((s) => {
                const value = categories[p.name]?.[s.name] ?? s.category;
                return (
                  <div
                    key={`${p.name}/${s.name}`}
                    className="flex items-center gap-2 font-sans text-sm"
                  >
                    <span className="min-w-0 flex-1 break-words text-foreground">
                      {s.name}
                      {statusProjects.length > 1 ? (
                        <span className="text-muted-foreground"> · {p.name}</span>
                      ) : null}
                    </span>
                    <Select
                      value={value}
                      onValueChange={(v) =>
                        setCategories((prev) => ({
                          ...prev,
                          [p.name]: { ...prev[p.name], [s.name]: v as TaskStatusCategory },
                        }))
                      }
                    >
                      <SelectTrigger aria-label={`Category of ${s.name}`} className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CATEGORY_LABELS[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              }),
            )}
          </div>
        </section>
      ) : null}

      {people.length ? (
        <section aria-label="People in the file" className="flex flex-col gap-1.5">
          <h3 className="font-sans text-xs text-muted-foreground">
            People in the file. Pick who each one is here:
          </h3>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto scrollbar-thin">
            {people.map((p) => (
              <div key={p.key} className="flex items-center gap-2 font-sans text-sm">
                <span className="min-w-0 flex-1 break-words text-foreground">
                  {p.label}
                  <span className="text-muted-foreground"> · {plural(p.tasks, "task")}</span>
                </span>
                <Select
                  value={assigneeOf.get(p.key) ?? UNASSIGNED}
                  onValueChange={(v) =>
                    setPicked((prev) => ({ ...prev, [p.key]: v === UNASSIGNED ? null : v }))
                  }
                >
                  <SelectTrigger aria-label={`Assignee for ${p.label}`} className="w-40">
                    {/* The menu lists "Name (you)"; the picked value reads "You" (MOD-137). */}
                    <SelectValue>
                      {takers.find((a) => a.userId === assigneeOf.get(p.key))?.name ?? "Unassigned"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {takers.map((a) => (
                      <SelectItem key={a.userId} value={a.userId}>
                        {assigneeListName(a)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {finished > 0 ? (
          <Label className="flex items-center gap-2 font-sans text-sm text-foreground">
            <Checkbox
              checked={includeFinished}
              onCheckedChange={(v) => setIncludeFinished(v === true)}
              aria-label="Include finished tasks"
            />
            Include finished tasks ({finished.toLocaleString("en-US")})
          </Label>
        ) : null}
        {resolved.counts.nobodyOnIt > 0 ? (
          <Label className="flex items-center gap-2 font-sans text-sm text-foreground">
            <Checkbox
              checked={assignNobodyToMe}
              onCheckedChange={(v) => setAssignNobodyToMe(v === true)}
              aria-label="Assign tasks nobody is on to you"
            />
            {/* "to you", never "to me" (MOD-137). */}
            Assign the {plural(resolved.counts.nobodyOnIt, "task")} nobody is on to you
          </Label>
        ) : null}
      </div>

      {notes.length || skipped ? (
        <section aria-label="What changes on the way" className="flex flex-col gap-1">
          <h3 className="font-sans text-xs text-muted-foreground">On the way in</h3>
          <ul className="flex list-disc flex-col gap-0.5 pl-4 font-sans text-xs text-muted-foreground">
            {skipped ? <li>Skipped: {describeSkips(chosen.skipped).join(" · ")}</li> : null}
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <DialogFooter>
        <Button variant="ghost" onClick={onBack}>
          Choose another file
        </Button>
        <Button
          disabled={taskCount === 0 || readyAt === null}
          onClick={() => onImport(resolved, { assignNobodyToMe, assigneeOf })}
        >
          Import {plural(taskCount, "task")}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── 4. done ──────────────────────────────────────────────────────────────────

function DoneStep({
  step,
  runtime,
  workspaceId,
  onChanged,
  onClose,
  onOpenProject,
}: {
  step: Extract<Step, { kind: "done" }>;
  runtime: ModuoRuntime | null;
  workspaceId: string;
  onChanged: () => Promise<void> | void;
  onClose: () => void;
  onOpenProject?: () => void;
}) {
  const { outcome } = step;
  const [undone, setUndone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const undo = runtime?.tasks.undoImport;
  const { made } = outcome;
  const lines: string[] = [];
  const into = step.names.length ? ` into ${step.names.map((n) => `“${n}”`).join(", ")}` : "";
  lines.push(
    outcome.countsUnknown
      ? `Imported${into}, but how many couldn't be read back. "Your imports" has the run and its Undo.`
      : `Imported ${plural(made.tasksCreated, "task")}${into}${made.tasksUpdated ? `, and updated ${plural(made.tasksUpdated, "task")} from before` : ""}.`,
  );
  if (outcome.matchedEarlier)
    lines.push(
      `${plural(outcome.matchedEarlier, "task")} ${outcome.matchedEarlier === 1 ? "was" : "were"} already here from an earlier import: the file updated ${outcome.matchedEarlier === 1 ? "it" : "them"}, place and status included.`,
    );
  if (outcome.comments) lines.push(`${plural(outcome.comments, "comment")} came along.`);
  if (outcome.unassigned) lines.push(`${plural(outcome.unassigned, "task")} left unassigned.`);
  if (outcome.tagsLeftOff)
    lines.push(
      `${plural(outcome.tagsLeftOff, "task")} came without tags (you can't make tags here).`,
    );
  if (outcome.stopped) lines.push("Stopped part way: the rest of the file wasn't imported.");

  return (
    <div className="flex flex-col gap-3" data-testid="import-done">
      <ul className="flex flex-col gap-1 font-sans text-sm text-foreground">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {outcome.failed > 0 ? (
        <p className="font-sans text-sm text-destructive" role="alert">
          {plural(outcome.failed, "task")} couldn’t be imported
          {outcome.firstError ? `: ${outcome.firstError}` : "."}
        </p>
      ) : null}
      {outcome.commentsFailed > 0 ? (
        <p className="font-sans text-xs text-muted-foreground">
          {plural(outcome.commentsFailed, "comment")} couldn’t be added.
        </p>
      ) : null}
      {undone ? <p className="font-sans text-sm text-muted-foreground">{undone}</p> : null}
      <DialogFooter>
        {undo && !undone ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              undo({ workspaceId, importId: outcome.importId })
                .then(async (r) => {
                  await onChanged();
                  setUndone(undoneSentence(r));
                })
                .catch((e: unknown) =>
                  toast.error("Couldn’t undo the import", {
                    description: e instanceof Error ? e.message : undefined,
                  }),
                )
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Undoing…" : "Undo this import"}
          </Button>
        ) : null}
        {onOpenProject && !undone ? (
          <Button variant="ghost" onClick={onOpenProject}>
            Open project
          </Button>
        ) : null}
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </div>
  );
}
