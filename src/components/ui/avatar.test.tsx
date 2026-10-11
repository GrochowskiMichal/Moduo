// DS-6 (tasks-v3 AC1.15, calls 43 + 95): people are two initials on a stable
// colour in a circle, teams two letters in a rounded square. Never one letter,
// never "Me". tests/visual/avatars.spec.ts checks the rendered shapes.
import { describe, expect, it } from "@rstest/core";
import { render } from "@testing-library/react";

import {
  AVATAR_HUES,
  avatarHue,
  initialsOf,
  PersonAvatar,
  TeamMark,
  teamLettersOf,
} from "./avatar";

describe("initialsOf (call 43)", () => {
  it("takes the first and last word", () => {
    expect(initialsOf("Maciej Grzywacz")).toBe("MG");
    expect(initialsOf("Jean-Luc de la Cruz")).toBe("JC");
    expect(initialsOf("  mia   chen ")).toBe("MC");
  });

  it("takes two letters of a single word, so Maciej and Mike differ", () => {
    expect(initialsOf("Maciej")).toBe("MA");
    expect(initialsOf("Mike")).toBe("MI");
    expect(initialsOf("Ó")).toBe("Ó");
  });

  it("reads an email's local part and falls back to ?", () => {
    expect(initialsOf("anna.kowalska@example.com")).toBe("AK");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf(null)).toBe("?");
  });
});

describe("teamLettersOf (call 95)", () => {
  it("first letter plus the next consonant, or two words' initials", () => {
    expect(teamLettersOf("Design")).toBe("DS");
    expect(teamLettersOf("Development")).toBe("DV");
    expect(teamLettersOf("Customer success")).toBe("CS");
    expect(teamLettersOf("AI")).toBe("AI");
  });
});

describe("avatarHue", () => {
  it("is stable and always one of the label hues", () => {
    for (const key of ["u1", "u2", "Maciej", "Mike", "t-design"]) {
      expect(avatarHue(key)).toBe(avatarHue(key));
      expect(AVATAR_HUES).toContain(avatarHue(key));
    }
  });

  it("spreads people across the hues", () => {
    const hues = new Set(Array.from({ length: 60 }, (_, i) => avatarHue(`user-${i}`)));
    expect(hues.size).toBe(AVATAR_HUES.length);
  });
});

describe("PersonAvatar and TeamMark", () => {
  it("a person is round with two initials on their hue, hidden from the row's name", () => {
    const { container } = render(<PersonAvatar name="Mike" id="u-mike" />);
    const root = container.querySelector("[data-slot=avatar]") as HTMLElement;
    expect(root.getAttribute("data-label")).toBe(avatarHue("u-mike"));
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.className).toContain("rounded-avatar");
    expect(container.textContent).toBe("MI");
    // The icon rung's 9 px step must beat the fallback's own 11 px variant.
    const fallback = container.querySelector("[data-slot=avatar-fallback]") as HTMLElement;
    expect(fallback.className).toContain("group-data-[size=icon]/avatar:text-3xs");
    expect(fallback.className).not.toContain("group-data-[size=icon]/avatar:text-2xs");
  });

  it("someone the app can't name is a gray ?, not the unassigned ring", () => {
    const { container } = render(<PersonAvatar name="?" />);
    const root = container.querySelector("[data-slot=avatar]") as HTMLElement;
    expect(root.getAttribute("data-label")).toBe("gray");
    expect(root.hasAttribute("data-unassigned")).toBe(false);
    expect(container.textContent).toBe("?");
  });

  it("no one is the dashed ring, with no letters", () => {
    const { container } = render(<PersonAvatar name={null} />);
    const root = container.querySelector("[data-slot=avatar]") as HTMLElement;
    expect(root.hasAttribute("data-unassigned")).toBe(true);
    expect(root.className).toContain("border-dashed");
    expect(container.textContent).toBe("");
  });

  it("a team is a rounded square with two letters; edited letters win", () => {
    const { container, rerender } = render(<TeamMark name="Design" id="t1" />);
    const mark = container.querySelector("[data-slot=team-mark]") as HTMLElement;
    expect(mark.className).toContain("rounded-sm");
    expect(mark.className).not.toContain("rounded-avatar");
    expect(mark.textContent).toBe("DS");
    rerender(<TeamMark name="Design" id="t1" letters="dx" />);
    expect(container.textContent).toBe("DX");
  });
});
