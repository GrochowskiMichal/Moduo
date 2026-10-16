import { expect, type Page, test } from "@playwright/test";

/**
 * The five shapes (chat v2 CV-17, AC11.1; spec §10): green dot = reachable,
 * grey outline = away, grey thick bar = do not disturb, grey target =
 * Focusing, nothing = offline (plus Calls' sixth, "In a call"). Opens the
 * avatar's Presence story on dark and light, at the three densities, and
 * reads computed styles: only reachable is green, every shape keeps 3:1
 * against the card it sits on, each has its words, offline draws nothing.
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/chat-presence.spec.ts
 */

type Rgb = [number, number, number];

function parse(color: string): Rgb | null {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b] = m[1]!.split(/[ ,/]+/).map(Number);
  return [r!, g!, b!];
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

async function openPresence(page: Page, theme: "dark" | "light") {
  await page.goto(
    `/iframe.html?id=components-ui-avatar--presence&viewMode=story&globals=theme:${theme}`,
  );
  await page.getByTestId("presence-shapes").first().waitFor({ state: "visible" });
}

/** The shape's own ink (its fill or its outline) and the card behind it. */
async function inks(page: Page) {
  return page.locator("[data-slot=presence]").evaluateAll((els) =>
    els.map((el) => {
      // Any CSS colour (oklch included) as "rgba(r, g, b, a)", through a canvas.
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const rgba = (color: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return { text: `rgb(${r}, ${g}, ${b})`, a: a! };
      };
      const cs = getComputedStyle(el);
      const filled = rgba(cs.backgroundColor).a > 0;
      const outlined = Number.parseFloat(cs.borderTopWidth) > 0;
      // The surface behind: the closest painted ancestor, else the page.
      let bg = rgba(getComputedStyle(document.body).backgroundColor).text;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const c = rgba(getComputedStyle(p).backgroundColor);
        if (c.a > 0) {
          bg = c.text;
          break;
        }
      }
      return {
        state: el.getAttribute("data-state"),
        label: el.getAttribute("aria-label"),
        ink: rgba(outlined ? cs.borderTopColor : cs.backgroundColor).text,
        filled,
        outlined,
        bg,
        mark: el.firstElementChild ? getComputedStyle(el.firstElementChild).width : null,
      };
    }),
  );
}

test.describe("presence shapes", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`the five shapes on ${theme}, at three densities`, async ({ page }) => {
      await openPresence(page, theme);
      const shapes = await inks(page);
      // Three densities × two avatar sizes × five drawn states (offline draws none).
      expect(shapes).toHaveLength(3 * 2 * 5);
      expect(shapes.some((s) => s.state === "offline")).toBe(false);

      const by = (state: string) => shapes.filter((s) => s.state === state);
      // Words for every shape.
      expect(by("reachable").every((s) => s.label === "Online")).toBe(true);
      expect(by("away").every((s) => s.label === "Away")).toBe(true);
      expect(by("dnd").every((s) => s.label === "Do not disturb")).toBe(true);
      expect(by("focusing").every((s) => s.label === "Focusing")).toBe(true);
      expect(by("in_call").every((s) => s.label === "In a call")).toBe(true);

      // Shapes: outline (away), outline + centre (target), fill + bar (DND).
      for (const s of by("away")) expect([s.outlined, s.mark]).toEqual([true, null]);
      for (const s of by("focusing")) expect(s.outlined && s.mark !== null).toBe(true);
      for (const s of by("dnd")) expect(s.filled && !s.outlined && s.mark !== null).toBe(true);

      // Only reachable is green; the rest share one grey.
      const green = parse(by("reachable")[0]!.ink)!;
      const grey = parse(by("dnd")[0]!.ink)!;
      expect(green[1]).toBeGreaterThan(green[0]);
      for (const s of shapes.filter((x) => x.state !== "reachable")) {
        expect(parse(s.ink)).toEqual(grey);
      }

      // 3:1 against the surface they sit on.
      for (const s of shapes) {
        const ink = parse(s.ink)!;
        const bg = parse(s.bg)!;
        expect(contrast(ink, bg), `${s.state} on ${theme}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
