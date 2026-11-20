// The Timeline's name column (69): 280 px, 200–480, ⇧[ hides it, a handle on
// its edge resizes it. Per device.

import { type PointerEvent as ReactPointerEvent, useCallback, useState } from "react";

const NAME_W_DEFAULT = 280;
const NAME_W_MIN = 200;
const NAME_W_MAX = 480;
const NAME_COLUMN_KEY = "moduo:tasks:timeline:name-column";

type NameColumn = { width: number; hidden: boolean };

function readNameColumn(): NameColumn {
  try {
    const raw = JSON.parse(window.localStorage.getItem(NAME_COLUMN_KEY) ?? "null") as unknown;
    if (raw && typeof raw === "object") {
      const { width, hidden } = raw as Partial<NameColumn>;
      return {
        width:
          typeof width === "number" && Number.isFinite(width)
            ? Math.min(NAME_W_MAX, Math.max(NAME_W_MIN, Math.round(width)))
            : NAME_W_DEFAULT,
        hidden: hidden === true,
      };
    }
  } catch {
    // Storage off or a stray value: the default.
  }
  return { width: NAME_W_DEFAULT, hidden: false };
}

function writeNameColumn(value: NameColumn): void {
  try {
    window.localStorage.setItem(NAME_COLUMN_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function useTimelineNameColumn() {
  const [nameColumn, setNameColumn] = useState<NameColumn>(readNameColumn);
  const nameW = nameColumn.hidden ? 0 : nameColumn.width;
  const toggleNameColumn = useCallback(() => {
    setNameColumn((prev) => {
      const next = { ...prev, hidden: !prev.hidden };
      writeNameColumn(next);
      return next;
    });
  }, []);
  const startResize = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = nameColumn.width;
      let width = startW;
      const onMove = (ev: PointerEvent) => {
        width = Math.min(NAME_W_MAX, Math.max(NAME_W_MIN, startW + ev.clientX - startX));
        setNameColumn((prev) => ({ ...prev, width }));
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        writeNameColumn({ width, hidden: false });
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [nameColumn.width],
  );
  return { nameHidden: nameColumn.hidden, nameW, toggleNameColumn, startResize };
}
