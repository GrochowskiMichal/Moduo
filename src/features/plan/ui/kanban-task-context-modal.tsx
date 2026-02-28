import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Task, TaskPriority, TaskRelationKind } from "../../tasks/types";
import { priorityVisual } from "../../tasks/ui/task-visuals";

type HoverSection = "assignee" | "priority" | "labels" | "mark_as" | "rename" | null;

const PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 0, label: "PI" },
  { value: 1, label: "PII" },
  { value: 2, label: "PIII" },
  { value: 3, label: "PIV" },
  { value: 4, label: "Nulla" },
];
const RELATION_OPTIONS: Array<{ kind: TaskRelationKind; label: string }> = [
  { kind: "parent_of", label: "Parent of" },
  { kind: "child_of", label: "Child of" },
  { kind: "blocked_by", label: "Waiting on" },
  { kind: "blocking", label: "Holds" },
  { kind: "duplicate_of", label: "Mirror of" },
];

function PriorityLabel({ label }: { label: string }) {
  if (!label.startsWith("P") || label === "Nulla") return <>{label}</>;
  return (
    <>
      P<span className="priority-roman-numeral">{label.slice(1)}</span>
    </>
  );
}

function clampModalPosition(x: number, y: number): CSSProperties {
  if (typeof window === "undefined") return { left: x, top: y };
  const modalWidth = 300;
  const modalHeight = 240;
  const safeX = Math.max(8, Math.min(x, window.innerWidth - modalWidth - 8));
  const safeY = Math.max(8, Math.min(y, window.innerHeight - modalHeight - 8));
  return { left: safeX, top: safeY };
}
function submenuSide(modalLeft: number, submenuWidth: number): "left" | "right" {
  if (typeof window === "undefined") return "right";
  const modalWidth = 300;
  const rightSpace = window.innerWidth - (modalLeft + modalWidth);
  return rightSpace >= submenuWidth + 8 ? "right" : "left";
}

