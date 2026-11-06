// Which account each failed op belongs to (specs/mail-v3.md §4: one failed
// line per account). An op names its threads, not its account: the loaded rows
// answer first, the engine's thread read for the rest.

import { useCallback, useEffect, useState } from "react";

import type { MailEngine, MailOpRecord, MailThreadRow } from "@/lib/runtime.types.mail-engine";

export function useFailedAccounts(
  engine: MailEngine | null,
  failed: readonly MailOpRecord[],
  rows: readonly MailThreadRow[],
): (op: MailOpRecord) => string | null {
  const [known, setKnown] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!engine) return;
    const loaded = new Set(rows.map((r) => r.threadId));
    const missing = [
      ...new Set(failed.map((o) => o.threadIds[0]).filter((id): id is string => !!id)),
    ].filter((id) => !known[id] && !loaded.has(id));
    if (missing.length === 0) return;
    let gone = false;
    void Promise.all(
      missing.map(async (id) => [id, (await engine.getThread(id))?.row.accountId ?? null] as const),
    ).then(
      (pairs) => {
        if (gone) return;
        const found = pairs.filter((p): p is readonly [string, string] => p[1] !== null);
        if (found.length > 0) setKnown((k) => ({ ...k, ...Object.fromEntries(found) }));
      },
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [engine, failed, rows, known]);
  return useCallback(
    (op: MailOpRecord) => {
      const id = op.threadIds[0];
      if (!id) return null;
      return rows.find((r) => r.threadId === id)?.accountId ?? known[id] ?? null;
    },
    [rows, known],
  );
}
