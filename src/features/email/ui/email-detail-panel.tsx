// The thread's Detail right-panel variant (EM-8). Once an email is in the tissue
// (converted / linked / snoozed / followed-up / tagged) it has an `email_thread`
// entity, so this shows its spine EntityHub (links / suggestions / activity) + the
// tag row. Pre-tissue there's nothing to show yet — a quiet nudge to convert/link.

import { Link2 } from "lucide-react";

import { EmptyState } from "../../../components/ui/empty-state";
import { EntityTagRow } from "../../contacts/ui/entity-tag-row";
import { EntityHub } from "../../../features/spine/ui/entity-hub";
import { useEntityHub } from "../../../features/spine/hooks/use-entity-hub";
import type { EntityRef } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** The tissue ref id = the email_thread entity id, or null pre-tissue. */
  refId: string | null;
  canEdit: boolean;
  onOpenEntity?: (ref: EntityRef) => void;
};

export function EmailDetailPanel({
  runtime,
  workspaceId,
  refId,
  canEdit,
  onOpenEntity,
}: Props) {
  const hub = useEntityHub(
    runtime,
    workspaceId,
    refId ? { type: "email_thread", id: refId } : null,
  );

  if (!refId) {
    return (
      <EmptyState
        icon={Link2}
        title="No links yet"
        description="Convert this email to a task or link it — its connections show up here."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <EntityTagRow
        runtime={runtime}
        workspaceId={workspaceId}
        focus={{ type: "email_thread", id: refId }}
        canEdit={canEdit}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EntityHub
          variant="rail"
          status={hub.status}
          sections={hub.sections}
          canEdit={false}
          onOpen={onOpenEntity}
          onRetry={hub.reload}
        />
      </div>
    </div>
  );
}
