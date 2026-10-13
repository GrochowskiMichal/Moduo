// The two reads the project overview makes beyond the shared store (TV-U16):
// the hours tracked this month (TV-D14's report, only time the reader may
// see) and the files on the project's tasks (AT-1's list). Each loads when
// the overview opens a project and again when its signal moves; neither
// refetches on every render.

import { useEffect, useMemo, useState } from "react";
import { getRuntime } from "../../../lib/runtime";
import type { AttachmentRecord } from "../../../lib/runtime.types";

/** Seconds tracked in a range on one project (signed entries summed, never
 *  below zero), or null while loading or when it can't be read. `stamp`
 *  re-reads it (the project's tracked total, which a save moves). */
export function useProjectTime(input: {
  workspaceId: string;
  projectId: string;
  from: string;
  to: string;
  zone: string;
  stamp: number;
}): number | null {
  const { workspaceId, projectId, from, to, zone, stamp } = input;
  const [seconds, setSeconds] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is the re-read cue
  useEffect(() => {
    const runtime = getRuntime();
    if (!runtime) return;
    let live = true;
    runtime.tasks
      .timeReport({ workspaceId, from, to, projectIds: [projectId], clientContactId: null, zone })
      .then(
        (r) => {
          if (!live) return;
          const sum = r.rows.reduce((total, row) => total + row.seconds, 0);
          setSeconds(Math.max(0, sum));
        },
        () => {
          if (live) setSeconds(null);
        },
      );
    return () => {
      live = false;
    };
  }, [workspaceId, projectId, from, to, zone, stamp]);
  // A new project starts blank, never with the last one's hours.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per project
  useEffect(() => setSeconds(null), [projectId]);
  return seconds;
}

export type ProjectFiles = {
  /** Newest first. */
  files: AttachmentRecord[];
  /** The workspace list was cut: there may be more. */
  partial: boolean;
  loaded: boolean;
};

const NO_FILES: ProjectFiles = { files: [], partial: false, loaded: false };

/** The files on a project's tasks (ready, not in the trash). `taskIds` is
 *  the project's tasks the reader can see; the list re-reads when it changes. */
export function useProjectFiles(workspaceId: string, taskIds: readonly string[]): ProjectFiles {
  const key = useMemo(() => [...taskIds].sort().join(","), [taskIds]);
  const [all, setAll] = useState<{ list: AttachmentRecord[]; partial: boolean } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the re-read cue
  useEffect(() => {
    const runtime = getRuntime();
    if (!runtime?.attachments) return;
    let live = true;
    runtime.attachments.list(workspaceId).then(
      (r) => {
        if (live) setAll({ list: r.attachments, partial: r.truncation !== null });
      },
      () => {
        if (live) setAll({ list: [], partial: false });
      },
    );
    return () => {
      live = false;
    };
  }, [workspaceId, key]);
  return useMemo(() => {
    if (!all) return NO_FILES;
    const ids = new Set(key ? key.split(",") : []);
    const files = all.list
      .filter(
        (f) =>
          f.entityType === "task" && ids.has(f.entityId) && !f.deletedAt && f.status === "ready",
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return { files, partial: all.partial, loaded: true };
  }, [all, key]);
}

/**
 * Whether the reader may change this project (Edit on it, D15-11's
 * `templates_can_copy`), asked once per project: the workspace's Tasks edit
 * isn't enough when a project is shared view-only. Null while asking; a
 * server that can't answer leaves it to the ops (yes).
 */
export function useProjectEditable(projectId: string, enabled: boolean): boolean | null {
  const [answer, setAnswer] = useState<{ id: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const runtime = getRuntime();
    if (!runtime?.tasks.canCopyTemplateSource) {
      setAnswer({ id: projectId, ok: true });
      return;
    }
    let live = true;
    runtime.tasks.canCopyTemplateSource({ kind: "project", id: projectId }).then(
      (ok) => {
        if (live) setAnswer({ id: projectId, ok });
      },
      () => {
        if (live) setAnswer({ id: projectId, ok: true });
      },
    );
    return () => {
      live = false;
    };
  }, [projectId, enabled]);
  if (!enabled) return false;
  return answer?.id === projectId ? answer.ok : null;
}
