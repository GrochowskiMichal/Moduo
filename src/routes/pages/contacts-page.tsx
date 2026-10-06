// Contacts (light CRM) — the directory + ContactHub/CompanyHub page
// (specs/contacts.md + specs/contacts-v2.md). Composes the 3-pane shell: the
// people+companies directory (left) and the iOS-style inline-edit contact card
// (center). v2 moved all contact controls onto the card itself — there is no
// essential right panel (it reverts to optional cross-module context).
//
// Contacts rides the Tasks permission lane at alpha, so render + edit gate on
// `modulePermissions.tasks` until a dedicated lane lands.

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Contact as ContactIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { onCreateNew } from "../../components/app/create-events";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { truncationNotice } from "../../components/app/truncation-notice";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { EmptyState } from "../../components/ui/empty-state";
import type { ContactsSearch } from "../../features/contacts/search";
import { coerceKindForPair } from "../../features/spine/kind-constraints";
import type { MentionCandidate } from "../../features/spine/mention";
import { entityRefKey } from "../../features/spine/rollup";
import { createLinkWithToast } from "../../features/spine/ui/drop-link-toast";
import {
  asDragPayload,
  asDropLinkTarget,
  isSelfDrop,
  payloadRef,
  targetAccepts,
} from "../../lib/drag-payload";
import type { EntityLink, EntityRef, RelationKind } from "../../lib/entity-links";
import { ENTITY_OPEN_EVENT } from "../../lib/entity-open";
import type { ContactDetailsPatch } from "../../lib/runtime.types";
import { undoToast } from "../../lib/undo-toast";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import "../../features/contacts/projectors";
import {
  RightPanelSwitcher,
  type RightPanelVariant,
} from "../../components/app/right-panel-switcher";
import { buildFollowupTask, followupLinkArgs } from "../../features/contacts/followup";
import { useCompanyHub } from "../../features/contacts/hooks/use-company-hub";
import { useContactHub } from "../../features/contacts/hooks/use-contact-hub";
import { useContactsDirectory } from "../../features/contacts/hooks/use-contacts-directory";
import { useDirectoryTags } from "../../features/contacts/hooks/use-directory-tags";
import type { Contact, ContactFieldType } from "../../features/contacts/model";
import { channelsFromValues } from "../../features/contacts/parse-contact";
import {
  CompanyFormDialog,
  type CompanyFormValues,
} from "../../features/contacts/ui/company-form-dialog";
import { CompanyHub } from "../../features/contacts/ui/company-hub";
import {
  ContactDirectory,
  type DirectorySelection,
} from "../../features/contacts/ui/contact-directory";
import {
  ContactFormDialog,
  type ContactFormValues,
} from "../../features/contacts/ui/contact-form-dialog";
import { ContactHub } from "../../features/contacts/ui/contact-hub";
import { ContactImportDialog } from "../../features/contacts/ui/contact-import-dialog";
import { HubDropZone } from "../../features/contacts/ui/hub-drop-zone";
import { contactToVCard } from "../../features/contacts/vcard";
import { LinkedNotesPanel } from "../../features/notes/ui/linked-notes-panel";

