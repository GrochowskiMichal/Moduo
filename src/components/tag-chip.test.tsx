// MOD-97 · the dot chip (option C): a neutral pill, a 6 px dot in the tag's
// hue, the name, no "#". Colour only through data-label and the tokens.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TagChip, TagChipList } from "./tag-chip";
import { TooltipProvider } from "./ui/tooltip";

beforeAll(() => {
  // The kit Tooltip measures its trigger.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

const chipOf = (name: string) => screen.getByTitle(`Tag: ${name}`);

describe("TagChip", () => {
  it("is a neutral pill with the hue's dot and the bare name", () => {
    render(<TagChip name="website" color="blue" />);
    const chip = chipOf("website");
    expect(chip.getAttribute("data-slot")).toBe("tag-chip");
    expect(chip.getAttribute("data-label")).toBe("blue");
    expect(chip.textContent).toBe("website");
    expect(chip.className).toContain("rounded-full");
    expect(chip.className).toContain("bg-tag-chip-surface");
    expect(chip.className).toContain("text-foreground/90");
    // The pill never takes the hue: only the dot does.
    expect(chip.className).not.toMatch(/label-surface|tag-chip-active/);
    const dot = chip.querySelector(".tag-dot") as HTMLElement;
    expect(dot.className).toContain("size-1.5");
    expect(dot.className).toContain("rounded-full");
    expect(dot.getAttribute("aria-hidden")).toBe("true");
  });

  it("never shows a #", () => {
    render(<TagChip name="website" color="blue" onRemove={() => {}} active />);
    expect(chipOf("website").textContent).not.toContain("#");
  });

  it("falls back to gray for a missing or unknown hue", () => {
    render(
      <>
        <TagChip name="a" />
        <TagChip name="b" color="#ff0000" />
      </>,
    );
    expect(chipOf("a").getAttribute("data-label")).toBe("gray");
    expect(chipOf("b").getAttribute("data-label")).toBe("gray");
  });

  it("sm is 18 px with 12 px text, md 22 px with 13 px text", () => {
    render(
      <>
        <TagChip name="small" />
        <TagChip name="medium" size="md" />
      </>,
    );
    expect(chipOf("small").className).toMatch(/\bh-4\.5\b/);
    expect(chipOf("small").className).toMatch(/\btext-xs\b/);
    expect(chipOf("medium").className).toMatch(/\bh-5\.5\b/);
    expect(chipOf("medium").className).toMatch(/\btext-sm\b/);
  });

  it("an active filter chip adds the hue ring and full-foreground text", () => {
    render(<TagChip name="tasks" color="green" active />);
    const chip = chipOf("tasks");
    expect(chip.className).toContain("tag-chip-active");
    expect(chip.className).toContain("text-foreground");
    expect(chip.className).not.toContain("text-foreground/90");
    expect(chip.getAttribute("data-active")).toBe("true");
  });

  it("a removable chip ends with a muted × named for the tag", () => {
    const onRemove = rs.fn();
    // The row (or card) under the chip never hears the click.
    const onRow = rs.fn();
    document.body.addEventListener("click", onRow);
    render(<TagChip name="visual" color="violet" size="md" onRemove={onRemove} />);
    const remove = screen.getByRole("button", { name: "Remove tag visual" });
    expect(remove.className).toContain("text-muted-foreground");
    expect(remove.className).toContain("hit-min");
    fireEvent.click(remove);
    document.body.removeEventListener("click", onRow);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("a clickable chip is a button that says it's a tag", () => {
    const onClick = rs.fn();
    render(<TagChip name="errand" color="amber" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Tag: errand" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("takes a custom title, or none", () => {
    render(
      <>
        <TagChip name="a" title="Filter by a" />
        <TagChip name="b" title="" />
      </>,
    );
    expect(screen.getByTitle("Filter by a").textContent).toBe("a");
    expect(screen.getByText("b").closest('[data-slot="tag-chip"]')?.getAttribute("title")).toBe("");
  });
});

describe("TagChipList", () => {
  const tags = [
    { id: "1", name: "deep-work", color: "blue" },
    { id: "2", name: "waiting-on", color: "green" },
    { id: "3", name: "errand", color: "amber" },
    { id: "4", name: "someday", color: null },
  ];

  it("shows the first `max` as chips, then a focusable +n whose kit tooltip names the rest", async () => {
    render(
      <TooltipProvider>
        <TagChipList tags={tags} max={2} />
      </TooltipProvider>,
    );
    expect(document.querySelectorAll('[data-slot="tag-chip"]')).toHaveLength(2);
    const more = document.querySelector('[data-slot="tag-chip-more"]') as HTMLElement;
    expect(more.tagName).toBe("BUTTON");
    expect(more.textContent).toBe("+2");
    expect(more.getAttribute("title")).toBeNull();
    expect(more.className).toContain("text-subtle-foreground");
    act(() => more.focus());
    expect((await screen.findByRole("tooltip")).textContent).toBe("errand, someday");
  });

  it("renders nothing without tags", () => {
    const { container } = render(<TagChipList tags={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
