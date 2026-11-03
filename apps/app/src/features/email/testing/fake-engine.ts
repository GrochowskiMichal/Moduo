// The fixture engine: an in-memory `MailEngine` over the reference mailbox
// (decision 18). Stories, unit tests and lab journeys run against it; the real
// Tauri engine implements the same port. Ops apply locally at once and stay
// undoable for `undoWindowMs` (decision 12); `failNextOps` simulates failures.

import { MAIL_FLAG_BITS, type MailMailboxRole, type MailOpKind } from "@contracts/mail";

import { mailViewKey } from "@/lib/runtime.types";
import type {
  MailAccount,
  MailCounts,
  MailEngine,
  MailEvent,
  MailListInput,
  MailListPage,
  MailMailbox,
  MailOpInput,
  MailOpRecord,
  MailSearchQuery,
  MailThread,
  MailThreadRow,
  MailView,
} from "@/lib/runtime.types.mail-engine";

import { isMailQueryEmpty } from "../search/query";
import { classifyTab } from "./classify";
import { type Fixture, FIXTURE_NOW_MS, type FixtureMessage, generateFixture } from "./fixture";

type ThreadState = {
  row: MailThreadRow;
  role: MailMailboxRole;
  messages: FixtureMessage[];
};

type PendingOp = {
  record: MailOpRecord;
  before: Map<string, { row: MailThreadRow; role: MailMailboxRole }>;
  notBeforeMs: number;
};

export type FakeEngineOptions = {
  fixture?: Fixture;
  now?: () => number;
  undoWindowMs?: number;
};

const LIVE_ROLES: MailMailboxRole[] = [
  "inbox",
  "sent",
  "drafts",
  "archive",
  "trash",
  "spam",
  "all",
];

/** The compensating op for `z` after the undo window (AC11). */
export const INVERSE_OPS: Partial<Record<MailOpKind, MailOpKind>> = {
  done: "undone",
  undone: "done",
  delete: "restore",
  restore: "delete",
  mark_read: "mark_unread",
  mark_unread: "mark_read",
  pin: "unpin",
  unpin: "pin",
  snooze: "unsnooze",
  mute: "unmute",
  unmute: "mute",
  spam: "not_spam",
  not_spam: "spam",
};

export type FakeMailEngine = MailEngine & {
  /** Moves every op whose window has passed to the "server" (or to failed). */
  flush(): void;
  /** The next `n` flushed ops fail instead of landing. */
  failNextOps(n: number): void;
  /** Simulates new mail arriving for `accountId`. */
  deliver(message: FixtureMessage): void;
};

/** Keyset order: newest first, ties by threadId ascending. */
function isAfterCursor(
  row: { lastDateMs: number; threadId: string },
  after: { lastDateMs: number; threadId: string },
): boolean {
  if (row.lastDateMs !== after.lastDateMs) return row.lastDateMs < after.lastDateMs;
  return row.threadId > after.threadId;
}

