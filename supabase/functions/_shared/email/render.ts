/**
 * Turns an `EmailDoc` into the HTML body and the plain-text body of one email.
 *
 * Plain TypeScript (no Deno globals, no URL imports) so Edge Functions, the
 * unit tests and Storybook all run the same code. The HTML is the
 * conservative kind mail clients need: nested tables, inline styles for the
 * light look, and a `<style>` block that switches to the dark palette where
 * the client supports `prefers-color-scheme` (Apple Mail, iOS Mail) or
 * Outlook.com's own dark mode. Gmail and Outlook desktop show the light look.
 *
 * Every string in the doc is escaped here. A template never builds HTML.
 */

import { escapeHtml, singleLine } from "../escape.ts";
import {
  DEFAULT_EMAIL_ASSET_BASE,
  emailAssets,
  LOCKUP_DISPLAY_HEIGHT,
  LOCKUP_DISPLAY_WIDTH,
  MARK_DISPLAY_SIZE,
} from "./assets.ts";
import type { Block, EmailDoc, Footer, Inline } from "./blocks.ts";
import { inlineText } from "./blocks.ts";
import { EMAIL_FONT, EMAIL_MONO_FONT, paletteHex } from "./palette.ts";

/** The legal line every email ends with (the registered company, not brand copy). */
export const LEGAL_LINE = "Moduo · Ringdove sp. z o.o., Fatimska 41A/310, 31-831 Kraków, Poland";
export const PRIVACY_URL = "https://www.moduo.app/privacy";
export const SCHEDULED_WITH = "Scheduled with Moduo";

export type RenderOptions = {
  /** Where the logo images live. Defaults to app.moduo.app/email. */
  assetBase?: string;
  /**
   * "auto" (every real email): light, switching to dark where the mail app
   * supports it. "light" and "dark" force one look — for previews only.
   */
  colorScheme?: "auto" | "light" | "dark";
};

export type RenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

const LIGHT = paletteHex("light");
const DARK = paletteHex("dark");

const SUBJECT_MAX = 200;

/** Only links we would be happy to send: https, mailto, or a local dev server. Anything else becomes "#". */
/** Longest link we put in an email; anything longer is refused rather than cut (a cut URL is a broken one). */
export const MAX_URL_LENGTH = 2048;

export function safeHref(url: string): string {
  if (url.length > MAX_URL_LENGTH) return "#";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "mailto:") return parsed.toString();
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return parsed.toString();
    }
  } catch {
    // fall through
  }
  return "#";
}

/** Length caps (in characters) for the strings a doc carries; user-typed text lands in most of them. */
export const TEXT_LIMITS = {
  name: 80,
  short: 200,
  value: 1000,
  body: 2000,
} as const;

// Line breaks, other control characters, bidi overrides and the BOM (the set
// singleLine strips). Built from a string, as in escape.ts, so SWC doesn't turn
// the U+2028 escape into a raw line break.
const BREAKING_CHARS = new RegExp(
  "[\\u0000-\\u001f\\u007f-\\u009f\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069\\ufeff]",
  "g",
);

/**
 * One line, capped — like singleLine, but without trimming: a sentence is
 * built from several parts ("You're meeting Anna on ", fixed(day), "."), so
 * the spaces at a part's edges are part of the sentence.
 */
