// A Focus run's writes still owed to the server, kept on the device per person
// (HV-15 509-3 variants, MOD-718/719): a give-back whose request failed, and the
// end of a run stopped just before signing out. Sign-out and reload drop the
// run store's memory; these survive it and go once the same person is back.

import type { FocusRunRuntime, FocusRunSnapshot } from "./run-model";

export type OwedGiveBack = Parameters<FocusRunRuntime["giveBackTime"]>[0];
export type OwedEnd = { runId: string; state: Partial<FocusRunSnapshot> };
type Owed = { giveBacks: OwedGiveBack[]; ends: OwedEnd[] };

const EMPTY: Owed = { giveBacks: [], ends: [] };

function owedKey(userId: string): string {
  return `moduo.focus.owed.${userId}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readOwed(userId: string): Owed {
  try {
    const raw = storage()?.getItem(owedKey(userId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Owed>;
    return {
      giveBacks: Array.isArray(parsed.giveBacks) ? parsed.giveBacks : [],
      ends: Array.isArray(parsed.ends) ? parsed.ends : [],
    };
  } catch {
    return EMPTY;
  }
}

function writeOwed(userId: string, owed: Owed): void {
  try {
    const s = storage();
    if (!s) return;
    if (owed.giveBacks.length === 0 && owed.ends.length === 0) s.removeItem(owedKey(userId));
    else s.setItem(owedKey(userId), JSON.stringify(owed));
  } catch {
    /* storage full or blocked: memory still has it */
  }
}

/** Keep a give-back (by its key: once). */
export function oweGiveBack(userId: string, back: OwedGiveBack): void {
  const owed = readOwed(userId);
  if (owed.giveBacks.some((b) => b.key === back.key)) return;
  writeOwed(userId, { ...owed, giveBacks: [...owed.giveBacks, back] });
}

export function paidGiveBack(userId: string, key: string): void {
  const owed = readOwed(userId);
  writeOwed(userId, { ...owed, giveBacks: owed.giveBacks.filter((b) => b.key !== key) });
}

/** Keep a run's end (by run: once). */
export function oweEnd(userId: string, end: OwedEnd): void {
  const owed = readOwed(userId);
  writeOwed(userId, { ...owed, ends: [...owed.ends.filter((e) => e.runId !== end.runId), end] });
}

export function paidEnd(userId: string, runId: string): void {
  const owed = readOwed(userId);
  writeOwed(userId, { ...owed, ends: owed.ends.filter((e) => e.runId !== runId) });
}

/** Erase a person's owed writes from this device (account deletion). */
export function forgetOwed(userId: string): void {
  try {
    storage()?.removeItem(owedKey(userId));
  } catch {
    /* nothing to erase */
  }
}
