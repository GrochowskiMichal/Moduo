// DF-6 — remote-content blocking + auto-height injection in buildEmailSrcDoc.

import { describe, expect, it } from "@rstest/core";

import {
  buildEmailReaderDoc,
  buildEmailSrcDoc,
  countRemoteRefs,
  EMAIL_IFRAME_HEIGHT_MESSAGE,
} from "./email-html";

describe("buildEmailSrcDoc — remote blocking (default)", () => {
  it("strips remote img src and ships a data:/cid:-only CSP", () => {
    const out = buildEmailSrcDoc(`<p>Hi</p><img src="https://tracker.example/pixel.gif" alt="" />`);
    expect(out).not.toContain("tracker.example");
    expect(out).toContain("img-src data: cid:");
    expect(out).not.toContain("img-src data: https:");
  });

  it("keeps cid: and data: images intact", () => {
    const out = buildEmailSrcDoc(
      `<img src="cid:logo@corp" /><img src="data:image/gif;base64,R0lGOD" />`,
    );
    expect(out).toContain("cid:logo@corp");
    expect(out).toContain("data:image/gif;base64,R0lGOD");
  });

  it("neutralizes srcset, poster, background attrs and remote link tags", () => {
    const out = buildEmailSrcDoc(
      `<img srcset="https://cdn.example/a.png 1x" />` +
        `<video poster="https://cdn.example/p.jpg"></video>` +
        `<table background="https://cdn.example/bg.png"><tr><td>x</td></tr></table>` +
        `<link rel="stylesheet" href="https://cdn.example/mail.css" />`,
    );
    expect(out).not.toContain("cdn.example");
  });

  it("drops remote url() from inline styles but keeps the rest of the rule", () => {
    const out = buildEmailSrcDoc(
      `<div style="color: rgb(200, 0, 0); background: rgb(0, 0, 200) url('https://cdn.example/bg.png')">x</div>`,
    );
    expect(out).not.toContain("cdn.example");
    expect(out).toContain("color: rgb(200, 0, 0)");
  });

  it("keeps remote content when blockRemote is false", () => {
    const out = buildEmailSrcDoc(`<img src="https://cdn.example/photo.jpg" />`, {
      blockRemote: false,
    });
    expect(out).toContain("https://cdn.example/photo.jpg");
    expect(out).toContain("img-src data: https: http: cid:");
  });

  it("still strips scripts and on* handlers (regression)", () => {
    const out = buildEmailSrcDoc(
      `<script>alert(1)</script><img src="cid:x" onerror="alert(2)" /><iframe src="https://x.example"></iframe>`,
    );
    expect(out).not.toContain("alert(1)");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("x.example");
  });
});

describe("buildEmailSrcDoc — auto-height reporter", () => {
  it("injects a nonce-pinned script and matching script-src when enabled", () => {
    const out = buildEmailSrcDoc(`<p>Hi</p>`, { autoHeight: true });
    const nonce = /script-src 'nonce-([^']+)'/.exec(out)?.[1];
    expect(nonce).toBeTruthy();
    expect(out).toContain(`<script nonce="${nonce}">`);
    expect(out).toContain(EMAIL_IFRAME_HEIGHT_MESSAGE);
  });

  it("ships no script (and no script-src) by default", () => {
    const out = buildEmailSrcDoc(`<p>Hi</p>`);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("script-src");
  });
});

describe("countRemoteRefs", () => {
  it("counts every remote vector", () => {
    const count = countRemoteRefs(
      `<img src="https://a.example/i.png" />` +
        `<img srcset="//b.example/i2.png 1x" />` +
        `<video poster="http://c.example/p.jpg"></video>` +
        `<table background="https://d.example/bg.png"><tr><td>x</td></tr></table>` +
        `<div style="background-image: url(https://e.example/x.png)">x</div>` +
        `<style>.h { background: url('https://f.example/y.png'); }</style>` +
        `<link href="https://g.example/mail.css" rel="stylesheet" />`,
    );
    expect(count).toBe(7);
  });

  it("is 0 for local-only content", () => {
    expect(
      countRemoteRefs(`<p>Hi</p><img src="cid:logo" /><img src="data:image/gif;base64,AA" />`),
    ).toBe(0);
  });
});