function flatten(value: string, max: number): string {
  const flat = value.replace(BREAKING_CHARS, " ").replace(/ {2,}/g, " ");
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  return `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

function cleanInline(parts: Inline[], max: number): Inline[] {
  const cleaned = parts.map((part): Inline => {
    if (typeof part === "string") return flatten(part, max);
    if ("fixed" in part) return { fixed: singleLine(part.fixed, TEXT_LIMITS.short) };
    return { strong: singleLine(part.strong, TEXT_LIMITS.short) };
  });
  // A flattened line break at a part's edge can meet the next part's space: keep one.
  for (let i = 1; i < cleaned.length; i += 1) {
    const previous = cleaned[i - 1];
    const current = cleaned[i];
    if (typeof previous === "string" && typeof current === "string" && previous.endsWith(" ")) {
      cleaned[i] = current.replace(/^ +/, "");
    }
  }
  return cleaned;
}

function cleanBlock(block: Block): Block {
  const { name, short, value, body } = TEXT_LIMITS;
  switch (block.type) {
    case "lockup":
      return block;
    case "host":
      return { ...block, name: singleLine(block.name, name) };
    case "workspace":
      return { ...block, name: singleLine(block.name, name) };
    case "heading":
    case "eyebrow":
      return { ...block, text: singleLine(block.text, short) };
    case "signoff":
      return { ...block, text: singleLine(block.text, name) };
    case "sentence":
    case "paragraph":
    case "muted":
      return { ...block, parts: cleanInline(block.parts, body) };
    case "code":
      return { ...block, code: singleLine(block.code, 20) };
    case "button":
      return {
        ...block,
        label: singleLine(block.label, name),
        caption: block.caption === undefined ? undefined : singleLine(block.caption, short),
      };
    case "link":
      return { ...block, label: singleLine(block.label, short) };
    case "rows":
      return {
        ...block,
        rows: block.rows.map((row) => ({ label: singleLine(row.label, name), value: singleLine(row.value, value) })),
      };
    case "list":
      return { ...block, items: block.items.map((item) => cleanInline(item, value)) };
    case "attachment":
      return { ...block, filename: singleLine(block.filename, name), label: singleLine(block.label, name) };
    case "item":
      return { ...block, title: singleLine(block.title, short), body: singleLine(block.body, value) };
  }
}

/**
 * Every string a doc carries, on one line and within its cap. Names and notes
 * are typed by users (hosts, guests, inviters); a line break in one could
 * otherwise start a fake "Label: URL" line in the plain-text version.
 */
export function cleanDoc(doc: EmailDoc): EmailDoc {
  return {
    subject: singleLine(doc.subject, SUBJECT_MAX),
    preheader: singleLine(doc.preheader, SUBJECT_MAX),
    blocks: doc.blocks.map(cleanBlock),
    footer: {
      ...doc.footer,
      reason: singleLine(doc.footer.reason, TEXT_LIMITS.short * 2),
      links: doc.footer.links?.map((item) => ({ ...item, label: singleLine(item.label, TEXT_LIMITS.name) })),
    },
  };
}

export function renderEmail(doc: EmailDoc, options: RenderOptions = {}): RenderedEmail {
  const clean = cleanDoc(doc);
  return {
    subject: clean.subject,
    preheader: clean.preheader,
    html: renderHtml(clean, clean.subject, clean.preheader, options),
    text: renderText(clean),
  };
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

/** Space below a block, in px (the ratified mock): headers get more air, an eyebrow sits on its heading. */
const BLOCK_GAP: Partial<Record<Block["type"], number>> = { lockup: 28, host: 24, workspace: 24, eyebrow: 10 };

function font(size: number, lineHeight: number | string, weight = 400): string {
  return `font-family:${EMAIL_FONT};font-size:${size}px;line-height:${lineHeight};font-weight:${weight}`;
}

/**
 * Dark-palette overrides, keyed by the class names the blocks carry. Colour
 * and background rules are separate because Outlook.com flags the two with
 * different attributes ([data-ogsc] for text it recoloured, [data-ogsb] for
 * backgrounds); applying a text colour without its matching background would
 * put dark text on a background Outlook left dark.
 */
function darkColorRules(prefix = ""): string[] {
  const p = prefix ? `${prefix} ` : "";
  return [
    `${p}.m-fg{color:${DARK.fg}!important}`,
    `${p}.m-body{color:${DARK.body}!important}`,
    `${p}.m-muted{color:${DARK.muted}!important}`,
    `${p}.m-line{border-color:${DARK.line}!important}`,
    `${p}.m-btn-fg{color:${DARK.buttonFg}!important}`,
    `${p}.m-fixed{border-color:${DARK.fixed}!important}`,
    `${p}.m-ws-mark{color:${DARK.canvas}!important}`,
    `${p}.m-on-light{display:none!important}`,
    `${p}.m-on-dark{display:block!important}`,
  ];
}

function darkBackgroundRules(prefix = ""): string[] {
  const p = prefix ? `${prefix} ` : "";
  return [
    `${p}.m-canvas{background-color:${DARK.canvas}!important}`,
    `${p}.m-well{background-color:${DARK.well}!important;border-color:${DARK.line}!important}`,
    `${p}.m-btn{background-color:${DARK.button}!important}`,
    `${p}.m-ws-mark{background-color:${DARK.fg}!important}`,
  ];
}

function darkRules(): string {
  return [...darkBackgroundRules(), ...darkColorRules()].join("");
}

function styleBlock(colorScheme: "auto" | "light" | "dark"): string {
  const forced = colorScheme === "dark" ? darkRules() : "";
  const adaptive =
    colorScheme === "light"
      ? []
      : [
          `@media (prefers-color-scheme:dark){${darkRules()}}`,
          // Outlook.com marks its dark mode with these attributes instead of the media query.
          darkColorRules("[data-ogsc]").join(""),
          darkBackgroundRules("[data-ogsb]").join(""),
        ];
  return [
    ":root{color-scheme:light dark;supported-color-schemes:light dark}",
    "body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}",
    "table,td{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}",
    "img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}",
    "@media only screen and (max-width:600px){.m-pad{padding:28px 20px 24px!important}.m-sentence{font-size:22px!important}.m-code{font-size:26px!important}}",
    ...adaptive,
    forced,
  ].join("\n");
}

function inline(parts: Inline[]): string {
  return parts
    .map((part) => {
      if (typeof part === "string") return escapeHtml(part);
      if ("fixed" in part) {
        return `<span class="m-fixed" style="border-bottom:1.5px solid ${LIGHT.fixed};white-space:nowrap">${escapeHtml(part.fixed)}</span>`;
      }
      return `<strong class="m-fg" style="color:${LIGHT.fg};font-weight:500">${escapeHtml(part.strong)}</strong>`;
    })
    .join("");
}

/** First and last word's first letter, the app's rule (initialsOf in tasks/assignees.ts, which can't be imported here). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function lockupHtml(assetBase: string): string {
  const assets = emailAssets(assetBase);
  const img = (src: string, cls: string, display: string) =>
    `<img class="${cls}" src="${escapeHtml(src)}" width="${LOCKUP_DISPLAY_WIDTH}" height="${LOCKUP_DISPLAY_HEIGHT}" alt="Moduo" style="display:${display};width:${LOCKUP_DISPLAY_WIDTH}px;height:auto;border:0;${font(15, 1, 600)};color:${LIGHT.fg}">`;
  // m-fg colours the "Moduo" alt text when images are blocked, in either look.
  return `${img(assets.lockupLight, "m-on-light m-fg", "block")}<!--[if !mso]><!-->${img(assets.lockupDark, "m-on-dark m-fg", "none")}<!--<![endif]-->`;
}

function markHtml(assetBase: string): string {
  const assets = emailAssets(assetBase);
  const img = (src: string, cls: string, display: string) =>
    `<img class="${cls}" src="${escapeHtml(src)}" width="${MARK_DISPLAY_SIZE}" height="${MARK_DISPLAY_SIZE}" alt="" style="display:${display};width:${MARK_DISPLAY_SIZE}px;height:${MARK_DISPLAY_SIZE}px;border:0">`;
  return `${img(assets.markLight, "m-on-light", "block")}<!--[if !mso]><!-->${img(assets.markDark, "m-on-dark", "none")}<!--<![endif]-->`;
}

function blockHtml(block: Block, assetBase: string): string {
  switch (block.type) {
    case "lockup":
      return lockupHtml(assetBase);
    case "host": {
      const avatarUrl = block.avatarUrl ? safeHref(block.avatarUrl) : "#";
      const avatar =
        avatarUrl !== "#" && avatarUrl.startsWith("https:")
          ? `<img src="${escapeHtml(avatarUrl)}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border-radius:50%;border:0">`
          : `<table ${TABLE}><tr><td class="m-well m-fg" width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;border-radius:50%;background-color:${LIGHT.well};border:1px solid ${LIGHT.line};${font(12, "36px", 500)};color:${LIGHT.fg}">${escapeHtml(initials(block.name))}</td></tr></table>`;
      return `<table ${TABLE}><tr><td style="padding-right:10px;vertical-align:middle">${avatar}</td><td class="m-fg" style="vertical-align:middle;${font(14, 1.3, 500)};color:${LIGHT.fg}">${escapeHtml(block.name)}</td></tr></table>`;
    }
    case "workspace":
      return `<table ${TABLE}><tr><td class="m-ws-mark" width="24" height="24" align="center" valign="middle" style="width:24px;height:24px;border-radius:6px;background-color:${LIGHT.fg};color:${LIGHT.canvas};${font(12, "24px", 600)}">${escapeHtml(Array.from(initials(block.name))[0] ?? "?")}</td><td class="m-fg" style="padding-left:9px;vertical-align:middle;${font(14, 1.3, 500)};color:${LIGHT.fg}">${escapeHtml(block.name)}</td></tr></table>`;
    case "heading":
      return `<h1 class="m-fg" style="margin:0;${font(22, 1.3, 500)};letter-spacing:-0.015em;color:${LIGHT.fg}">${escapeHtml(block.text)}</h1>`;
    case "sentence":
      return `<p class="m-fg m-sentence" style="margin:0;${font(26, 1.35, 300)};letter-spacing:-0.02em;color:${LIGHT.fg}">${inline(block.parts)}</p>`;
    case "paragraph":
      return `<p class="m-body" style="margin:0;${font(15, 1.6)};color:${LIGHT.body}">${inline(block.parts)}</p>`;
    case "muted":
      return `<p class="m-muted" style="margin:0;${font(14, 1.55)};color:${LIGHT.muted}">${inline(block.parts)}</p>`;
    case "code":
      return `<table ${TABLE} width="100%"><tr><td class="m-well m-fg m-code" align="center" style="background-color:${LIGHT.well};border:1px solid ${LIGHT.line};border-radius:8px;padding:18px 12px 18px 22px;font-family:${EMAIL_MONO_FONT};font-size:30px;line-height:1.2;font-weight:600;letter-spacing:0.35em;font-variant-numeric:tabular-nums;color:${LIGHT.fg}">${escapeHtml(block.code)}</td></tr></table>`;
    case "button": {
      const caption = block.caption
        ? `<p class="m-muted" style="margin:8px 0 0;${font(13, 1.5)};color:${LIGHT.muted}">${escapeHtml(block.caption)}</p>`
        : "";
      return `<table ${TABLE}><tr><td class="m-btn" bgcolor="${LIGHT.button}" style="border-radius:8px;background-color:${LIGHT.button};mso-padding-alt:11px 18px"><a class="m-btn-fg" href="${escapeHtml(safeHref(block.href))}" target="_blank" style="display:inline-block;padding:11px 18px;${font(14, 1.2, 500)};color:${LIGHT.buttonFg};text-decoration:none;border-radius:8px">${escapeHtml(block.label)}</a></td></tr></table>${caption}`;
    }
    case "link":
      return `<a class="m-fg" href="${escapeHtml(safeHref(block.href))}" target="_blank" style="${font(14, 1.5)};color:${LIGHT.fg};text-decoration:underline">${escapeHtml(block.label)}</a>`;
    case "rows": {
      const last = block.rows.length - 1;
      const rows = block.rows
        .map((row, index) => {
          const top = index === 0 ? `border-top:1px solid ${LIGHT.line};padding-top:16px;` : "padding-top:6px;";
          const bottom =
            index === last ? `border-bottom:1px solid ${LIGHT.line};padding-bottom:16px;` : "padding-bottom:6px;";
          return `<tr><td class="m-line" style="${top}${bottom}"><div class="m-muted" style="${font(11, 1.4, 500)};letter-spacing:0.04em;text-transform:uppercase;color:${LIGHT.muted}">${escapeHtml(row.label)}</div><div class="m-fg" style="padding-top:2px;${font(14, 1.5)};color:${LIGHT.fg}">${escapeHtml(row.value)}</div></td></tr>`;
        })
        .join("");
      return `<table ${TABLE} width="100%">${rows}</table>`;
    }
    case "list":
      return `<ul class="m-body" style="margin:0;padding:0 0 0 20px;${font(15, 1.6)};color:${LIGHT.body}">${block.items
        .map((item) => `<li style="margin:0 0 6px">${inline(item)}</li>`)
        .join("")}</ul>`;
    case "signoff":
      return `<p class="m-fg" style="margin:0;${font(15, 1.6)};color:${LIGHT.fg}">${escapeHtml(block.text)}</p>`;
    case "attachment":
      return `<table ${TABLE}><tr><td class="m-line m-fg" style="border:1px solid ${LIGHT.line};border-radius:8px;padding:7px 12px;${font(13, 1.4)};color:${LIGHT.fg}">${escapeHtml(block.filename)} <span class="m-muted" style="color:${LIGHT.muted}">· ${escapeHtml(block.label)}</span></td></tr></table>`;
    case "eyebrow":
      return `<p class="m-muted" style="margin:0;${font(11, 1.4, 500)};letter-spacing:0.04em;text-transform:uppercase;color:${LIGHT.muted}">${escapeHtml(block.text)}</p>`;
    case "item":
      return `<p class="m-body" style="margin:0;${font(15, 1.6)};color:${LIGHT.body}"><strong class="m-fg" style="display:block;font-weight:500;color:${LIGHT.fg}">${escapeHtml(block.title)}</strong>${escapeHtml(block.body)}</p>`;
  }
}

