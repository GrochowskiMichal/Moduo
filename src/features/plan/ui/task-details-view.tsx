import { useEffect, useMemo, useState } from "react";
import type { Task, TaskActivity, TaskComment, TaskPriority, TaskWorkflowState } from "../../tasks/types";

function LabelsSelector({
  labels,
  selected,
  onToggle,
}: {
  labels: Array<{ name: string; color: string }>;
  selected: string[];
  onToggle: (name: string) => void;
}) {
  if (!labels.length) {
    return <div className="text-[10px] text-[#555]">No project labels configured.</div>;
  }
  const selectedSet = new Set(selected);
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => {
        const active = selectedSet.has(label.name);
        return (
          <button
            key={label.name}
            type="button"
            onClick={() => onToggle(label.name)}
            className={`px-2 py-1 rounded-md border text-[10px] transition-colors ${active ? "text-[#f1f1f1]" : "text-[#8f8f8f] hover:text-[#d8d8d8]"}`}
            style={{ borderColor: `${label.color}${active ? "" : "55"}`, background: active ? `${label.color}22` : "#0f0f0f" }}
          >
            {label.name}
          </button>
        );
      })}
    </div>
  );
}

export function TaskDetailsView({
  task,
  projectName,
  states,
  projectLabels,
  comments,
  activities,
  assigneeOptions,
  assigneeById,
  currentUserId,
  canEdit,
  onBack,
  onSave,
  onDelete,
  onAddComment,
}: {
  task: Task;
  projectName: string;
  states: TaskWorkflowState[];
  projectLabels: Array<{ name: string; color: string }>;
  comments: TaskComment[];
  activities: TaskActivity[];
  assigneeOptions: Array<{ id: string; label: string; avatarUrl: string | null; initial: string }>;
  assigneeById: Map<string, { label: string; avatarUrl: string | null; initial: string }>;
  currentUserId: string | null;
  canEdit: boolean;
  onBack: () => void;
  onSave: (patch: Partial<Pick<Task, "title" | "description" | "tags" | "priority" | "dueDate" | "stateId" | "assigneeId">>) => Promise<void>;
  onDelete: () => Promise<void>;
  onAddComment: (body: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [tags, setTags] = useState<string[]>(task.tags ?? []);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [stateId, setStateId] = useState(task.stateId);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [addingComment, setAddingComment] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setTags(task.tags ?? []);
    setPriority(task.priority);
    setDueDate(task.dueDate ?? "");
    setStateId(task.stateId);
    setAssigneeId(task.assigneeId ?? "");
  }, [task]);

  const submit = async () => {
    if (!canEdit || saving || deleting) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim() || "Untitled",
        description: description.trim(),
        tags,
        priority,
        dueDate: dueDate || null,
        stateId,
        assigneeId: assigneeId || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!canEdit || deleting || saving) return;
    setDeleting(true);
    try {
      await onDelete();
      onBack();
    } finally {
      setDeleting(false);
    }
  };

  const addComment = async () => {
    const body = commentBody.trim();
    if (!body || addingComment || !canEdit) return;
    setAddingComment(true);
    try {
      await onAddComment(body);
      setCommentBody("");
    } finally {
      setAddingComment(false);
    }
  };

  const stateNameById = useMemo(
    () => new Map(states.filter((s) => s.projectId === task.projectId).map((s) => [s.id, s.name])),
    [states, task.projectId]
  );
  const taskComments = useMemo(
    () => comments.filter((c) => !c.deletedAt && c.taskId === task.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [comments, task.id]
  );
  const taskActivities = useMemo(() => activities.filter((a) => a.taskId === task.id), [activities, task.id]);

  const renderActivity = (activity: TaskActivity): string => {
    const payload = (activity.payload ?? {}) as any;
    if (activity.action === "created") return "created this task";
    if (activity.action === "renamed") return `renamed task to "${String(payload?.to ?? "")}"`;
    if (activity.action === "stage_changed") {
      const fromName = payload?.from ? stateNameById.get(String(payload.from)) ?? String(payload.from) : "Unknown";
      const toName = payload?.to ? stateNameById.get(String(payload.to)) ?? String(payload.to) : "Unknown";
      return `changed stage from ${fromName} to ${toName}`;
    }
    if (activity.action === "priority_changed") return `changed priority from ${String(payload?.from ?? "")} to ${String(payload?.to ?? "")}`;
    if (activity.action === "assignee_changed") {
      const fromId = payload?.from ? String(payload.from) : "";
      const toId = payload?.to ? String(payload.to) : "";
      const fromLabel = fromId ? assigneeById.get(fromId)?.label ?? fromId : "Unassigned";
      const toLabel = toId ? assigneeById.get(toId)?.label ?? toId : "Unassigned";
      return `changed assignee from ${fromLabel} to ${toLabel}`;
    }
    if (activity.action === "tags_changed") {
      const added = Array.isArray(payload?.added) ? payload.added.length : 0;
      const removed = Array.isArray(payload?.removed) ? payload.removed.length : 0;
      return `updated labels (${added} added, ${removed} removed)`;
    }
    if (activity.action === "comment_added") return "added a comment";
    if (activity.action === "deleted") return "deleted this task";
    return activity.action;
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto p-5">
      <div className="max-w-[760px] mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="px-3 py-1.5 rounded-lg border border-[#252525] text-[11px] text-[#a8a8a8] hover:text-[#ddd] hover:bg-[#151515] transition-colors">
            Back to Kanban
          </button>
          <div className="text-[10px] text-[#666]">{projectName}</div>
        </div>

        <div className="rounded-xl border border-[#1f1f1f] bg-[#111] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} className="w-full bg-transparent text-[15px] font-bold text-[#e6e6e6] outline-none border-b border-[#1a1a1a] pb-2 disabled:opacity-70" />
            {task.taskCode && <span className="px-2 py-1 rounded-md border border-[#252525] bg-[#151515] text-[10px] text-[#9b9b9b]">{task.taskCode}</span>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-widest text-[#444] font-bold">Stage</span>
              <select value={stateId} disabled={!canEdit} onChange={(e) => setStateId(e.target.value)} className="bg-[#0f0f0f] border border-[#1b1b1b] rounded-lg px-2 py-1.5 text-[11px] text-[#c7c7c7] outline-none [color-scheme:dark] disabled:opacity-70">
                {states.filter((s) => !s.deletedAt && s.projectId === task.projectId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-widest text-[#444] font-bold">Priority</span>
              <select value={priority} disabled={!canEdit} onChange={(e) => setPriority(Number(e.target.value) as TaskPriority)} className="bg-[#0f0f0f] border border-[#1b1b1b] rounded-lg px-2 py-1.5 text-[11px] text-[#c7c7c7] outline-none [color-scheme:dark] disabled:opacity-70">
                {[["Urgent", 0], ["High", 1], ["Medium", 2], ["Low", 3], ["None", 4]].map(([l, v]) => <option key={v} value={Number(v)}>{l}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-widest text-[#444] font-bold">Due date</span>
              <input type="date" value={dueDate} disabled={!canEdit} onChange={(e) => setDueDate(e.target.value)} className="bg-[#0f0f0f] border border-[#1b1b1b] rounded-lg px-2 py-1.5 text-[11px] text-[#c7c7c7] outline-none [color-scheme:dark] disabled:opacity-70" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-widest text-[#444] font-bold">Assignee</span>
              <select value={assigneeId} disabled={!canEdit} onChange={(e) => setAssigneeId(e.target.value)} className="bg-[#0f0f0f] border border-[#1b1b1b] rounded-lg px-2 py-1.5 text-[11px] text-[#c7c7c7] outline-none [color-scheme:dark] disabled:opacity-70">
                <option value="">Unassigned</option>
                {assigneeOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-[#444] font-bold">Description</span>
            <textarea rows={5} value={description} disabled={!canEdit} onChange={(e) => setDescription(e.target.value)} className="bg-[#0f0f0f] border border-[#1b1b1b] rounded-lg px-2 py-2 text-[11px] text-[#c7c7c7] outline-none resize-y disabled:opacity-70" />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-[#444] font-bold">Labels</span>
            <LabelsSelector labels={projectLabels} selected={tags} onToggle={(name) => { if (!canEdit) return; setTags((prev) => prev.includes(name) ? prev.filter((tag) => tag !== name) : [...prev, name]); }} />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => void submit()} disabled={!canEdit || saving || deleting} className="px-4 py-2 rounded-lg bg-[#2a2a2a] text-[#f1f1f1] text-[11px] font-semibold hover:bg-[#353535] disabled:opacity-40 disabled:pointer-events-none">
              {saving ? "Saving..." : "Save changes"}
            </button>
            <button onClick={() => void remove()} disabled={!canEdit || deleting || saving} className="px-4 py-2 rounded-lg border border-[#3a2323] bg-[#211313] text-[11px] text-[#d9a8a8] hover:bg-[#2a1616] disabled:opacity-40 disabled:pointer-events-none">
              {deleting ? "Deleting..." : "Delete task"}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-[#1f1f1f] bg-[#111] p-4 flex flex-col gap-3">
          <div className="text-[11px] font-semibold text-[#ddd]">Comments</div>
          <div className="flex gap-2">
            <textarea rows={2} value={commentBody} onChange={(e) => setCommentBody(e.target.value)} placeholder="Write a comment..." className="flex-1 bg-[#0f0f0f] border border-[#1b1b1b] rounded-lg px-2 py-1.5 text-[11px] text-[#c7c7c7] outline-none resize-y" />
            <button onClick={() => void addComment()} disabled={!canEdit || addingComment || !commentBody.trim()} className="h-fit px-3 py-2 rounded-lg bg-[#2a2a2a] text-[#f1f1f1] text-[11px] font-semibold hover:bg-[#353535] disabled:opacity-40 disabled:pointer-events-none">
              {addingComment ? "Adding..." : "Add"}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {taskComments.length === 0 && <div className="text-[10px] text-[#666]">No comments yet.</div>}
            {taskComments.map((comment) => {
              const who = comment.ownerId === currentUserId ? "You" : (assigneeById.get(comment.ownerId)?.label ?? comment.ownerId);
              return (
                <div key={comment.id} className="rounded-lg border border-[#1b1b1b] bg-[#0f0f0f] px-2 py-2">
                  <div className="text-[10px] text-[#777] mb-1">{who} · {new Date(comment.createdAt).toLocaleString()}</div>
                  <div className="text-[11px] text-[#d1d1d1] whitespace-pre-wrap">{comment.body}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-[#1f1f1f] bg-[#111] p-4 flex flex-col gap-3">
          <div className="text-[11px] font-semibold text-[#ddd]">Activity</div>
          <div className="flex flex-col gap-2">
            {taskActivities.length === 0 && <div className="text-[10px] text-[#666]">No activity yet.</div>}
            {taskActivities.map((activity) => {
              const actor = assigneeById.get(activity.actorUserId) ?? {
                label: activity.actorUserId === currentUserId ? "You" : activity.actorUserId,
                avatarUrl: null,
                initial: (activity.actorUserId || "U").charAt(0).toUpperCase(),
              };
              const label = activity.actorUserId === currentUserId ? "You" : actor.label;
              return (
                <div key={activity.id} className="rounded-lg border border-[#1b1b1b] bg-[#0f0f0f] px-2 py-2 flex gap-2">
                  <span className="h-5 w-5 rounded-full border border-[#2c2c2c] bg-[#1a1a1a] overflow-hidden grid place-items-center shrink-0">
                    {actor.avatarUrl ? <img src={actor.avatarUrl} alt={actor.label} className="h-full w-full object-cover" /> : <span className="text-[8px] font-bold text-[#bdbdbd]">{actor.initial}</span>}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[11px] text-[#d1d1d1]">{label} {renderActivity(activity)}</div>
                    <div className="text-[10px] text-[#666]">{new Date(activity.createdAt).toLocaleString()}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
