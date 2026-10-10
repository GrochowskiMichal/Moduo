import { describe, expect, it } from "@rstest/core";

import { button, codeBox, fixed, heading, link, paragraph, sentence, signoff, strong } from "./blocks.ts";
import { LEGAL_LINE, PRIVACY_URL, renderEmail } from "./render.ts";
import { EMAIL_FIXTURES } from "./templates/fixtures.ts";
import { BUILT_EMAIL_KINDS, renderTemplate, templateDoc } from "./templates/index.ts";
import { inlineText } from "./blocks.ts";

describe("plain-text twin", () => {
  for (const kind of BUILT_EMAIL_KINDS) {
    it(`${kind}: carries every sentence and full links, no markup`, () => {
      const emailDoc = templateDoc(kind, EMAIL_FIXTURES[kind]);
      const { text } = renderTemplate(kind, EMAIL_FIXTURES[kind]);
      expect(text).not.toMatch(/<[a-z!/]/i);
      for (const block of emailDoc.blocks) {
        if (block.type === "heading") expect(text).toContain(block.text);
        if (block.type === "paragraph" || block.type === "muted" || block.type === "sentence") {
          expect(text).toContain(inlineText(block.parts));
        }
        if (block.type === "code") expect(text).toContain(block.code);
        if (block.type === "button" || block.type === "link") expect(text).toContain(block.href);
      }
      expect(text).toContain(emailDoc.footer.reason);
      expect(text).toContain(LEGAL_LINE);
      expect(text).toContain(`Privacy: ${PRIVACY_URL}`);
    });
  }

  it("writes buttons and links as label: URL, and flattens emphasis", () => {
    const { text } = renderEmail({
      subject: "s",
      preheader: "p",
      blocks: [
        heading("Hello"),
        sentence("You're meeting Anna on ", fixed("Friday 16 October"), "."),
        paragraph("Sign in with ", strong("tom@becker.studio"), "."),
        codeBox("482913"),
        button("Open Moduo", "https://app.moduo.app", "app.moduo.app"),
        link("Can't make it? Cancel the meeting", "https://moduo.app/book/cancel?token=abc"),
        signoff("Maciej & Mike"),
      ],
      footer: { reason: "You got this email because of a test." },
    });
    expect(text).toContain("You're meeting Anna on Friday 16 October.");
    expect(text).toContain("Sign in with tom@becker.studio.");
    expect(text).toContain("Open Moduo: https://app.moduo.app/");
    expect(text).toContain("Can't make it? Cancel the meeting: https://moduo.app/book/cancel?token=abc");
    expect(text).toContain("Maciej & Mike");
    expect(text).not.toContain("&amp;");
  });
});
