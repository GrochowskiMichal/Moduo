// Triage, snooze and follow-up handlers (EM-5, EM-6) — optimistic, each with an
// undo toast (the triage() undo-window contract), plus the pickers' open state.

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { EmailThreadRef } from "../../../lib/runtime.types";
import { TRIAGE_UNDO_MS, type useEmailModule } from "../hooks/use-email-module";
import type { EmailFolderInfo, EmailThread } from "../model/email-types";
import { formatSnoozeUntil } from "../snooze";

type Input = {
  email: ReturnType<typeof useEmailModule>;
  selectedThreadId: string | null;
  setSelectedThreadId: (id: string | null) => void;
};

export function useEmailTriageActions({ email, selectedThreadId, setSelectedThreadId }: Input) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeTarget, setSnoozeTarget] = useState<EmailThread | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpTarget, setFollowUpTarget] = useState<EmailThread | null>(null);

  const runArchive = useCallback(
    (thread: EmailThread) => {
      const undo = email.triage(thread, "archive");
      if (selectedThreadId === thread.threadId) setSelectedThreadId(null);
      toast("Done", {
        duration: TRIAGE_UNDO_MS,
        action: { label: "Undo", onClick: undo },
      });
    },
    [email, selectedThreadId],
  );

  const runDelete = useCallback(
    (thread: EmailThread) => {
      const undo = email.triage(thread, "delete");
      if (selectedThreadId === thread.threadId) setSelectedThreadId(null);
      toast("Deleted", {
        duration: TRIAGE_UNDO_MS,
        action: { label: "Undo", onClick: undo },
      });
    },
    [email, selectedThreadId],
  );

  const runMove = useCallback(
    (thread: EmailThread, folder: EmailFolderInfo) => {
      const undo = email.triage(thread, "move", folder.name);
      if (selectedThreadId === thread.threadId) setSelectedThreadId(null);
      toast(`Moved to ${folder.displayName || folder.name}`, {
        duration: TRIAGE_UNDO_MS,
        action: { label: "Undo", onClick: undo },
      });
    },
    [email, selectedThreadId],
  );

  // ── snooze + follow-up (EM-6) ──────────────────────────────────────────────
  const openSnooze = useCallback((thread: EmailThread) => {
    setSnoozeTarget(thread);
    setSnoozeOpen(true);
  }, []);

  const doSnooze = useCallback(
    (at: Date) => {
      const thread = snoozeTarget;
      if (!thread) return;
      const undo = email.snooze(thread, at);
      if (selectedThreadId === thread.threadId) setSelectedThreadId(null);
      toast(`Snoozed — returns ${formatSnoozeUntil(at.toISOString(), new Date())}`, {
        duration: TRIAGE_UNDO_MS,
        action: { label: "Undo", onClick: undo },
      });
    },
    [email, snoozeTarget, selectedThreadId],
  );

  const openFollowUp = useCallback((thread: EmailThread) => {
    setFollowUpTarget(thread);
    setFollowUpOpen(true);
  }, []);

  const doFollowUp = useCallback(
    (at: Date) => {
      const thread = followUpTarget;
      if (!thread) return;
      void email.setFollowUp(thread, at);
      toast(`Follow-up set — ${formatSnoozeUntil(at.toISOString(), new Date())}`);
    },
    [email, followUpTarget],
  );

  const unsnoozeRef = useCallback(
    (ref: EmailThreadRef) => {
      void email.unsnooze(ref);
      toast("Back in your inbox");
    },
    [email],
  );

  const clearFollowUpRef = useCallback(
    (ref: EmailThreadRef) => {
      void email.clearFollowUpFor(ref);
      toast("Follow-up cleared");
    },
    [email],
  );

  return {
    runArchive,
    runDelete,
    runMove,
    openSnooze,
    doSnooze,
    openFollowUp,
    doFollowUp,
    unsnoozeRef,
    clearFollowUpRef,
    snoozeOpen,
    setSnoozeOpen,
    followUpOpen,
    setFollowUpOpen,
  };
}