describe("buildEmailReaderDoc", () => {
  it("returns the remote count alongside the blocked srcdoc (single parse)", () => {
    const { srcDoc, remoteCount } = buildEmailReaderDoc(
      `<p>Hi</p><img src="https://tracker.example/pixel.gif" />`,
      { blockRemote: true, autoHeight: true },
    );
    expect(remoteCount).toBe(1);
    expect(srcDoc).not.toContain("tracker.example");
  });

  it("counts remote refs even when not blocking", () => {
    const { srcDoc, remoteCount } = buildEmailReaderDoc(
      `<img src="https://cdn.example/photo.jpg" />`,
      { blockRemote: false },
    );
    expect(remoteCount).toBe(1);
    expect(srcDoc).toContain("https://cdn.example/photo.jpg");
  });
});

describe("buildEmailReaderDoc — navigation vectors (MOD-574)", () => {
  it("drops meta refresh, in head or body, so an email can't load a page on open", () => {
    const { srcDoc } = buildEmailReaderDoc(
      `<html><head><meta http-equiv="refresh" content="0;url=https://phish.example/login"></head>` +
        `<body><p>Hi</p><META HTTP-EQUIV="Refresh" CONTENT="1; URL=https://phish.example/2"></body></html>`,
    );
    expect(srcDoc).not.toContain("phish.example");
    expect(srcDoc.toLowerCase()).not.toContain("refresh");
  });

  it("drops a refresh that hides behind a charset attribute", () => {
    const { srcDoc } = buildEmailReaderDoc(
      `<meta charset="utf-8" http-equiv="refresh" content="0;url=https://phish.example/">`,
    );
    expect(srcDoc).not.toContain("phish.example");
  });

  it("drops <base> and every meta but charset/content-type", () => {
    const { srcDoc } = buildEmailReaderDoc(
      `<head><base href="https://evil.example/"><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2">` +
        `<meta name="referrer" content="unsafe-url"><meta http-equiv="Content-Security-Policy" content="default-src *">` +
        `<meta http-equiv="set-cookie" content="a=b"></head><body><a href="next">next</a></body>`,
    );
    expect(srcDoc).not.toContain("evil.example");
    expect(srcDoc).not.toContain("<base");
    expect(srcDoc).not.toContain("unsafe-url");
    expect(srcDoc).not.toContain("default-src *");
    expect(srcDoc).not.toContain("set-cookie");
    expect(srcDoc).toContain('content="text/html; charset=iso-8859-2"');
    // Our own CSP and charset still lead the document.
    expect(srcDoc).toContain('<meta charset="utf-8" />');
    expect(srcDoc).toContain("default-src 'none'");
  });
});

describe("remote url() detection — linear time (MOD-577 F19)", () => {
  it("still matches every spelling of a remote url()", () => {
    for (const style of [
      "background:url(https://x.example/a.png)",
      "background:url( 'http://x.example/a.png')",
      'background:url(" //x.example/a.png")',
      "background:url(  ' https://x.example/a.png')",
    ]) {
      expect(countRemoteRefs(`<div style="${style.replace(/"/g, "&quot;")}">x</div>`)).toBe(1);
    }
    expect(countRemoteRefs(`<div style="background:url(data:image/png;base64,AAAA)">x</div>`)).toBe(
      0,
    );
  });

  it("scans a hostile style of long whitespace runs quickly", () => {
    const hostile = `url(${" ".repeat(20_000)}x;`.repeat(20);
    const started = performance.now();
    expect(countRemoteRefs(`<style>${hostile}</style><div style="${hostile}">x</div>`)).toBe(0);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
