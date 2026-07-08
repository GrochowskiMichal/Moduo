/**
 * Task line visual states (NO-5, AC3) — a static mock of the editor block:
 * the real TaskLineNode is a Lexical ElementNode whose checkbox/meta render
 * in the plugin's overlay OUTSIDE the contenteditable, so the story renders
 * the same visual contract (`.notes-task-line` gutters in global.css) with
 * the widgets positioned inline. States: open · done · scheduled · pending
 * mint · tombstoned task.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { X } from "lucide-react";

function TaskLineMock({
  title,
  done = false,
  pending = false,
  missing = false,
  chip,
}: {
  title: string;
  done?: boolean;
  pending?: boolean;
  missing?: boolean;
  chip?: string;
}) {
  return (
    <div
      className="notes-task-line"
      data-task-line="true"
      data-done={done ? "true" : "false"}
      data-pending={pending ? "true" : "false"}
    >
      <span className="absolute left-1 top-0.5 inline-flex h-7 items-center">
        <CompleteToggle done={done} disabled={pending || missing} onToggle={() => {}} />
      </span>
      <span className="text-base">{title}</span>
      <span className="absolute right-1 top-0.5 inline-flex h-7 items-center gap-1">
        {pending ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
          </span>
        ) : missing ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="line-through">task deleted</span>
            <button
              type="button"
              className="rounded-sm p-0.5 hover:bg-accent hover:text-foreground"
              aria-label="Remove line"
            >
              <X className="size-3" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="inline-flex max-w-40 items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {chip ?? "Details"}
          </button>
        )}
      </span>
    </div>
  );
}

const meta: Meta = {
  title: "Notes/TaskLineStates",
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

export const AllStates: Story = {
  render: () => (
    <div className="notes-editor-v2 max-w-xl space-y-1 bg-background p-4">
      <TaskLineMock title="An open task line" />
      <TaskLineMock title="A completed task line" done />
      <TaskLineMock title="Scheduled work" chip="Tomorrow 09:00" />
      <TaskLineMock title="Still minting…" pending />
      <TaskLineMock title="Line whose task was deleted in Tasks" missing />
    </div>
  ),
};
