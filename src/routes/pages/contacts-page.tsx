// Contacts (light CRM) — the directory + ContactHub page (specs/contacts.md
// block CO-2). The rename destination of `/crm`, composing the 3-pane shell:
// the people+companies directory (left) and the auto-rollup hub (center). The
// right context strip (suggestions / tags / quick actions) arrives in CO-4.
//
// Contacts rides the Tasks permission lane at alpha (CO-1 decision a), so render
// + edit gate on `modulePermissions.tasks` until a dedicated lane lands.

import { useMemo, useState, type ReactNode } from "react";
import { Contact as ContactIcon } from "lucide-react";
import { toast } from "sonner";

import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { EmptyState } from "../../components/ui/empty-state";
import { Separator } from "../../components/ui/separator";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import type { EntityLink, EntityRef, RelationKind } from "../../lib/entity-links";
import { EntityHub } from "../../features/spine/ui/entity-hub";
import "../../features/contacts/projectors";
import { useContactsDirectory } from "../../features/contacts/hooks/use-contacts-directory";
import { useContactHub } from "../../features/contacts/hooks/use-contact-hub";
import { lastTouchLine } from "../../features/contacts/rollup";
import {
  ContactDirectory,
  type DirectorySelection,
} from "../../features/contacts/ui/contact-directory";
import { ContactHub } from "../../features/contacts/ui/contact-hub";
import { ContactImportDialog } from "../../features/contacts/ui/contact-import-dialog";

function openEntity(ref: EntityRef) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("moduo:entity:open", { detail: { type: ref.type, id: ref.id } }));
}

export function ContactsPage() {
  const { runtime, userId, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const permission = modulePermissions.tasks;
  const canEdit = permission === "edit" || permission === "admin";

  const workspaceId = selectedWorkspaceId ?? null;
  const directory = useContactsDirectory(runtime, workspaceId);
  const [selected, setSelected] = useState<DirectorySelection | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const focus = useMemo<EntityRef | null>(
    () => (selected ? { type: selected.type, id: selected.id } : null),
    [selected],
  );
  const hub = useContactHub(runtime, workspaceId, focus);

  const selectedContact =
    selected?.type === "contact" ? directory.bundle.contacts.find((c) => c.id === selected.id) ?? null : null;
  const selectedCompany =
    selected?.type === "company" ? directory.bundle.companies.find((c) => c.id === selected.id) ?? null : null;

  const canRender = !!runtime && !!userId && !!workspaceId && !configError && permission !== "none";

  if (!canRender) {
    return (
      <FeaturePanelsShell
        feature="contacts"
        hideRight
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
            <h2 className="font-display text-2xl text-foreground">Contacts unavailable</h2>
            <p className="text-sm">
              {configError ??
                (permission === "none"
                  ? "You do not have access to contacts in this workspace."
                  : "Authentication, workspace, or runtime is missing.")}
            </p>
          </div>
        }
      />
    );
  }

  const ws = workspaceId as string;

  async function changeStatus(contactId: string, status: string) {
    try {
      await runtime!.contacts.setStatus({ workspaceId: ws, contactId, status });
      directory.reload();
      hub.reload();
    } catch (err) {
      toast.error("Couldn’t save status", { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function rename(contactId: string, name: string) {
    try {
      await runtime!.contacts.updateContact({ workspaceId: ws, contactId, name });
      directory.reload();
    } catch (err) {
      toast.error("Couldn’t rename contact", { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function changeKind(link: EntityLink, kind: RelationKind) {
    try {
      await runtime!.spine.setLinkKind({ workspaceId: ws, linkId: link.id, relationKind: kind });
      hub.reload();
    } catch (err) {
      toast.error("Couldn’t change the relation", { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function unlink(link: EntityLink) {
    try {
      await runtime!.spine.deleteLink({ workspaceId: ws, linkId: link.id });
      hub.reload();
    } catch (err) {
      toast.error("Couldn’t remove the link", { description: err instanceof Error ? err.message : undefined });
    }
  }

  const left = (
    <ContactDirectory
      contacts={directory.bundle.contacts}
      companies={directory.bundle.companies}
      status={directory.status}
      selected={selected}
      onSelect={setSelected}
      onImport={canEdit ? () => setImportOpen(true) : undefined}
      onRetry={directory.reload}
    />
  );

  let center: ReactNode;
  if (selectedContact) {
    center = (
      <ContactHub
        contact={selectedContact}
        rollup={hub.rollup}
        hubStatus={hub.hubStatus}
        activity={hub.activity}
        canEdit={canEdit}
        currentUserId={userId ?? null}
        onRename={(name) => void rename(selectedContact.id, name)}
        onStatusChange={(status) => void changeStatus(selectedContact.id, status)}
        onOpenEntity={openEntity}
        onChangeKind={(link, kind) => void changeKind(link, kind)}
        onUnlink={(link) => void unlink(link)}
        onRetry={hub.reload}
      />
    );
  } else if (selectedCompany) {
    // A company hub: roll-up + activity now; the People-union group lands in CO-4.
    center = (
      <div className="mx-auto flex h-full min-h-0 max-w-2xl flex-col gap-5 overflow-y-auto p-6">
        <h2 className="font-display text-2xl text-foreground">{selectedCompany.name || "Unnamed company"}</h2>
        <p className="text-sm text-muted-foreground">{lastTouchLine(hub.rollup, new Date())}</p>
        <Separator />
        <EntityHub
          variant="page"
          status={hub.hubStatus}
          sections={hub.rollup.sections}
          canEdit={canEdit}
          onOpen={openEntity}
          onChangeKind={(link, kind) => void changeKind(link, kind)}
          onUnlink={(link) => void unlink(link)}
          onRetry={hub.reload}
        />
      </div>
    );
  } else {
    center = (
      <EmptyState
        icon={ContactIcon}
        title="Your contacts live here"
        description="People and companies whose pages stay current automatically — every linked email, task, note and payment rolls up onto them. Select one, import, or add to begin."
      />
    );
  }

  return (
    <>
      <FeaturePanelsShell feature="contacts" hideRight left={left} center={center} />
      {canEdit ? (
        <ContactImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          existingContacts={directory.bundle.contacts}
          existingCompanies={directory.bundle.companies}
          onImport={(rows) => runtime!.contacts.importContacts({ workspaceId: ws, rows })}
          onDone={(result) => {
            directory.reload();
            const parts = [
              result.created ? `${result.created} added` : null,
              result.merged ? `${result.merged} merged` : null,
            ].filter(Boolean);
            toast.success("Contacts imported", {
              description: parts.length ? parts.join(" · ") : "Nothing to import.",
            });
          }}
        />
      ) : null}
    </>
  );
}
