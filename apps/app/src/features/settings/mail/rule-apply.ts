// "Also apply to the {n} already on this Mac?" (specs/mail-v3.md §12, AC7): the
// apply runs as one undoable bulk op in the engine, and its progress lives here,
// outside the Settings tree, so closing Settings doesn't stop it and the rule's
// row still reads "Applying to 4,000…" or "Applied to 4,000 · Undo" when you
// come back.

import { useSyncExternalStore } from "react";

export type RuleApplyState =
  | { status: "applying"; count: number }
  | { status: "applied"; count: number; opIds: string[] }
  | { status: "failed"; count: number; error: string };

/** What the apply needs from the engine (`MailEngine.applyRuleExisting` / `undoOp`). */
export type RuleApplyPort = {
  /** The dry run: how many threads on this Mac the rule matches. */
  count(ruleId: string): Promise<number>;
  apply(ruleId: string): Promise<{ count: number; opIds: string[] }>;
  undo(opIds: string[]): Promise<void>;
};

const states = new Map<string, RuleApplyState>();
const listeners = new Set<() => void>();

function set(ruleId: string, state: RuleApplyState | null) {
  if (state) states.set(ruleId, state);
  else states.delete(ruleId);
  for (const l of listeners) l();
}

/** Starts the apply; resolves when the engine has queued every chunk. */
export async function startRuleApply(
  port: RuleApplyPort,
  ruleId: string,
  count: number,
): Promise<void> {
  set(ruleId, { status: "applying", count });
  try {
    const res = await port.apply(ruleId);
    set(ruleId, { status: "applied", count: res.count, opIds: res.opIds });
  } catch (e) {
    const error = e instanceof Error && e.message ? e.message : "The rule didn't apply.";
    set(ruleId, { status: "failed", count, error });
  }
}

/** Undo of the whole apply (its one bulk op); the row's line goes away. */
export async function undoRuleApply(port: RuleApplyPort, ruleId: string): Promise<void> {
  const state = states.get(ruleId);
  if (state?.status !== "applied") return;
  set(ruleId, null);
  await port.undo(state.opIds);
}

export function forgetRuleApply(ruleId: string): void {
  if (states.has(ruleId)) set(ruleId, null);
}

/** Test seam: drops every remembered apply. */
export function resetRuleAppliesForTests(): void {
  states.clear();
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRuleApply(ruleId: string): RuleApplyState | null {
  return useSyncExternalStore(
    subscribe,
    () => states.get(ruleId) ?? null,
    () => states.get(ruleId) ?? null,
  );
}

const num = (n: number) => n.toLocaleString("en-US");

/** The row's line: "Applying to 4,000…", "Applied to 4,000", or why it failed. */
export function ruleApplyLine(state: RuleApplyState): string {
  if (state.status === "applying") return `Applying to ${num(state.count)}…`;
  if (state.status === "applied") return `Applied to ${num(state.count)}`;
  return `Couldn't apply: ${state.error}`;
}

export function applyPrompt(count: number): string {
  return `Also apply to the ${num(count)} already on this Mac?`;
}
