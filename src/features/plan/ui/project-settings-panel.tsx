import { useEffect, useMemo, useState } from "react";
import type { Task, TaskWorkflowState } from "../../tasks/types";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";

const STAGE_ICON_OPTIONS = ["◯", "◉", "◔", "◑", "◕", "◆", "◇", "▲", "■", "✦", "✳", "⨯"] as const;

function defaultStageVisual(kind: string): { icon: string; color: string } {
  if (kind === "todo") return { icon: "◯", color: "#C9CED6" };
  if (kind === "in_progress") return { icon: "◔", color: "#F5A524" };
  if (kind === "done") return { icon: "◉", color: "#2DD4BF" };
  if (kind === "in_review") return { icon: "◑", color: "#60A5FA" };
  if (kind === "backlog") return { icon: "◇", color: "#9CA3AF" };
  if (kind === "canceled") return { icon: "⨯", color: "#EF4444" };
  return { icon: "◯", color: "#8E8E8E" };
}

const STAGE_KIND_RANK: Record<string, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  in_review: 3,
  done: 4,
  canceled: 5,
  custom: 6,
};

function stagePositionOrder(position: string): number {
  const m = position.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

function compareStages(a: TaskWorkflowState, b: TaskWorkflowState): number {
  const po = stagePositionOrder(a.position) - stagePositionOrder(b.position);
  if (po !== 0) return po;
  const ko = (STAGE_KIND_RANK[a.kind] ?? 99) - (STAGE_KIND_RANK[b.kind] ?? 99);
  if (ko !== 0) return ko;
  return a.name.localeCompare(b.name);
}

function ProjectAvatar({ name, logoUrl, size = 14 }: { name: string; logoUrl?: string | null; size?: number }) {
  if (!logoUrl) return null;
  return (
    <span
      className="rounded-[8px] border border-[#252525] bg-[#1a1a1a] p-[4px] overflow-hidden grid place-items-center shrink-0"
      style={{ width: size, height: size }}
    >
      <img src={logoUrl} alt={name} className="h-full w-full rounded-[6px] object-cover" />
    </span>
  );
}

type StageDraft = {
  id: string;
  name: string;
  icon: string;
  color: string;
  isNew: boolean;
  deleted: boolean;
};

function StageIconPickerModal({ selected, onSelect, onClose }: {
  selected: string;
  onSelect: (icon: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[120] bg-black/50 grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-[360px] rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[12px] font-semibold text-[#e8e8e8]">Select icon</h3>
          <button onClick={onClose} className="h-6 w-6 grid place-items-center rounded text-[#555] hover:text-[#bbb] hover:bg-[#171717] transition-colors">✕</button>
        </div>
        <div className="grid grid-cols-6 gap-2">
          {STAGE_ICON_OPTIONS.map(icon => (
            <button
              key={icon}
              onClick={() => { onSelect(icon); onClose(); }}
              className={`h-9 rounded-lg border text-[14px] transition-colors ${selected === icon ? "border-[#454545] bg-[#1b1b1b] text-[#f0f0f0]" : "border-[#242424] bg-[#121212] text-[#b9b9b9] hover:bg-[#191919]"}`}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function normalizeHexColor(input: string): string {
  const value = input.trim();
  if (!value) return "";
  const withHash = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toUpperCase() : "";
}

function SortableStageRow({
  stage,
  canRemove,
  canEdit,
  onChange,
  onPickIcon,
  onRemove,
  isPendingDelete,
  pendingTasksCount,
  onCancelRemove,
  onConfirmRemove,
}: {
  stage: StageDraft;
  canRemove: boolean;
  canEdit: boolean;
  onChange: (patch: Partial<StageDraft>) => void;
  onPickIcon: () => void;
  onRemove: () => void;
  isPendingDelete: boolean;
  pendingTasksCount: number;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id, disabled: !canEdit });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.7 : 1 };
  const iconColor = normalizeHexColor(stage.color) || "#ddd";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-[#1f1f1f] bg-[#111] px-2 py-2"
    >
      <div className="grid grid-cols-[18px_1fr_96px_132px_auto] gap-2 items-center">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={!canEdit}
          className="text-[#444] disabled:opacity-40 cursor-grab active:cursor-grabbing"
          title="Drag to reorder"
        >
          ⋮⋮
        </button>
        <input
          value={stage.name}
          disabled={!canEdit}
          onChange={e => onChange({ name: e.target.value })}
          className="bg-[#121212] border border-[#1e1e1e] rounded px-2 py-1 text-[11px] text-[#ddd] outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={onPickIcon}
          disabled={!canEdit}
          style={{ color: iconColor }}
          className="h-[30px] px-2 bg-[#121212] border border-[#1e1e1e] rounded text-[12px] disabled:opacity-60"
        >
          {stage.icon || "◯"}
        </button>
        <input
          value={stage.color}
          disabled={!canEdit}
          onChange={e => onChange({ color: e.target.value })}
          className="bg-[#121212] border border-[#1e1e1e] rounded px-2 py-1 text-[11px] text-[#ddd] outline-none disabled:opacity-60"
        />
        <button
          disabled={!canRemove || !canEdit}
          onClick={onRemove}
          className="h-7 px-2 rounded border border-[#2a2a2a] text-[10px] text-[#888] hover:text-red-400 hover:border-[#3a2222] disabled:opacity-40 disabled:pointer-events-none"
        >
          Remove
        </button>
      </div>
      <div className={`overflow-hidden transition-all duration-200 ease-out ${isPendingDelete ? "max-h-24 opacity-100 mt-2" : "max-h-0 opacity-0 mt-0"}`}>
        <div className="rounded-lg border border-[#3a2222] bg-[#1a1111] p-2.5">
          <div className="text-[11px] text-[#d6baba] mb-2">
            This stage has {pendingTasksCount} task(s). Removing it will also remove those tasks.
          </div>
          <div className="flex gap-2">
            <button onClick={onCancelRemove} className="px-3 py-1.5 rounded-lg border border-[#2a2a2a] text-[11px] text-[#aaa] hover:bg-[#161616]">Cancel</button>
            <button onClick={onConfirmRemove} className="px-3 py-1.5 rounded-lg border border-[#512a2a] bg-[#2a1414] text-[11px] text-red-300 hover:bg-[#341818]">Remove with tasks</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectSettingsNav({ projectName, logoUrl, section, onSelect, onBack }: {
  projectName: string;
  logoUrl: string | null;
  section: "general" | "stages" | "labels";
  onSelect: (next: "general" | "stages" | "labels") => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col h-full gap-3">
      <button onClick={onBack} className="self-start px-2 py-1 rounded-md text-[10px] text-[#777] hover:text-[#ccc] hover:bg-[#161616] transition-colors">Back</button>
      <div className="flex items-center gap-2 px-1">
        <ProjectAvatar name={projectName} logoUrl={logoUrl} size={18} />
        <div className="text-[11px] font-semibold text-[#ddd] truncate">{projectName}</div>
      </div>
      <button onClick={() => onSelect("general")} className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] border transition-colors ${section === "general" ? "bg-[#1a1a1a] border-[#2a2a2a] text-[#eee]" : "bg-transparent border-transparent text-[#666] hover:text-[#bbb] hover:bg-[#141414]"}`}>General</button>
      <button onClick={() => onSelect("stages")} className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] border transition-colors ${section === "stages" ? "bg-[#1a1a1a] border-[#2a2a2a] text-[#eee]" : "bg-transparent border-transparent text-[#666] hover:text-[#bbb] hover:bg-[#141414]"}`}>Stages</button>
      <button onClick={() => onSelect("labels")} className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] border transition-colors ${section === "labels" ? "bg-[#1a1a1a] border-[#2a2a2a] text-[#eee]" : "bg-transparent border-transparent text-[#666] hover:text-[#bbb] hover:bg-[#141414]"}`}>Labels</button>
    </div>
  );
}

export function ProjectSettingsGeneral({ projectName, logoUrl, onRename, onSetLogo }: {
  projectName: string;
  logoUrl: string | null;
  onRename: (name: string) => Promise<void>;
  onSetLogo: (logo: string | null) => void;
}) {
  const [nameDraft, setNameDraft] = useState(projectName);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setNameDraft(projectName); }, [projectName]);

  const saveName = async () => {
    const next = nameDraft.trim();
    if (!next || next === projectName) return;
    setSaving(true);
    try { await onRename(next); } finally { setSaving(false); }
  };

  const onPickLogo = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onSetLogo(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col h-full min-h-0 p-6 gap-6 overflow-y-auto">
      <div>
        <h2 className="text-[15px] font-bold text-[#f0f0f0]">Project Settings</h2>
        <p className="text-[11px] text-[#666] mt-1">General</p>
      </div>

      <div className="flex items-center gap-3">
        <ProjectAvatar name={projectName} logoUrl={logoUrl} size={44} />
        <div className="flex items-center gap-2">
          <label className="px-3 py-1.5 rounded-lg border border-[#2a2a2a] text-[11px] text-[#bbb] hover:text-[#fff] hover:bg-[#181818] cursor-pointer transition-colors">
            Upload logo
            <input type="file" accept="image/*" className="hidden" onChange={e => onPickLogo(e.target.files?.[0] ?? null)} />
          </label>
          {logoUrl && <button onClick={() => onSetLogo(null)} className="px-3 py-1.5 rounded-lg border border-[#2a2a2a] text-[11px] text-[#777] hover:text-[#ddd] hover:bg-[#181818] transition-colors">Remove</button>}
        </div>
      </div>

      <div className="max-w-[460px] flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#333]">Project name</span>
        <input
          value={nameDraft}
          onChange={e => setNameDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") void saveName(); }}
          className="bg-[#111] border border-[#1d1d1d] rounded-lg px-3 py-2 text-[12px] text-[#ddd] outline-none"
        />
        <div>
          <button onClick={() => void saveName()} disabled={saving || !nameDraft.trim() || nameDraft.trim() === projectName} className="px-4 py-2 rounded-lg bg-[#2a2a2a] text-[#f1f1f1] text-[11px] font-semibold hover:bg-[#353535] disabled:opacity-40 disabled:pointer-events-none transition-colors">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectSettingsStages({
  projectId,
  states,
  tasks,
  canEdit,
  onCreateStage,
  onUpdateStage,
  onDeleteStage,
  onDeleteTask,
}: {
  projectId: string;
  states: TaskWorkflowState[];
  tasks: Task[];
  canEdit: boolean;
  onCreateStage: (args: { name: string; icon: string | null; color: string | null }) => Promise<string | null>;
  onUpdateStage: (stageId: string, patch: Partial<TaskWorkflowState>) => Promise<void>;
  onDeleteStage: (stageId: string) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
}) {
  const stageSource = useMemo(
    () => states.filter(s => !s.deletedAt && s.projectId === projectId).sort(compareStages),
    [states, projectId]
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const tasksByStage = useMemo(() => {
    const m = new Map<string, number>();
    tasks.filter(t => !t.deletedAt && t.projectId === projectId).forEach(t => m.set(t.stateId, (m.get(t.stateId) ?? 0) + 1));
    return m;
  }, [tasks, projectId]);
  const [drafts, setDrafts] = useState<StageDraft[]>([]);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("◯");
  const [newColor, setNewColor] = useState("#8E8E8E");
  const [iconPickerFor, setIconPickerFor] = useState<{ mode: "new" | "edit"; stageId?: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ stageId: string; tasksCount: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDrafts(
      stageSource.map(s => ({
        id: s.id,
        name: s.name,
        icon: s.icon ?? defaultStageVisual(s.kind).icon,
        color: s.color ?? defaultStageVisual(s.kind).color,
        isNew: false,
        deleted: false,
      }))
    );
  }, [stageSource]);

  const activeDrafts = drafts.filter(d => !d.deleted);
  const removeStage = (stageId: string, withTasks: boolean) => {
    const activeCount = activeDrafts.length;
    if (activeCount <= 1) return;
    if (!withTasks) {
      setDrafts(prev => prev.map(d => d.id === stageId ? { ...d, deleted: true } : d));
      return;
    }
    setDrafts(prev => prev.map(d => d.id === stageId ? { ...d, deleted: true } : d));
  };

  const onAddStage = () => {
    const name = newName.trim();
    if (!name) return;
    const color = normalizeHexColor(newColor);
    setDrafts(prev => [
      ...prev,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        icon: newIcon.trim(),
        color,
        isNew: true,
        deleted: false,
      },
    ]);
    setNewName("");
    setNewIcon("◯");
    setNewColor("#8E8E8E");
  };

  const saveAll = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      const toDelete = drafts.filter(d => d.deleted && !d.isNew);
      for (const stage of toDelete) {
        const relatedTasks = tasks.filter(t => !t.deletedAt && t.projectId === projectId && t.stateId === stage.id);
        for (const task of relatedTasks) await onDeleteTask(task.id);
        await onDeleteStage(stage.id);
      }

      const idMap = new Map<string, string>();
      for (const stage of drafts.filter(d => d.isNew && !d.deleted)) {
        const created = await onCreateStage({
          name: stage.name,
          icon: stage.icon.trim() || null,
          color: normalizeHexColor(stage.color) || null,
        });
        if (created) idMap.set(stage.id, created);
      }

      const ordered = drafts.filter(d => !d.deleted).map((stage, idx) => ({
        ...stage,
        realId: stage.isNew ? (idMap.get(stage.id) ?? null) : stage.id,
        position: `stage-${String(idx + 1).padStart(3, "0")}`,
      })).filter(stage => !!stage.realId);

      for (const stage of ordered) {
        await onUpdateStage(stage.realId!, {
          name: stage.name.trim() || "Stage",
          icon: stage.icon.trim() || null,
          color: normalizeHexColor(stage.color) || null,
          position: stage.position,
        });
      }
    } finally {
      setSaving(false);
      setPendingDelete(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 p-6 gap-4 overflow-y-auto">
      <div>
        <h2 className="text-[15px] font-bold text-[#f0f0f0]">Project Settings</h2>
        <p className="text-[11px] text-[#666] mt-1">Stages</p>
      </div>

      <div className="rounded-lg border border-[#1f1f1f] bg-[#111] px-2 py-2">
        <div className="grid grid-cols-[18px_1fr_96px_132px_auto] gap-2 items-center">
          <span className="text-[#222] select-none">⋮⋮</span>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Stage name"
            className="bg-[#121212] border border-[#1e1e1e] rounded px-2 py-1 text-[11px] text-[#ddd] outline-none placeholder:text-[#4a4a4a]"
          />
          <button
            type="button"
            onClick={() => setIconPickerFor({ mode: "new" })}
            style={{ color: normalizeHexColor(newColor) || "#ddd" }}
            className="h-[30px] px-2 bg-[#121212] border border-[#1e1e1e] rounded text-[12px]"
          >
            {newIcon}
          </button>
          <input
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            className="bg-[#121212] border border-[#1e1e1e] rounded px-2 py-1 text-[11px] text-[#ddd] outline-none"
          />
          <button onClick={onAddStage} className="h-7 px-2 rounded border border-[#2a2a2a] text-[10px] text-[#ddd] hover:bg-[#1a1a1a]">
            Add stage
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <DndContext
          sensors={sensors}
          onDragEnd={event => {
            const activeId = String(event.active.id);
            const overId = event.over ? String(event.over.id) : null;
            if (!overId || activeId === overId) return;
            setDrafts(prev => {
              const active = prev.filter(d => !d.deleted);
              const oldIndex = active.findIndex(d => d.id === activeId);
              const newIndex = active.findIndex(d => d.id === overId);
              if (oldIndex < 0 || newIndex < 0) return prev;
              const moved = arrayMove(active, oldIndex, newIndex);
              return [...moved, ...prev.filter(d => d.deleted)];
            });
          }}
        >
          <SortableContext items={activeDrafts.map(s => s.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {activeDrafts.map(stage => {
                const count = tasksByStage.get(stage.id) ?? 0;
                const canRemove = activeDrafts.length > 1;
                return (
                  <SortableStageRow
                    key={stage.id}
                    stage={stage}
                    canRemove={canRemove}
                    canEdit={canEdit}
                    onChange={patch => setDrafts(prev => prev.map(d => d.id === stage.id ? { ...d, ...patch } : d))}
                    onPickIcon={() => setIconPickerFor({ mode: "edit", stageId: stage.id })}
                    onRemove={() => {
                      if (!canRemove) return;
                      if (count > 0) setPendingDelete({ stageId: stage.id, tasksCount: count });
                      else removeStage(stage.id, false);
                    }}
                    isPendingDelete={pendingDelete?.stageId === stage.id}
                    pendingTasksCount={pendingDelete?.stageId === stage.id ? pendingDelete.tasksCount : 0}
                    onCancelRemove={() => setPendingDelete(null)}
                    onConfirmRemove={() => {
                      removeStage(stage.id, true);
                      setPendingDelete(null);
                    }}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div>
        <button onClick={() => void saveAll()} disabled={saving || !canEdit} className="px-4 py-2 rounded-lg bg-[#2a2a2a] text-[#f1f1f1] text-[11px] font-semibold hover:bg-[#353535] disabled:opacity-40 disabled:pointer-events-none">
          {saving ? "Saving..." : "Save stages"}
        </button>
      </div>
      {iconPickerFor && (
        <StageIconPickerModal
          selected={iconPickerFor.mode === "new" ? newIcon : (drafts.find(d => d.id === iconPickerFor.stageId)?.icon || "◯")}
          onSelect={icon => {
            if (iconPickerFor.mode === "new") {
              setNewIcon(icon);
              return;
            }
            if (!iconPickerFor.stageId) return;
            setDrafts(prev => prev.map(d => d.id === iconPickerFor.stageId ? { ...d, icon } : d));
          }}
          onClose={() => setIconPickerFor(null)}
        />
      )}
    </div>
  );
}

export function ProjectSettingsLabels({
  labels,
  canEdit,
  onSaveLabels,
}: {
  labels: Array<{ name: string; color: string }>;
  canEdit: boolean;
  onSaveLabels: (labels: Array<{ name: string; color: string }>) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Array<{ name: string; color: string }>>(labels);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#8E8E8E");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDrafts(labels); }, [labels]);

  const addLabel = () => {
    const name = newName.trim();
    const color = normalizeHexColor(newColor);
    if (!name || !color) return;
    if (drafts.some(label => label.name.toLowerCase() === name.toLowerCase())) return;
    setDrafts(prev => [...prev, { name, color }]);
    setNewName("");
    setNewColor("#8E8E8E");
  };

  const save = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      await onSaveLabels(drafts.map(label => ({ name: label.name.trim(), color: normalizeHexColor(label.color) || "#8E8E8E" })));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 p-6 gap-4 overflow-y-auto">
      <div>
        <h2 className="text-[15px] font-bold text-[#f0f0f0]">Project Settings</h2>
        <p className="text-[11px] text-[#666] mt-1">Labels</p>
      </div>

      <div className="rounded-lg border border-[#1f1f1f] bg-[#111] px-2 py-2">
        <div className="grid grid-cols-[1fr_132px_auto] gap-2 items-center">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Label name"
            className="bg-[#121212] border border-[#1e1e1e] rounded px-2 py-1 text-[11px] text-[#ddd] outline-none placeholder:text-[#4a4a4a]"
          />
          <input
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            className="bg-[#121212] border border-[#1e1e1e] rounded px-2 py-1 text-[11px] text-[#ddd] outline-none"
          />
          <button onClick={addLabel} className="h-7 px-2 rounded border border-[#2a2a2a] text-[10px] text-[#ddd] hover:bg-[#1a1a1a]">Add label</button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {drafts.map((label, idx) => (
          <div key={`${label.name}-${idx}`} className="rounded-lg border border-[#1f1f1f] bg-[#111] px-2 py-2">
            <div className="grid grid-cols-[18px_1fr_132px_auto] gap-2 items-center">
              <span className="h-2 w-2 rounded-full" style={{ background: normalizeHexColor(label.color) || "#8E8E8E" }} />
              <input
                value={label.name}
                disabled={!canEdit}
                onChange={e => setDrafts(prev => prev.map((entry, i) => i === idx ? { ...entry, name: e.target.value } : entry))}
                className="bg-[#121212] border border-[#1e1e1e] rounded px-2 py-1 text-[11px] text-[#ddd] outline-none disabled:opacity-60"
              />
              <input
                value={label.color}
                disabled={!canEdit}
                onChange={e => setDrafts(prev => prev.map((entry, i) => i === idx ? { ...entry, color: e.target.value } : entry))}
                className="bg-[#121212] border border-[#1e1e1e] rounded px-2 py-1 text-[11px] text-[#ddd] outline-none disabled:opacity-60"
              />
              <button
                disabled={!canEdit}
                onClick={() => setDrafts(prev => prev.filter((_, i) => i !== idx))}
                className="h-7 px-2 rounded border border-[#2a2a2a] text-[10px] text-[#888] hover:text-red-400 hover:border-[#3a2222] disabled:opacity-40 disabled:pointer-events-none"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {drafts.length === 0 && <div className="text-[10px] text-[#555]">No labels yet.</div>}
      </div>

      <div>
        <button onClick={() => void save()} disabled={saving || !canEdit} className="px-4 py-2 rounded-lg bg-[#2a2a2a] text-[#f1f1f1] text-[11px] font-semibold hover:bg-[#353535] disabled:opacity-40 disabled:pointer-events-none">
          {saving ? "Saving..." : "Save labels"}
        </button>
      </div>
    </div>
  );
}
