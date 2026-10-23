// The great moment (EM-8): convert a thread → a task + contact context, plus
// "Add as contact" and "Make a task" from the Follow-ups list. The sequence is
// non-atomic (separate RPCs), so each step is tracked and a failure compensates.

import { useCallback } from "react";
import { toast } from "sonner";

import type { EmailThreadRef } from "../../../lib/runtime.types";
import type { useAuth } from "../../../providers/auth-provider";
import type { Contact } from "../../contacts/model";
import { endPosition, makeTask } from "../../tasks/helpers";
import type { Bucket } from "../../tasks/model";
import {
  buildConvertDescription,
  cleanTaskTitle,
  resolveContactIdByAddress,
  spawnedFromLinkArgs,
} from "../convert";
import { TRIAGE_UNDO_MS, type useEmailModule } from "../hooks/use-email-module";
import type { EmailThread } from "../model/email-types";
import { buildRefUpsertArgs } from "../refs";
import type { PanelVariantId } from "./email-page-types";

/** The registry args that upsert a thread's `email_thread` ref. */
export function refArgsForThread(thread: EmailThread) {
  return buildRefUpsertArgs({
    threadKey: thread.threadId,
    accountId: thread.accountId,
    fromAddr: thread.fromEmail || null,
    fromName: thread.fromName || null,
    subject: thread.subject || null,
    snippet: thread.snippet || null,
    sentAt: Number.isFinite(thread.timestampMs) ? new Date(thread.timestampMs).toISOString() : null,
  });
}

type Input = {
  runtime: ReturnType<typeof useAuth>["runtime"];
  workspaceId: string | null;
  email: ReturnType<typeof useEmailModule>;
  tasksInbox: Bucket | null;
  reloadTasks: () => Promise<unknown> | unknown;
  contacts: Contact[];
  setContacts: (update: (prev: Contact[]) => Contact[]) => void;
  contactIndex: { id: string; emails: string[] }[];
  selectedThread: EmailThread | null;
  selectedThreadId: string | null;
  setSelectedThreadId: (id: string | null) => void;
  setDetailTaskId: (id: string | null) => void;
  setPanelVariant: (variant: PanelVariantId) => void;
};

