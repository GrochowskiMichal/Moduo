// MOD-96: a person token in the capture title draws the avatar every other
// surface shows: their profile photo (asked for by URL) and, until it loads or
// when there is none, the initials of their own name ("?" when unset, never the
// "ME" of a "Member" label). The facts come from the Task body's context, so
// the token itself carries ids only.

import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";
import { createEditor } from "lexical";
import type { ReactNode } from "react";

import type { CaptureToken } from "../parse/capture-tokens";
import { CaptureTokenNode, type TokenPerson, TokenPersonContext } from "./token-node";

const PHOTO = "https://example.supabase.co/storage/v1/object/public/avatars/profiles/u-sam/a.png";

/** Records what the avatar asked to load (jsdom loads nothing). */
class RecordingImage extends EventTarget {
  static asked: string[] = [];
  complete = false;
  naturalWidth = 0;
  referrerPolicy = "";
  crossOrigin: string | null = null;
  #src = "";
  get src() {
    return this.#src;
  }
  set src(value: string) {
    this.#src = value;
    RecordingImage.asked.push(value);
  }
}

function chip(token: CaptureToken): ReactNode {
  const editor = createEditor({
    nodes: [CaptureTokenNode],
    onError: (error) => {
      throw error;
    },
  });
  let element: ReactNode = null;
  editor.update(
    () => {
      element = new CaptureTokenNode(token).decorate();
    },
    { discrete: true },
  );
  return element;
}

describe("a person token's avatar (MOD-96)", () => {
  let realImage: typeof window.Image;
  beforeEach(() => {
    realImage = window.Image;
    RecordingImage.asked = [];
    window.Image = RecordingImage as unknown as typeof window.Image;
  });
  afterEach(() => {
    window.Image = realImage;
    cleanup();
  });

  const people = new Map<string, TokenPerson>([
    ["u-sam", { avatarUrl: PHOTO, name: "Sam Ortiz" }],
    ["u-new", { avatarUrl: null, name: "?" }],
  ]);
  const personOf = (id: string) => people.get(id) ?? null;

  it("asks for the person's photo and shows their initials meanwhile", () => {
    const { container } = render(
      <TokenPersonContext value={personOf}>
        {chip({ kind: "person", userId: "u-sam", label: "Sam Ortiz" })}
      </TokenPersonContext>,
    );
    expect(RecordingImage.asked).toEqual([PHOTO]);
    expect(container.querySelector("[data-slot=avatar]")?.textContent).toBe("SO");
  });

  it("someone without a name is a gray ?, not the initials of their label", () => {
    const { container } = render(
      <TokenPersonContext value={personOf}>
        {chip({ kind: "person", userId: "u-new", label: "Member" })}
      </TokenPersonContext>,
    );
    const avatar = container.querySelector("[data-slot=avatar]") as HTMLElement;
    expect(avatar.textContent).toBe("?");
    expect(avatar.getAttribute("data-label")).toBe("gray");
    expect(RecordingImage.asked).toEqual([]);
  });

  it("without the Task body's facts, shows the label's initials and asks for nothing", () => {
    const { container } = render(
      <>{chip({ kind: "person", userId: "u-sam", label: "Sam Ortiz" })}</>,
    );
    expect(container.querySelector("[data-slot=avatar]")?.textContent).toBe("SO");
    expect(RecordingImage.asked).toEqual([]);
  });
});
