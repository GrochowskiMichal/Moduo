// The reader's Contact right-panel variant (EM-8, AC9). Resolves the sender to an
// existing contact (by any of their addresses) and shows the contact's linked
// items via the spine EntityHub; an unknown sender gets a one-click "Add as
// contact" (prefilled from the From header — never auto-created). Compact + tokens-
// only; the full contact hub lives on /contacts.

import { UserPlus } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { useEntityHub } from "../../../features/spine/hooks/use-entity-hub";
import { EntityHub } from "../../../features/spine/ui/entity-hub";
import type { EntityRef } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { Contact } from "../../contacts/model";

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** The From header name + address (for the unknown-sender add flow). */
  fromName: string;
  fromAddr: string;
  /** The resolved contact, or null when the sender isn't a contact yet. */
  contact: Contact | null;
  canEdit: boolean;
  onAddContact: (name: string, email: string) => void;
  onOpenEntity?: (ref: EntityRef) => void;
};

export function EmailContactPanel({
  runtime,
  workspaceId,
  fromName,
  fromAddr,
  contact,
  canEdit,
  onAddContact,
  onOpenEntity,
}: Props) {
  const hub = useEntityHub(
    runtime,
    workspaceId,
    contact ? { type: "contact", id: contact.id } : null,
  );

  if (!contact) {
    const name = fromName.trim() || fromAddr;
    return (
      <div className="flex flex-col gap-3 p-1">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="truncate text-sm font-medium text-foreground">{name}</div>
          {fromAddr ? (
            <div className="truncate text-xs text-muted-foreground">{fromAddr}</div>
          ) : null}
        </div>
        <EmptyState
          icon={UserPlus}
          title="Not a contact yet"
          description="Add this sender to your contacts to track your history together."
          action={
            canEdit && fromAddr ? (
              <Button size="sm" onClick={() => onAddContact(fromName, fromAddr)}>
                <UserPlus aria-hidden />
                Add as contact
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="shrink-0">
        <div className="truncate text-sm font-medium text-foreground">{contact.name}</div>
        {contact.email ? (
          <div className="truncate text-xs text-muted-foreground">{contact.email}</div>
        ) : null}
      </header>
      <div className="pane-scroll min-h-0 flex-1 overflow-y-auto">
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