export function useEmailConvert({
  runtime,
  workspaceId,
  email,
  tasksInbox,
  reloadTasks,
  contacts,
  setContacts,
  contactIndex,
  selectedThread,
  selectedThreadId,
  setSelectedThreadId,
  setDetailTaskId,
  setPanelVariant,
}: Input) {
  /**
   * Best-effort reverse teardown of everything a convert created — shared by
   * the undo toast AND the mid-sequence failure compensation (DF-6) so the two
   * paths can't drift. Each step is individually best-effort (a failed task
   * delete doesn't stop the link/ref cleanup). Only removes the ref/contact
   * link when THIS convert created them.
   */
  const deleteConvertArtifacts = useCallback(
    async (plan: {
      taskId: string | null;
      spawnLinkId: string | null;
      contactLinkId: string | null;
      refId: string | null;
      refCreated: boolean;
    }) => {
      if (!runtime || !workspaceId) return;
      if (plan.taskId) {
        await runtime.tasks.deleteTask({ workspaceId, taskId: plan.taskId }).catch(() => {});
      }
      if (plan.spawnLinkId) {
        await runtime.spine.deleteLink({ workspaceId, linkId: plan.spawnLinkId }).catch(() => {});
      }
      if (plan.contactLinkId) {
        await runtime.spine.deleteLink({ workspaceId, linkId: plan.contactLinkId }).catch(() => {});
      }
      if (plan.refId && plan.refCreated) {
        await runtime.email.removeRef({ workspaceId, refId: plan.refId }).catch((err) => {
          // Best-effort: the ref is linkless by now, so a failure here only leaves a
          // stray tissue row — never block the undo. (`email_op_ref_remove` was
          // undeployed until OPS-1 applied it 2026-07-29; this catch is now purely
          // defensive, so warn rather than swallow — a silent failure is invisible.)
          console.warn("email: convert-undo could not remove the ref", err);
        });
      }
    },
    [runtime, workspaceId],
  );

  const undoConvert = useCallback(
    async (plan: {
      taskId: string;
      refId: string;
      refCreated: boolean;
      spawnLinkId: string | null;
      contactLinkId: string | null;
    }) => {
      await deleteConvertArtifacts(plan);
      setDetailTaskId(null);
      setPanelVariant("reader");
      void reloadTasks();
      void email.refreshTissue();
    },
    [deleteConvertArtifacts, reloadTasks, email],
  );

  const runConvert = useCallback(
    async (thread: EmailThread) => {
      if (!runtime || !workspaceId) return;
      const inbox = tasksInbox;
      if (!inbox) {
        toast.error("Your Tasks inbox isn't ready yet.");
        return;
      }
      // DF-6: the sequence is non-atomic (separate RPCs) — track what each step
      // created so a mid-sequence failure can compensate instead of stranding
      // an orphan task/ref in another module.
      const refExisted = email.tissueRefs.some((r) => r.threadKey === thread.threadId);
      let createdRefId: string | null = null;
      let createdTaskId: string | null = null;
      let createdSpawnLinkId: string | null = null;
      let createdContactLinkId: string | null = null;
      try {
        const ref = await runtime.email.upsertRef({ workspaceId, ...refArgsForThread(thread) });
        createdRefId = ref.id;

        const title = cleanTaskTitle(thread.subject);
        const task = makeTask({
          workspaceId,
          bucketId: inbox.id,
          title,
          description: buildConvertDescription({
            snippet: thread.snippet,
            subject: thread.subject,
            refId: ref.id,
          }),
          position: endPosition([]),
        });
        const saved = await runtime.tasks.upsertTask(task);
        createdTaskId = saved.id;

        // task --spawned-from--> email_thread
        const spawn = await runtime.spine.createLink({
          workspaceId,
          ...spawnedFromLinkArgs({
            taskId: saved.id,
            taskTitle: title,
            refId: ref.id,
            subject: thread.subject,
          }),
        });
        createdSpawnLinkId = spawn?.id ?? null;

        // email_thread --references--> contact (when the sender is a known contact)
        const contactId = resolveContactIdByAddress(thread.fromEmail ?? null, contactIndex);
        if (contactId) {
          // email_op_link is idempotent (returns a PRE-EXISTING row) — so only mark
          // the contact link for undo when THIS convert actually creates it, or
          // undo would silently delete a link the user made earlier.
          let alreadyLinked = false;
          try {
            const existing = await runtime.spine.listLinks({
              workspaceId,
              entityType: "email_thread",
              entityId: ref.id,
            });
            alreadyLinked = existing.some(
              (l) =>
                (l.targetType === "contact" && l.targetId === contactId) ||
                (l.sourceType === "contact" && l.sourceId === contactId),
            );
          } catch {
            // Can't tell → err toward NOT deleting on undo.
            alreadyLinked = true;
          }
          const link = (await runtime.email.linkThread({
            workspaceId,
            threadId: ref.id,
            targetType: "contact",
            targetId: contactId,
            relationKind: "references",
            origin: "manual",
            threadLabel: thread.subject,
            targetLabel: contacts.find((c) => c.id === contactId)?.name ?? null,
          })) as { id?: string } | null;
          createdContactLinkId = alreadyLinked ? null : (link?.id ?? null);
        }

        setDetailTaskId(saved.id);
        setPanelVariant("task");
        void reloadTasks();
        void email.refreshTissue();

        const plan = {
          taskId: saved.id,
          refId: ref.id,
          refCreated: !refExisted,
          spawnLinkId: spawn?.id ?? null,
          contactLinkId: createdContactLinkId,
        };
        toast("Task created", {
          duration: TRIAGE_UNDO_MS,
          action: { label: "Undo", onClick: () => void undoConvert(plan) },
          cancel: {
            label: "Also mark done",
            onClick: () => {
              const undo = email.triage(thread, "archive");
              if (selectedThreadId === thread.threadId) setSelectedThreadId(null);
              toast("Done", {
                duration: TRIAGE_UNDO_MS,
                action: { label: "Undo", onClick: undo },
              });
            },
          },
        });
      } catch (e) {
        // DF-6: compensate — tear down whatever this convert managed to create
        // so a partial failure leaves nothing behind in Tasks or the spine.
        await deleteConvertArtifacts({
          taskId: createdTaskId,
          spawnLinkId: createdSpawnLinkId,
          contactLinkId: createdContactLinkId,
          refId: createdRefId,
          refCreated: !refExisted,
        });
        void reloadTasks();
        void email.refreshTissue();
        toast.error(e instanceof Error ? e.message : "Couldn't convert to a task.");
      }
    },
    [
      runtime,
      workspaceId,
      tasksInbox,
      reloadTasks,
      email,
      contactIndex,
      contacts,
      refArgsForThread,
      undoConvert,
      deleteConvertArtifacts,
      selectedThreadId,
    ],
  );

  const addAsContact = useCallback(
    async (name: string, address: string) => {
      if (!runtime || !workspaceId) return;
      try {
        const contact = await runtime.contacts.createContact({
          workspaceId,
          name: name.trim() || address,
          email: address,
        });
        setContacts((prev) => [...prev, contact]);
        const thread = selectedThread;
        if (thread) {
          const ref = await runtime.email.upsertRef({ workspaceId, ...refArgsForThread(thread) });
          await runtime.email.linkThread({
            workspaceId,
            threadId: ref.id,
            targetType: "contact",
            targetId: contact.id,
            relationKind: "references",
            origin: "manual",
            threadLabel: thread.subject,
            targetLabel: contact.name,
          });
          void email.refreshTissue();
        }
        toast("Added to your contacts");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't add the contact.");
      }
    },
    [runtime, workspaceId, selectedThread, refArgsForThread, email],
  );

  // "Make a task" from the Follow-ups list (AC7). The ref already exists in the
  // tissue, so this creates the task + spawned-from link off ref.id directly.
  const makeTaskFromRef = useCallback(
    async (ref: EmailThreadRef) => {
      if (!runtime || !workspaceId) return;
      const inbox = tasksInbox;
      if (!inbox) {
        toast.error("Your Tasks inbox isn't ready yet.");
        return;
      }
      let createdTaskId: string | null = null;
      try {
        const title = cleanTaskTitle(ref.subject);
        const task = makeTask({
          workspaceId,
          bucketId: inbox.id,
          title,
          description: buildConvertDescription({
            snippet: ref.snippet,
            subject: ref.subject,
            refId: ref.id,
          }),
          position: endPosition([]),
        });
        const saved = await runtime.tasks.upsertTask(task);
        createdTaskId = saved.id;
        await runtime.spine.createLink({
          workspaceId,
          ...spawnedFromLinkArgs({
            taskId: saved.id,
            taskTitle: title,
            refId: ref.id,
            subject: ref.subject,
          }),
        });
        setDetailTaskId(saved.id);
        setPanelVariant("task");
        void reloadTasks();
        toast("Task created");
      } catch (e) {
        // DF-6: don't strand a linkless orphan task when the spawn link fails.
        // The ref pre-existed here (it came from the tissue), so never remove it.
        if (createdTaskId) {
          await deleteConvertArtifacts({
            taskId: createdTaskId,
            spawnLinkId: null,
            contactLinkId: null,
            refId: null,
            refCreated: false,
          });
          void reloadTasks();
        }
        toast.error(e instanceof Error ? e.message : "Couldn't convert to a task.");
      }
    },
    [runtime, workspaceId, tasksInbox, reloadTasks, deleteConvertArtifacts],
  );

  return { runConvert, addAsContact, makeTaskFromRef };
}
