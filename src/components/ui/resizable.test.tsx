// MOD-161 / MOD-162 — the panels' group as the library renders it: it clips
// (the library's own `overflow: hidden` would make it a scroll container that
// focus can shift sideways), and its handle is the --panel-gap wide. The 16 px
// drag target (`resizeTargetMinimumSize`) is geometry jsdom can't lay out; it
// was checked live (a grab 7 px from the gap's centre resizes, 10 px doesn't).

import { beforeAll, describe, expect, it } from "@rstest/core";
import { render } from "@testing-library/react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

describe("ResizablePanelGroup", () => {
  it("clips instead of hiding, and the handle is the panel gap", () => {
    const { container } = render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel id="a" defaultSize="50%">
          A
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="b" defaultSize="50%">
          B
        </ResizablePanel>
      </ResizablePanelGroup>,
    );
    const group = container.querySelector<HTMLElement>('[data-slot="resizable-panel-group"]');
    expect(group?.style.overflow).toBe("clip");
    const handle = container.querySelector<HTMLElement>('[data-slot="resizable-handle"]');
    expect(handle?.className).toMatch(/\bw-\(--panel-gap\)/);
    expect(handle?.className).not.toMatch(/\bw-4\b/);
  });
});
