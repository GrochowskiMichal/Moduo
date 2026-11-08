// Opening a thread reads it (specs/mail-improve.md §2, AC8): its unread dot goes at once,
// locally, and the engine's `mark_read` follows in one op for every thread opened in a
// short burst (j j j), so walking the list costs no engine write and re-read per key.
// Not an undoable action: no toast, no undo entry.

import { useEffect, useRef, useState } from "react";

import type { MailEngine, MailThreadRow } from "@/lib/runtime.types.mail-engine";

/** How long the list rests before the reads go to the engine. */
export const READ_FLUSH_MS = 600;

const NONE: ReadonlySet<string> = new Set();

export function useReadOnOpen(
  engine: MailEngine | null,
  cursor: string | null,
  rows: readonly MailThreadRow[],
): ReadonlySet<string> {
  const [readNow, setReadNow] = useState<ReadonlySet<string>>(NONE);
  const pending = useRef(new Set<string>());
  const last = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const engineRef = useRef(engine);

  const flush = useRef(() => {
    timer.current = null;
    const ids = [...pending.current];
    pending.current.clear();
    const e = engineRef.current;
    if (!e || ids.length === 0) return;
    void e.applyOp({ kind: "mark_read", threadIds: ids }).then(
      () =>
        setReadNow((s) => {
          const next = new Set(s);
          for (const id of ids) next.delete(id);
          return next.size ? next : NONE;
        }),
      () => {},
    );
  });

  useEffect(() => {
    engineRef.current = engine;
  });

  useEffect(() => {
    if (!cursor || last.current === cursor) return;
    const row = rows.find((r) => r.threadId === cursor);
    if (!row) return;
    last.current = cursor;
    if (!row.unread) return;
    pending.current.add(cursor);
    setReadNow((s) => new Set(s).add(cursor));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush.current, READ_FLUSH_MS);
  }, [cursor, rows]);

  // Leaving Mail sends what's pending.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      flush.current();
    },
    [],
  );

  return readNow;
}
