// CV-20 custom emoji: the rules the app shows before the server decides, the
// file checks the browser runs before an upload, and the shared store.

import { afterEach, describe, expect, it } from "@rstest/core";

import { resolveQuickRow } from "../../spine/reactions";
import { rightsFrom } from "../shell/use-chat-rights";
import {
  addedByLine,
  type CustomEmoji,
  emojiNameProblem,
  emojiRoomLeft,
  liveEmoji,
  mapCustomEmoji,
  matchCustomEmoji,
  mergeEmoji,
  quickRowUsable,
  resolveCustomKey,
  tidyEmojiName,
} from "./model";
import {
  applyEmojiRow,
  emojiLoadForTest,
  emojiViewForTest,
  setEmojiStoreDepsForTest,
} from "./store";
import { emojiPaths, fitWithin, isAnimatedImage, sniffImageType, typeAgrees } from "./upload";

const WS = "11111111-1111-4111-8111-111111111111";
const row = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  workspace_id: WS,
  name: "shipit",
  storage_path: `${WS}/${"a".repeat(64)}.png`,
  poster_path: `${WS}/${"a".repeat(64)}.poster.png`,
  mime: "image/png",
  width: 64,
  height: 64,
  bytes: 1234,
  animated: false,
  created_by: "u1",
  created_at: "2026-10-09T10:00:00Z",
  deleted_at: null,
  ...over,
});
const emoji = (over: Record<string, unknown> = {}) => mapCustomEmoji(row(over)) as CustomEmoji;

describe("custom emoji rows", () => {
  it("maps a row, and refuses one this build can't draw", () => {
    expect(emoji().name).toBe("shipit");
    expect(mapCustomEmoji(row({ mime: "image/svg+xml" }))).toBeNull();
    expect(mapCustomEmoji(row({ name: "Bad Name" }))).toBeNull();
    expect(mapCustomEmoji(null)).toBeNull();
  });

  it("lists the live ones newest first; a removal merges in and drops it", () => {
    const a = emoji({ id: "a", name: "aa", created_at: "2026-10-01T00:00:00Z" });
    const b = emoji({ id: "b", name: "bb", created_at: "2026-10-05T00:00:00Z" });
    expect(liveEmoji([a, b]).map((e) => e.id)).toEqual(["b", "a"]);
    const gone = mergeEmoji([a, b], { ...b, deletedAt: "2026-10-06T00:00:00Z" });
    expect(liveEmoji(gone).map((e) => e.id)).toEqual(["a"]);
  });

  it("a removed (or unknown) `:name:` resolves to nothing: it reads as text", () => {
    const byName = new Map([["shipit", emoji()]]);
    expect(resolveCustomKey(":shipit:", byName)?.id).toBe("e1");
    expect(resolveCustomKey(":gone:", byName)).toBeNull();
    expect(resolveCustomKey("👍", byName)).toBeNull();
  });

  it("the `:` menu: names that start with the query, then ones that contain it", () => {
    const list = [
      emoji({ id: "1", name: "party" }),
      emoji({ id: "2", name: "shipit" }),
      emoji({ id: "3", name: "ship" }),
    ];
    expect(matchCustomEmoji(list, "ship").map((e) => e.name)).toEqual(["shipit", "ship"]);
    expect(matchCustomEmoji(list, "it").map((e) => e.name)).toEqual(["shipit"]);
    expect(matchCustomEmoji(list, "")).toEqual([]);
  });

  it("your quick row keeps a custom key only where it's live", () => {
    const usable = quickRowUsable(new Map([["shipit", emoji()]]));
    expect(resolveQuickRow([":shipit:", ":gone:", "🎉"], usable).slice(0, 2)).toEqual([
      ":shipit:",
      "🎉",
    ]);
    // Settings (no workspace check) keeps it, so a save doesn't drop it.
    expect(resolveQuickRow([":gone:"])[0]).toBe(":gone:");
  });
});

describe("custom emoji names", () => {
  const reserved = (n: string) => n === "thumbsup" || n === "tada";
  it("tidies what's typed the way the server reads it", () => {
    expect(tidyEmojiName("  :Ship It: ")).toBe("ship_it");
  });
  it("says what's wrong, in words", () => {
    const taken = new Set(["shipit"]);
    expect(emojiNameProblem("", taken, reserved)).toBe("Give it a name.");
    expect(emojiNameProblem("a", taken, reserved)).toMatch(/2 to 32/);
    expect(emojiNameProblem("a+b", taken, reserved)).toMatch(/2 to 32/);
    expect(emojiNameProblem("tada", taken, reserved)).toBe(
      ":tada: is a standard emoji. Pick another name.",
    );
    expect(emojiNameProblem("shipit", taken, reserved)).toBe(
      "There's already an emoji called :shipit:.",
    );
    expect(emojiNameProblem("lgtm", taken, reserved)).toBeNull();
  });
  it("500 is the most a workspace holds", () => {
    expect(emojiRoomLeft(499)).toBe(true);
    expect(emojiRoomLeft(500)).toBe(false);
  });
  it("says who added it (an erased account: no name)", () => {
    const fmt = () => "Oct 9";
    const names = (id: string) => (id === "u2" ? "Mike Chen" : null);
    expect(addedByLine({ createdBy: "u2", createdAt: "x" }, "u1", names, fmt)).toBe(
      "Added by Mike Chen · Oct 9",
    );
    expect(addedByLine({ createdBy: "u1", createdAt: "x" }, "u1", names, fmt)).toBe(
      "Added by you · Oct 9",
    );
    expect(addedByLine({ createdBy: null, createdAt: "x" }, "u1", names, fmt)).toBe("Added Oct 9");
  });
});

