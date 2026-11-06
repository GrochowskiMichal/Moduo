// The compose session (AC20–AC22): one compose is active at a time; switching
// to another saves the first as a draft. Every change saves the draft locally
// (the engine uploads it to the server Drafts folder after its 2 s debounce).
// Send queues it with the undo window; Undo cancels and reopens it, Edit does
// the same, and Done-on-send marks the thread Done when replying from the inbox.

import type {
  MailComposeEngine,
  MailDraftDoc,
  MailSendHandle,
} from "@/lib/runtime.types.mail-compose";

import { htmlToPlainText, splitAddresses } from "../compose";
import { checkSendSize } from "./size-limit";

export type ComposePlacement = "inline" | "pane";
export type ComposeKind = "new" | "reply" | "reply-all" | "forward";

export type ComposeState = {
  key: string;
  kind: ComposeKind;
  placement: ComposePlacement;
  accountId: string;
  threadId: string | null;
  draftId: string | null;
  fromAddr: string;
  fromName: string | null;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
  inReplyTo: string | null;
  references: string[];
  attachments: MailDraftDoc["attachments"];
  followUp: number | null;
  /** Opened from the inbox: Done-on-send applies (E48). */
  fromInbox: boolean;
  lastError: string | null;
};

export type ComposeOpenSpec = Omit<ComposeState, "key" | "draftId" | "followUp" | "lastError"> & {
  draftId?: string | null;
  lastError?: string | null;
};

export type ComposeDeps = {
  port: MailComposeEngine;
  settings: () => { undoSeconds: number; doneOnSend: boolean };
  /** Marks the thread Done (the triage command). */
  markDone: (threadId: string) => Promise<unknown> | void;
  /** Records the follow-up reminder on the thread. */
  setFollowUp?: (threadId: string, dueMs: number) => Promise<unknown> | void;
  /** Shows the undo-send toast; the callbacks are its Undo and Edit buttons. */
  showSent?: (
    handle: MailSendHandle,
    actions: { undo: () => void; edit: () => void },
    info: SentInfo,
  ) => void;
};

/** What the send did besides queueing, for the undo-send toast's copy (spec §5). */
export type SentInfo = {
  kind: ComposeKind;
  to: string;
  threadId: string | null;
  markedDone: boolean;
  followUpMs: number | null;
};

export type SendResult = { ok: true; handle: MailSendHandle } | { ok: false; reason: string };

let seq = 0;

export function toDraftDoc(s: ComposeState): MailDraftDoc {
  return {
    messageId: "",
    fromName: s.fromName,
    fromAddr: s.fromAddr,
    to: splitAddresses(s.to),
    cc: splitAddresses(s.cc),
    bcc: splitAddresses(s.bcc),
    subject: s.subject,
    text: htmlToPlainText(s.bodyHtml),
    html: s.bodyHtml,
    inReplyTo: s.inReplyTo,
    references: s.references,
    attachments: s.attachments,
    lastError: null,
  };
}

export function createComposeSession(deps: ComposeDeps) {
  let active: ComposeState | null = null;
  let saving: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };

  function save(state: ComposeState): Promise<void> {
    const run = saving.then(async () => {
      const { draftId } = await deps.port.saveDraft({
        draftId: state.draftId,
        accountId: state.accountId,
        threadId: state.threadId,
        doc: toDraftDoc(state),
      });
      state.draftId = draftId;
    });
    saving = run.catch((error) => {
      console.warn("[mail] draft save failed:", error);
    });
    return saving;
  }

  async function close(opts: { keepDraft: boolean }) {
    const prev = active;
    if (!prev) return;
    active = null;
    emit();
    if (opts.keepDraft) await save(prev);
    else {
      await saving;
      if (prev.draftId) await deps.port.discardDraft(prev.draftId);
    }
  }

  return {
    get active() {
      return active;
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Opens a compose; an active one is saved as a draft first (AC20). */
    async open(spec: ComposeOpenSpec): Promise<ComposeState> {
      if (active) await close({ keepDraft: true });
      active = {
        ...spec,
        key: `compose-${++seq}`,
        draftId: spec.draftId ?? null,
        followUp: null,
        lastError: spec.lastError ?? null,
      };
      emit();
      return active;
    },
    /** Every change saves the draft locally (AC21). */
    update(patch: Partial<ComposeState>): Promise<void> {
      if (!active) return Promise.resolve();
      Object.assign(active, patch);
      active = { ...active };
      emit();
      return save(active);
    },
    /** Esc / switching away keeps the draft; Discard drops it. */
    close,
    flush: () => saving,
    async send(sizeLimit?: number): Promise<SendResult> {
      const s = active;
      if (!s) return { ok: false, reason: "Nothing to send." };
      if (
        splitAddresses(s.to).length + splitAddresses(s.cc).length + splitAddresses(s.bcc).length ===
        0
      )
        return { ok: false, reason: "Add a recipient." };
      if (sizeLimit) {
        const size = checkSendSize(s.attachments, new Blob([s.bodyHtml]).size, sizeLimit);
        if (!size.ok) return { ok: false, reason: size.message };
      }
      await save(s);
      await saving;
      if (!s.draftId) return { ok: false, reason: "The draft couldn't be saved." };
      const { undoSeconds, doneOnSend } = deps.settings();
      const handle = await deps.port.queueSend({ draftId: s.draftId, undoSeconds });
      active = null;
      emit();
      if (s.threadId && s.followUp && deps.setFollowUp)
        await deps.setFollowUp(s.threadId, s.followUp);
      const markedDone = Boolean(s.threadId && s.fromInbox && doneOnSend && s.kind !== "new");
      if (markedDone && s.threadId) await deps.markDone(s.threadId);
      const reopen = async () => {
        const { draftId } = await deps.port.undoSend(handle.outboxId);
        if (!draftId) return;
        if (active) await close({ keepDraft: true });
        active = { ...s, key: `compose-${++seq}`, draftId };
        emit();
      };
      deps.showSent?.(
        handle,
        { undo: () => void reopen(), edit: () => void reopen() },
        {
          kind: s.kind,
          to: s.to,
          threadId: s.threadId,
          markedDone,
          followUpMs: s.threadId ? s.followUp : null,
        },
      );
      return { ok: true, handle };
    },
  };
}

export type ComposeSession = ReturnType<typeof createComposeSession>;
