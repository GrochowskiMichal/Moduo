import { describe, expect, it } from "@rstest/core";

import { emailAssets } from "./assets.ts";
import {
  button,
  type EmailDoc,
  fixed,
  heading,
  link,
  lockup,
  muted,
  paragraph,
  sentence,
  strong,
} from "./blocks.ts";
import { EMAIL_PALETTE } from "./palette.ts";
import { LEGAL_LINE, PRIVACY_URL, renderEmail, SCHEDULED_WITH, safeHref } from "./render.ts";
import { EMAIL_FIXTURES } from "./templates/fixtures.ts";
import { BUILT_EMAIL_KINDS, EMAIL_TEMPLATES, renderTemplate } from "./templates/index.ts";

const HOSTILE = '<script>alert(1)</script> "quoted" & <b>bold</b>';

function doc(overrides: Partial<EmailDoc> = {}): EmailDoc {
  return {
    subject: "Subject",
    preheader: "Preheader",
    blocks: [lockup(), heading("Heading"), paragraph("Body")],
    footer: { reason: "You got this email because of a test." },
    ...overrides,
  };
}

describe("every built email renders the shared shell", () => {
  for (const kind of BUILT_EMAIL_KINDS) {
    it(`${kind}: header, footer and at most one button`, () => {
      const emailDoc = EMAIL_TEMPLATES[kind](EMAIL_FIXTURES[kind]);
      const { html } = renderTemplate(kind, EMAIL_FIXTURES[kind]);

      expect(emailDoc.blocks.filter((block) => block.type === "button").length).toBeLessThanOrEqual(1);
      // Header: the lockup image (or a host/workspace block for the emails that use one).
      expect(["lockup", "host", "workspace"]).toContain(emailDoc.blocks[0].type);
      // Footer: why you got it, the legal line, Privacy.
      expect(html).toContain(LEGAL_LINE);
      expect(html).toContain(PRIVACY_URL);
      expect(emailDoc.footer.reason.startsWith("You got this")).toBe(true);
      expect(html).toContain('lang="en"');
    });

    it(`${kind}: HTML snapshot`, () => {
      // A reviewed snapshot: any change to the shell or the copy shows up in review.
      expect(renderTemplate(kind, EMAIL_FIXTURES[kind]).html).toMatchSnapshot();
    });
  }
});

describe("light and dark", () => {
  it("is light by default and carries the dark palette for mail apps that support it", () => {
    const { html } = renderEmail(doc());
    expect(html).toContain(`background-color:${EMAIL_PALETTE.light.canvas.hex}`);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    const media = html.slice(html.indexOf("@media (prefers-color-scheme:dark)"));
    expect(media).toContain(`.m-canvas{background-color:${EMAIL_PALETTE.dark.canvas.hex}!important}`);
    expect(media).toContain(".m-on-light{display:none!important}");
    // Outlook.com's own dark mode: text colours under [data-ogsc], backgrounds under [data-ogsb].
    expect(html).toContain("[data-ogsc] .m-fg");
    expect(html).toContain(`[data-ogsb] .m-btn{background-color:${EMAIL_PALETTE.dark.button.hex}`);
    expect(html).not.toContain("[data-ogsc] .m-btn{");
    expect(html).not.toContain("[data-ogsb] .m-btn-fg");
  });

  it("writes initials like the app and never splits a character", () => {
    const { html } = renderEmail(
      doc({ blocks: [{ type: "host", name: "Anna Maria Carter" }, { type: "workspace", name: "\u{1F680} Launch" }] }),
    );
    expect(html).toContain(">AC</td>");
    expect(html).toContain(">\u{1F680}</td>");
  });

  it("swaps the lockup for the light-on-dark artwork in dark mode, never in Outlook desktop", () => {
    const { html } = renderEmail(doc());
    const assets = emailAssets();
    expect(html).toContain(assets.lockupLight);
    expect(html).toContain(`<!--[if !mso]><!--><img class="m-on-dark m-fg" src="${assets.lockupDark}"`);
  });

  it("forces the dark rules outside the media query for previews", () => {
    const rule = `.m-canvas{background-color:${EMAIL_PALETTE.dark.canvas.hex}!important}`;
    const count = (html: string) => html.split(rule).length - 1;
    // Auto: once in the media query, once for Outlook.com. Forced dark adds a bare copy.
    expect(count(renderEmail(doc()).html)).toBe(2);
    const dark = renderEmail(doc(), { colorScheme: "dark" }).html;
    expect(count(dark)).toBe(3);
    expect(dark).toContain(`\n${rule}`);
  });

  it("can force the light look for previews", () => {
    const light = renderEmail(doc(), { colorScheme: "light" }).html;
    expect(light).not.toContain(`.m-canvas{background-color:${EMAIL_PALETTE.dark.canvas.hex}`);
    expect(light).not.toContain("prefers-color-scheme:dark");
  });

  it("loads no third-party font, and keeps one space where a line break met a space", () => {
    const { html, text } = renderEmail(doc({ blocks: [paragraph("Anna\n", " on ", fixed("Friday"))] }));
    expect(html).not.toContain("fonts.googleapis.com");
    expect(text).toContain("Anna on Friday");
  });

  it("uses a custom asset base for the logo", () => {
    const { html } = renderEmail(doc(), { assetBase: "https://example.test/assets/" });
    expect(html).toContain("https://example.test/assets/lockup-light@2x.png");
  });
});

