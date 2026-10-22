// The Timeline's folds: projects expanded at All, sections folded (per device,
// kept under one key per person, scope and workspace).

import { useCallback, useMemo, useState } from "react";

function readToggled(key: string): ReadonlySet<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

export function useTimelineFolds(foldKey: string) {
  const [folds, setFolds] = useState(() => ({ key: foldKey, set: readToggled(foldKey) }));
  const toggled = folds.key === foldKey ? folds.set : readToggled(foldKey);
  if (folds.key !== foldKey) setFolds({ key: foldKey, set: toggled });
  const toggleRow = useCallback((rowKey: string) => {
    setFolds((prev) => {
      const next = new Set(prev.set);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      try {
        window.localStorage.setItem(prev.key, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return { key: prev.key, set: next };
    });
  }, []);
  const expanded = useMemo(() => {
    const ids = new Set<string>();
    for (const k of toggled) if (k.startsWith("project:")) ids.add(k.slice("project:".length));
    return ids;
  }, [toggled]);
  return { toggled, toggleRow, expanded };
}