describe("the add-emoji switch on the client", () => {
  it("admins and members by default, never a viewer, owners always", () => {
    expect(rightsFrom(null, "editor", false).addEmoji).toBe(true);
    expect(rightsFrom(null, "viewer", false).addEmoji).toBe(false);
    expect(rightsFrom(null, "editor", true).addEmoji).toBe(false);
    expect(rightsFrom([{ role_key: "member", add_emoji: false }], "editor", false).addEmoji).toBe(
      false,
    );
    expect(rightsFrom([], "owner", false).addEmoji).toBe(true);
  });
});

const bytes = (...parts: Array<string | number[]>) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const chunk = (kind: string, len = 0) => [
  0,
  0,
  0,
  len,
  ...[...kind].map((c) => c.charCodeAt(0)),
  ...new Array(len + 4).fill(0),
];

describe("a picked file", () => {
  it("is what its bytes say: PNG, JPEG, GIF or WebP, never SVG or HTML", () => {
    expect(sniffImageType(bytes(PNG_SIG))).toBe("image/png");
    expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(bytes("GIF89a"))).toBe("image/gif");
    expect(sniffImageType(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(bytes("<html>"))).toBeNull();
  });

  it("its name and type must say the same as its bytes", () => {
    expect(typeAgrees("image/png", "ship.png", "image/png")).toBe(true);
    expect(typeAgrees("image/png", "ship.gif", "image/png")).toBe(false);
    expect(typeAgrees("image/png", "ship.png", "image/svg+xml")).toBe(false);
    expect(typeAgrees("image/png", "ship.apng", "image/apng")).toBe(true);
    expect(typeAgrees("image/jpeg", "photo.JPG", "")).toBe(true);
    expect(typeAgrees("image/gif", "ship", "image/gif")).toBe(false);
  });

  it("knows an animated one (two GIF frames, an APNG, an animated WebP)", () => {
    const gif = (frames: number) => {
      const out = [...bytes("GIF89a"), 1, 0, 1, 0, 0, 0, 0];
      for (let i = 0; i < frames; i++) out.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0, 0);
      out.push(0x3b);
      return new Uint8Array(out);
    };
    expect(isAnimatedImage(gif(1), "image/gif")).toBe(false);
    expect(isAnimatedImage(gif(2), "image/gif")).toBe(true);
    expect(isAnimatedImage(bytes(PNG_SIG, chunk("IHDR", 13), chunk("IDAT", 2)), "image/png")).toBe(
      false,
    );
    expect(
      isAnimatedImage(
        bytes(PNG_SIG, chunk("IHDR", 13), chunk("acTL", 8), chunk("IDAT", 2)),
        "image/png",
      ),
    ).toBe(true);
    const vp8x = (flags: number) =>
      bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8X", [10, 0, 0, 0, flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(isAnimatedImage(vp8x(0x02), "image/webp")).toBe(true);
    expect(isAnimatedImage(vp8x(0x00), "image/webp")).toBe(false);
  });

  it("a still image fits 128 px a side and is never made larger", () => {
    expect(fitWithin(512, 256)).toEqual({ w: 128, h: 64 });
    expect(fitWithin(40, 30)).toEqual({ w: 40, h: 30 });
  });

  it("is stored under the server's slot as <workspace>/<slot>.<ext>, its still frame beside it", () => {
    const sha = "b".repeat(64);
    expect(emojiPaths(WS, sha, "image/gif")).toEqual({
      path: `${WS}/${sha}.gif`,
      posterPath: `${WS}/${sha}.poster.png`,
    });
  });
});

describe("the shared store", () => {
  afterEach(() => setEmojiStoreDepsForTest(null));

  it("reads once, signs the images, and takes live adds and removals", async () => {
    const signed: string[][] = [];
    setEmojiStoreDepsForTest({
      runtime: () =>
        ({
          customEmoji: async () => [emoji()],
          emojiUrls: async (paths: readonly string[]) => {
            signed.push([...paths]);
            return new Map(paths.map((p) => [p, `https://signed/${p}`]));
          },
        }) as never,
      live: () => () => {},
    });
    await emojiLoadForTest(WS);
    let view = emojiViewForTest(WS);
    expect(view.list.map((e) => e.name)).toEqual(["shipit"]);
    expect(view.urlOf(emoji().posterPath)).toBe(`https://signed/${emoji().posterPath}`);
    expect(signed[0]).toContain(emoji().storagePath);

    applyEmojiRow(row({ id: "e2", name: "lgtm", created_at: "2026-10-10T00:00:00Z" }));
    view = emojiViewForTest(WS);
    expect(view.list.map((e) => e.name)).toEqual(["lgtm", "shipit"]);

    applyEmojiRow(row({ deleted_at: "2026-10-11T00:00:00Z" }));
    view = emojiViewForTest(WS);
    expect(view.byName.has("shipit")).toBe(false);
  });

  it("an unreachable read leaves nothing custom (names read as text)", async () => {
    setEmojiStoreDepsForTest({
      runtime: () =>
        ({
          customEmoji: async () => {
            throw new Error("offline");
          },
        }) as never,
      live: () => () => {},
    });
    await emojiLoadForTest(WS);
    expect(emojiViewForTest(WS).list).toEqual([]);
  });
});
