// Task handles (TV-D8, specs/tasks-v3.md §Assumptions #2): the workspace's task
// key plus the task's permanent number, `MOD-142`. No zero-padding; a handle
// never changes when a task moves; an old key stays an alias on the server.

/** A task key: 2 to 5 letters, A to Z (the server's CHECK). */
export const TASK_KEY_PATTERN = /^[A-Z]{2,5}$/;

/** "MOD-142", or null while the task (or the workspace's key) has no number yet. */
export function taskHandle(
  taskKey: string | null | undefined,
  number: number | null | undefined,
): string | null {
  if (!taskKey || number == null || !Number.isFinite(number)) return null;
  return `${taskKey}-${number}`;
}

/** What a typed key becomes: trimmed and upper-cased. */
export function normalizeTaskKey(input: string): string {
  return input.trim().toUpperCase();
}

/** Why a key can't be saved, in the words Settings shows, or null when it can. */
export function taskKeyProblem(input: string): string | null {
  const key = normalizeTaskKey(input);
  if (!key) return "Type 2 to 5 letters.";
  if (!/^[A-Z]+$/.test(key)) return "Use letters A to Z only.";
  if (key.length < 2 || key.length > 5) return "Use 2 to 5 letters.";
  return null;
}

/**
 * The registry search pattern for a query that looks like a handle ("MOD-14",
 * "mod-", "MOD-142"), or null. Only letters, digits and one hyphen pass, so the
 * pattern is safe inside a PostgREST `or` filter.
 */
export function handleSearchPattern(query: string): string | null {
  const q = query.trim();
  if (!/^[A-Za-z]{2,5}-\d{0,9}$/.test(q)) return null;
  return `${q.toUpperCase()}%`;
}

/**
 * A handle search pattern typed with an earlier key of the workspace, moved to
 * its current key ("ML-14%" → "PLAN-14%" once ML became PLAN). Numbers never
 * change, so the old handle finds the same task.
 */
export function handleWithCurrentKey(
  pattern: string,
  currentKey: string | null,
  aliases: readonly string[],
): string {
  const dash = pattern.indexOf("-");
  if (!currentKey || dash < 0) return pattern;
  const key = pattern.slice(0, dash).toUpperCase();
  if (key === currentKey || !aliases.some((a) => a.toUpperCase() === key)) return pattern;
  return `${currentKey}${pattern.slice(dash)}`;
}
