import { describe, expect, it } from "@rstest/core";

import { buildReaderDoc, messageNonce, shouldLoadImages, stripTrackers } from "./sanitize";

const base = {
  policy: "block" as const,
  senderIsContact: false,
  senderAllowed: false,
  loadedForMessage: false,
};
const MAIL = `<p>Hello</p><img src="https://cdn.acme.io/hero.png" alt="hero">
<img src="https://acme.list-manage.com/track/open.php?u=1" width="1" height="1">
<img src="https://x.test/o.gif" style="width:1px;height:1px">`;

describe("images policy", () => {
  it("blocks by default and obeys contacts / always / per-message / per-sender", () => {
    expect(shouldLoadImages(base)).toBe(false);
    expect(shouldLoadImages({ ...base, policy: "contacts" })).toBe(false);
    expect(shouldLoadImages({ ...base, policy: "contacts", senderIsContact: true })).toBe(true);
    expect(shouldLoadImages({ ...base, policy: "always" })).toBe(true);
    expect(shouldLoadImages({ ...base, loadedForMessage: true })).toBe(true);
    expect(shouldLoadImages({ ...base, senderAllowed: true })).toBe(true);
  });

  it("blocked mail keeps no remote src and reports the blocked count", () => {
    const doc = buildReaderDoc("m-1", MAIL, base);
    expect(doc.imagesLoaded).toBe(false);
    expect(doc.srcDoc).not.toContain("cdn.acme.io");
    expect(doc.remoteBlocked).toBe(1);
  });
});

describe("trackers stripped after load", () => {
  it("keeps real images but never the pixels once images load", () => {
    const doc = buildReaderDoc("m-2", MAIL, { ...base, loadedForMessage: true });
    expect(doc.srcDoc).toContain("cdn.acme.io/hero.png");
    expect(doc.srcDoc).not.toContain("list-manage.com");
    expect(doc.srcDoc).not.toContain("x.test/o.gif");
    expect(doc.remoteBlocked).toBe(0);
  });

  it("tracker blocking off lets them through", () => {
    const doc = buildReaderDoc("m-3", MAIL, { ...base, policy: "always" }, false);
    expect(doc.srcDoc).toContain("list-manage.com");
    expect(doc.trackers).toBe(0);
  });
});

describe("shield count", () => {
  it("counts each stripped tracker", () => {
    expect(stripTrackers(MAIL).trackers).toBe(2);
    expect(buildReaderDoc("m-4", MAIL, base).trackers).toBe(2);
    expect(stripTrackers("<p>plain</p>").trackers).toBe(0);
    expect(
      stripTrackers('<img src="data:image/gif;base64,R0" width="1" height="1">').trackers,
    ).toBe(0);
  });
});

describe("stable nonce", () => {
  it("is the same for one message across loads and differs between messages", () => {
    const a = buildReaderDoc("m-5", MAIL, base);
    const b = buildReaderDoc("m-5", MAIL, { ...base, loadedForMessage: true });
    expect(a.nonce).toBe(b.nonce);
    expect(a.srcDoc).toContain(`nonce-${a.nonce}`);
    expect(messageNonce("m-6")).not.toBe(a.nonce);
  });
});

describe("tracker hosts on every remote vector", () => {
  const T = "https://acme.list-manage.com/o.gif";
  const loaded = { ...base, loadedForMessage: true };
  const check = (html: string, keep: string[] = []) => {
    const doc = buildReaderDoc(`v-${html.length}-${keep.length}`, html, loaded);
    expect(doc.srcDoc).not.toContain("list-manage.com");
    for (const k of keep) expect(doc.srcDoc).toContain(k);
    expect(doc.trackers).toBeGreaterThan(0);
    return doc;
  };

  it("img srcset candidates", () => {
    const doc = check(
      `<img src="https://cdn.acme.io/a.png" srcset="https://cdn.acme.io/a2.png 2x, ${T} 3x">`,
      ["cdn.acme.io/a.png", "cdn.acme.io/a2.png"],
    );
    expect(doc.trackers).toBe(1);
  });

  it("srcset-only tracker img", () => {
    check(`<p>hi</p><img srcset="${T} 1x">`, ["hi"]);
  });

  it("picture source srcset", () => {
    check(`<picture><source srcset="${T}"><img src="https://cdn.acme.io/p.png"></picture>`, [
      "cdn.acme.io/p.png",
    ]);
  });

  it("video poster", () => {
    check(`<video poster="${T}"></video><p>v</p>`, ["v"]);
  });

  it("background attribute", () => {
    check(`<table background="${T}"><tr><td>cell</td></tr></table>`, ["cell"]);
  });

  it("inline style url()", () => {
    const doc = check(
      `<div style="background:url('${T}') no-repeat; color: red">x</div>
       <div style="background-image:url(https://cdn.acme.io/bg.png)">y</div>`,
      ["cdn.acme.io/bg.png"],
    );
    expect(doc.trackers).toBe(1);
  });

  it("<style> url()", () => {
    check(
      `<style>.a{background:url("${T}")} .b{background:url(https://cdn.acme.io/s.png)}</style><p class="a">s</p>`,
      ["cdn.acme.io/s.png"],
    );
  });

  it("counts each vector for the shield even with images blocked", () => {
    const html = `<img srcset="${T} 1x"><video poster="${T}"></video><table><tr><td background="${T}"></td></tr></table>
      <div style="background:url(${T})"></div><style>p{background:url(${T})}</style>`;
    expect(stripTrackers(html).trackers).toBe(5);
    expect(buildReaderDoc("v-blocked", html, base).trackers).toBe(5);
  });
});
