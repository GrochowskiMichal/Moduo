import { useMemo } from "react";
import type { Task, TaskProject, TaskWorkflowState } from "../../../tasks/types";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

type Props = {
  tasks: Task[];
  projects: TaskProject[];
  states: TaskWorkflowState[];
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

export function TasksWidget({ tasks, projects, states, config, isLocked, onUpdateConfig }: Props) {
  const activeProjects = useMemo(() => projects.filter((project) => !project.deletedAt), [projects]);
  const stateMap = useMemo(() => new Map(states.map((state) => [state.id, state])), [states]);

  const filtered = useMemo(() => {
    let current = tasks.filter((task) => !task.deletedAt);
    if (config.projectIds?.length) {
      current = current.filter((task) => config.projectIds?.includes(task.projectId));
    }
    return [...current].sort((a, b) => a.priority - b.priority || a.position.localeCompare(b.position));
  }, [config.projectIds, tasks]);

  return (
    <WidgetShell
      config={config}
      title={`Tasks (${filtered.length})`}
      controls={
        !isLocked ? (
          <select
            value={config.projectIds?.[0] ?? ""}
            onChange={(event) => onUpdateConfig({ projectIds: event.target.value ? [event.target.value] : undefined })}
            className="max-w-[65%] rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#cfcfcf] outline-none"
          >
            <option value="">All projects</option>
            {activeProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        ) : null
      }
    >
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 ? (
          <p className="px-1 text-[12px] text-[#808080]">No tasks found.</p>
        ) : (
          filtered.slice(0, 30).map((task) => {
            const state = stateMap.get(task.stateId);
            return (
              <div key={task.id} className="mb-1 rounded-lg border border-transparent px-2 py-1 hover:border-[#232323] hover:bg-[#171717]">
                <p className="truncate text-[12px] text-[#e8e8e8]">{task.title}</p>
                <p className="mt-0.5 text-[10px] text-[#878787]">
                  {state?.name ?? "Unknown"} {task.dueDate ? `• ${task.dueDate}` : ""}
                </p>
              </div>
            );
          })
        )}
      </div>
    </WidgetShell>
  );
}
