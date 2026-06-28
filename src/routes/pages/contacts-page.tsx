// Contacts (light CRM) — the directory + ContactHub/CompanyHub page
// (specs/contacts.md + specs/contacts-v2.md). Composes the 3-pane shell: the
// people+companies directory (left) and the iOS-style inline-edit contact card
// (center). v2 moved all contact controls onto the card itself — there is no
// essential right panel (it reverts to optional cross-module context).
//
// Contacts rides the Tasks permission lane at alpha, so render + edit gate on
// `modulePermissions.tasks` until a dedicated lane lands.

import { useMemo, useState, type ReactNode } from "react";
import { Contact as ContactIcon } from "lucide-react";
import { toast } from "sonner";

import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { EmptyState } from "../../components/ui/empty-state";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import type { EntityLink, EntityRef, RelationKind } from "../../lib/entity-links";
import type { ContactDetailsPatch } from "../../lib/runtime.types";
import type { MentionCandidate } from "../../features/spine/mention";
import "../../features/contacts/projectors";
import type { Contact, ContactFieldType } from "../../features/contacts/model";
import { useContactsDirectory } from "../../features/contacts/hooks/use-contacts-directory";
import { useContactHub } from "../../features/contacts/hooks/use-contact-hub";
import { useCompanyHub } from "../../features/contacts/hooks/use-company-hub";
import { buildFollowupTask, followupLinkArgs } from "../../features/contacts/followup";
import { contactToVCard } from "../../features/contacts/vcard";
import { ContactDirectory, type DirectorySelection } from "../../features/contacts/ui/contact-directory";
import { ContactHub } from "../../features/contacts/ui/contact-hub";
import { CompanyHub } from "../../features/contacts/ui/company-hub";
import { ContactImportDialog } from "../../features/contacts/ui/contact-import-dialog";
import { ContactFormDialog, type ContactFormValues } from "../../features/contacts/ui/contact-form-dialog";

function openEntity(ref: EntityRef) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("moduo:entity:open", { detail: { type: ref.type, id: ref.id } }));
}

