import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { normalizeTaskKey, taskHandle, taskKeyProblem } from "../../../lib/task-handle";

type Props = {
  /** The workspace's key today, or null before TV-D8's migration. */
  taskKey: string | null;
  /** Only the owner changes it (the server checks too). */
  canEdit: boolean;
  onSave: (key: string) => Promise<void>;
};

/**
 * Settings → Workspace → Task key (TV-D8): the letters in front of every
 * task's number, `MOD-142`. The owner changes it; the old key keeps working in
 * links and search.
 */
export function TaskKeyField({ taskKey, canEdit, onSave }: Props) {
  const id = useId();
  const [draft, setDraft] = useState(taskKey ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(taskKey ?? "");
  }, [taskKey]);

  const key = normalizeTaskKey(draft);
  const problem = draft.trim() === "" ? null : taskKeyProblem(draft);
  const changed = !!key && key !== taskKey;
  const example = taskHandle(changed && !problem ? key : taskKey, 142);

  const save = async () => {
    if (!changed || problem || saving) return;
    setSaving(true);
    try {
      await onSave(key);
      toast.success(`Task key changed to ${key}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change the task key.");
    } finally {
      setSaving(false);
    }
  };

  if (!taskKey) {
    return (
      <p className="text-sm text-muted-foreground">
        Task handles aren't available in this workspace yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Task key</Label>
      {canEdit ? (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            value={draft}
            maxLength={5}
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-hint`}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
            className="max-w-28 tabular-nums"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void save()}
            disabled={!changed || !!problem || saving}
          >
            {saving ? "Saving…" : "Change key"}
          </Button>
        </div>
      ) : (
        <p id={id} className="text-sm text-foreground">
          {taskKey}
        </p>
      )}
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {problem ??
          (canEdit
            ? `Every task gets a handle like ${example}. If you change the key, the numbers stay and a handle typed with the old key still finds its task.`
            : `Every task gets a handle like ${example}. Only the workspace owner can change the key.`)}
      </p>
    </div>
  );
}