function openEntity(ref: EntityRef) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ENTITY_OPEN_EVENT, { detail: { type: ref.type, id: ref.id } }),
  );
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
  const permission = modulePermissions.contacts;
  const canEdit = permission === "edit" || permission === "admin";

  const workspaceId = selectedWorkspaceId ?? null;
  const directory = useContactsDirectory(runtime, workspaceId);
  const directoryTags = useDirectoryTags(runtime, workspaceId);
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [companyFormOpen, setCompanyFormOpen] = useState(false);
  // A preset company for the "+ Add person" flow from a company page (FX-7).
  const [formCompanyPreset, setFormCompanyPreset] = useState<{ id: string; name: string } | null>(
    null,
  );
  // Company delete confirms first ("N people work here") — no restore op yet (DF-5).
  const [companyDeleteId, setCompanyDeleteId] = useState<string | null>(null);

  // Selection lives in the URL (FX-1 AC1): refresh keeps your place, back/
  // forward walk selection history, and deep links are shareable. strict:false
  // because the route id sits under the pathless app-gate parent.
  const search = useSearch({ strict: false }) as ContactsSearch;
  const navigate = useNavigate();
  const selected = useMemo<DirectorySelection | null>(
    () => (search.type && search.id ? { type: search.type, id: search.id } : null),
    [search.type, search.id],
  );
  const setSelected = useCallback(
    (sel: DirectorySelection | null, opts?: { replace?: boolean }) => {
      void navigate({
        to: "/contacts",
        search: sel ? { type: sel.type, id: sel.id } : {},
        replace: opts?.replace ?? false,
      });
    },
    [navigate],
  );

  const selectedContact =
    selected?.type === "contact"
      ? (directory.bundle.contacts.find((c) => c.id === selected.id) ?? null)
      : null;
  const selectedCompany =
    selected?.type === "company"
      ? (directory.bundle.companies.find((c) => c.id === selected.id) ?? null)
      : null;

  const contactFocus = useMemo<EntityRef | null>(
    () => (selectedContact ? { type: "contact", id: selectedContact.id } : null),
    [selectedContact],
  );
  const companyFocus = useMemo<EntityRef | null>(
    () => (selectedCompany ? { type: "company", id: selectedCompany.id } : null),
    [selectedCompany],
  );
  const companyMembers = useMemo(
    () =>
      selectedCompany
        ? directory.bundle.contacts.filter((c) => c.companyId === selectedCompany.id)
        : [],
    [selectedCompany, directory.bundle.contacts],
  );

  const hub = useContactHub(runtime, workspaceId, contactFocus);
  const companyHub = useCompanyHub(runtime, workspaceId, companyFocus, companyMembers);

  // Lookup for enriching linked-people rows (status/avatar) on the contact hub (FX-5).
  const contactsById = useMemo(
    () => new Map(directory.bundle.contacts.map((c) => [c.id, c])),
    [directory.bundle.contacts],
  );

  // Drag-to-link (FX-9): a small pointer-activation distance so a click still
  // selects; the contact hub's direct-link keys back the drop duplicate guard.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const contactDirectLinkKeys = useMemo(
    () => new Set(hub.rollup.sections.flatMap((s) => s.rows).map((r) => entityRefKey(r.other))),
    [hub.rollup.sections],
  );

  // Palette entries land here carrying ?action=new|import (FX-1 AC2): open the
  // dialog once, then clear the param (replace — no extra history entry).
  useEffect(() => {
    if (!search.action) return;
    if (canEdit) {
      if (search.action === "new") {
        setFormCompanyPreset(null);
        setFormOpen(true);
      } else setImportOpen(true);
    } else {
      // Don't swallow the palette command silently for view-only members.
      toast("You don't have edit access to contacts in this workspace");
    }
    void navigate({
      to: "/contacts",
      search: selected ? { type: selected.type, id: selected.id } : {},
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.action]);

  // ⌘N / global "+" → new contact dialog (this listener is only mounted on
  // /contacts). We're already here, so open the dialog directly rather than the
  // palette's ?action=new round-trip. No-ops for view-only members.
  useEffect(
    () =>
      onCreateNew(() => {
        if (!canEdit) return;
        setFormCompanyPreset(null);
        setFormOpen(true);
      }),
    [canEdit],
  );

  // A URL id that never resolves (deleted contact, stale share link) clears
  // after a short grace window — delayed so a just-created contact's directory
  // reload can land first instead of being misread as missing.
  useEffect(() => {
    if (directory.status !== "ready" || !selected) return;
    const exists =
      selected.type === "contact"
        ? directory.bundle.contacts.some((c) => c.id === selected.id)
        : directory.bundle.companies.some((c) => c.id === selected.id);
    if (exists) return;
    const timer = window.setTimeout(() => {
      toast(`That ${selected.type === "contact" ? "contact" : "company"} no longer exists`);
      void navigate({ to: "/contacts", search: {}, replace: true });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [directory.status, directory.bundle, selected, navigate]);

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
    companyId ? (directory.bundle.companies.find((c) => c.id === companyId)?.name ?? null) : null;

  const reload = () => {
    directory.reload();
    hub.reload();
  };

  async function saveDetails(contactId: string, patch: ContactDetailsPatch) {
    try {
      await runtime!.contacts.setContactDetails({ workspaceId: ws, contactId, patch });
      reload();
    } catch (err) {
      toast.error("Couldn’t save changes", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function toggleFavorite(c: Contact) {
    try {
      await runtime!.contacts.setFavorite({
        workspaceId: ws,
        contactId: c.id,
        value: !c.isFavorite,
      });
      directory.reload();
    } catch (err) {
      toast.error("Couldn’t update favorite", {
        description: err instanceof Error ? err.message : undefined,
      });
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
      toast.error("Couldn’t change the relation", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function unlink(link: EntityLink) {
    try {
      await runtime!.spine.deleteLink({ workspaceId: ws, linkId: link.id });
      hub.reload();
    } catch (err) {
      toast.error("Couldn’t remove the link", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  // Optimistic header status change (FX-4 AC5) — rethrow so the hub's pill can
  // roll back on failure; the page owns the toast.
  async function setStatus(contactId: string, status: string) {
    try {
      await runtime!.contacts.setContactDetails({ workspaceId: ws, contactId, patch: { status } });
      directory.reload();
      hub.reload();
    } catch (err) {
      toast.error("Couldn’t change status", {
        description: err instanceof Error ? err.message : undefined,
      });
      throw err;
    }
  }

  async function submitNewContact(values: ContactFormValues, opts: { addAnother: boolean }) {
    // Resolve the chosen company: an existing id, or create one (FX-6 AC9).
    let companyId: string | null = null;
    let companyLabel: string | null = null;
    if (values.company && "id" in values.company) {
      companyId = values.company.id;
      companyLabel = values.company.name;
    } else if (values.company && "createName" in values.company) {
      const co = await runtime!.contacts.createCompany({
        workspaceId: ws,
        name: values.company.createName,
      });
      companyId = co.id;
      companyLabel = co.name;
    }

    const created = await runtime!.contacts.createContact({
      workspaceId: ws,
      name: values.name,
      email: values.emails[0] ?? null,
      phone: values.phones[0] ?? null,
      title: values.title || null,
      companyId,
      status: values.status,
    });

    // The contact now exists — the enrichment steps (extra emails/phones, the
    // canonical works-at edge) are best-effort: a hiccup here must NOT throw the
    // whole submit (that would leave a created contact behind + the user retries
    // → a duplicate). Surface a soft toast and keep the created contact.
    try {
      // Multi-value paste: patch the full email/phone lists onto the new contact.
      if (values.emails.length > 1 || values.phones.length > 1) {
        await runtime!.contacts.setContactDetails({
          workspaceId: ws,
          contactId: created.id,
          patch: {
            emails: channelsFromValues(values.emails),
            phones: channelsFromValues(values.phones),
          },
        });
      }
      // The canonical works-at edge (mirrors setCompany's dual-write) so a
      // contact with a company always has the spine link, not just the FK.
      if (companyId) {
        await runtime!.contacts.link({
          workspaceId: ws,
          contact: { type: "contact", id: created.id },
          target: { type: "company", id: companyId },
          relationKind: "works-at",
          origin: "manual",
          targetLabel: companyLabel ?? undefined,
          targetIcon: "building-2",
        });
      }
    } catch (err) {
      toast.error("Contact added, but some details didn’t save", {
        description: err instanceof Error ? err.message : undefined,
      });
    }

    directory.reload();
    if (!opts.addAnother) setSelected({ type: "contact", id: created.id });
  }

  async function submitNewCompany(values: CompanyFormValues) {
    const created = await runtime!.contacts.createCompany({
      workspaceId: ws,
      name: values.name,
      website: values.website || null,
      domains: values.domains,
    });
    directory.reload();
    setSelected({ type: "company", id: created.id });
  }

  async function addFollowup(focus: EntityRef, name: string) {
    try {
      const inbox = await runtime!.tasks.seedInbox(ws);
      const task = await runtime!.tasks.upsertTask(
        buildFollowupTask({ workspaceId: ws, bucketId: inbox.id, contactName: name }),
      );
      const args = followupLinkArgs(focus, task.id);
      await runtime!.contacts.link({
        workspaceId: ws,
        contact: args.contact,
        target: args.target,
        relationKind: args.relationKind,
        origin: args.origin,
        targetLabel: task.title,
      });
      reloadFocus(focus);
      toast("Follow-up added", { description: task.title });
    } catch (err) {
      toast.error("Couldn’t add follow-up", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function linkExisting(focus: EntityRef, candidate: MentionCandidate) {
    if (candidate.kind !== "entity") return;
    try {
      await runtime!.contacts.link({
        workspaceId: ws,
        contact: focus,
        target: candidate.ref,
        // works-at only survives a contact↔company pair; anything else → references.
        relationKind: coerceKindForPair("works-at", focus.type, candidate.ref.type),
        origin: "manual",
        targetLabel: candidate.label,
        targetIcon: candidate.icon,
      });
      reloadFocus(focus);
    } catch (err) {
      toast.error("Couldn’t add the link", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  /** Reload the hub whose entity a write touched (contact vs company). */
  function reloadFocus(focus: EntityRef) {
    directory.reload();
    if (focus.type === "company") companyHub.reload();
    else hub.reload();
  }

  // Drag-to-link (FX-9, AC12): a directory row dropped on the selected hub links
  // it to that entity via the CT-3 spine machinery (origin='drag', resolveKind,
  // Undo/override toast). Self-drops and already-linked pairs are rejected with
  // a toast — never a silent no-op or a misleading "Undo" on a pre-existing edge.
  function onDragEnd(event: DragEndEvent) {
    if (!canEdit || !runtime || !workspaceId) return;
    const payload = asDragPayload(event.active.data.current);
    const target = asDropLinkTarget(event.over?.data.current);
    if (!payload || !target) return;
    if (isSelfDrop(payload, target)) {
      toast("You can’t link something to itself");
      return;
    }
    if (!targetAccepts(target, payload)) return;
    const sourceKey = entityRefKey(payloadRef(payload));
    const linkedKeys =
      target.entityType === "company" ? companyHub.directLinkKeys : contactDirectLinkKeys;
    if (linkedKeys.has(sourceKey)) {
      toast("Already linked");
      return;
    }
    void (async () => {
      const created = await createLinkWithToast({
        runtime,
        workspaceId,
        source: payload,
        target,
        onChanged: () => reloadFocus({ type: target.entityType, id: target.entityId }),
      });
      // A person↔company works-at drop also sets the denormalized company_id FK
      // (mirrors setCompany's dual-write) so the contact's header company chip
      // reflects it, not just the spine edge. Best-effort — the link already exists.
      if (created?.relationKind === "works-at") {
        const contactId =
          payload.entityType === "contact"
            ? payload.entityId
            : target.entityType === "contact"
              ? target.entityId
              : null;
        const companyId =
          payload.entityType === "company"
            ? payload.entityId
            : target.entityType === "company"
              ? target.entityId
              : null;
        if (contactId && companyId) {
          try {
            await runtime.contacts.updateContact({
              workspaceId,
              contactId,
              setCompany: { companyId },
            });
            reloadFocus({ type: "contact", id: contactId });
          } catch {
            /* the link is what matters; the FK is a convenience */
          }
        }
      }
    })();
  }

  function addPersonToCompany(company: { id: string; name: string }) {
    setFormCompanyPreset(company);
    setFormOpen(true);
  }

  // Company delete is guarded by a confirm ("N people work here") because it
  // has no restore op yet — the confirm is the safety, not an Undo (DF-5).
  async function performCompanyDelete(companyId: string) {
    try {
      await runtime!.contacts.deleteCompany({ workspaceId: ws, companyId });
      setSelected(null, { replace: true });
      directory.reload();
      toast("Company deleted");
    } catch (err) {
      toast.error("Couldn’t delete the company", {
        description: err instanceof Error ? err.message : undefined,
      });
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
        const company = await runtime!.contacts.createCompany({
          workspaceId: ws,
          name: candidate.label,
        });
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
      await runtime!.contacts.updateContact({
        workspaceId: ws,
        contactId,
        setCompany: { companyId: companyRef.id },
      });
      reload();
      toast("Company set", { description: label });
    } catch (err) {
      toast.error("Couldn’t set company", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function clearCompany(contact: Contact) {
    const companyId = contact.companyId;
    if (!companyId) return;
    const label = companyNameFor(companyId);
    try {
      // The dual-write in reverse (gotchas §Drag-to-link): drop the canonical
      // works-at edge(s) AND the denormalized FK, or the chip resurrects.
      const links = await runtime!.spine.listLinks({
        workspaceId: ws,
        entityType: "contact",
        entityId: contact.id,
      });
      const workAt = links.filter(
        (l) =>
          l.relationKind === "works-at" &&
          ((l.sourceType === "company" && l.sourceId === companyId) ||
            (l.targetType === "company" && l.targetId === companyId)),
      );
      await Promise.all(
        workAt.map((l) => runtime!.spine.deleteLink({ workspaceId: ws, linkId: l.id })),
      );
      await runtime!.contacts.updateContact({
        workspaceId: ws,
        contactId: contact.id,
        setCompany: { companyId: null },
      });
      reload();
      undoToast("Company removed", {
        description: label ?? undefined,
        onUndo: () => {
          void (async () => {
            // Same dual-write as Set company; the link create is idempotent.
            await runtime!.contacts.link({
              workspaceId: ws,
              contact: { type: "contact", id: contact.id },
              target: { type: "company", id: companyId },
              relationKind: "works-at",
              origin: "manual",
              targetLabel: label ?? undefined,
              targetIcon: "building-2",
            });
            await runtime!.contacts.updateContact({
              workspaceId: ws,
              contactId: contact.id,
              setCompany: { companyId },
            });
            reload();
          })().catch((err) =>
            toast.error("Couldn’t restore the company", {
              description: err instanceof Error ? err.message : undefined,
            }),
          );
        },
      });
    } catch (err) {
      toast.error("Couldn’t remove the company", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function addFieldDef(label: string, type: ContactFieldType, options?: string[]) {
    const key =
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "field";
    try {
      await runtime!.contacts.addFieldDef({ workspaceId: ws, key, label, type, options });
      directory.reload();
    } catch (err) {
      toast.error("Couldn’t add field", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function deleteFieldDef(fieldId: string) {
    try {
      await runtime!.contacts.deleteFieldDef({ workspaceId: ws, fieldId });
      directory.reload();
    } catch (err) {
      toast.error("Couldn’t remove field", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function deleteContact(contactId: string) {
    const name = directory.bundle.contacts.find((c) => c.id === contactId)?.name;
    try {
      await runtime!.contacts.deleteContact({ workspaceId: ws, contactId });
      // replace — otherwise Back lands on the deleted contact's dead URL.
      setSelected(null, { replace: true });
      directory.reload();
      // The server delete is soft (links + registry revive with it) — Undo is
      // a real restore, not a client illusion (DF-5).
      undoToast("Contact deleted", {
        description: name,
        onUndo: () => {
          void (async () => {
            await runtime!.contacts.restoreContact({ workspaceId: ws, contactId });
            directory.reload();
            setSelected({ type: "contact", id: contactId });
          })().catch((err) =>
            toast.error("Couldn’t restore the contact", {
              description: err instanceof Error ? err.message : undefined,
            }),
          );
        },
      });
    } catch (err) {
      toast.error("Couldn’t delete the contact", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const left = (
    <ContactDirectory
      contacts={directory.bundle.contacts}
      companies={directory.bundle.companies}
      status={directory.status}
      selected={selected}
      workspaceTags={directoryTags.tags}
      tagLinks={directoryTags.links}
      onRefreshTags={directoryTags.reload}
      onSelect={setSelected}
      draggable={canEdit}
      onNew={
        canEdit
          ? () => {
              setFormCompanyPreset(null);
              setFormOpen(true);
            }
          : undefined
      }
      onNewCompany={canEdit ? () => setCompanyFormOpen(true) : undefined}
      onImport={canEdit ? () => setImportOpen(true) : undefined}
      onToggleFavorite={
        canEdit
          ? (id) => void toggleFavorite(directory.bundle.contacts.find((c) => c.id === id)!)
          : undefined
      }
      onRetry={directory.reload}
    />
  );

  let center: ReactNode;
  if (selectedContact) {
    center = (
      <HubDropZone target={{ type: "contact", id: selectedContact.id }} disabled={!canEdit}>
        <ContactHub
          contact={selectedContact}
          companyName={companyNameFor(selectedContact.companyId)}
          contactsById={contactsById}
          fieldDefs={directory.bundle.fieldDefs}
          rollup={hub.rollup}
          hubStatus={hub.hubStatus}
          activity={hub.activity}
          canEdit={canEdit}
          currentUserId={userId ?? null}
          runtime={runtime}
          workspaceId={ws}
          onSaveDetails={(patch) => void saveDetails(selectedContact.id, patch)}
          onSetStatus={(status) => setStatus(selectedContact.id, status)}
          onToggleFavorite={() => void toggleFavorite(selectedContact)}
          onDelete={() => void deleteContact(selectedContact.id)}
          onShare={() => shareVCard(selectedContact)}
          onAddFollowup={() =>
            void addFollowup({ type: "contact", id: selectedContact.id }, selectedContact.name)
          }
          onLink={(candidate) =>
            void linkExisting({ type: "contact", id: selectedContact.id }, candidate)
          }
          onSetCompany={(candidate) => void setCompany(selectedContact.id, candidate)}
          onClearCompany={
            selectedContact.companyId ? () => void clearCompany(selectedContact) : undefined
          }
          onAddField={(label, type, options) => void addFieldDef(label, type, options)}
          onDeleteField={(fieldId) => void deleteFieldDef(fieldId)}
          onOpenEntity={openEntity}
          onChangeKind={(link, kind) => void changeKind(link, kind)}
          onUnlink={(link) => void unlink(link)}
          onRetry={hub.reload}
          onLinked={reload}
        />
      </HubDropZone>
    );
  } else if (selectedCompany) {
    center = (
      <HubDropZone target={{ type: "company", id: selectedCompany.id }} disabled={!canEdit}>
        <CompanyHub
          company={selectedCompany}
          rollup={companyHub.rollup}
          status={companyHub.status}
          activity={companyHub.activity}
          runtime={runtime}
          workspaceId={ws}
          canEdit={canEdit}
          currentUserId={userId ?? null}
          onSaveDetails={(patch) =>
            void runtime!.contacts
              .setCompanyDetails({ workspaceId: ws, companyId: selectedCompany.id, patch })
              .then(() => directory.reload())
              .catch((err) =>
                toast.error("Couldn’t save company", {
                  description: err instanceof Error ? err.message : undefined,
                }),
              )
          }
          onOpenEntity={openEntity}
          onAddTask={() =>
            void addFollowup({ type: "company", id: selectedCompany.id }, selectedCompany.name)
          }
          onLink={(candidate) =>
            void linkExisting({ type: "company", id: selectedCompany.id }, candidate)
          }
          onAddPerson={() =>
            addPersonToCompany({ id: selectedCompany.id, name: selectedCompany.name })
          }
          onDelete={() => setCompanyDeleteId(selectedCompany.id)}
          onRetry={companyHub.reload}
        />
      </HubDropZone>
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

  // The "Notes" right-panel rail (NO-7b, AC8): linked notes + New-linked-note for
  // the selected contact/company. Contacts had no right panel before this — the
  // switcher is single-variant today, extension-ready per the IA principle.
  const railFocus = contactFocus ?? companyFocus;
  const railLabel = selectedContact?.name ?? selectedCompany?.name ?? undefined;
  const railIcon = selectedContact ? "contact" : selectedCompany ? "building-2" : null;
  const notesRailVariants: RightPanelVariant[] = railFocus
    ? [
        {
          id: "notes",
          label: "Notes",
          render: () => (
            <LinkedNotesPanel
              runtime={runtime}
              workspaceId={ws}
              focus={railFocus}
              focusLabel={railLabel}
              focusIcon={railIcon}
              canEdit={canEdit}
              onOpenNote={(id) => openEntity({ type: "note", id })}
              onLinked={() => {
                if (railFocus) reloadFocus(railFocus);
              }}
            />
          ),
        },
      ]
    : [];
  const right =
    railFocus && notesRailVariants.length > 0 ? (
      <RightPanelSwitcher variants={notesRailVariants} activeId="notes" onChange={() => {}} />
    ) : undefined;

  return (
    <>
      {/* DndContext scopes drag-to-link (FX-9): directory rows (drag sources) +
          the center hub (drop target) both sit inside it. pointerWithin only —
          an out-of-hub release is a no-op, never a stray link (gotchas). */}
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
        <FeaturePanelsShell
          feature="contacts"
          notice={truncationNotice([...directory.bundle.truncated, ...directoryTags.truncated])}
          left={left}
          center={center}
          right={right}
          hideRight={!right}
        />
      </DndContext>
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
            toast("Contacts imported", {
              description: parts.length ? parts.join(" · ") : "Nothing to import.",
            });
          }}
        />
      ) : null}
      {canEdit ? (
        <ContactFormDialog
          open={formOpen}
          onOpenChange={(open) => {
            setFormOpen(open);
            if (!open) setFormCompanyPreset(null);
          }}
          runtime={runtime}
          workspaceId={ws}
          existingContacts={directory.bundle.contacts}
          companies={directory.bundle.companies}
          initialCompany={formCompanyPreset}
          onSubmit={submitNewContact}
          onOpenExisting={(id) => setSelected({ type: "contact", id })}
        />
      ) : null}
      {canEdit ? (
        <CompanyFormDialog
          open={companyFormOpen}
          onOpenChange={setCompanyFormOpen}
          onSubmit={submitNewCompany}
        />
      ) : null}
      {(() => {
        // Company delete confirm — the guard names the people affected (DF-5).
        const target = companyDeleteId
          ? (directory.bundle.companies.find((c) => c.id === companyDeleteId) ?? null)
          : null;
        const memberCount = companyDeleteId
          ? directory.bundle.contacts.filter((c) => c.companyId === companyDeleteId).length
          : 0;
        return (
          <Dialog open={target !== null} onOpenChange={(open) => !open && setCompanyDeleteId(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Delete {target?.name || "this company"}?</DialogTitle>
                <DialogDescription>
                  {memberCount > 0
                    ? `${memberCount} ${memberCount === 1 ? "person works" : "people work"} here — they'll stay, but their company field clears. `
                    : ""}
                  Links to this company are removed. This can't be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setCompanyDeleteId(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    const id = companyDeleteId;
                    setCompanyDeleteId(null);
                    if (id) void performCompanyDelete(id);
                  }}
                >
                  Delete company
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </>
  );
}