/** Trigger a client-side file download (vCard export). */
function downloadText(filename: string, text: string, mime: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  const [formOpen, setFormOpen] = useState(false);

  const selectedContact =
    selected?.type === "contact" ? directory.bundle.contacts.find((c) => c.id === selected.id) ?? null : null;
  const selectedCompany =
    selected?.type === "company" ? directory.bundle.companies.find((c) => c.id === selected.id) ?? null : null;

  const contactFocus = useMemo<EntityRef | null>(
    () => (selectedContact ? { type: "contact", id: selectedContact.id } : null),
    [selectedContact],
  );
  const companyFocus = useMemo<EntityRef | null>(
    () => (selectedCompany ? { type: "company", id: selectedCompany.id } : null),
    [selectedCompany],
  );
  const companyMembers = useMemo(
    () => (selectedCompany ? directory.bundle.contacts.filter((c) => c.companyId === selectedCompany.id) : []),
    [selectedCompany, directory.bundle.contacts],
  );

  const hub = useContactHub(runtime, workspaceId, contactFocus);
  const companyHub = useCompanyHub(runtime, workspaceId, companyFocus, companyMembers);

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
  const companyNameFor = (companyId: string | null) =>
    companyId ? directory.bundle.companies.find((c) => c.id === companyId)?.name ?? null : null;

  const reload = () => {
    directory.reload();
    hub.reload();
  };

  async function saveDetails(contactId: string, patch: ContactDetailsPatch) {
    try {
      await runtime!.contacts.setContactDetails({ workspaceId: ws, contactId, patch });
      reload();
    } catch (err) {
      toast.error("Couldn’t save changes", { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function toggleFavorite(c: Contact) {
    try {
      await runtime!.contacts.setFavorite({ workspaceId: ws, contactId: c.id, value: !c.isFavorite });
      directory.reload();
    } catch (err) {
      toast.error("Couldn’t update favorite", { description: err instanceof Error ? err.message : undefined });
    }
  }

  function shareVCard(c: Contact) {
    const vcf = contactToVCard(c, { companyName: companyNameFor(c.companyId) });
    downloadText(`${(c.name || "contact").replace(/\s+/g, "_")}.vcf`, vcf, "text/vcard");
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

  async function submitNewContact(values: ContactFormValues) {
    const created = await runtime!.contacts.createContact({
      workspaceId: ws,
      name: values.name,
      email: values.email || null,
      phone: values.phone || null,
      title: values.title || null,
      status: values.status,
    });
    directory.reload();
    setSelected({ type: "contact", id: created.id });
  }

  async function addFollowup(contactId: string, contactName: string) {
    try {
      const inbox = await runtime!.tasks.seedInbox(ws);
      const task = await runtime!.tasks.upsertTask(buildFollowupTask({ workspaceId: ws, bucketId: inbox.id, contactName }));
      const args = followupLinkArgs({ type: "contact", id: contactId }, task.id);
      await runtime!.contacts.link({
        workspaceId: ws,
        contact: args.contact,
        target: args.target,
        relationKind: args.relationKind,
        origin: args.origin,
        targetLabel: task.title,
      });
      reload();
      toast.success("Follow-up added", { description: task.title });
    } catch (err) {
      toast.error("Couldn’t add follow-up", { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function linkExisting(contactId: string, candidate: MentionCandidate) {
    if (candidate.kind !== "entity") return;
    try {
      await runtime!.contacts.link({
        workspaceId: ws,
        contact: { type: "contact", id: contactId },
        target: candidate.ref,
        relationKind: candidate.ref.type === "company" ? "works-at" : "references",
        origin: "manual",
        targetLabel: candidate.label,
        targetIcon: candidate.icon,
      });
      reload();
    } catch (err) {
      toast.error("Couldn’t add the link", { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function setCompany(contactId: string, candidate: MentionCandidate) {
    try {
      let companyRef: EntityRef;
      let label: string;
      if (candidate.kind === "entity") {
        companyRef = candidate.ref;
        label = candidate.label;
      } else if (candidate.kind === "create") {
        const company = await runtime!.contacts.createCompany({ workspaceId: ws, name: candidate.label });
        companyRef = { type: "company", id: company.id };
        label = company.name;
      } else {
        return;
      }
      await runtime!.contacts.link({
        workspaceId: ws,
        contact: { type: "contact", id: contactId },
        target: companyRef,
        relationKind: "works-at",
        origin: "manual",
        targetLabel: label,
        targetIcon: "building-2",
      });
      await runtime!.contacts.updateContact({ workspaceId: ws, contactId, setCompany: { companyId: companyRef.id } });
      reload();
      toast.success("Company set", { description: label });
    } catch (err) {
      toast.error("Couldn’t set company", { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function addFieldDef(label: string, type: ContactFieldType) {
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
    try {
      await runtime!.contacts.addFieldDef({ workspaceId: ws, key, label, type });
      directory.reload();
    } catch (err) {
      toast.error("Couldn’t add field", { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function deleteFieldDef(fieldId: string) {
    try {
      await runtime!.contacts.deleteFieldDef({ workspaceId: ws, fieldId });
      directory.reload();
    } catch (err) {
      toast.error("Couldn’t remove field", { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function deleteContact(contactId: string) {
    try {
      await runtime!.contacts.deleteContact({ workspaceId: ws, contactId });
      setSelected(null);
      directory.reload();
      toast.success("Contact deleted");
    } catch (err) {
      toast.error("Couldn’t delete the contact", { description: err instanceof Error ? err.message : undefined });
    }
  }

  const left = (
    <ContactDirectory
      contacts={directory.bundle.contacts}
      companies={directory.bundle.companies}
      status={directory.status}
      selected={selected}
      onSelect={setSelected}
      onNew={canEdit ? () => setFormOpen(true) : undefined}
      onImport={canEdit ? () => setImportOpen(true) : undefined}
      onToggleFavorite={canEdit ? (id) => void toggleFavorite(directory.bundle.contacts.find((c) => c.id === id)!) : undefined}
      onRetry={directory.reload}
    />
  );

  let center: ReactNode;
  if (selectedContact) {
    center = (
      <ContactHub
        contact={selectedContact}
        companyName={companyNameFor(selectedContact.companyId)}
        fieldDefs={directory.bundle.fieldDefs}
        rollup={hub.rollup}
        hubStatus={hub.hubStatus}
        activity={hub.activity}
        canEdit={canEdit}
        currentUserId={userId ?? null}
        runtime={runtime}
        workspaceId={ws}
        onSaveDetails={(patch) => void saveDetails(selectedContact.id, patch)}
        onToggleFavorite={() => void toggleFavorite(selectedContact)}
        onDelete={() => void deleteContact(selectedContact.id)}
        onShare={() => shareVCard(selectedContact)}
        onAddFollowup={() => void addFollowup(selectedContact.id, selectedContact.name)}
        onLink={(candidate) => void linkExisting(selectedContact.id, candidate)}
        onSetCompany={(candidate) => void setCompany(selectedContact.id, candidate)}
        onAddField={(label, type) => void addFieldDef(label, type)}
        onDeleteField={(fieldId) => void deleteFieldDef(fieldId)}
        onOpenEntity={openEntity}
        onChangeKind={(link, kind) => void changeKind(link, kind)}
        onUnlink={(link) => void unlink(link)}
        onRetry={hub.reload}
        onLinked={reload}
      />
    );
  } else if (selectedCompany) {
    center = (
      <CompanyHub
        company={selectedCompany}
        rollup={companyHub.rollup}
        status={companyHub.status}
        activity={companyHub.activity}
        canEdit={canEdit}
        currentUserId={userId ?? null}
        onSaveDetails={(patch) =>
          void runtime!.contacts
            .setCompanyDetails({ workspaceId: ws, companyId: selectedCompany.id, patch })
            .then(() => directory.reload())
            .catch((err) => toast.error("Couldn’t save company", { description: err instanceof Error ? err.message : undefined }))
        }
        onOpenEntity={openEntity}
        onRetry={companyHub.reload}
      />
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
            toast.success("Contacts imported", { description: parts.length ? parts.join(" · ") : "Nothing to import." });
          }}
        />
      ) : null}
      {canEdit ? (
        <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} mode="create" onSubmit={submitNewContact} />
      ) : null}
    </>
  );
}