export function createFakeMailEngine(opts: FakeEngineOptions = {}): FakeMailEngine {
  const fixture = opts.fixture ?? generateFixture();
  const now = opts.now ?? (() => FIXTURE_NOW_MS);
  const windowMs = opts.undoWindowMs ?? 8000;
  const listeners = new Set<(e: MailEvent) => void>();
  const threads = new Map<string, ThreadState>();
  const pending = new Map<string, PendingOp>();
  const failed = new Map<string, PendingOp>();
  const landed = new Map<string, PendingOp>();
  let failBudget = 0;
  let opSeq = 0;

  const emit = (e: MailEvent) => {
    for (const l of listeners) l(e);
  };

  function ingest(m: FixtureMessage) {
    let t = threads.get(m.threadId);
    if (!t) {
      const tab = classifyTab(m);
      t = {
        role: m.mailboxRole,
        messages: [],
        row: {
          threadId: m.threadId,
          accountId: m.accountId,
          subject: m.subject.replace(/^Re: /, ""),
          snippet: m.snippet,
          senders: [],
          lastDateMs: m.dateMs,
          messageCount: 0,
          unread: false,
          pinned: false,
          hasAttachments: false,
          hasInvite: false,
          tab: tab.kind,
          priority: false,
          muted: false,
          snoozedUntilMs: null,
        },
      };
      threads.set(m.threadId, t);
    }
    t.messages.push(m);
    const r = t.row;
    r.messageCount++;
    if (m.dateMs >= r.lastDateMs) {
      r.lastDateMs = m.dateMs;
      r.snippet = m.snippet;
    }
    r.unread ||= (m.flags & MAIL_FLAG_BITS.seen) === 0;
    r.pinned ||= (m.flags & MAIL_FLAG_BITS.flagged) !== 0;
    r.hasAttachments ||= m.attachmentNames.length > 0;
    r.hasInvite ||= m.hasInvite;
    if (!r.senders.some((s) => s.email === m.fromEmail))
      r.senders.push({ name: m.fromName, email: m.fromEmail });
  }
  for (const m of fixture.messages) ingest(m);

  let sorted: ThreadState[] | null = null;
  const all = () =>
    (sorted ??= [...threads.values()].sort(
      (a, b) => b.row.lastDateMs - a.row.lastDateMs || (a.row.threadId < b.row.threadId ? -1 : 1),
    ));

  const mailboxId = (accountId: string, role: MailMailboxRole) => `${accountId}:${role}`;

  function inView(t: ThreadState, view: MailView): boolean {
    switch (view.kind) {
      case "unified":
        return view.role === "all"
          ? t.role !== "trash" && t.role !== "spam"
          : t.role === view.role && t.row.snoozedUntilMs === null;
      case "mailbox":
        return (
          mailboxId(t.row.accountId, t.role) === view.mailboxId && t.row.snoozedUntilMs === null
        );
      case "snoozed":
        return t.row.snoozedUntilMs !== null;
      default:
        return false;
    }
  }

  function computeCounts(): MailCounts {
    const byViewKey: Record<string, number> = {};
    const bump = (k: string) => (byViewKey[k] = (byViewKey[k] ?? 0) + 1);
    for (const t of threads.values()) {
      if (!t.row.unread || t.row.snoozedUntilMs !== null) continue;
      const u: MailView = { kind: "unified", role: t.role };
      bump(mailViewKey(u));
      bump(mailViewKey(u, { kind: t.row.tab }));
      bump(mailViewKey({ kind: "mailbox", mailboxId: mailboxId(t.row.accountId, t.role) }));
    }
    return {
      byViewKey,
      badge: byViewKey[mailViewKey({ kind: "unified", role: "inbox" }, { kind: "personal" })] ?? 0,
    };
  }

  function effect(t: ThreadState, kind: MailOpKind, input: MailOpInput) {
    const r = t.row;
    switch (kind) {
      case "done":
        if (t.role === "inbox") t.role = "archive";
        break;
      case "undone":
        t.role = "inbox";
        break;
      case "delete":
        t.role = "trash";
        break;
      case "restore":
        t.role = "inbox";
        break;
      case "spam":
        t.role = "spam";
        break;
      case "not_spam":
        t.role = "inbox";
        break;
      case "mark_read":
        r.unread = false;
        break;
      case "mark_unread":
        r.unread = true;
        break;
      case "pin":
        r.pinned = true;
        break;
      case "unpin":
        r.pinned = false;
        break;
      case "mute":
        r.muted = true;
        break;
      case "unmute":
        r.muted = false;
        break;
      case "snooze":
        r.snoozedUntilMs = input.args?.untilMs ?? now() + 86_400_000;
        break;
      case "unsnooze":
        r.snoozedUntilMs = null;
        break;
      case "move": {
        const role = input.args?.mailboxId?.split(":").pop() as MailMailboxRole | undefined;
        if (role) t.role = role;
        break;
      }
      default:
        break;
    }
  }

  const touched = (ids: string[]) => {
    sorted = null;
    emit({
      kind: "threads_changed",
      viewKeys: LIVE_ROLES.map((role) => mailViewKey({ kind: "unified", role })),
      threadIds: ids,
    });
    emit({ kind: "counts", counts: computeCounts() });
  };

  const restore = (op: PendingOp) => {
    for (const [id, snap] of op.before) {
      const t = threads.get(id);
      if (!t) continue;
      t.row = { ...snap.row };
      t.role = snap.role;
    }
    touched([...op.before.keys()]);
  };

  const engine: FakeMailEngine = {
    async listAccounts(): Promise<MailAccount[]> {
      return fixture.accounts.map((a) => ({
        ...a,
        syncState: "idle",
        backfillProgress: null,
        lastError: null,
      }));
    },
    async listMailboxes(accountId): Promise<MailMailbox[]> {
      const roles: MailMailboxRole[] = ["inbox", "sent", "drafts", "archive", "trash", "spam"];
      return roles.map((role) => {
        let unread = 0;
        let total = 0;
        for (const t of threads.values()) {
          if (t.row.accountId !== accountId || t.role !== role) continue;
          total++;
          if (t.row.unread) unread++;
        }
        return {
          id: mailboxId(accountId, role),
          accountId,
          name: role[0]!.toUpperCase() + role.slice(1),
          path: role.toUpperCase(),
          role,
          unread,
          total,
        };
      });
    },
    async listThreads(input: MailListInput): Promise<MailListPage> {
      const rows: MailThreadRow[] = [];
      const after = input.after;
      for (const t of all()) {
        if (after && !isAfterCursor(t.row, after)) continue;
        if (!inView(t, input.view)) continue;
        if (input.tab && t.row.tab !== input.tab.kind) continue;
        rows.push({ ...t.row, senders: [...t.row.senders] });
        if (rows.length > input.limit) break;
      }
      const more = rows.length > input.limit;
      if (more) rows.pop();
      const last = rows[rows.length - 1];
      return {
        rows,
        next: more && last ? { lastDateMs: last.lastDateMs, threadId: last.threadId } : null,
      };
    },
    async counts() {
      return computeCounts();
    },
    async getThread(threadId): Promise<MailThread | null> {
      const t = threads.get(threadId);
      if (!t) return null;
      return {
        row: { ...t.row },
        messages: [...t.messages]
          .sort((a, b) => a.dateMs - b.dateMs)
          .map((m) => ({
            id: m.id,
            messageId: m.messageId,
            from: { name: m.fromName, email: m.fromEmail },
            to: m.to.map((email) => ({ name: "", email })),
            cc: [],
            dateMs: m.dateMs,
            subject: m.subject,
            snippet: m.snippet,
            unread: (m.flags & MAIL_FLAG_BITS.seen) === 0,
            bodyState: "full",
            html: null,
            text: m.bodyText,
            quoteOffset: null,
            trackerCount: 0,
            attachments: m.attachmentNames.map((filename, i) => ({
              id: `${m.id}:a${i}`,
              filename,
              mime: "application/octet-stream",
              size: 1024,
              isInline: false,
              contentId: null,
            })),
            listUnsubscribe: m.listUnsubscribe,
            hasInvite: m.hasInvite,
          })),
      };
    },
    async applyOp(input) {
      const opId = `op${++opSeq}`;
      const before = new Map<string, { row: MailThreadRow; role: MailMailboxRole }>();
      for (const id of input.threadIds) {
        const t = threads.get(id);
        if (!t) continue;
        before.set(id, { row: { ...t.row }, role: t.role });
        effect(t, input.kind, input);
      }
      pending.set(opId, {
        record: {
          opId,
          kind: input.kind,
          threadIds: [...input.threadIds],
          state: "pending",
          attempts: 0,
          lastError: null,
          createdAtMs: now(),
        },
        before,
        notBeforeMs: now() + windowMs,
      });
      touched(input.threadIds);
      return { opIds: [opId] };
    },
    async undoOp(opId) {
      const op = pending.get(opId);
      if (op) {
        pending.delete(opId);
        restore(op);
        return;
      }
      const done = landed.get(opId);
      const inverse = done ? INVERSE_OPS[done.record.kind] : undefined;
      if (!done || !inverse) return;
      landed.delete(opId);
      // After the window: a compensating op, itself queued like any other.
      await engine.applyOp({ kind: inverse, threadIds: done.record.threadIds });
    },
    async listFailedOps() {
      return [...failed.values()].map((o) => ({ ...o.record }));
    },
    async retryOp(opId) {
      const op = failed.get(opId);
      if (!op) return;
      failed.delete(opId);
      op.record.state = "pending";
      op.notBeforeMs = now();
      pending.set(opId, op);
    },
    async discardOp(opId) {
      const op = failed.get(opId);
      if (!op) return;
      failed.delete(opId);
      restore(op);
    },
    async search({ query, limit, accountId }) {
      const out: MailThreadRow[] = [];
      if (isMailQueryEmpty(query)) return out;
      for (const t of all()) {
        if (!fakeThreadInScope(t, query, accountId)) continue;
        if (t.messages.some((m) => fakeSearchHit(m, query))) out.push({ ...t.row });
        if (out.length >= limit) break;
      }
      return out;
    },
    async setForeground() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush() {
      for (const [id, op] of pending) {
        if (op.notBeforeMs > now()) continue;
        pending.delete(id);
        op.record.attempts++;
        if (failBudget > 0) {
          failBudget--;
          op.record.state = "failed";
          op.record.lastError = "Simulated server failure";
          failed.set(id, op);
          emit({ kind: "op_failed", op: { ...op.record } });
        } else {
          op.record.state = "done";
          landed.set(id, op);
        }
      }
    },
    failNextOps(n) {
      failBudget = n;
    },
    deliver(message) {
      ingest(message);
      touched([message.threadId]);
      emit({ kind: "new_mail", accountId: message.accountId, threadIds: [message.threadId] });
    },
  };
  return engine;
}

