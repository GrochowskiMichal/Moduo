// The mail front-end store (decision 11): one external store, read through
// `useSyncExternalStore` with selectors, written only by the provider's
// controller and `features/email/commands/`. The engine stays the truth for
// rows; this holds the app-wide facts (counts, accounts, failed ops, the undo
// stack, announcements) and a version that bumps when threads change.

import type {
  MailAccount,
  MailCounts,
  MailEngine,
  MailOpKind,
  MailOpRecord,
  MailThreadRow,
} from "@/lib/runtime.types.mail-engine";

import { DEFAULT_MAIL_BEHAVIOR, type MailBehavior } from "../engine/behavior";

export type MailUndoEntry = {
  opIds: string[];
  kind: MailOpKind;
  threadIds: string[];
  atMs: number;
};

export type MailStoreState = {
  engine: MailEngine | null;
  behavior: MailBehavior;
  counts: MailCounts | null;
  /** What the nav and Dock show (follows `behavior.badge`). */
  badge: number;
  accounts: MailAccount[];
  failedOps: MailOpRecord[];
  undoStack: MailUndoEntry[];
  /** Snoozes that came due while the app was closed, announced once at launch. */
  awayReturned: string[];
  /** Due follow-ups shown at the inbox top until dismissed. */
  followupsDue: MailThreadRow[];
  dismissedFollowups: string[];
  /** Bumps on every `threads_changed`; list windows re-read on change. */
  threadsVersion: number;
  changedViewKeys: string[];
};

export type MailStore = {
  getState(): MailStoreState;
  setState(patch: Partial<MailStoreState> | ((s: MailStoreState) => Partial<MailStoreState>)): void;
  subscribe(listener: () => void): () => void;
};

export const UNDO_STACK_MAX = 20;

export function initialMailState(): MailStoreState {
  return {
    engine: null,
    behavior: DEFAULT_MAIL_BEHAVIOR,
    counts: null,
    badge: 0,
    accounts: [],
    failedOps: [],
    undoStack: [],
    awayReturned: [],
    followupsDue: [],
    dismissedFollowups: [],
    threadsVersion: 0,
    changedViewKeys: [],
  };
}

export function createMailStore(init: Partial<MailStoreState> = {}): MailStore {
  let state: MailStoreState = { ...initialMailState(), ...init };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's one mail store (the provider binds the engine to it). */
export const mailStore: MailStore = createMailStore();
