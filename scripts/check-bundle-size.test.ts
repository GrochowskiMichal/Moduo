import { firstLoadScripts } from "./check-bundle-size";

describe("firstLoadScripts", () => {
  it("collects local scripts and module preloads, not remote ones or styles", () => {
    const html = `<head>
      <script defer src="/static/js/lib-react.1.js"></script>
      <script defer src="/static/js/index.2.js"></script>
      <link rel="modulepreload" href="/static/js/l.3.js">
      <link rel="stylesheet" href="/static/css/index.css">
      <script src="https://example.com/x.js"></script>
    </head>`;
    expect(firstLoadScripts(html)).toEqual([
      "/static/js/lib-react.1.js",
      "/static/js/index.2.js",
      "/static/js/l.3.js",
    ]);
  });
});
