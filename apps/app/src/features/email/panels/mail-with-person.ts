// "All mail with this person" (AC30): an engine search across every synced
// account for the address as sender or recipient, merged newest first, plus
// the messages of the most recent threads so the panel can list their files.

import { useEffect, useState } from "react";

import type { MailEngine, MailMessage, MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { emptyMailQuery } from "../search/query";

export type MailWithPerson = {
  rows: MailThreadRow[];
  messages: (MailMessage & { threadId: string })[];
};

export type MailWithPersonOptions = {
  /** Threads per search (from, to). */
  limit?: number;
  /** How many of the newest threads are opened to collect files. */
  filesFrom?: number;
};

export async function loadMailWithPerson(
  engine: Pick<MailEngine, "search" | "getThread">,
  email: string,
  opts: MailWithPersonOptions = {},
): Promise<MailWithPerson> {
  const address = email.trim().toLowerCase();
  if (!address) return { rows: [], messages: [] };
  const limit = opts.limit ?? 50;
  const [sent, received] = await Promise.all([
    engine.search({ query: { ...emptyMailQuery(), from: [address] }, limit, accountId: null }),
    engine.search({ query: { ...emptyMailQuery(), to: [address] }, limit, accountId: null }),
  ]);
  const byId = new Map<string, MailThreadRow>();
  for (const r of [...sent, ...received]) if (!byId.has(r.threadId)) byId.set(r.threadId, r);
  const rows = [...byId.values()].sort((a, b) => b.lastDateMs - a.lastDateMs);
  const threads = await Promise.all(
    rows.slice(0, opts.filesFrom ?? 20).map((r) => engine.getThread(r.threadId).catch(() => null)),
  );
  const messages = threads.flatMap((t) =>
    t ? t.messages.map((m) => ({ ...m, threadId: t.row.threadId })) : [],
  );
  return { rows, messages };
}

/** The loader as a hook; `fallback` shows until the search answers. */
export function useMailWithPerson(
  engine: Pick<MailEngine, "search" | "getThread"> | null,
  email: string | null,
  version: number,
  fallback: MailWithPerson,
): MailWithPerson {
  const [found, setFound] = useState<{ key: string; data: MailWithPerson } | null>(null);
  useEffect(() => {
    if (!engine || !email) return;
    let gone = false;
    void loadMailWithPerson(engine, email).then(
      (data) => !gone && setFound({ key: email, data }),
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [engine, email, version]);
  return found && found.key === email ? found.data : fallback;
}