export function KanbanTaskContextModal({
  task,
  open,
  x,
  y,
  canEdit,
  assigneeOptions,
  projectLabels,
  relationTargets,
  onClose,
  onUpdateTask,
  onRenameTask,
  onDuplicateTask,
  onDeleteTask,
  onApplyRelation,
}: {
  task: Task | null;
  open: boolean;
  x: number;
  y: number;
  canEdit: boolean;
  assigneeOptions: Array<{ id: string; label: string; avatarUrl: string | null; initial: string }>;
  projectLabels: Array<{ name: string; color: string }>;
  relationTargets: Task[];
  onClose: () => void;
  onUpdateTask: (taskId: string, patch: Partial<Pick<Task, "priority" | "assigneeId" | "tags">>) => Promise<void>;
  onRenameTask: (taskId: string, title: string) => Promise<void>;
  onDuplicateTask: (task: Task) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onApplyRelation: (sourceTaskId: string, kind: TaskRelationKind, targetTaskId: string) => Promise<string | null>;
}) {
  const [hovered, setHovered] = useState<HoverSection>(null);
  const [savingSection, setSavingSection] = useState<HoverSection>(null);
  const [runningAction, setRunningAction] = useState<"duplicate" | "delete" | "rename" | null>(null);
  const [relationKind, setRelationKind] = useState<TaskRelationKind | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setHovered(null);
      setRelationKind(null);
      setRelationError(null);
      setRenameValue("");
      setRenameError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const modalStyle = useMemo(() => clampModalPosition(x, y), [x, y]);
  const modalLeft = Number(modalStyle.left ?? x);
  const assigneeSide = submenuSide(modalLeft, 220);
  const prioritySide = submenuSide(modalLeft, 200);
  const labelsSide = submenuSide(modalLeft, 240);
  const relationSide = submenuSide(modalLeft, 240);
  const renameSide = submenuSide(modalLeft, 260);
  const selectedLabels = useMemo(() => new Set(task?.tags ?? []), [task?.tags]);

  if (!open || !task) return null;

  const updateAssignee = async (assigneeId: string) => {
    if (!canEdit || savingSection) return;
    setSavingSection("assignee");
    try {
      await onUpdateTask(task.id, { assigneeId: assigneeId || null });
    } finally {
      setSavingSection(null);
    }
  };

  const updatePriority = async (priority: TaskPriority) => {
    if (!canEdit || savingSection) return;
    setSavingSection("priority");
    try {
      await onUpdateTask(task.id, { priority });
    } finally {
      setSavingSection(null);
    }
  };

  const toggleLabel = async (labelName: string) => {
    if (!canEdit || savingSection) return;
    setSavingSection("labels");
    try {
      const nextTags = selectedLabels.has(labelName)
        ? (task.tags ?? []).filter((tag) => tag !== labelName)
        : [...(task.tags ?? []), labelName];
      await onUpdateTask(task.id, { tags: nextTags });
    } finally {
      setSavingSection(null);
    }
  };
  const applyRelation = async (targetTaskId: string) => {
    if (!canEdit || !relationKind || runningAction || savingSection) return;
    setSavingSection("mark_as");
    setRelationError(null);
    try {
      const err = await onApplyRelation(task.id, relationKind, targetTaskId);
      if (err) {
        setRelationError(err);
        return;
      }
      onClose();
    } finally {
      setSavingSection(null);
    }
  };
  const renameTask = async () => {
    const title = renameValue.trim();
    if (!canEdit || !title || runningAction || savingSection) return;
    setRunningAction("rename");
    setRenameError(null);
    try {
      await onRenameTask(task.id, title);
      onClose();
    } catch {
      setRenameError("Failed to rename task.");
    } finally {
      setRunningAction(null);
    }
  };
  const duplicateTask = async () => {
    if (!canEdit || runningAction || savingSection) return;
    setRunningAction("duplicate");
    try {
      await onDuplicateTask(task);
      onClose();
    } finally {
      setRunningAction(null);
    }
  };
  const deleteTask = async () => {
    if (!canEdit || runningAction || savingSection) return;
    setRunningAction("delete");
    try {
      await onDeleteTask(task.id);
      onClose();
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/40" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        className="fixed w-[300px] rounded-xl border border-[#2a2a2a] bg-[#121212] p-3 shadow-[0_20px_40px_rgba(0,0,0,0.55)]"
        style={modalStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-0.5">
          <div className="relative" onMouseEnter={() => setHovered("assignee")} onMouseLeave={() => setHovered((prev) => (prev === "assignee" ? null : prev))}>
            <button type="button" className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] text-[#d3d3d3] hover:bg-[#1a1a1a]">
              <div className="text-[11px] text-[#d3d3d3]">Assignee</div>
            </button>
            {hovered === "assignee" && (
              <div className={`absolute ${assigneeSide === "right" ? "left-full" : "right-full"} top-0 z-10 w-[220px] rounded-lg border border-[#292929] bg-[#121212] p-1.5 shadow-[0_16px_32px_rgba(0,0,0,0.5)]`}>
                <button type="button" disabled={!canEdit || !!savingSection} onClick={() => void updateAssignee("")} className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[#c2c2c2] hover:bg-[#1a1a1a] disabled:opacity-50">
                  Unassigned
                </button>
                {assigneeOptions.map((option) => (
                  <button key={option.id} type="button" disabled={!canEdit || !!savingSection} onClick={() => void updateAssignee(option.id)} className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[#c2c2c2] hover:bg-[#1a1a1a] disabled:opacity-50">
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" onMouseEnter={() => setHovered("priority")} onMouseLeave={() => setHovered((prev) => (prev === "priority" ? null : prev))}>
            <button type="button" className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] text-[#d3d3d3] hover:bg-[#1a1a1a]">
              <div className="text-[11px] text-[#d3d3d3]">Priority</div>
            </button>
            {hovered === "priority" && (
              <div className={`absolute ${prioritySide === "right" ? "left-full" : "right-full"} top-0 z-10 w-[200px] rounded-lg border border-[#292929] bg-[#121212] p-1.5 shadow-[0_16px_32px_rgba(0,0,0,0.5)]`}>
                {PRIORITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={!canEdit || !!savingSection}
                    onClick={() => void updatePriority(option.value)}
                    className="w-full rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-[#1a1a1a] disabled:opacity-50"
                    style={{ color: priorityVisual(option.value).color }}
                  >
                    <PriorityLabel label={option.label} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" onMouseEnter={() => setHovered("labels")} onMouseLeave={() => setHovered((prev) => (prev === "labels" ? null : prev))}>
            <button type="button" className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] text-[#d3d3d3] hover:bg-[#1a1a1a]">
              <div className="text-[11px] text-[#d3d3d3]">Labels</div>
            </button>
            {hovered === "labels" && (
              <div className={`absolute ${labelsSide === "right" ? "left-full" : "right-full"} top-0 z-10 w-[240px] rounded-lg border border-[#292929] bg-[#121212] p-2 shadow-[0_16px_32px_rgba(0,0,0,0.5)]`}>
                {!projectLabels.length && <div className="text-[10px] text-[#666]">No project labels configured.</div>}
                <div className="flex flex-wrap gap-1.5">
                  {projectLabels.map((label) => {
                    const active = selectedLabels.has(label.name);
                    return (
                      <button
                        key={label.name}
                        type="button"
                        disabled={!canEdit || !!savingSection}
                        onClick={() => void toggleLabel(label.name)}
                        className={`px-2 py-1 rounded-md border text-[10px] transition-colors disabled:opacity-50 ${active ? "text-[#f1f1f1]" : "text-[#8f8f8f] hover:text-[#d8d8d8]"}`}
                        style={{ borderColor: `${label.color}${active ? "" : "55"}`, background: active ? `${label.color}22` : "#0f0f0f" }}
                      >
                        {label.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="relative" onMouseEnter={() => setHovered("mark_as")} onMouseLeave={() => { setHovered((prev) => (prev === "mark_as" ? null : prev)); setRelationKind(null); setRelationError(null); }}>
            <button type="button" className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] text-[#d3d3d3] hover:bg-[#1a1a1a]">
              <div className="text-[11px] text-[#d3d3d3]">Mark as</div>
            </button>
            {hovered === "mark_as" && (
              <div className={`absolute ${relationSide === "right" ? "left-full" : "right-full"} top-0 z-10 w-[240px] rounded-lg border border-[#292929] bg-[#121212] p-2 shadow-[0_16px_32px_rgba(0,0,0,0.5)]`}>
                {!relationKind && (
                  <div className="flex flex-col gap-1">
                    {RELATION_OPTIONS.map((option) => (
                      <button key={option.kind} type="button" className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[#d0d0d0] hover:bg-[#1a1a1a]" onClick={() => setRelationKind(option.kind)}>
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
                {relationKind && (
                  <div className="flex flex-col gap-1">
                    <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-[10px] text-[#8d8d8d] hover:bg-[#1a1a1a]" onClick={() => { setRelationKind(null); setRelationError(null); }}>
                      ← Back
                    </button>
                    {relationTargets.length === 0 && <div className="px-2 py-1 text-[10px] text-[#666]">No related tasks available.</div>}
                    <div className="max-h-44 overflow-y-auto">
                      {relationTargets.map((target) => (
                        <button key={target.id} type="button" disabled={!canEdit || !!savingSection || !!runningAction} onClick={() => void applyRelation(target.id)} className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[#cfcfcf] hover:bg-[#1a1a1a] disabled:opacity-50">
                          {target.title || "Untitled"}
                        </button>
                      ))}
                    </div>
                    {relationError && <div className="px-2 py-1 text-[10px] text-[#d58b8b]">{relationError}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="relative" onMouseEnter={() => { setHovered("rename"); setRenameValue(task.title || ""); setRenameError(null); }} onMouseLeave={() => setHovered((prev) => (prev === "rename" ? null : prev))}>
            <button type="button" className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] text-[#d3d3d3] hover:bg-[#1a1a1a]">
              Rename
            </button>
            {hovered === "rename" && (
              <div className={`absolute ${renameSide === "right" ? "left-full" : "right-full"} top-0 z-10 w-[260px] rounded-lg border border-[#292929] bg-[#121212] p-2 shadow-[0_16px_32px_rgba(0,0,0,0.5)]`}>
                <input
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  placeholder="Task title"
                  className="w-full rounded-md border border-[#2a2a2a] bg-[#0f0f0f] px-2 py-1.5 text-[11px] text-[#d5d5d5] outline-none"
                />
                <button
                  type="button"
                  disabled={!canEdit || !renameValue.trim() || !!savingSection || !!runningAction}
                  onClick={() => void renameTask()}
                  className="mt-1.5 w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[#cfcfcf] hover:bg-[#1a1a1a] disabled:opacity-50"
                >
                  {runningAction === "rename" ? "Renaming..." : "Save"}
                </button>
                {renameError && <div className="mt-1 text-[10px] text-[#d58b8b]">{renameError}</div>}
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={!canEdit || !!savingSection || !!runningAction}
            onClick={() => void duplicateTask()}
            className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] text-[#d3d3d3] hover:bg-[#1a1a1a] disabled:opacity-50"
          >
            {runningAction === "duplicate" ? "Mirroring..." : "Mirror"}
          </button>
          <button
            type="button"
            disabled={!canEdit || !!savingSection || !!runningAction}
            onClick={() => void deleteTask()}
            className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] text-[#e1a9a9] hover:bg-[#2a1616] disabled:opacity-50"
          >
            {runningAction === "delete" ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
