import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { GridWorkspace } from "../../features/dashboard/ui/grid-workspace";
import type { NoteMeta } from "../../features/notes/types";
import type { Note } from "../../features/notes/model";

/** The legacy dashboard notes-preview widget only needs a meta list — read it
 * through the Wave-3 surface (the old useNotes hook + sync engine retired
 * with NO-2/NO-3). The widget itself stays untouched until the dashboard
 * rework (DESIGN_BRIEF §6). */
function noteToLegacyMeta(n: Note): NoteMeta {
  return {
    id: n.id,
    workspaceId: n.workspaceId,
    ownerId: n.createdBy ?? "",
    parentId: n.parentId,
    title: n.title,
    icon: n.icon,
    kind: "note",
    tags: [],
    isPinned: n.isPinned,
    position: n.position,
    isArchived: n.isArchived,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    deletedAt: n.deletedAt,
  };
}

export function GridPage() {
  const { runtime, userId, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const [notes, setNotes] = useState<NoteMeta[]>([]);

  const canReadNotes = modulePermissions.notes !== "none";

  useEffect(() => {
    let cancelled = false;
    if (!runtime || !selectedWorkspaceId || !canReadNotes) {
      setNotes([]);
      return;
    }
    void runtime.notesV2
      .listMeta(selectedWorkspaceId)
      .then((bundle) => {
        if (cancelled) return;
        setNotes(bundle.notes.filter((n) => !n.deletedAt).map(noteToLegacyMeta));
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, selectedWorkspaceId, canReadNotes]);

  const canRender = useMemo(
    () => !!runtime && !!userId && !!selectedWorkspaceId && !configError,
    [configError, runtime, selectedWorkspaceId, userId]
  );

  if (!canRender) {
    return (
      <FeaturePanelsShell
        feature="grid"
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
            <h2>Grid unavailable</h2>
            <p>{configError ?? "Authentication, workspace, or desktop runtime is missing."}</p>
          </div>
        }
      />
    );
  }

  return (
    <GridWorkspace
      runtime={runtime}
      workspaceId={selectedWorkspaceId!}
      notes={notes}
    />
  );
}
