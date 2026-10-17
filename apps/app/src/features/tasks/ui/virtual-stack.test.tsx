// TV-D11b (AC12.4): a long stack draws only what's on screen, keeps the
// header of the section at the top stuck there, keeps a dragged item drawn
// wherever it is, and brings an asked-for item into view. A short one draws
// everything in plain flow.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "@rstest/core";
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";

import { VirtualStack } from "./virtual-stack";

// jsdom has no layout: give every element a 300 px box (the scroller's
// screen) and let ResizeObserver be a no-op.
const VIEW = 300;
const ROW = 30;
let restore: () => void = () => {};
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.scroller !== undefined ? VIEW : ROW;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 400,
  });
  // The scroller is as tall as its content (the stack's box sets it).
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      const box = (this as HTMLElement).querySelector?.<HTMLElement>("[data-virtual-stack]");
      return box ? Number.parseFloat(box.style.height) || 0 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.scroller !== undefined ? VIEW : 0;
    },
  });
  // jsdom doesn't scroll: a programmatic scroll sets the offset and says so.
  const scrollToBefore = HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, opts?: ScrollToOptions | number) {
    if (typeof opts === "object" && typeof opts.top === "number") this.scrollTop = opts.top;
    this.dispatchEvent(new Event("scroll"));
  } as typeof HTMLElement.prototype.scrollTo;
  restore = () => {
    if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
    if (width) Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
    HTMLElement.prototype.scrollTo = scrollToBefore;
    // Element.prototype's own (jsdom's) show through again.
    Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  };
});
afterAll(() => restore());
afterEach(cleanup);

type Item = { key: string; header: boolean };

/** 10 sections of a header and 49 rows: 500 items. */
const ITEMS: Item[] = Array.from({ length: 500 }, (_, i) => ({
  key: i % 50 === 0 ? `h${i / 50}` : `r${i}`,
  header: i % 50 === 0,
}));
const STICKY = ITEMS.flatMap((item, i) => (item.header ? [i] : []));

function Stack(props: {
  items?: Item[];
  pinned?: number[];
  scrollTo?: { key: string; seq: number } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const items = props.items ?? ITEMS;
  return (
    <div ref={ref} data-scroller="" style={{ height: VIEW, overflow: "auto" }}>
      <VirtualStack
        items={items}
        itemKey={(item) => item.key}
        estimateSize={() => ROW}
        scrollRef={ref}
        render={(item, _i, place) => (
          <div data-item={item.key} data-sticky={place.sticky || undefined}>
            {item.key}
          </div>
        )}
        stickyIndexes={STICKY.filter((i) => i < items.length)}
        pinned={props.pinned}
        scrollTo={props.scrollTo}
        overscan={2}
      />
    </div>
  );
}

const drawn = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("[data-item]")].map((el) => el.dataset.item);

async function scrollTo(container: HTMLElement, top: number) {
  const scroller = container.querySelector<HTMLElement>("[data-scroller]")!;
  scroller.scrollTop = top;
  await act(async () => {
    scroller.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("VirtualStack (TV-D11b)", () => {
  it("draws only a screenful (and a little more) of a long stack", async () => {
    const { container } = render(<Stack />);
    await act(async () => {});
    const shown = drawn(container);
    expect(shown.length).toBeGreaterThan(5);
    expect(shown.length).toBeLessThan(20);
    expect(shown[0]).toBe("h0");
  });

  it("keeps the header of the section at the top stuck there", async () => {
    const { container } = render(<Stack />);
    await act(async () => {});
    // Into the middle of the third section (items 100–149).
    await scrollTo(container, 120 * ROW);
    const shown = drawn(container);
    expect(shown).toContain("h2");
    expect(shown).not.toContain("h1");
    const stuck = container.querySelector("[data-sticky]") as HTMLElement | null;
    expect(stuck?.dataset.item).toBe("h2");
    expect(stuck?.parentElement?.className).toContain("sticky");
  });

  it("keeps a pinned item (the one being dragged) drawn after it scrolls away", async () => {
    const { container, rerender } = render(<Stack pinned={[3]} />);
    await act(async () => {});
    rerender(<Stack pinned={[3]} />);
    await scrollTo(container, 305 * ROW);
    expect(drawn(container)).toContain("r3");
    expect(drawn(container)).toContain("r305");
  });

  it("brings an asked-for item into view, once per ask", async () => {
    const { container, rerender } = render(<Stack />);
    await act(async () => {});
    rerender(<Stack scrollTo={{ key: "r420", seq: 1 }} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const scroller = container.querySelector<HTMLElement>("[data-scroller]")!;
    expect(scroller.scrollTop).toBeGreaterThan(420 * ROW - VIEW);
    expect(drawn(container)).toContain("r420");
    // The same ask again doesn't move it back after the reader scrolled away.
    await scrollTo(container, 0);
    rerender(<Stack scrollTo={{ key: "r420", seq: 1 }} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(scroller.scrollTop).toBe(0);
  });

  it("draws a short stack whole, in plain flow", () => {
    const { container } = render(<Stack items={ITEMS.slice(0, 60)} />);
    expect(drawn(container)).toHaveLength(60);
    expect(container.querySelector("[data-virtual-stack]")).toBeNull();
  });
});
