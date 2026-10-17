// MOD-97 · the dot chip (option C): a neutral pill, a 6 px dot in the tag's
// hue, the name, no "#". Colour only through data-label and the tokens.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TagAddButton, TagChip, TagChipList } from "./tag-chip";
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

/** The chip whose dot and name say "Tag: <name>" on hover. */
const chipOf = (name: string) =>
  screen.getByTitle(`Tag: ${name}`).closest('[data-slot="tag-chip"]') as HTMLElement;

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
    render(
      <TooltipProvider>
        <TagChip name="website" color="blue" onRemove={() => {}} active />
      </TooltipProvider>,
    );
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
    render(
      <TooltipProvider>
        <TagChip name="visual" color="violet" size="md" onRemove={onRemove} />
      </TooltipProvider>,
    );
    const remove = screen.getByRole("button", { name: "Remove tag visual" });
    expect(remove.className).toContain("text-muted-foreground");
    expect(remove.className).toContain("hit-min");
    fireEvent.click(remove);
    document.body.removeEventListener("click", onRow);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("the × has its own kit tooltip, and its hit area clears the name", async () => {
    render(
      <TooltipProvider>
        <TagChip name="visual" color="violet" size="md" onRemove={() => {}} />
      </TooltipProvider>,
    );
    const chip = chipOf("visual");
    // The hover text is on the dot and name only, so the × never shows it too.
    expect(chip.getAttribute("title")).toBeNull();
    // 5 px from the name to the 14 px ×, whose 24 px target reaches 5 px out.
    expect(chip.className).toContain("gap-1.25");
    const remove = screen.getByRole("button", { name: "Remove tag visual" });
    expect(remove.getAttribute("title")).toBeNull();
    act(() => remove.focus());
    expect((await screen.findByRole("tooltip")).textContent).toBe("Remove tag");
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
    expect(
      screen.getByText("b").closest('[data-slot="tag-chip-label"]')?.getAttribute("title"),
    ).toBe("");
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

  it("says they're tags to a screen reader, and names what +n hides", () => {
    render(
      <TooltipProvider>
        <TagChipList tags={tags} max={3} />
      </TooltipProvider>,
    );
    const label = screen.getByText("Tags:");
    expect(label.className).toContain("sr-only");
    // Before the chips, so it's read first.
    const list = label.closest('[data-slot="tag-chip-list"]') as HTMLElement;
    expect(list.firstElementChild).toBe(label);
    expect(screen.getByRole("button", { name: "1 more tag: someday" }).textContent).toBe("+1");
    cleanup();
    render(
      <TooltipProvider>
        <TagChipList tags={tags} max={2} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "2 more tags: errand, someday" })).toBeTruthy();
  });

  it("caps each chip's width so a long name cuts, with the full name on hover", () => {
    const long = "a-very-long-tag-name-that-would-push-the-title-out";
    render(
      <TooltipProvider>
        <TagChipList tags={[{ id: "1", name: long, color: "teal" }]} />
      </TooltipProvider>,
    );
    const chip = chipOf(long);
    expect(chip.className).toContain("max-w-24");
    expect(chip.className).not.toContain("max-w-full");
    expect(screen.getByText(long).className).toContain("truncate");
  });

  it("renders nothing without tags", () => {
    const { container } = render(<TagChipList tags={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("TagAddButton (MOD-158)", () => {
  it("is a round, quiet + at the md chip's 22 px, with a 24 px hit area", () => {
    render(
      <TooltipProvider>
        <TagAddButton />
      </TooltipProvider>,
    );
    const add = screen.getByRole("button", { name: "Add tag" });
    expect(add.getAttribute("data-slot")).toBe("tag-add");
    for (const cls of ["size-5.5", "rounded-full", "hit-min", "text-muted-foreground"]) {
      expect(add.className).toContain(cls);
    }
    // Never the property value's 26 px square.
    expect(add.className).not.toMatch(/ctrl-h|rounded-md/);
    expect(add.querySelector("svg")?.getAttribute("class")).toContain("size-icon-sm");
  });

  it("matches the sm chip's 18 px beside rows' chips", () => {
    render(
      <TooltipProvider>
        <TagAddButton size="sm" label="Tag it" />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Tag it" }).className).toContain("size-4.5");
  });
});