/** Thread-level filters (account, pinned, folder) before the message match. */
function fakeThreadInScope(t: ThreadState, q: MailSearchQuery, accountId?: string | null): boolean {
  if (accountId && t.row.accountId !== accountId) return false;
  if (q.isPinned && !t.row.pinned) return false;
  if (q.inRole && t.role !== q.inRole) return false;
  return !q.inMailboxId;
}

/** The fake's stand-in for the store's FTS + column filters (MR-13). */
function fakeSearchHit(m: FixtureMessage, q: MailSearchQuery): boolean {
  const has = (hay: string, needles: readonly string[]) =>
    needles.every((n) => hay.toLowerCase().includes(n.toLowerCase()));
  const from = `${m.fromName} ${m.fromEmail}`;
  const to = m.to.join(" ");
  const all = [m.subject, from, to, m.bodyText, m.attachmentNames.join(" ")].join(" ");
  return (
    has(all, q.words) &&
    has(from, q.from) &&
    has(to, q.to) &&
    has(m.subject, q.subject) &&
    (!q.hasAttachment || m.attachmentNames.length > 0) &&
    (!q.isUnread || (m.flags & 1) === 0) &&
    (q.beforeMs === null || m.dateMs < q.beforeMs) &&
    (q.afterMs === null || m.dateMs >= q.afterMs)
  );
}
