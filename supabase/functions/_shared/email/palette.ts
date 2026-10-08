/**
 * The email palette: the one place hex colours are allowed for email.
 *
 * Mail clients can't read CSS variables or oklch, so every colour an email
 * uses is a hex mirror of either an app token in `src/styles/tokens.css` or a
 * brand constant from `.design/brand/BRAND_BRIEF.md` §7 (White, Ink, Paper,
 * Reading black). `palette.test.ts` converts each source back to hex and fails
 * when a token changes without this file following it.
 *
 * Light is the default; dark applies where the mail app supports
 * `prefers-color-scheme` (Apple Mail, iOS Mail) or flags its own dark mode
 * (Outlook's [data-ogsc]/[data-ogsb]). Gmail and Outlook desktop show light.
 */

export type EmailColorRole =
  | "canvas"
  | "fg"
  | "body"
  | "muted"
  | "line"
  | "well"
  | "button"
  | "buttonFg"
  | "fixed";

/** Where a colour comes from: an app token, or a brand constant with its oklch value. */
export type EmailColorSource =
  | { token: `--${string}` }
  | { brand: "White" | "Ink" | "Paper" | "Reading black"; oklch: string };

export type EmailColor = { hex: string; source: EmailColorSource };

export type EmailPalette = Record<EmailColorRole, EmailColor>;

export const EMAIL_PALETTE: { light: EmailPalette; dark: EmailPalette } = {
  light: {
    canvas: { hex: "#ffffff", source: { brand: "White", oklch: "oklch(1 0 0)" } },
    fg: { hex: "#0d0d0d", source: { brand: "Ink", oklch: "oklch(0.16 0 0)" } },
    body: { hex: "#333333", source: { token: "--neutral-700" } },
    muted: { hex: "#555555", source: { token: "--neutral-600" } },
    line: { hex: "#e4e4e4", source: { token: "--neutral-200" } },
    well: { hex: "#f3f3f3", source: { token: "--neutral-100" } },
    button: { hex: "#0d0d0d", source: { brand: "Ink", oklch: "oklch(0.16 0 0)" } },
    buttonFg: { hex: "#fafafa", source: { token: "--neutral-50" } },
    fixed: { hex: "#a4a4a4", source: { token: "--neutral-400" } },
  },
  dark: {
    canvas: { hex: "#161616", source: { brand: "Reading black", oklch: "oklch(0.2 0 0)" } },
    fg: { hex: "#fafafa", source: { token: "--neutral-50" } },
    body: { hex: "#cecece", source: { token: "--neutral-300" } },
    muted: { hex: "#a4a4a4", source: { token: "--neutral-400" } },
    line: { hex: "#333333", source: { token: "--neutral-700" } },
    well: { hex: "#1b1b1b", source: { token: "--neutral-800" } },
    button: { hex: "#eeeeee", source: { token: "--mono-base" } },
    buttonFg: { hex: "#030303", source: { token: "--neutral-950" } },
    fixed: { hex: "#555555", source: { token: "--neutral-600" } },
  },
};

/** Just the hex values, for the renderer. */
export function paletteHex(mode: "light" | "dark"): Record<EmailColorRole, string> {
  const source = EMAIL_PALETTE[mode];
  const out = {} as Record<EmailColorRole, string>;
  for (const role of Object.keys(source) as EmailColorRole[]) out[role] = source[role].hex;
  return out;
}

/**
 * Geist where the reader has it, system sans everywhere else (brand brief §9).
 * Emails don't load it from Google Fonts: that would hand every reader's IP
 * address to Google, which the privacy policy doesn't cover for email.
 */
export const EMAIL_FONT =
  "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
export const EMAIL_MONO_FONT =
  "'Geist Mono', 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
