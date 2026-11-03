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
