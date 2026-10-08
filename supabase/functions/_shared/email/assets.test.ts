import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import { emailAssets, LOCKUP_DISPLAY_HEIGHT, LOCKUP_DISPLAY_WIDTH, MARK_DISPLAY_SIZE } from "./assets.ts";

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../public");

/** Width, height and color type from a PNG's IHDR chunk. */
function pngHeader(path: string): { width: number; height: number; colorType: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

describe("email logo files (exported by BRAND-1 into public/email)", () => {
  // Outlook desktop sizes images from the width/height attributes the kit writes,
  // so each file must be exactly twice the display box, with a transparent canvas.
  const expected = {
    lockupLight: [LOCKUP_DISPLAY_WIDTH * 2, LOCKUP_DISPLAY_HEIGHT * 2],
    lockupDark: [LOCKUP_DISPLAY_WIDTH * 2, LOCKUP_DISPLAY_HEIGHT * 2],
    markLight: [MARK_DISPLAY_SIZE * 2, MARK_DISPLAY_SIZE * 2],
    markDark: [MARK_DISPLAY_SIZE * 2, MARK_DISPLAY_SIZE * 2],
  } as const;

  for (const [key, url] of Object.entries(emailAssets("/email"))) {
    it(`${key} is a ${expected[key as keyof typeof expected].join(" × ")} RGBA PNG`, () => {
      const header = pngHeader(resolve(PUBLIC_DIR, url.replace(/^\//, "")));
      expect([header.width, header.height]).toEqual([...expected[key as keyof typeof expected]]);
      expect(header.colorType).toBe(6);
    });
  }
});
