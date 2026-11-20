// The Task and Note row flags (specs/mail-v3.md decision 7): one batched spine
// read (`MailSpinePort.linkedKindsFor`) per list window, cached in the mail
// store, and read again when links change: a spine link written anywhere in the
// app (`ENTITY_LINKED_EVENT`), a mail gesture (`MAIL_LINKS_CHANGED_EVENT`), or
// the window regaining focus (links made on another device). No per-row reads.

import { useEffect, useState } from "react";

import { ENTITY_LINKED_EVENT } from "../../spine/mention-actions";
import { MAIL_LINKS_CHANGED_EVENT, type MailLinkedKind } from "../commands/spine";
import type { MailStore } from "../store/mail-store";

export type LinkedKindsRead = (threadIds: string[]) => Promise<Record<string, MailLinkedKind[]>>;

const sameKinds = (a: readonly MailLinkedKind[] | undefined, b: readonly MailLinkedKind[]) =>
  a !== undefined && a.length === b.length && a.every((k, i) => k === b[i]);

/** The cache after one window's answer: its threads are replaced, others kept.
 *  Unchanged entries keep their identity so memoized rows don't redraw. */
export function mergeLinkedKinds(
  cache: Readonly<Record<string, MailLinkedKind[]>>,
  threadIds: readonly string[],
  answer: Readonly<Record<string, MailLinkedKind[]>>,
): Record<string, MailLinkedKind[]> {
  const next = { ...cache };
  let changed = false;
  for (const id of threadIds) {
    const kinds = answer[id];
    if (kinds && kinds.length > 0) {
      if (sameKinds(next[id], kinds)) continue;
      next[id] = [...kinds];
      changed = true;
    } else if (id in next) {
      delete next[id];
      changed = true;
    }
  }
  return changed ? next : (cache as Record<string, MailLinkedKind[]>);
}

export function useLinkedKinds(
  store: MailStore,
  read: LinkedKindsRead | undefined,
  threadIds: readonly string[],
): void {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!read) return;
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(ENTITY_LINKED_EVENT, bump);
    window.addEventListener(MAIL_LINKS_CHANGED_EVENT, bump);
    window.addEventListener("focus", bump);
    return () => {
      window.removeEventListener(ENTITY_LINKED_EVENT, bump);
      window.removeEventListener(MAIL_LINKS_CHANGED_EVENT, bump);
      window.removeEventListener("focus", bump);
    };
  }, [read]);

  const key = threadIds.join(",");
  useEffect(() => {
    if (!read || threadIds.length === 0) return;
    let gone = false;
    const ids = [...threadIds];
    void read(ids).then(
      (answer) => {
        if (gone) return;
        const cur = store.getState().linkedKinds;
        const next = mergeLinkedKinds(cur, ids, answer);
        if (next !== cur) store.setState({ linkedKinds: next });
      },
      () => {},
    );
    return () => {
      gone = true;
    };
    // `key` names the window's threads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, key, tick, store]);
}
