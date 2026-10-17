// A widget opens its module, and a place in it when it names one (Upcoming's
// "+n more" → /tasks?place=upcoming); the app chrome navigates from the event.

import { describe, expect, it } from "@rstest/core";

import { ENTITY_OPEN_EVENT } from "@/lib/entity-open";
import { openModuleRoute } from "./widget-nav";

function opened(run: () => void): unknown[] {
  const seen: unknown[] = [];
  const on = (e: Event) => seen.push((e as CustomEvent).detail);
  window.addEventListener(ENTITY_OPEN_EVENT, on);
  run();
  window.removeEventListener(ENTITY_OPEN_EVENT, on);
  return seen;
}

describe("openModuleRoute", () => {
  it("opens the module", () => {
    expect(opened(() => openModuleRoute("/tasks"))).toEqual([{ to: "/tasks" }]);
  });

  it("carries a place to open in it", () => {
    expect(opened(() => openModuleRoute("/tasks", { place: "upcoming" }))).toEqual([
      { to: "/tasks", search: { place: "upcoming" } },
    ]);
  });
});
