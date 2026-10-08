import { describe, expect, it } from "@rstest/core";

import { renderTemplate } from "./index.ts";

describe("A1 · sign-in code", () => {
  it("puts the code in the subject and says how long it works", () => {
    const email = renderTemplate("auth_code", { code: "482913", email: "tom@becker.studio" });
    expect(email.subject).toBe("482913 is your Moduo code");
    expect(email.preheader).toBe("It works for 10 minutes.");
    expect(email.text).toContain("Your sign-in code");
    expect(email.text).toContain("Enter this code in Moduo to sign in.");
    expect(email.text).toContain("482913");
    expect(email.text).toContain(
      "It works once, for 10 minutes. If you didn't ask for it, ignore this email. Nobody can sign in without the code.",
    );
    expect(email.text).toContain("You got this email because someone asked to sign in to Moduo with tom@becker.studio.");
    expect(email.html).toContain(">482913</td>");
  });

  it("follows the configured expiry", () => {
    expect(renderTemplate("auth_code", { code: "1", email: "a@b.test", validMinutes: 1 }).preheader).toBe(
      "It works for 1 minute.",
    );
  });

  it("never renders anything but the code characters in the code box", () => {
    const email = renderTemplate("auth_code", { code: "48<b>29</b>13", email: "a@b.test" });
    expect(email.subject).toBe("48b29b13 is your Moduo code");
    expect(email.html).not.toContain("<b>");
  });

  it("refuses to render without a code", () => {
    expect(() => renderTemplate("auth_code", { code: "<>", email: "a@b.test" })).toThrow("empty code");
  });

  it("has no sign-in link", () => {
    const email = renderTemplate("auth_code", { code: "482913", email: "tom@becker.studio" });
    expect(email.html).not.toContain('class="m-btn"');
  });
});
