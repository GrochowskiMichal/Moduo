// Narrow windows, Calendar only (CALR-13, AC14): folds the side panels through
// the shell's own panel events as the window crosses 1600 and 1360 px, keeps
// one side panel at a time below 1360, and gives back the full-width choice
// when the window widens (remembered on the device). ⌥3 opens Plan while it
// is folded; once Plan shows, the panel's own ⌥3 takes over.

import { useEffect, useRef, useState } from "react";

import { useAppHotkeys } from "../../../lib/hotkeys";
import {
  dispatchLayoutPanelsSet,
  readFeaturePanelState,
  useFeaturePanelState,
} from "../../layout/panel-events";
import {
  type PanelBand,
  panelBand,
  type PanelPair,
  panelsOnEnter,
  panelsOnToggle,
} from "../narrow-panels";

const WIDE_KEY = "moduo:calendar:wide-panels";

function readWide(): PanelPair | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(WIDE_KEY) ?? "null") as unknown;
    if (raw && typeof raw === "object") {
      const { left, right } = raw as Partial<PanelPair>;
      if (typeof left === "boolean" && typeof right === "boolean") return { left, right };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function writeWide(pair: PanelPair): void {
  try {
    window.localStorage.setItem(WIDE_KEY, JSON.stringify(pair));
  } catch {
    /* storage off: the wide choice lasts this page only */
  }
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

const same = (a: PanelPair, b: PanelPair) => a.left === b.left && a.right === b.right;

function apply(next: PanelPair, current: PanelPair) {
  if (!same(next, current)) dispatchLayoutPanelsSet({ feature: "calendar", ...next });
}

export function useCalendarNarrowPanels(showPlan: (view: "tasks") => void): void {
  const band = panelBand(useWindowWidth());
  const panels = useFeaturePanelState("calendar");
  const bandRef = useRef<PanelBand | null>(null);
  const lastRef = useRef<PanelPair>(panels);
  // A fold sent but not yet back from the shell: toggles wait for it.
  const pendingRef = useRef<PanelPair | null>(null);

  // Crossing a line (or the first paint): fold, or give back the wide choice.
  // Sent a tick later: on the first paint this page's effects run before the
  // app chrome's, which is what listens for panel changes.
  useEffect(() => {
    const prev = bandRef.current;
    if (prev === band) return;
    bandRef.current = band;
    const current = readFeaturePanelState("calendar");
    let next: PanelPair;
    if (band === "wide") {
      if (prev === null) {
        writeWide(current);
        return;
      }
      next = readWide() ?? current;
    } else {
      // Leaving a wide window remembers it; a first paint narrow keeps the last one.
      if (prev === "wide" || (prev === null && !readWide())) writeWide(current);
      next = panelsOnEnter(band, readWide() ?? current);
    }
    lastRef.current = next;
    if (same(next, current)) return;
    pendingRef.current = next;
    let sent = false;
    const timer = window.setTimeout(() => {
      sent = true;
      apply(next, readFeaturePanelState("calendar"));
    }, 0);
    return () => {
      if (sent) return;
      // Not sent (a strict-mode remount, a quick resize): the next run decides again.
      window.clearTimeout(timer);
      bandRef.current = prev;
      pendingRef.current = null;
    };
  }, [band]);

  // A toggle inside a band: remember it when wide; one panel below 1360.
  useEffect(() => {
    const pending = pendingRef.current;
    if (pending) {
      if (!same(pending, panels)) return;
      pendingRef.current = null;
    }
    const prev = lastRef.current;
    lastRef.current = panels;
    if (bandRef.current !== band) return;
    if (band === "wide") {
      writeWide(panels);
      return;
    }
    const next = panelsOnToggle(band, prev, panels);
    if (!same(next, panels)) {
      lastRef.current = next;
      pendingRef.current = next;
      apply(next, panels);
    }
  }, [band, panels]);

  useAppHotkeys(
    {
      "calendar.plan": () => {
        showPlan("tasks");
        apply({ left: band === "one-panel" ? false : panels.left, right: true }, panels);
      },
    },
    { enabled: !panels.right },
  );
}
