import { describe, expect, it } from "@rstest/core";

import { createTauriMailCompose, MAILTO_EVENT } from "@/lib/runtime.tauri.mail-compose";

import { applyMailtoPrefill, drainMailto, interceptMailto, parseMailto } from "./mailto";

describe("mailto (AC24)", () => {
  it("parses RFC 6068 with subject, cc and body", () => {
    expect(
      parseMailto(
        "mailto:a@x.com,b@y.com?cc=c@z.com&subject=Hello%20there&body=Line%201%0D%0ALine+2&from=evil@x.com",
      ),
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

describe("mailto deep link (AC24)", () => {
  it("drains every pending URL into a filled compose, skipping junk", async () => {
    const opened: string[] = [];
    const n = await drainMailto(
      async () => ["mailto:a@x.test?subject=Hi%20there&body=L1%0D%0A%3Cb%3E", "https://x.test"],
      (p) => {
        const spec = applyMailtoPrefill(
          { to: "", cc: "", bcc: "", subject: "", bodyHtml: "", inReplyTo: null },
          p,
        );
        opened.push(`${spec.to}|${spec.subject}|${spec.bodyHtml}`);
      },
    );
    expect(n).toBe(1);
    expect(opened).toEqual(["a@x.test|Hi there|<p>L1</p><p>&lt;b&gt;</p>"]);
  });

  it("the desktop port drains through mail_take_mailto and listens on the Rust event", async () => {
    const calls: string[] = [];
    let fire: (() => void) | null = null;
    const port = createTauriMailCompose(
      async <T>(cmd: string) => {
        calls.push(cmd);
        return ["mailto:b@x.test"] as T;
      },
      async (event, cb) => {
        calls.push(`listen:${event}`);
        fire = cb;
        return () => calls.push("unlisten");
      },
    );
    let nudges = 0;
    const off = port.onMailto!(() => nudges++);
    await Promise.resolve();
    (fire as unknown as () => void)();
    expect(await port.takeMailto!()).toEqual(["mailto:b@x.test"]);
    off();
    expect(nudges).toBe(1);
    expect(calls).toEqual([`listen:${MAILTO_EVENT}`, "mail_take_mailto", "unlisten"]);
  });
});
