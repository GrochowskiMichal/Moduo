import { describe, expect, it } from "@rstest/core";

import { findCssUrls, rewriteCssUrls } from "./css-urls";

const urls = (css: string) => findCssUrls(css).map((r) => r.url);

describe("findCssUrls", () => {
  it("finds bare, quoted and escaped url()", () => {
    expect(urls("a{background:url(http://t.co/x.gif)}")).toEqual(["http://t.co/x.gif"]);
    expect(urls("a{background:url( 'http://t.co/q' )}")).toEqual(["http://t.co/q"]);
    expect(urls('a{background:u\\72l("http://t.co/e")}')).toEqual(["http://t.co/e"]);
    expect(urls("a{background:url(http://t.co/\\61)}")).toEqual(["http://t.co/a"]);
    expect(urls("a{b:URL(x)}")).toEqual(["x"]);
  });

  it("flags unparseable references as null", () => {
    expect(urls("a{b:url(http://x y)}")).toEqual([null]);
    expect(urls("a{b:url(http://x(y)}")).toEqual([null]);
    expect(urls("a{b:url(http://x")).toEqual([null]);
    expect(urls('a{b:url("http://x" junk)}')).toEqual([null]);
    expect(urls('a{b:url("http://x)}')).toEqual([null]);
  });

  it("covers image-set, @import, src() and ignores comments", () => {
    expect(urls('a{b:image-set("http://a/1" 1x, "http://a/2" 2x)}')).toEqual([
      "http://a/1",
      "http://a/2",
    ]);
    expect(urls('@import "http://i/x.css";')).toEqual(["http://i/x.css"]);
    expect(urls('@font-face{src:src("http://f/f.woff")}')).toEqual(["http://f/f.woff"]);
    expect(urls("/* url(http://c) */a{color:red}")).toEqual([]);
    expect(urls('a{b:"http://plain"}')).toEqual([]);
    expect(urls("a{width:10px;b:url(z)}")).toEqual(["z"]);
  });

  it("keeps escapes in strings and bad escapes", () => {
    expect(urls('a{b:url("http://x/\\\nq")}')).toEqual(["http://x/q"]);
    expect(urls('a{b:url("\\0")}')).toEqual(["\uFFFD"]);
    expect(urls("a{b:url(x\\\ny)}")).toEqual([null]);
  });
});

describe("rewriteCssUrls", () => {
  it("replaces the dropped references only", () => {
    const r = rewriteCssUrls(
      'a{b:url(http://t/x);c:image-set("http://t/y" 1x)}',
      (u) => u === null || u.includes("t/x"),
    );
    expect(r).toEqual({ css: 'a{b:none;c:image-set("http://t/y" 1x)}', dropped: 1 });
    expect(rewriteCssUrls("a{}", () => true)).toEqual({ css: "a{}", dropped: 0 });
  });
});
