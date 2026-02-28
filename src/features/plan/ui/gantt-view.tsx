import type { Task } from "../../tasks/types";
import { TasksGantt } from "../../tasks/ui/tasks-gantt";

type AssigneeInfo = { label: string; avatarUrl: string | null; initial: string };

export function GanttView({
  tasks,
  selectedTaskId,
  projectNameById,
  assigneeById,
  showProjectName,
  onSelectTask,
}: {
  tasks: Task[];
  selectedTaskId: string | null;
  projectNameById: Map<string, string>;
  assigneeById: Map<string, AssigneeInfo>;
  showProjectName: boolean;
  onSelectTask: (id: string) => void;
}) {
  return (
    <div className="flex-1 h-full min-h-0">
      <TasksGantt
        tasks={tasks}
        selectedTaskId={selectedTaskId}
        projectNameById={projectNameById}
        assigneeById={assigneeById}
        showProjectName={showProjectName}
        onSelectTask={onSelectTask}
      />
    </div>
  );
}
