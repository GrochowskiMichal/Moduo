// The template list per workspace (TV-D15): read on demand (a picker or the
// Templates page opening, and after each template op), kept in one place so
// every surface (capture's `/template`, New project → From template…, the
// Templates page) shows the same list. Templates aren't work items and nobody
// else's change needs to show live, so they stay out of the shared task store
// (TV-D11a); a body is read only when a template is opened.

import { useEffect, useSyncExternalStore } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { Template } from "./model";

type Entry = {
  templates: Template[];
  /** The list has been read once (an empty list is then a real "none"). */
  loaded: boolean;
  loading: Promise<void> | null;
  /** Bumped by every local change, so a read that began earlier doesn't undo it. */
  version: number;
};

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
/** Bumped by `clearTemplates`: a read that began before a sign-out is dropped. */
let generation = 0;

const EMPTY: Entry = { templates: [], loaded: false, loading: null, version: 0 };

function entryOf(workspaceId: string): Entry {
  let entry = entries.get(workspaceId);
  if (!entry) {
    entry = { ...EMPTY };
    entries.set(workspaceId, entry);
  }
  return entry;
}

function emit() {
  for (const fn of listeners) fn();
}

function sortTemplates(list: Template[]): Template[] {
  return [...list].sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.id < b.id ? -1 : 1),
  );
}

/** Read the list again (one read at a time per workspace). */
export function refreshTemplates(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
): Promise<void> {
  if (!runtime?.tasks.listTemplates || !workspaceId) return Promise.resolve();
  const entry = entryOf(workspaceId);
  if (entry.loading) return entry.loading;
  const startedAt = entry.version;
  const startedIn = generation;
  const read = runtime.tasks
    .listTemplates(workspaceId)
    .then((templates) => {
      if (startedIn !== generation) return;
      const now = entryOf(workspaceId);
      // A change made while this read was out wins until the next read.
      if (now.version !== startedAt) {
        entries.set(workspaceId, { ...now, loaded: true, loading: null });
      } else {
        entries.set(workspaceId, {
          ...now,
          templates: sortTemplates(templates),
          loaded: true,
          loading: null,
        });
      }
      emit();
    })
    .catch(() => {
      if (startedIn !== generation) return;
      const now = entryOf(workspaceId);
      entries.set(workspaceId, { ...now, loading: null });
      emit();
    });
  entries.set(workspaceId, { ...entry, loading: read });
  return read;
}

/** Put a template the server just answered with into the list (or replace it). */
export function rememberTemplate(template: Template): void {
  const entry = entryOf(template.workspaceId);
  const rest = entry.templates.filter((t) => t.id !== template.id);
  entries.set(template.workspaceId, {
    ...entry,
    templates: template.deletedAt ? rest : sortTemplates([...rest, template]),
    version: entry.version + 1,
  });
  emit();
}

/** Take a template out of the list (deleted, or no longer shared with you). */
export function forgetTemplate(workspaceId: string, id: string): void {
  const entry = entryOf(workspaceId);
  entries.set(workspaceId, {
    ...entry,
    templates: entry.templates.filter((t) => t.id !== id),
    version: entry.version + 1,
  });
  emit();
}

/** Every workspace's list, wiped (sign-out). */
export function clearTemplates(): void {
  generation += 1;
  entries.clear();
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The workspace's templates (yours and the shared ones); read when the
 * component mounts and whenever `refreshKey` changes.
 */
export function useTemplates(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  refreshKey: unknown = null,
): { templates: Template[]; loaded: boolean; supported: boolean } {
  const entry = useSyncExternalStore(
    subscribe,
    () => (workspaceId ? (entries.get(workspaceId) ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey asks for a fresh read
  useEffect(() => {
    void refreshTemplates(runtime, workspaceId);
  }, [runtime, workspaceId, refreshKey]);
  return {
    templates: entry.templates,
    loaded: entry.loaded,
    supported: Boolean(runtime?.tasks.listTemplates),
  };
}

/** For tests: start from nothing. */
export function resetTemplatesForTests(): void {
  entries.clear();
  listeners.clear();
}
