// The app-wide mail controller behind `MailEngineProvider` (decision 11, AC34,
// AC35). It owns the engine's event subscription, the badge and Dock count,
// snooze returns, follow-up checks, reply-unsnooze and the away announcement,
// so all of it runs on any page while the app runs, not only on /email.

import type {
  MailEngine,
  MailEvent,
  MailThreadRow,
  MailView,
} from "@/lib/runtime.types.mail-engine";

import type { MailStore } from "../store/mail-store";
import { mailBadgeCount, shouldNotifyNewMail } from "./badge";
import type { MailBehavior } from "./behavior";

export type MailControllerDeps = {
  engine: MailEngine;
  store: MailStore;
  behavior: MailBehavior;
  now?: () => number;
  /** When the app launched: snoozes due before it came back "while you were away". */
  launchMs?: number;
  /** The Dock badge (desktop). */
  setDockBadge?: (count: number) => void;
  notify?: (title: string, body: string) => void;
  /** How often snooze returns and follow-ups are checked. */
  sweepMs?: number;
};

const SNOOZED: MailView = { kind: "snoozed" };
const FOLLOWUPS: MailView = { kind: "followups" };
const PAGE = 200;

async function readAll(engine: MailEngine, view: MailView): Promise<MailThreadRow[]> {
  const rows: MailThreadRow[] = [];
  let after = null;
  do {
    const page = await engine.listThreads({ view, after, limit: PAGE });
    rows.push(...page.rows);
    after = page.next;
  } while (after);
  return rows;
}

export type MailController = {
  start(): Promise<void>;
  stop(): void;
  /** Run the snooze and follow-up checks now (also on a timer). */
  sweep(): Promise<void>;
  setBehavior(behavior: MailBehavior): void;
};

export function createMailController(deps: MailControllerDeps): MailController {
  const { engine, store } = deps;
  const now = deps.now ?? Date.now;
  const launchMs = deps.launchMs ?? now();
  let behavior = deps.behavior;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let announced = false;
  let sweeping: Promise<void> | null = null;

  const publishBadge = () => {
    const badge = mailBadgeCount(store.getState().counts, behavior);
    if (badge !== store.getState().badge) store.setState({ badge });
    deps.setDockBadge?.(badge);
  };

  async function unsnooze(threadIds: string[]) {
    if (threadIds.length === 0) return;
    await engine.applyOp({ kind: "unsnooze", threadIds });
  }

  async function onNewMail(threadIds: string[]) {
    const wake: string[] = [];
    for (const id of threadIds) {
      const thread = await engine.getThread(id);
      if (!thread) continue;
      // A reply on a snoozed thread brings it back (AC34).
      if (thread.row.snoozedUntilMs !== null) {
        wake.push(id);
        continue;
      }
      if (shouldNotifyNewMail(thread.row, behavior)) {
        const from = thread.row.senders[thread.row.senders.length - 1];
        deps.notify?.(from?.name || from?.email || "New mail", thread.row.subject);
      }
    }
    await unsnooze(wake);
  }

  function onEvent(event: MailEvent) {
    if (stopped) return;
    switch (event.kind) {
      case "counts":
        store.setState({ counts: event.counts });
        publishBadge();
        break;
      case "threads_changed":
        store.setState((s) => ({
          threadsVersion: s.threadsVersion + 1,
          changedViewKeys: event.viewKeys,
        }));
        break;
      case "op_failed":
        store.setState((s) => ({
          failedOps: [...s.failedOps.filter((o) => o.opId !== event.op.opId), event.op],
        }));
        break;
      case "sync_status":
        store.setState((s) => ({
          accounts: s.accounts.map((a) =>
            a.id === event.accountId
              ? { ...a, syncState: event.state, backfillProgress: event.progress }
              : a,
          ),
        }));
        break;
      case "new_mail":
        void onNewMail(event.threadIds).catch(() => {});
        break;
      default:
        break;
    }
  }

  async function returnDue(due: MailThreadRow[], first: boolean) {
    await unsnooze(due.map((r) => r.threadId));
    const away = first
      ? due.filter((r) => (r.snoozedUntilMs ?? 0) <= launchMs).map((r) => r.threadId)
      : [];
    if (away.length > 0) {
      store.setState({ awayReturned: away });
      deps.notify?.(
        away.length === 1 ? "1 email came back" : `${away.length} emails came back`,
        "while you were away",
      );
    }
    for (const r of due) {
      if (!away.includes(r.threadId)) deps.notify?.("Snoozed email back", r.subject);
    }
  }

  async function runSweep() {
    const t = now();
    const snoozed = await readAll(engine, SNOOZED);
    const due = snoozed.filter((r) => r.snoozedUntilMs !== null && r.snoozedUntilMs <= t);
    const first = !announced;
    announced = true;
    if (due.length > 0) await returnDue(due, first);
    const dismissed = new Set(store.getState().dismissedFollowups);
    const followups = (await readAll(engine, FOLLOWUPS)).filter((r) => !dismissed.has(r.threadId));
    const before = new Set(store.getState().followupsDue.map((r) => r.threadId));
    for (const r of followups) {
      if (!before.has(r.threadId)) deps.notify?.("Follow-up due", r.subject);
    }
    store.setState({ followupsDue: followups });
  }

  return {
    async start() {
      stopped = false;
      store.setState({ engine, behavior });
      unsubscribe = engine.subscribe(onEvent);
      const [counts, accounts, failedOps] = await Promise.all([
        engine.counts(),
        engine.listAccounts(),
        engine.listFailedOps(),
      ]);
      if (stopped) return;
      store.setState({ counts, accounts, failedOps });
      publishBadge();
      await this.sweep();
      if (stopped) return;
      timer = setInterval(() => void this.sweep().catch(() => {}), deps.sweepMs ?? 30_000);
    },
    stop() {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
      if (timer) clearInterval(timer);
      timer = null;
      store.setState({ engine: null, badge: 0 });
      deps.setDockBadge?.(0);
    },
    sweep() {
      // One sweep at a time: a slow one never overlaps the next tick.
      sweeping ??= runSweep().finally(() => {
        sweeping = null;
      });
      return sweeping;
    },
    setBehavior(next) {
      behavior = next;
      store.setState({ behavior });
      publishBadge();
    },
  };
}
