// The fixture engine: an in-memory `MailEngine` over the reference mailbox
// (decision 18). Stories, unit tests and lab journeys run against it; the real
// Tauri engine implements the same port. Ops apply locally at once and stay
// undoable for `undoWindowMs` (decision 12); `failNextOps` simulates failures.

import {
  MAIL_FLAG_BITS,
  type MailClassifyStage,
  type MailMailboxRole,
  type MailOpKind,
  type MailSyncState,
} from "@contracts/mail";

import { mailViewKey } from "@/lib/runtime.types";
import type {
  MailAccount,
  MailCounts,
  MailEngine,
  MailEvent,
  MailExplain,
  MailListInput,
  MailListPage,
  MailMailbox,
  MailOpInput,
  MailOpRecord,
  MailOutboxState,
  MailSearchQuery,
  MailThread,
  MailThreadRow,
  MailView,
} from "@/lib/runtime.types.mail-engine";

import { isMailQueryEmpty } from "../search/query";
import { type ClassifyContext, classifyTab, type MailTabResult } from "./classify";
import { type Fixture, FIXTURE_NOW_MS, type FixtureMessage, generateFixture } from "./fixture";

type ThreadState = {
  row: MailThreadRow;
  role: MailMailboxRole;
  messages: FixtureMessage[];
  customTabId: string | null;
  /** The stored classifier reason (store v2); undefined = classified before v2. */
  reason?: { stage: MailClassifyStage; ruleId: string | null };
  /** False when an old thread's headers are gone too (explain answers without a stage). */
  headersKept: boolean;
  repliedWhileSnoozed: boolean;
};

type PendingOp = {
  record: MailOpRecord;
  before: Map<string, { row: MailThreadRow; role: MailMailboxRole }>;
  notBeforeMs: number;
};

/** A rule as the fixture runs it: match by sender or domain, then a tab or an op. */
export type FakeRule = {
  id: string;
  from?: string;
  domain?: string;
  tab?: MailTabResult;
  action?: MailOpKind;
};

/** The settings the classifier reads (blocks, rules, overrides, custom tabs, contacts). */
export type FakeClassifyOptions = {
  blocked?: string[];
  rules?: FakeRule[];
  senderOverrides?: Record<string, MailTabResult>;
  customTabs?: { id: string; senders: string[]; domains: string[] }[];
  knownContacts?: string[];
};

/** Lab states the fixture can start in (specs/mail-v3.md MV-0, MV-12). */
export const MAIL_FIXTURE_SCENARIOS = [
  "outbox",
  "offline",
  "reconnect",
  "error",
  "firstSync",
  "noAccount",
  "failed",
  "away",
  "followups",
  "bodyFetch",
  "bodyOffline",
] as const;
export type MailFixtureScenario = (typeof MAIL_FIXTURE_SCENARIOS)[number];

export function isMailFixtureScenario(v: string): v is MailFixtureScenario {
  return (MAIL_FIXTURE_SCENARIOS as readonly string[]).includes(v);
}

export type FakeEngineOptions = {
  fixture?: Fixture;
  now?: () => number;
  undoWindowMs?: number;
  classify?: FakeClassifyOptions;
  scenario?: MailFixtureScenario[];
};

type AccountState = Pick<
  MailAccount,
  "syncState" | "lastError" | "backfillProgress" | "lastSyncedMs" | "push"
>;

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
  /** Moves an account to a sync state (emits `sync_status`). */
  setAccountState(
    accountId: string,
    patch: {
      syncState: MailSyncState;
      lastError?: string | null;
      backfillProgress?: number | null;
    },
  ): void;
  /** Queues a send in the Outbox; returns its row's thread id. */
  queueOutbox(input: {
    accountId: string;
    subject: string;
    to: string[];
    state?: MailOutboxState;
  }): string;
  /** Every queued send leaves (sent). */
  drainOutbox(): void;
  /** Makes a thread look classified before store v2 (no stored reason). */
  forgetReason(threadId: string, opts: { keepHeaders: boolean }): void;
  /** Emits any event, for tests (e.g. `draft_changed` from the compose fake). */
  emitEvent(event: MailEvent): void;
};

const matchesRule = (rule: FakeRule, from: string) =>
  (rule.from !== undefined && rule.from.toLowerCase() === from) ||
  (rule.domain !== undefined && from.endsWith(`@${rule.domain.toLowerCase()}`));

function classifyContext(c: FakeClassifyOptions): ClassifyContext {
  return {
    blocked: new Set((c.blocked ?? []).map((a) => a.toLowerCase())),
    ruleTab: (input) =>
      (c.rules ?? []).find((r) => r.tab && matchesRule(r, input.fromEmail.toLowerCase()))?.tab ??
      null,
    senderOverrides: new Map(Object.entries(c.senderOverrides ?? {})),
    customTabs: c.customTabs ?? [],
    knownContacts: new Set((c.knownContacts ?? []).map((a) => a.toLowerCase())),
  };
}

