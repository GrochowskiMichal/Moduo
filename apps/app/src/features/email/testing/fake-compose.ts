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
  /** The 2 s debounce elapsed: every local draft reaches the server (online only) and
   *  `draft_changed` fires with its server uid (AC10). */
  uploadDrafts(): void;
};

/** Compose lab states: a failed send back in Drafts, a queued send. */
export const FAKE_COMPOSE_SCENARIOS = ["sendFailed", "outbox"] as const;
export type FakeComposeScenario = (typeof FAKE_COMPOSE_SCENARIOS)[number];

export function isFakeComposeScenario(v: string): v is FakeComposeScenario {
  return (FAKE_COMPOSE_SCENARIOS as readonly string[]).includes(v);
}

export function createFakeCompose(
  opts: {
    now?: () => number;
    correspondents?: { name: string; email: string; count: number }[];
    sizeLimit?: number;
    /** The engine's `draft_changed` (the fixture mail engine re-emits it). */
    onDraftChanged?: (draftId: string, serverUid: number | null) => void;
    scenario?: FakeComposeScenario[];
  } = {},
): FakeComposeEngine {
  const now = opts.now ?? (() => Date.now());
  const drafts = new Map<string, MailDraftRow>();
  const outbox = new Map<string, MailOutboxItem>();
  let n = 0;
  let uid = 100;
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
        // A save after a failed send clears its reason (specs/mail-v3.md edge cases).
        doc: {
          ...input.doc,
          messageId: prev?.doc.messageId || `<${id}@moduo.local>`,
          lastError: null,
        },
        updatedAtMs: now(),
        // The edited copy is local until the next upload replaces the server's.
        serverUid: null,
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
        state: "pending",
        attempts: 0,
        lastError: null,
        notBeforeMs: sendAtMs,
      });
      return { outboxId: id, draftId, sendAtMs };
    },
    async undoSend(outboxId) {
      const item = outbox.get(outboxId);
      if (!item || item.state !== "pending" || now() >= item.notBeforeMs) return { draftId: null };
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
    async stageAttachment() {
      return crypto.randomUUID();
    },
    async pickAttachments() {
      return [];
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
    uploadDrafts() {
      if (!engine.online) return;
      for (const d of drafts.values()) {
        if (d.queued || d.serverUid !== null) continue;
        d.serverUid = ++uid;
        opts.onDraftChanged?.(d.id, d.serverUid);
      }
    },
  };
  applyComposeScenario(new Set(opts.scenario ?? []), drafts, outbox, now);
  return engine;
}

function applyComposeScenario(
  scenario: Set<FakeComposeScenario>,
  drafts: Map<string, MailDraftRow>,
  outbox: Map<string, MailOutboxItem>,
  now: () => number,
) {
  const base = {
    fromName: "Mike",
    fromAddr: "mike@gmail.test",
    cc: [],
    bcc: [],
    html: null,
    inReplyTo: null,
    references: [],
    attachments: [],
  };
  if (scenario.has("sendFailed")) {
    drafts.set("draft-failed", {
      id: "draft-failed",
      accountId: "acc-gmail",
      threadId: null,
      updatedAtMs: now() - 300_000,
      serverUid: 41,
      queued: false,
      doc: {
        ...base,
        messageId: "<draft-failed@moduo.local>",
        to: ["dana@northzone.tst"],
        subject: "Deck for Thursday",
        text: "Hi Dana, the deck is attached.",
        lastError: "The server refused the address dana@northzone.tst",
      },
    });
  }
  if (scenario.has("outbox")) {
    drafts.set("draft-outbox", {
      id: "draft-outbox",
      accountId: "acc-gmail",
      threadId: null,
      updatedAtMs: now(),
      serverUid: null,
      queued: true,
      doc: {
        ...base,
        messageId: "<draft-outbox@moduo.local>",
        to: ["ana@acme.test"],
        subject: "Pilot terms, signed",
        text: "Signed copy attached.",
        lastError: null,
      },
    });
    outbox.set("out-scenario", {
      id: "out-scenario",
      accountId: "acc-gmail",
      draftId: "draft-outbox",
      subject: "Pilot terms, signed",
      to: ["ana@acme.test"],
      state: "pending",
      attempts: 1,
      lastError: null,
      notBeforeMs: now(),
    });
  }
}
