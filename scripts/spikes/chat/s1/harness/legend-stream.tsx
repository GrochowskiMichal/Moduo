// CV-0 spike 1: the Legend List 3 runner-up (its React DOM entry), with its
// chat props: alignItemsAtEnd, maintainScrollAtEnd, maintainVisibleContentPosition
// (data + size), initialScrollAtEnd, stickyHeaderIndices. Lives only on the
// reference branch t/maciej/cv-0-s1-legend (the landed package.json has no
// @legendapp/list).

import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { useEffect, useRef } from "react";
import { estimateRow, type Row, type StreamApi, type StreamProps } from "./model";
import { RowView } from "./rows";

export function LegendStream({ rows, density, config, initial, onApi }: StreamProps) {
  const listRef = useRef<LegendListRef | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const sticky: number[] = [];
  for (let i = 0; i < rows.length; i++) if (rows[i]?.type === "day") sticky.push(i);

  let estimate = 0;
  for (let i = Math.max(0, rows.length - 50); i < rows.length; i++) {
    estimate += estimateRow(rows[i] as Row, density);
  }
  estimate = Math.round(estimate / Math.max(1, Math.min(50, rows.length)));

  const initialIndex =
    initial.kind === "key" ? rows.findIndex((r) => r.key === initial.key) : undefined;

  useEffect(() => {
    const api: StreamApi = {
      lib: "legend",
      scroller: () => listRef.current?.getScrollableNode() ?? null,
      scrollToKey: (key, align) => {
        const index = rowsRef.current.findIndex((r) => r.key === key);
        if (index < 0) return;
        void listRef.current?.scrollToIndex({
          index,
          animated: false,
          viewPosition: align === "center" ? 0.5 : align === "end" ? 1 : 0,
        });
      },
      scrollToEnd: () => {
        void listRef.current?.scrollToEnd({ animated: false });
      },
    };
    onApi(api);
    return () => onApi(null);
  }, [onApi]);

  return (
    <div
      className="s1-legend"
      data-density={density}
      data-anchor={config.overflowAnchor}
      data-contain={config.contain ? "" : undefined}
      data-imgbox={config.imageBox}
    >
      <LegendList
        ref={listRef}
        data={rows as Row[]}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => (
          <div className="s1-item-legend" data-key={item.key}>
            <RowView row={item} />
          </div>
        )}
        estimatedItemSize={estimate}
        alignItemsAtEnd
        maintainScrollAtEnd
        maintainScrollAtEndThreshold={0.1}
        maintainVisibleContentPosition
        initialScrollAtEnd={initial.kind === "end"}
        initialScrollIndex={
          initialIndex !== undefined && initialIndex >= 0
            ? { index: initialIndex, viewPosition: 0.5 }
            : undefined
        }
        stickyHeaderIndices={sticky}
        recycleItems={false}
        style={{ height: "100%" }}
      />
    </div>
  );
}