/** Polled providers check every minute; the rest push (IDLE / Gmail push). */
const PUSH_PROVIDERS = new Set(["gmail", "google_workspace", "icloud"]);

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
  const classifyOpts = opts.classify ?? {};
  const ctx = classifyContext(classifyOpts);
  const scenario = new Set(opts.scenario ?? []);
  const imagesAllowed = new Set<string>();
  const outbox = new Map<string, MailThreadRow>();
  const bodyStates = new Map<string, MailThread["messages"][number]["bodyState"]>();
  const accountStates = new Map<string, AccountState>(
    fixture.accounts.map((a) => [
      a.id,
      {
        syncState: "idle",
        lastError: null,
        backfillProgress: null,
        lastSyncedMs: now() - 120_000,
        push: PUSH_PROVIDERS.has(a.provider),
      },
    ]),
  );
  const pending = new Map<string, PendingOp>();
  const failed = new Map<string, PendingOp>();
  const landed = new Map<string, PendingOp>();
  let failBudget = 0;
  let opSeq = 0;

  const emit = (e: MailEvent) => {
    for (const l of listeners) l(e);
  };

  function classify(m: FixtureMessage) {
    const c = classifyTab(m, ctx);
    const from = m.fromEmail.toLowerCase();
    const ruleId =
      c.stage === "rules"
        ? ((classifyOpts.rules ?? []).find((r) => r.tab && matchesRule(r, from))?.id ?? null)
        : null;
    return { ...c, stage: c.stage as MailClassifyStage, ruleId };
  }

  function ingest(m: FixtureMessage) {
    let t = threads.get(m.threadId);
    if (!t) {
      const tab = classify(m);
      t = {
        role: tab.blocked ? "spam" : m.mailboxRole,
        customTabId: tab.customTabId ?? null,
        reason: { stage: tab.stage, ruleId: tab.ruleId },
        headersKept: true,
        repliedWhileSnoozed: false,
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
          followUpAtMs: null,
          returnReason: null,
          outboxState: null,
        },
      };
      threads.set(m.threadId, t);
    } else if (t.row.snoozedUntilMs !== null) {
      t.repliedWhileSnoozed = true;
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
      case "followups":
        return t.row.followUpAtMs != null && t.row.followUpAtMs <= now();
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
      bump(mailViewKey(u, { kind: t.row.tab, customTabId: t.customTabId }));
      bump(mailViewKey({ kind: "mailbox", mailboxId: mailboxId(t.row.accountId, t.role) }));
    }
    return {
      byViewKey,
      badge: byViewKey[mailViewKey({ kind: "unified", role: "inbox" }, { kind: "personal" })] ?? 0,
      outbox: outbox.size,
    };
  }

  function effect(t: ThreadState, kind: MailOpKind, input: MailOpInput) {
    const r = t.row;
    switch (kind) {
      case "done":
        if (t.role === "inbox") t.role = "archive";
        r.returnReason = null;
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
        r.returnReason = null;
        t.repliedWhileSnoozed = false;
        break;
      case "unsnooze":
        if (r.snoozedUntilMs !== null) r.returnReason = t.repliedWhileSnoozed ? "reply" : "snooze";
        r.snoozedUntilMs = null;
        t.repliedWhileSnoozed = false;
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

  const emitOutbox = (ids: string[]) => {
    emit({ kind: "threads_changed", viewKeys: [mailViewKey({ kind: "outbox" })], threadIds: ids });
    emit({ kind: "counts", counts: computeCounts() });
  };

  const engine: FakeMailEngine = {
    async listAccounts(): Promise<MailAccount[]> {
      if (scenario.has("noAccount")) return [];
      return fixture.accounts.map((a) => ({ ...a, ...accountStates.get(a.id)! }));
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
      if (input.view.kind === "outbox") {
        const queued = [...outbox.values()].sort((a, b) => b.lastDateMs - a.lastDateMs);
        return { rows: queued.slice(0, input.limit).map((r) => ({ ...r })), next: null };
      }
      for (const t of all()) {
        if (after && !isAfterCursor(t.row, after)) continue;
        if (!inView(t, input.view) || !inTab(t, input.tab)) continue;
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
      const sorted = [...t.messages].sort((a, b) => a.dateMs - b.dateMs);
      const newest = sorted[sorted.length - 1];
      const pendingBody = bodyStates.get(threadId);
      return {
        row: { ...t.row },
        imagesAllowed: newest ? imagesAllowed.has(newest.fromEmail.toLowerCase()) : false,
        messages: sorted.map((m) => ({
          id: m.id,
          messageId: m.messageId,
          from: { name: m.fromName, email: m.fromEmail },
          to: m.to.map((email) => ({ name: "", email })),
          cc: [],
          dateMs: m.dateMs,
          subject: m.subject,
          snippet: m.snippet,
          unread: (m.flags & MAIL_FLAG_BITS.seen) === 0,
          bodyState: m === newest && pendingBody ? pendingBody : "full",
          html: null,
          text: m === newest && pendingBody === "none" ? null : m.bodyText,
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
    async getRawMessage(messageId) {
      for (const t of threads.values()) {
        const m = t.messages.find((x) => x.id === messageId);
        if (!m) continue;
        return [
          `Message-ID: ${m.messageId}`,
          `From: ${m.fromName} <${m.fromEmail}>`,
          `To: ${m.to.join(", ")}`,
          `Subject: ${m.subject}`,
          `Date: ${new Date(m.dateMs).toUTCString()}`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          m.bodyText,
        ].join("\r\n");
      }
      throw new Error("message not found");
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
          subject: threads.get(input.threadIds[0] ?? "")?.row.subject ?? null,
        },
        before,
        notBeforeMs: now() + windowMs,
      });
      touched(input.threadIds);
      return { opIds: [opId], undoUntilMs: now() + windowMs };
    },
    async explainThread(threadId): Promise<MailExplain> {
      const t = threads.get(threadId);
      if (!t) throw new Error("thread not found");
      const newest = [...t.messages].sort((a, b) => b.dateMs - a.dateMs)[0]!;
      const base = { address: newest.fromEmail, tab: t.row.tab };
      if (t.reason) {
        return {
          ...base,
          stage: t.reason.stage,
          ruleId: t.reason.ruleId,
          customTabId: t.reason.stage === "custom_tabs" ? t.customTabId : null,
        };
      }
      if (!t.headersKept) return { ...base, stage: null, ruleId: null, customTabId: null };
      // Classified before reasons were stored: re-run on the stored headers.
      const c = classify(newest);
      return {
        ...base,
        tab: c.kind,
        stage: c.stage,
        ruleId: c.ruleId,
        customTabId: c.customTabId ?? null,
      };
    },
    async applyRuleExisting({ ruleId, dryRun }) {
      const rule = (classifyOpts.rules ?? []).find((r) => r.id === ruleId);
      if (!rule) throw new Error("rule not found");
      const ids = [...threads.values()]
        .filter(
          (t) =>
            t.role !== "trash" &&
            t.role !== "spam" &&
            t.messages.some((m) => matchesRule(rule, m.fromEmail.toLowerCase())),
        )
        .map((t) => t.row.threadId);
      if (dryRun || ids.length === 0) return { count: ids.length, opIds: [] };
      if (rule.action) {
        const { opIds } = await engine.applyOp({ kind: rule.action, threadIds: ids });
        return { count: ids.length, opIds };
      }
      for (const id of ids) {
        const t = threads.get(id)!;
        if (rule.tab) {
          t.row.tab = rule.tab.kind;
          t.customTabId = rule.tab.customTabId ?? null;
        }
      }
      touched(ids);
      return { count: ids.length, opIds: [] };
    },
    async setImageAllow(address, allow) {
      const a = address.toLowerCase();
      if (allow) imagesAllowed.add(a);
      else imagesAllowed.delete(a);
    },
    async setFollowUp(threadId, dueMs) {
      const t = threads.get(threadId);
      if (!t) return;
      t.row.followUpAtMs = dueMs;
      touched([threadId]);
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
      const t = threads.get(message.threadId)!;
      // Rules act on new mail as it syncs (AC6); muted threads skip the Inbox.
      const from = message.fromEmail.toLowerCase();
      for (const rule of classifyOpts.rules ?? []) {
        if (rule.action && matchesRule(rule, from))
          effect(t, rule.action, { kind: rule.action, threadIds: [t.row.threadId] });
      }
      if (t.row.muted && t.role === "inbox") t.role = "archive";
      touched([message.threadId]);
      emit({ kind: "new_mail", accountId: message.accountId, threadIds: [message.threadId] });
    },
    setAccountState(accountId, patch) {
      const cur = accountStates.get(accountId);
      if (!cur) return;
      accountStates.set(accountId, {
        ...cur,
        syncState: patch.syncState,
        lastError: patch.lastError ?? (patch.syncState === "idle" ? null : cur.lastError),
        backfillProgress: patch.backfillProgress ?? null,
        lastSyncedMs: patch.syncState === "idle" ? now() : cur.lastSyncedMs,
      });
      emit({
        kind: "sync_status",
        accountId,
        state: patch.syncState,
        progress: patch.backfillProgress ?? null,
      });
    },
    queueOutbox({ accountId, subject, to, state = "pending" }) {
      const threadId = `outbox:${outbox.size + 1}:${accountId}`;
      outbox.set(threadId, {
        threadId,
        accountId,
        subject,
        snippet: "",
        senders: to.map((email) => ({ name: "", email })),
        lastDateMs: now(),
        messageCount: 1,
        unread: false,
        pinned: false,
        hasAttachments: false,
        hasInvite: false,
        tab: "personal",
        priority: false,
        muted: false,
        snoozedUntilMs: null,
        followUpAtMs: null,
        returnReason: null,
        outboxState: state,
      });
      emitOutbox([threadId]);
      return threadId;
    },
    drainOutbox() {
      const ids = [...outbox.keys()];
      outbox.clear();
      emitOutbox(ids);
    },
    forgetReason(threadId, { keepHeaders }) {
      const t = threads.get(threadId);
      if (!t) return;
      t.reason = undefined;
      t.headersKept = keepHeaders;
    },
    emitEvent(event) {
      emit(event);
    },
  };
  applyScenario(scenario, {
    engine,
    threads: () => all(),
    now,
    accounts: fixture.accounts.map((a) => a.id),
    bodyStates,
    addFailed: (op) => failed.set(op.record.opId, op),
    nextOpId: () => `op${++opSeq}`,
  });
  sorted = null;
  return engine;
}

type ScenarioDeps = {
  engine: FakeMailEngine;
  threads: () => ThreadState[];
  now: () => number;
  accounts: string[];
  bodyStates: Map<string, MailThread["messages"][number]["bodyState"]>;
  addFailed: (op: PendingOp) => void;
  nextOpId: () => string;
};

const DAY_MS = 86_400_000;

/** Puts the fixture in the lab states MV-12 needs; each is independent. */
function applyScenario(scenario: Set<MailFixtureScenario>, d: ScenarioDeps) {
  scenarioAccounts(scenario, d);
  if (scenario.has("failed")) scenarioFailed(d);
  if (scenario.has("away")) {
    for (const t of personalThreads(d).slice(0, 3)) t.row.snoozedUntilMs = d.now() - 3_600_000;
  }
  if (scenario.has("followups")) {
    const t = personalThreads(d)[0];
    if (t) t.row.followUpAtMs = d.now() - 7 * DAY_MS;
  }
  if (scenario.has("bodyFetch")) scenarioBody(d, "text_only");
  if (scenario.has("bodyOffline")) scenarioBody(d, "none");
}

const personalThreads = (d: ScenarioDeps) =>
  d
    .threads()
    .filter((t) => t.role === "inbox" && t.row.tab === "personal" && !t.row.snoozedUntilMs);

function scenarioAccounts(scenario: Set<MailFixtureScenario>, d: ScenarioDeps) {
  const setAll = (syncState: MailSyncState) => {
    for (const id of d.accounts) d.engine.setAccountState(id, { syncState });
  };
  if (scenario.has("outbox"))
    d.engine.queueOutbox({
      accountId: d.accounts[0] ?? "acc-gmail",
      subject: "Pilot terms, signed",
      to: ["ana@acme.test"],
    });
  if (scenario.has("offline")) setAll("offline");
  if (scenario.has("firstSync")) setAll("first_sync");
  const [, second, third] = d.accounts;
  if (scenario.has("reconnect") && second)
    d.engine.setAccountState(second, { syncState: "reconnect", lastError: "invalid_grant" });
  if (scenario.has("error") && third)
    d.engine.setAccountState(third, {
      syncState: "error",
      lastError: "The server didn't answer in 30 seconds",
    });
}

function scenarioFailed(d: ScenarioDeps) {
  const [a, b] = personalThreads(d);
  const kinds: [ThreadState | undefined, MailOpKind][] = [
    [a, "done"],
    [b, "move"],
  ];
  for (const [t, kind] of kinds) {
    if (!t) continue;
    d.addFailed({
      record: {
        opId: d.nextOpId(),
        kind,
        threadIds: [t.row.threadId],
        state: "failed",
        attempts: 3,
        lastError: "The folder is read-only on the server",
        createdAtMs: d.now() - 60_000,
        subject: t.row.subject,
      },
      before: new Map([[t.row.threadId, { row: { ...t.row }, role: t.role }]]),
      notBeforeMs: d.now(),
    });
  }
}

function scenarioBody(d: ScenarioDeps, state: "text_only" | "none") {
  const t = personalThreads(d)[0];
  if (!t) return;
  d.bodyStates.set(t.row.threadId, state);
  if (state === "none") d.engine.setAccountState(t.row.accountId, { syncState: "offline" });
}

function inTab(t: ThreadState, tab: MailListInput["tab"]): boolean {
  if (!tab) return true;
  if (t.row.tab !== tab.kind) return false;
  return tab.kind !== "custom" || t.customTabId === (tab.customTabId ?? null);
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
