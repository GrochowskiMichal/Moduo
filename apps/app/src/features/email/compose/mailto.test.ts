import { describe, expect, it } from "@rstest/core";

import { interceptMailto, parseMailto } from "./mailto";

describe("mailto (AC24)", () => {
  it("parses RFC 6068 with subject, cc and body", () => {
    expect(
      parseMailto("mailto:a@x.com,b@y.com?cc=c@z.com&subject=Hello%20there&body=Line%201%0D%0ALine+2&from=evil@x.com"),
    ).toEqual({
      to: ["a@x.com", "b@y.com"],
      cc: ["c@z.com"],
      bcc: [],
      subject: "Hello there",
      body: "Line 1\nLine+2",
      inReplyTo: null,
    });
    expect(parseMailto("https://x.com")).toBeNull();
    expect(parseMailto("MAILTO:?to=a@x.com")?.to).toEqual(["a@x.com"]);
  });

  it("intercepts mailto links clicked inside Moduo", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "mailto:a@x.com?subject=Hi");
    const span = document.createElement("span");
    a.appendChild(span);
    let prevented = false;
    let opened: unknown = null;
    const handled = interceptMailto(
      { target: span, preventDefault: () => (prevented = true) },
      (p) => (opened = p),
    );
    expect(handled).toBe(true);
    expect(prevented).toBe(true);
    expect(opened).toMatchObject({ to: ["a@x.com"], subject: "Hi" });
  });
});
