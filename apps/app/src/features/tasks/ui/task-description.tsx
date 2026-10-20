// The task's description (Tasks v3 call 56, MOD-36): in the panel it shows
// about eight lines, then fades into "Show more · 2 tasks · 1 email", counting
// the references hidden below the fold; "Show less" sits at the end. A short
// or empty one never offers either. Editing always shows the whole text, and
// the full page never folds. Every item it mentions is also in Linked, with
// its card.

import { useLayoutEffect, useRef, useState } from "react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { EntityTextEditor } from "../../spine/editor/entity-text-editor";
import { referenceKind, referenceNoun } from "../../spine/references/kinds";
import type { Task } from "../model";
import { useTaskCommands } from "../tasks-context";

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
  canEdit,
  runtime,
  workspaceId,
  foldable = true,
  onFiles,
}: {
  task: Task;
  canEdit: boolean;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** The full page never folds (call 32). */
  foldable?: boolean;
  /** Files pasted or dropped into the text (AT-2: they attach to the task). */
  onFiles?: (files: File[]) => void;
}) {
  const { patchTask } = useTaskCommands();
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
    // The negative margin keeps the text where the title block puts it (the
    // soft surface pads 4 px above and below). It sits out here, never on the
    // editor: inside the measured box it would overflow it, and every
    // description, even an empty one, would read as folded.
    <div className="-my-1 flex flex-col items-start">
      <div
        ref={boxRef}
        className={cn(
          // The text's own size and leading, so `lh` is one of its lines.
          "w-full text-base",
          // About eight lines (MOD-36), counted in lines rather than pixels so
          // the fold holds whatever the type size; the half line under the
          // fade shows there's more (round-1c frame 3's 8.6).
          folded && "max-h-[8.5lh] overflow-hidden",
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
          // Stored as Markdown; an older HTML description turns into
          // Markdown on its next edit (call #15, MOD-120).
          format="markdown"
          placeholder={canEdit ? "Add a description…  @ or / to link" : undefined}
          // Plain text at rest; editing fills a quiet surface, its padding
          // inside (MOD-115).
          surface="soft"
          className="min-h-6 text-base text-foreground/85"
          placeholderClassName="truncate text-base"
          onCommit={(markdown) => {
            if (markdown !== task.description) patchTask(task.id, { description: markdown });
          }}
          onFiles={onFiles}
          // TV-D12: an @person in the description notifies them (people who
          // can see the task; the server checks).
          onMentionPerson={
            runtime && workspaceId
              ? async (memberId) => {
                  await runtime.tasks
                    .mentionInTask({ workspaceId, taskId: task.id, userIds: [memberId] })
                    .catch(() => undefined);
                }
              : undefined
          }
        />
      </div>
      {foldable && !editing && (overflow.folds || expanded) ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          // Its words start with the text above (the soft surface pads 8 px).
          className="-ms-0.5 font-sans text-xs font-normal text-muted-foreground"
        >
          {expanded ? "Show less" : counts ? `Show more · ${counts}` : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}
