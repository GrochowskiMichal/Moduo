// The compose session (AC20–AC22): one compose is active at a time; switching
// to another saves the first as a draft. Every change saves the draft locally
// (the engine uploads it to the server Drafts folder after its 2 s debounce).
// Send queues it with the undo window; Undo cancels and reopens it, Edit does
// the same, and Done-on-send marks the thread Done when replying from the inbox.
// Where it renders follows from the compose (specs/mail-v3.md decision 17): a
// reply sits under its conversation, everything else fills the reader column.

import type {
  MailComposeEngine,
  MailDraftDoc,
  MailSendHandle,
} from "@/lib/runtime.types.mail-compose";

import { htmlToPlainText, splitAddresses } from "../compose";
import { checkSendSize, type SendLimit } from "./size-limit";

export type ComposeKind = "new" | "reply" | "reply-all" | "forward";
/** The draft's save stage (AC10): not saved yet, on this Mac, or in the server's Drafts. */
export type DraftSaved = "none" | "local" | "server";

export type ComposeState = {
  key: string;
  kind: ComposeKind;
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
  /** "Also mark the email Done" for this compose; null follows Settings (Done on send). */
  doneOnSend: boolean | null;
  lastError: string | null;
  saved: DraftSaved;
};

export type ComposeOpenSpec = Omit<
  ComposeState,
  "key" | "draftId" | "followUp" | "lastError" | "doneOnSend" | "saved"
> & {
  draftId?: string | null;
  lastError?: string | null;
};

/** A reply renders under its conversation; a new message or a forward fills the reader column. */
export function composePlacement(s: Pick<ComposeState, "threadId">): "inline" | "column" {
  return s.threadId ? "inline" : "column";
}

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

function recipientCount(s: ComposeState): number {
  return splitAddresses(s.to).length + splitAddresses(s.cc).length + splitAddresses(s.bcc).length;
}

export function createComposeSession(deps: ComposeDeps) {
  let active: ComposeState | null = null;
  let saving: Promise<void> = Promise.resolve();
  // Compose key → its draft id, so a save queued before the first one answered
  // updates that draft instead of making another.
  const ids = new Map<string, string>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };

  function save(state: ComposeState): Promise<void> {
    const run = saving.then(async () => {
      const { draftId } = await deps.port.saveDraft({
        draftId: state.draftId ?? ids.get(state.key) ?? null,
        accountId: state.accountId,
        threadId: state.threadId,
        doc: toDraftDoc(state),
      });
      ids.set(state.key, draftId);
      state.draftId = draftId;
      // The local copy is newer than the server's until the next upload (AC10).
      if (active?.key === state.key) {
        active = { ...active, draftId, saved: "local" };
        emit();
      }
    });
    saving = run.catch((error) => {
      console.warn("[mail] draft save failed:", error);
    });
    return saving;
  }

  // Another account's alias (AC29): the draft belongs to the account it was
  // saved under (its upload, size check and send read that account), so the old
  // draft is discarded (the engine deletes its server Drafts copy) and the next
  // save makes a new one under the new account.
  function moveAccount(state: ComposeState) {
    const key = state.key;
    const known = state.draftId;
    state.draftId = null;
    const pending = saving.then(async () => {
      // A save queued before the switch may have answered since: its id is the old draft.
      const old = ids.get(key) ?? known;
      ids.delete(key);
      if (active?.key === key) active.draftId = null;
      if (old) await deps.port.discardDraft(old);
    });
    saving = pending.catch((error) => {
      console.warn("[mail] discarding the old account's draft failed:", error);
    });
  }

  async function close(opts: { keepDraft: boolean }) {
    const prev = active;
    if (!prev) return;
    active = null;
    emit();
    if (opts.keepDraft) await save(prev);
    else {
      await saving;
      const id = prev.draftId ?? ids.get(prev.key);
      if (id) await deps.port.discardDraft(id);
    }
  }

  /** What "Also mark the email Done" starts as: Done on send, for a reply opened from the inbox. */
  function defaultDoneOnSend(s: ComposeState): boolean {
    return Boolean(s.threadId && s.fromInbox && s.kind !== "new" && deps.settings().doneOnSend);
  }

  async function finishSend(s: ComposeState, handle: MailSendHandle) {
    if (s.threadId && s.followUp && deps.setFollowUp)
      await deps.setFollowUp(s.threadId, s.followUp);
    const markedDone = Boolean(
      s.threadId && s.kind !== "new" && (s.doneOnSend ?? defaultDoneOnSend(s)),
    );
    if (markedDone && s.threadId) await deps.markDone(s.threadId);
    const reopen = async () => {
      const { draftId } = await deps.port.undoSend(handle.outboxId);
      if (!draftId) return;
      if (active) await close({ keepDraft: true });
      active = { ...s, key: `compose-${++seq}`, draftId, saved: "local" };
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
        doneOnSend: null,
        lastError: spec.lastError ?? null,
        saved: spec.draftId ? "local" : "none",
      };
      emit();
      return active;
    },
    /** Every change saves the draft locally (AC21). */
    update(patch: Partial<ComposeState>): Promise<void> {
      if (!active) return Promise.resolve();
      if (patch.accountId && patch.accountId !== active.accountId) moveAccount(active);
      Object.assign(active, patch);
      active = { ...active };
      emit();
      return save(active);
    },
    /** The engine's `draft_changed` with a server uid: the open draft reached Drafts (AC10). */
    markUploaded(draftId: string) {
      if (!active) return;
      if (active.draftId !== draftId && ids.get(active.key) !== draftId) return;
      active = { ...active, saved: "server" };
      emit();
    },
    defaultDoneOnSend,
    /** Esc / switching away keeps the draft; Discard drops it. */
    close,
    flush: () => saving,
    async send(limit?: number | SendLimit | null): Promise<SendResult> {
      const s = active;
      if (!s) return { ok: false, reason: "Nothing to send." };
      if (recipientCount(s) === 0) return { ok: false, reason: "Add a recipient." };
      if (limit) {
        const size = checkSendSize(s.attachments, new Blob([s.bodyHtml]).size, limit);
        if (!size.ok) return { ok: false, reason: size.message };
      }
      await save(s);
      await saving;
      if (!s.draftId) return { ok: false, reason: "The draft couldn't be saved." };
      const handle = await deps.port.queueSend({
        draftId: s.draftId,
        undoSeconds: deps.settings().undoSeconds,
      });
      active = null;
      emit();
      await finishSend(s, handle);
      return { ok: true, handle };
    },
  };
}

export type ComposeSession = ReturnType<typeof createComposeSession>;
