// Focus's Now card folds a long description behind "Show more" (call #15):
// the fold is measured on the editor's content, and a changed description
// mounts a new editor, so the measuring moves to the new content.

import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, render } from "@testing-library/react";

import { FoldedDescription } from "./focus-now-card";

const observed: Element[] = [];
const globals = globalThis as Record<string, unknown>;
const realObserver = globals.ResizeObserver;

afterEach(() => {
  cleanup();
  observed.length = 0;
  globals.ResizeObserver = realObserver;
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("the Now card's folded description", () => {
  it("measures the new content when the description changes", async () => {
    globals.ResizeObserver = class {
      observe(target: Element) {
        observed.push(target);
      }
      disconnect() {}
      unobserve() {}
    };
    const view = render(<FoldedDescription description="First" runtime={null} workspaceId="ws" />);
    await settle();
    view.rerender(
      <FoldedDescription description="Second, longer" runtime={null} workspaceId="ws" />,
    );
    await settle();
    expect(observed.length).toBeGreaterThan(1);
    // The last element measured is the one on screen, not the replaced editor's.
    expect(observed.at(-1)?.isConnected).toBe(true);
  });
});