function footerLinks(footer: Footer): { label: string; href: string }[] {
  return [...(footer.links ?? []), { label: "Privacy", href: PRIVACY_URL }];
}

function footerHtml(footer: Footer, assetBase: string): string {
  const badge = footer.scheduledWith
    ? `<table ${TABLE} style="margin:0 0 8px"><tr><td style="vertical-align:middle;padding-right:6px">${markHtml(assetBase)}</td><td class="m-fg" style="vertical-align:middle;${font(12, 1.3, 600)};color:${LIGHT.fg}">${SCHEDULED_WITH}</td></tr></table>`
    : "";
  const links = footerLinks(footer)
    .map(
      (item) =>
        `<a class="m-muted" href="${escapeHtml(safeHref(item.href))}" target="_blank" style="color:${LIGHT.muted};text-decoration:underline">${escapeHtml(item.label)}</a>`,
    )
    .join(" · ");
  return `<tr><td style="padding:14px 0 0"><table ${TABLE} width="100%"><tr><td class="m-line m-muted" style="border-top:1px solid ${LIGHT.line};padding-top:18px;${font(12, 1.55)};color:${LIGHT.muted}">${badge}<p style="margin:0 0 6px">${escapeHtml(footer.reason)}</p><p style="margin:0 0 6px">${escapeHtml(LEGAL_LINE)}</p><p style="margin:0">${links}</p></td></tr></table></td></tr>`;
}

