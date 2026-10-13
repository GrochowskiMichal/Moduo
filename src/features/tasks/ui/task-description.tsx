// The task's description (Tasks v3 call 56): in the panel it shows about
// eight lines, then fades into "Show more · 2 tasks · 1 email", counting the
// references hidden below the fold; "Show less" sits at the end. Editing
// always shows the whole text, and the full page never folds. Every item it
// mentions is also in Linked, with its card.

import { useLayoutEffect, useRef, useState } from "react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { EntityTextEditor } from "../../spine/editor/entity-text-editor";
import { referenceKind, referenceNoun } from "../../spine/references/kinds";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task } from "../model";

/** "2 tasks · 1 email" for the references below the fold, by kind, in first-seen order. */
export function hiddenCounts(types: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const type of types) {
    const noun = referenceNoun(referenceKind(type));
    counts.set(noun, (counts.get(noun) ?? 0) + 1);
  }
  return [...counts].map(([noun, n]) => `${n} ${n === 1 ? noun : `${noun}s`}`).join(" · ");
}

export function TaskDescription({
  task,
  api,
  canEdit,
  runtime,
  workspaceId,
  foldable = true,
  onFiles,
}: {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** The full page never folds (call 32). */
  foldable?: boolean;
  /** Files pasted or dropped into the text (AT-2: they attach to the task). */
  onFiles?: (files: File[]) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [overflow, setOverflow] = useState<{ folds: boolean; hidden: string[] }>({
    folds: false,
    hidden: [],
  });
  const folded = foldable && !expanded && !editing;

  // Measure while folded: does the text run past the fold, and which
  // references sit below it? Re-measured when the text or the width changes.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !folded) return;
    const measure = () => {
      const limit = box.clientHeight;
      const folds = box.scrollHeight > limit + 1;
      const hidden: string[] = [];
      if (folds) {
        const top = box.getBoundingClientRect().top;
        for (const el of box.querySelectorAll<HTMLElement>("[data-entity-type]")) {
          if (el.getBoundingClientRect().bottom - top > limit) {
            hidden.push(el.dataset.entityType ?? "");
          }
        }
      }
      setOverflow((prev) =>
        prev.folds === folds && prev.hidden.join() === hidden.join() ? prev : { folds, hidden },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    const content = box.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [folded, task.description]);

  if (!canEdit && !task.description.trim()) return null;
  const counts = hiddenCounts(overflow.hidden);

  return (
    <div className="flex flex-col items-start">
      <div
        ref={boxRef}
        className={cn(
          "w-full",
          folded && "max-h-48 overflow-hidden",
          folded && overflow.folds && "mask-b-from-60%",
        )}
        onFocusCapture={() => setEditing(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(false);
        }}
      >
        <EntityTextEditor
          value={task.description}
          editable={canEdit}
          runtime={runtime}
          workspaceId={workspaceId}
          source={{ type: "task", id: task.id }}
          sourceLabel={task.title}
          sourceIcon="task"
          ariaLabel="Description"
          placeholder={canEdit ? "Add a description…  @ or / to link" : undefined}
          className="min-h-6 text-base text-foreground/85"
          placeholderClassName="right-0 truncate text-base"
          onCommit={(html) => {
            if (html !== task.description) api.patchTask(task.id, { description: html });
          }}
          onFiles={onFiles}
        />
      </div>
      {foldable && !editing && (overflow.folds || expanded) ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="-ms-2 font-sans text-xs font-normal text-muted-foreground"
        >
          {expanded ? "Show less" : counts ? `Show more · ${counts}` : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}
