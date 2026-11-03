// MR-13 — the saved searches pinned to Mail's rail (`saved_search` settings
// items, MR-7), read once on mount; a failed read shows none.

import { useEffect, useState } from "react";

import { getRuntime } from "../../../lib/runtime";
import { readSavedSearches, type SavedSearch } from "../search/palette";

const NONE: SavedSearch[] = [];

export function useSavedSearches(): SavedSearch[] {
  const [saved, setSaved] = useState<SavedSearch[]>(NONE);
  useEffect(() => {
    const runtime = getRuntime();
    if (!runtime) return;
    let live = true;
    runtime.email
      .listSettings()
      .then((items) => {
        if (live) setSaved(readSavedSearches(items));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return saved;
}