function renderHtml(
  doc: EmailDoc,
  subject: string,
  preheader: string,
  options: RenderOptions,
): string {
  const assetBase = options.assetBase ?? DEFAULT_EMAIL_ASSET_BASE;
  const rows = doc.blocks
    .map((block) => {
      const gap = BLOCK_GAP[block.type] ?? 18;
      return `<tr><td style="padding:0 0 ${gap}px">${blockHtml(block, assetBase)}</td></tr>`;
    })
    .join("\n");
  // Padding after the preheader stops mail apps pulling body text into the preview line.
  const preheaderPad = "&#847;&zwnj;&nbsp;".repeat(40);
  return `<!doctype html>
<html lang="en" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>table,td,div,p,a,span,h1,li{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
<style>
${styleBlock(options.colorScheme ?? "auto")}
</style>
</head>
<body class="m-canvas" style="margin:0;padding:0;background-color:${LIGHT.canvas}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}${preheaderPad}</div>
<table ${TABLE} class="m-canvas" width="100%" bgcolor="${LIGHT.canvas}" style="background-color:${LIGHT.canvas}">
<tr><td align="center" style="padding:0">
<!--[if mso]><table ${TABLE} width="600"><tr><td><![endif]-->
<table ${TABLE} width="100%" style="max-width:600px">
<tr><td class="m-pad" align="left" style="padding:40px 40px 32px">
<table ${TABLE} width="100%" style="max-width:520px">
${rows}
${footerHtml(doc.footer, assetBase)}
</table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

function blockText(block: Block): string | null {
  switch (block.type) {
    case "lockup":
      return null;
    case "host":
    case "workspace":
      return block.name;
    case "heading":
    case "signoff":
    case "eyebrow":
      return block.text;
    case "sentence":
    case "paragraph":
    case "muted":
      return inlineText(block.parts);
    case "code":
      return block.code;
    case "button":
      return [`${block.label}: ${safeHref(block.href)}`, block.caption].filter(Boolean).join("\n");
    case "link":
      return `${block.label}: ${safeHref(block.href)}`;
    case "rows":
      return block.rows.map((row) => `${row.label}: ${row.value}`).join("\n");
    case "list":
      return block.items.map((item) => `- ${inlineText(item)}`).join("\n");
    case "attachment":
      return `Attached: ${block.filename} (${block.label})`;
    case "item":
      return `${block.title}\n${block.body}`;
  }
}

function renderText(doc: EmailDoc): string {
  const body = doc.blocks.map(blockText).filter((part): part is string => Boolean(part));
  const footer = [
    "--",
    ...(doc.footer.scheduledWith ? [SCHEDULED_WITH] : []),
    doc.footer.reason,
    ...footerLinks(doc.footer).map((item) => `${item.label}: ${safeHref(item.href)}`),
    LEGAL_LINE,
  ];
  return `${[...body, footer.join("\n")].join("\n\n")}\n`;
}
