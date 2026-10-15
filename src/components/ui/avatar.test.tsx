// DS-6 (tasks-v3 AC1.15, calls 43 + 95): people are two initials on a stable
// colour in a circle, teams two letters in a rounded square. Never one letter,
// never "Me". tests/visual/avatars.spec.ts checks the rendered shapes.
import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import { act, render, waitFor } from "@testing-library/react";

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

// MOD-96: a person's profile photo when they have one, the initials on their
// colour while it loads, when it fails and when there is none. jsdom never
// loads an image, so Radix (which mounts the <img> only once the photo has
// loaded) is fed a stand-in `Image` that answers with the outcome we pick.
class FakeImage extends EventTarget {
  static outcome: "load" | "error" = "load";
  static made = 0;
  complete = false;
  naturalWidth = 0;
  referrerPolicy = "";
  crossOrigin: string | null = null;
  #src = "";
  constructor() {
    super();
    FakeImage.made += 1;
  }
  get src() {
    return this.#src;
  }
  set src(value: string) {
    this.#src = value;
    const outcome = FakeImage.outcome;
    setTimeout(() => {
      this.complete = true;
      this.naturalWidth = outcome === "load" ? 64 : 0;
      this.dispatchEvent(new Event(outcome));
    }, 0);
  }
}

describe("PersonAvatar photos (MOD-96)", () => {
  const PHOTO =
    "https://example.supabase.co/storage/v1/object/public/avatars/profiles/u-mike/avatar.png?v=1";
  let realImage: typeof window.Image;

  beforeEach(() => {
    realImage = window.Image;
    FakeImage.made = 0;
    window.Image = FakeImage as unknown as typeof window.Image;
  });
  afterEach(() => {
    window.Image = realImage;
  });

  it("shows the photo once it loads, with the initials standing in until then", async () => {
    FakeImage.outcome = "load";
    const { container } = render(<PersonAvatar name="Mike" id="u-mike" src={PHOTO} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("MI");

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(PHOTO);
    expect(img.getAttribute("data-slot")).toBe("avatar-image");
    expect(img.getAttribute("alt")).toBe("");
    // The initials step aside; the round shape and the colour key stay.
    expect(container.textContent).toBe("");
    const root = container.querySelector("[data-slot=avatar]") as HTMLElement;
    expect(root.getAttribute("data-label")).toBe(avatarHue("u-mike"));
    expect(root.className).toContain("rounded-avatar");
  });

  it("keeps the initials on their colour when the photo fails to load", async () => {
    FakeImage.outcome = "error";
    const { container } = render(<PersonAvatar name="Mike" id="u-mike" src={PHOTO} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(FakeImage.made).toBeGreaterThan(0);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("MI");
    const root = container.querySelector("[data-slot=avatar]") as HTMLElement;
    expect(root.getAttribute("data-label")).toBe(avatarHue("u-mike"));
  });

  it("shows the initials, and asks for no image, when there is no photo", async () => {
    for (const src of [null, undefined, ""]) {
      const { container, unmount } = render(<PersonAvatar name="Mike" id="u-mike" src={src} />);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toBe("MI");
      unmount();
    }
    expect(FakeImage.made).toBe(0);
  });
});
