import { useEffect, useMemo, useState } from "react";
import type { Task, TaskComment, TaskPriority, TaskWorkflowState } from "../types";

type Props = {
  task: Task | null;
  states: TaskWorkflowState[];
  tasks: Task[];
  comments: TaskComment[];
  onUpdateTask: (
    taskId: string,
    patch: Partial<Pick<Task, "title" | "description" | "priority" | "dueDate" | "stateId" | "parentTaskId">>
  ) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onAddComment: (taskId: string, body: string) => Promise<string | null>;
  onDeleteComment: (commentId: string) => Promise<void>;
};

export function TaskDrawer({
  task,
  states,
  tasks,
  comments,
  onUpdateTask,
  onDeleteTask,
  onAddComment,
  onDeleteComment,
}: Props) {
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [commentDraft, setCommentDraft] = useState("");

  useEffect(() => {
    setTitleDraft(task?.title ?? "");
    setDescriptionDraft(task?.description ?? "");
    setCommentDraft("");
  }, [task?.id, task?.description, task?.title]);

  const taskComments = useMemo(
    () => comments.filter((comment) => comment.taskId === task?.id && !comment.deletedAt),
    [comments, task?.id]
  );

  const parentOptions = useMemo(
    () =>
      tasks.filter(
        (entry) =>
          !entry.deletedAt &&
          !!task &&
          entry.projectId === task.projectId &&
          entry.id !== task.id
      ),
    [task, tasks]
  );

  if (!task) {
    return (
      <aside className="h-full rounded-2xl border border-[#2b2b2b] bg-[#111111] p-4 text-[13px] text-[#8896b0]">
        Select a task to edit details.
      </aside>
    );
  }

  return (
    <aside className="h-full min-h-0 overflow-y-auto rounded-2xl border border-[#2b2b2b] bg-[#111111] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15px] text-[#d4d8e1]">Task Details</h3>
        <button
          type="button"
          className="rounded-md border border-[#4a4a4a] px-2 py-1 text-[12px] text-[#ffb8c6]"
          onClick={() => {
            void onDeleteTask(task.id);
          }}
        >
          Delete
        </button>
      </div>

      <label className="mb-2 block text-[11px] uppercase tracking-[0.06em] text-[#72819b]">Title</label>
      <input
        value={titleDraft}
        onChange={(event) => setTitleDraft(event.target.value)}
        onBlur={() => {
          const next = titleDraft.trim();
          if (!next || next === task.title) return;
          void onUpdateTask(task.id, { title: next });
        }}
        className="mb-4 w-full rounded-lg border border-[#343434] bg-[#111111] px-3 py-2 text-[14px] text-[#d4d8e1] outline-none focus:border-[#4a4a4a]"
      />

      <label className="mb-2 block text-[11px] uppercase tracking-[0.06em] text-[#72819b]">Description</label>
      <textarea
        value={descriptionDraft}
        onChange={(event) => setDescriptionDraft(event.target.value)}
        onBlur={() => {
          if (descriptionDraft === task.description) return;
          void onUpdateTask(task.id, { description: descriptionDraft });
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void onUpdateTask(task.id, { description: descriptionDraft });
          }
        }}
        rows={5}
        className="mb-4 w-full rounded-lg border border-[#343434] bg-[#111111] px-3 py-2 text-[13px] text-[#d4d8e1] outline-none focus:border-[#4a4a4a]"
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-2 block text-[11px] uppercase tracking-[0.06em] text-[#72819b]">Status</label>
          <select
            value={task.stateId}
            className="w-full rounded-lg border border-[#343434] bg-[#111111] px-2 py-2 text-[13px] text-[#d4d8e1] outline-none"
            onChange={(event) => {
              void onUpdateTask(task.id, { stateId: event.target.value });
            }}
          >
            {states.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-[11px] uppercase tracking-[0.06em] text-[#72819b]">Priority</label>
          <select
            value={task.priority}
            className="w-full rounded-lg border border-[#343434] bg-[#111111] px-2 py-2 text-[13px] text-[#d4d8e1] outline-none"
            onChange={(event) => {
              void onUpdateTask(task.id, { priority: Number(event.target.value) as TaskPriority });
            }}
          >
            <option value={0}>P0</option>
            <option value={1}>P1</option>
            <option value={2}>P2</option>
            <option value={3}>P3</option>
            <option value={4}>P4</option>
          </select>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-2 block text-[11px] uppercase tracking-[0.06em] text-[#72819b]">Due Date</label>
          <input
            type="date"
            value={task.dueDate ?? ""}
            className="w-full rounded-lg border border-[#343434] bg-[#111111] px-2 py-2 text-[13px] text-[#d4d8e1] outline-none"
            onChange={(event) => {
              void onUpdateTask(task.id, { dueDate: event.target.value || null });
            }}
          />
        </div>

        <div>
          <label className="mb-2 block text-[11px] uppercase tracking-[0.06em] text-[#72819b]">Parent</label>
          <select
            value={task.parentTaskId ?? ""}
            className="w-full rounded-lg border border-[#343434] bg-[#111111] px-2 py-2 text-[13px] text-[#d4d8e1] outline-none"
            onChange={(event) => {
              void onUpdateTask(task.id, { parentTaskId: event.target.value || null });
            }}
          >
            <option value="">None</option>
            {parentOptions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-2 text-[11px] uppercase tracking-[0.06em] text-[#72819b]">Comments</div>

      <form
        className="mb-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!commentDraft.trim()) return;
          void onAddComment(task.id, commentDraft.trim());
          setCommentDraft("");
        }}
      >
        <input
          value={commentDraft}
          onChange={(event) => setCommentDraft(event.target.value)}
          placeholder="Add comment"
          className="flex-1 rounded-lg border border-[#343434] bg-[#111111] px-3 py-2 text-[13px] text-[#d4d8e1] outline-none"
        />
        <button
          type="submit"
          className="rounded-lg border border-[#3a3a3a] bg-[#1b1b1b] px-3 py-2 text-[12px] text-[#b9cdf0]"
        >
          Add
        </button>
      </form>

      <div className="grid gap-2">
        {taskComments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#343434] px-3 py-3 text-[12px] text-[#7b88a2]">
            No comments
          </div>
        ) : (
          taskComments.map((comment) => (
            <article key={comment.id} className="rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-3">
              <p className="whitespace-pre-wrap text-[13px] text-[#d4d8e1]">{comment.body}</p>
              <div className="mt-2 flex items-center justify-between text-[11px] text-[#7a869d]">
                <span>{new Date(comment.createdAt).toLocaleString()}</span>
                <button
                  type="button"
                  className="text-[#f7b9c8]"
                  onClick={() => {
                    void onDeleteComment(comment.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
