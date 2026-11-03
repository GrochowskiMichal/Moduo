// An in-memory compose port (MR-11) for stories and tests: drafts, the send
// outbox with its undo window, offline hold and failure back to Drafts, the
// same rules the Rust `mail::send` store follows.

import type {
  MailComposeEngine,
  MailDraftRow,
  MailOutboxItem,
} from "@/lib/runtime.types.mail-compose";

const UNDO_CHOICES = [5, 10, 20, 30];

export type FakeComposeEngine = MailComposeEngine & {
  /** Sends every due outbox item (or fails it when `failNext`). */
  drain(): void;
  online: boolean;
  failNext: string | null;
  /** A draft made on another device or client appears (AC21). */
  serverDraft(row: MailDraftRow): void;
  sent: MailDraftRow[];
};

export function createFakeCompose(
  opts: {
    now?: () => number;
    correspondents?: { name: string; email: string; count: number }[];
    sizeLimit?: number;
  } = {},
): FakeComposeEngine {
  const now = opts.now ?? (() => Date.now());
  const drafts = new Map<string, MailDraftRow>();
  const outbox = new Map<string, MailOutboxItem>();
  let n = 0;
  const engine: FakeComposeEngine = {
    online: true,
    failNext: null,
    sent: [],
    async saveDraft(input) {
      const id = input.draftId ?? `draft-${++n}`;
      const prev = drafts.get(id);
      drafts.set(id, {
        id,
        accountId: input.accountId,
        threadId: input.threadId,
        doc: { ...input.doc, messageId: prev?.doc.messageId || `<${id}@moduo.local>` },
        updatedAtMs: now(),
        serverUid: prev?.serverUid ?? null,
        queued: prev?.queued ?? false,
      });
      return { draftId: id };
    },
    async listDrafts(accountId) {
      return [...drafts.values()]
        .filter((d) => !d.queued && (!accountId || d.accountId === accountId))
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    },
    async getDraft(id) {
      return drafts.get(id) ?? null;
    },
    async discardDraft(id) {
      drafts.delete(id);
    },
    async queueSend({ draftId, undoSeconds }) {
      const d = drafts.get(draftId);
      if (!d) throw new Error("No such draft");
      const s = UNDO_CHOICES.includes(undoSeconds) ? undoSeconds : 10;
      const id = `out-${++n}`;
      d.queued = true;
      const sendAtMs = now() + s * 1000;
      outbox.set(id, {
        id,
        accountId: d.accountId,
        draftId,
        subject: d.doc.subject,
        to: d.doc.to,
        state: "queued",
        attempts: 0,
        lastError: null,
        notBeforeMs: sendAtMs,
      });
      return { outboxId: id, draftId, sendAtMs };
    },
    async undoSend(outboxId) {
      const item = outbox.get(outboxId);
      if (!item || item.state !== "queued" || now() >= item.notBeforeMs) return { draftId: null };
      outbox.delete(outboxId);
      const d = item.draftId ? drafts.get(item.draftId) : null;
      if (d) d.queued = false;
      return { draftId: item.draftId };
    },
    async listOutbox(accountId) {
      return [...outbox.values()].filter((o) => !accountId || o.accountId === accountId);
    },
    async correspondents({ prefix, limit }) {
      const q = prefix.toLowerCase();
      return (opts.correspondents ?? [])
        .filter((c) => c.email.includes(q) || c.name.toLowerCase().includes(q))
        .slice(0, limit);
    },
    async sizeLimit() {
      return opts.sizeLimit ?? 25 * 1024 * 1024;
    },
    drain() {
      if (!engine.online) return;
      for (const item of [...outbox.values()]) {
        if (now() < item.notBeforeMs) continue;
        const d = item.draftId ? drafts.get(item.draftId) : null;
        outbox.delete(item.id);
        if (!d) continue;
        if (engine.failNext) {
          d.queued = false;
          d.doc = { ...d.doc, lastError: engine.failNext };
          engine.failNext = null;
        } else {
          drafts.delete(d.id);
          engine.sent.push(d);
        }
      }
    },
    serverDraft(row) {
      drafts.set(row.id, row);
    },
  };
  return engine;
}
