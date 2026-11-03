"use no memo";
// TanStack Virtual keeps mutable state the React Compiler would cache; this
// file opts out (rows in mail-row.tsx stay compiled).

// The mail list (AC2, AC14, decision 11): fixed-height rows virtualized over
// the whole folder (no cap), more pages loaded near the end, the cursor kept
// in view on every move. Short lists draw in flow (no layout needed).

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";

import type { LabelColor } from "@/components/tag-colors";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { type MailDensity, MailRow, type MailRowActions, ROW_HEIGHT } from "./mail-row";

export const MAIL_VIRTUALIZE_FROM = 80;

type Props = {
  rows: readonly MailThreadRow[];
  cursor: string | null;
  picked: readonly string[];
  hovered: string | null;
  hues: Readonly<Record<string, LabelColor>>;
  showHue: boolean;
  density: MailDensity;
  previewLines: 1 | 2;
  nowMs: number;
  actions: MailRowActions;
  onNearEnd?: () => void;
  virtualizeFrom?: number;
};

export function MailThreadList({
  rows,
  cursor,
  picked,
  hovered,
  hues,
  showHue,
  density,
  previewLines,
  nowMs,
  actions,
  onNearEnd,
  virtualizeFrom = MAIL_VIRTUALIZE_FROM,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtual = rows.length >= virtualizeFrom;
  const height = ROW_HEIGHT[density];
  const pickedSet = new Set(picked);

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => height,
    getItemKey: (i) => rows[i]?.threadId ?? i,
    overscan: 10,
    enabled: virtual,
    useFlushSync: false,
  });

  // Keep the cursor in view on every move (AC14).
  useEffect(() => {
    if (!cursor) return;
    const index = rows.findIndex((r) => r.threadId === cursor);
    if (index < 0) return;
    if (virtual) {
      virtualizer.scrollToIndex(index, { align: "auto" });
      return;
    }
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-thread-id="${CSS.escape(cursor)}"]`,
    );
    el?.scrollIntoView?.({ block: "nearest" });
  }, [cursor, rows, virtual, virtualizer]);

  const items = virtual ? virtualizer.getVirtualItems() : [];
  const lastShown = virtual ? (items[items.length - 1]?.index ?? 0) : rows.length - 1;
  useEffect(() => {
    if (onNearEnd && rows.length > 0 && lastShown >= rows.length - 20) onNearEnd();
  }, [lastShown, rows.length, onNearEnd]);

  const renderRow = (row: MailThreadRow) => (
    <MailRow
      row={row}
      cursor={row.threadId === cursor}
      picked={pickedSet.has(row.threadId)}
      showActions={row.threadId === hovered}
      hue={hues[row.accountId] ?? "gray"}
      showHue={showHue}
      density={density}
      previewLines={previewLines}
      nowMs={nowMs}
      actions={actions}
    />
  );

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label="Conversations"
      aria-multiselectable
      onMouseLeave={() => actions.hover(null)}
      className="pane-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2"
    >
      {virtual ? (
        <div className="relative w-full shrink-0" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <div
                key={item.key}
                className="absolute inset-x-0 top-0"
                style={{ height, transform: `translateY(${item.start}px)` }}
              >
                {renderRow(row)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col">
          {rows.map((row) => (
            <div key={row.threadId} style={{ height }}>
              {renderRow(row)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
