// Contacts (light CRM) — the directory + ContactHub/CompanyHub page
// (specs/contacts.md blocks CO-2 + CO-4). The rename destination of `/crm`,
// composing the 3-pane shell: the people+companies directory (left), the
// auto-rollup hub (center), and the context strip (right: suggestions + quick
// actions, CO-4).
//
// Contacts rides the Tasks permission lane at alpha (CO-1 decision a), so render
// + edit gate on `modulePermissions.tasks` until a dedicated lane lands.

import { useMemo, useState, type ReactNode } from "react";
import { Contact as ContactIcon } from "lucide-react";
import { toast } from "sonner";

import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { EmptyState } from "../../components/ui/empty-state";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import type { EntityLink, EntityRef, RelationKind } from "../../lib/entity-links";
import type { MentionCandidate } from "../../features/spine/mention";
import "../../features/contacts/projectors";
import { useContactsDirectory } from "../../features/contacts/hooks/use-contacts-directory";
import { useContactHub } from "../../features/contacts/hooks/use-contact-hub";
import { useCompanyHub } from "../../features/contacts/hooks/use-company-hub";
import { buildFollowupTask, followupLinkArgs } from "../../features/contacts/followup";
import {
  ContactDirectory,
  type DirectorySelection,
} from "../../features/contacts/ui/contact-directory";
import { ContactHub } from "../../features/contacts/ui/contact-hub";
import { CompanyHub } from "../../features/contacts/ui/company-hub";
import { ContactContextStrip } from "../../features/contacts/ui/contact-context-strip";
import { ContactImportDialog } from "../../features/contacts/ui/contact-import-dialog";
import {
  ContactFormDialog,
  type ContactFormValues,
} from "../../features/contacts/ui/contact-form-dialog";

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
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");

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
  // A company's denormalized members (works-at-only people are unioned in the hook).
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

  // Create or edit a contact via the form dialog. Throws on failure so the
  // dialog surfaces the error inline (and stays open).
  async function submitContactForm(values: ContactFormValues) {
    if (formMode === "create") {
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
    } else if (selectedContact) {
      const id = selectedContact.id;
      await runtime!.contacts.updateContact({
        workspaceId: ws,
        contactId: id,
        name: values.name,
        email: values.email || null,
        phone: values.phone || null,
        title: values.title || null,
      });
      if (values.status !== selectedContact.status) {
        await runtime!.contacts.setStatus({ workspaceId: ws, contactId: id, status: values.status });
      }
      directory.reload();
      hub.reload();
    }
  }

  const formInitial: Partial<ContactFormValues> | undefined =
    formMode === "edit" && selectedContact
      ? {
          name: selectedContact.name,
          email: selectedContact.email ?? "",
          phone: selectedContact.phone ?? "",
          title: selectedContact.title ?? "",
          status: selectedContact.status,
        }
      : undefined;

  // ── CO-4 actions (a contact is selected) ────────────────────────────────────
  async function addFollowup(contactId: string, contactName: string) {
    try {
      const inbox = await runtime!.tasks.seedInbox(ws);
      const task = await runtime!.tasks.upsertTask(
        buildFollowupTask({ workspaceId: ws, bucketId: inbox.id, contactName }),
      );
      const args = followupLinkArgs({ type: "contact", id: contactId }, task.id);
      await runtime!.contacts.link({
        workspaceId: ws,
        contact: args.contact,
        target: args.target,
        relationKind: args.relationKind,
        origin: args.origin,
        targetLabel: task.title,
      });
      hub.reload();
      directory.reload();
      toast.success("Follow-up added", { description: task.title });
    } catch (err) {
      toast.error("Couldn’t add follow-up", { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function linkExisting(contactId: string, candidate: MentionCandidate) {
    if (candidate.kind !== "entity") return; // create-and-link is the @mention path's job
    try {
      await runtime!.contacts.link({
        workspaceId: ws,
        contact: { type: "contact", id: contactId },
        target: candidate.ref,
        relationKind: "references",
        origin: "manual",
        targetLabel: candidate.label,
        targetIcon: candidate.icon,
      });
      hub.reload();
      directory.reload();
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
        return; // person candidates aren't companies
      }
      // The works-at link is canonical; company_id is the denormalized convenience.
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
      hub.reload();
      directory.reload();
      toast.success("Company set", { description: label });
    } catch (err) {
      toast.error("Couldn’t set company", { description: err instanceof Error ? err.message : undefined });
    }
  }

  const left = (
    <ContactDirectory
      contacts={directory.bundle.contacts}
      companies={directory.bundle.companies}
      status={directory.status}
      selected={selected}
      onSelect={setSelected}
      onNew={
        canEdit
          ? () => {
              setFormMode("create");
              setFormOpen(true);
            }
          : undefined
      }
      onImport={canEdit ? () => setImportOpen(true) : undefined}
      onRetry={directory.reload}
    />
  );

  let center: ReactNode;
  let right: ReactNode;
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
        onEdit={() => {
          setFormMode("edit");
          setFormOpen(true);
        }}
        onOpenEntity={openEntity}
        onChangeKind={(link, kind) => void changeKind(link, kind)}
        onUnlink={(link) => void unlink(link)}
        onRetry={hub.reload}
      />
    );
    right = (
      <ContactContextStrip
        runtime={runtime}
        workspaceId={ws}
        contact={selectedContact}
        canEdit={canEdit}
        onLinked={() => {
          hub.reload();
          directory.reload();
        }}
        onAddFollowup={() => void addFollowup(selectedContact.id, selectedContact.name)}
        onLink={(candidate) => void linkExisting(selectedContact.id, candidate)}
        onSetCompany={(candidate) => void setCompany(selectedContact.id, candidate)}
      />
    );
  } else if (selectedCompany) {
    center = (
      <CompanyHub
        company={selectedCompany}
        rollup={companyHub.rollup}
        status={companyHub.status}
        activity={companyHub.activity}
        currentUserId={userId ?? null}
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
      <FeaturePanelsShell feature="contacts" left={left} center={center} right={right} hideRight={!right} />
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
      {canEdit ? (
        <ContactFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          mode={formMode}
          initial={formInitial}
          onSubmit={submitContactForm}
        />
      ) : null}
    </>
  );
}