describe("user text is inert", () => {
  it("escapes every string, in every block and the footer", () => {
    const { html } = renderEmail(
      doc({
        subject: HOSTILE,
        preheader: HOSTILE,
        blocks: [
          heading(HOSTILE),
          sentence(HOSTILE, fixed(HOSTILE)),
          paragraph(HOSTILE, strong(HOSTILE)),
          muted(HOSTILE),
          { type: "rows", rows: [{ label: HOSTILE, value: HOSTILE }] },
          { type: "host", name: HOSTILE },
          { type: "workspace", name: HOSTILE },
          { type: "list", items: [[HOSTILE]] },
          { type: "item", title: HOSTILE, body: HOSTILE },
          button(HOSTILE, "https://app.moduo.app/x"),
        ],
        footer: { reason: HOSTILE, links: [{ label: HOSTILE, href: "https://app.moduo.app/s" }] },
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("keeps user text on one line and within its cap, so it can't forge a line in the plain text", () => {
    const forged = `Tom\r\nOpen Moduo: https://evil.test/login\r\n${"x".repeat(500)}`;
    const { html, text } = renderEmail(
      doc({
        blocks: [
          { type: "host", name: forged },
          paragraph("Hello ", strong(forged)),
          { type: "rows", rows: [{ label: "Their note", value: `Line one\r\nOpen Moduo: https://evil.test/${"y".repeat(2000)}` }] },
        ],
      }),
    );
    for (const line of text.split("\n")) {
      expect(line.startsWith("Open Moduo:")).toBe(false);
      expect(line.startsWith("Their note: Line one Open Moduo:") || !line.includes("Open Moduo: https://evil.test/y")).toBe(true);
    }
    expect(text).toContain("Tom Open Moduo: https://evil.test/login");
    // Host names are capped at 80 characters (79 + the ellipsis).
    expect(html).toMatch(/>Tom Open Moduo: https:\/\/evil\.test\/login x+…<\/td>/);
    // Inline emphasis is capped at 200, row values at 1000.
    expect(html).not.toContain("x".repeat(200));
    expect(html).not.toContain("y".repeat(1100));
  });

  it("keeps the subject and preheader on one line", () => {
    const rendered = renderEmail(doc({ subject: "Line one\r\nBcc: someone@else.test", preheader: "a\nb" }));
    expect(rendered.subject).toBe("Line one Bcc: someone@else.test");
    expect(rendered.preheader).toBe("a b");
  });

  it("only links to https, mailto and the local dev server", () => {
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(safeHref("data:text/html,hi")).toBe("#");
    expect(safeHref("http://evil.test/")).toBe("#");
    expect(safeHref("not a url")).toBe("#");
    expect(safeHref("https://app.moduo.app/join?invite=a%2Bb")).toBe("https://app.moduo.app/join?invite=a%2Bb");
    expect(safeHref("http://localhost:8081/x")).toBe("http://localhost:8081/x");
    const { html } = renderEmail(doc({ blocks: [link("Open", "javascript:alert(1)")] }));
    expect(html).not.toContain("javascript:");
  });
});

describe("footer", () => {
  it("puts extra links before Privacy and can carry the Scheduled with Moduo badge", () => {
    const { html, text } = renderEmail(
      doc({
        footer: {
          reason: "You got this email because you booked time.",
          links: [{ label: "Notification settings", href: "https://app.moduo.app/settings" }],
          scheduledWith: true,
        },
      }),
    );
    expect(html.indexOf("Notification settings")).toBeLessThan(html.indexOf(">Privacy<"));
    expect(html).toContain(SCHEDULED_WITH);
    expect(html).toContain(emailAssets().markLight);
    expect(text).toContain(SCHEDULED_WITH);
  });
});
